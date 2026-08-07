import { Injectable, BadRequestException, ForbiddenException, NotFoundException, Inject } from '@nestjs/common';
import { hashSync } from 'bcryptjs';
import { Prisma, ExpertLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { RegisterSupplierDto } from './dto/register-supplier.dto';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { RegisterTemporarySupplierDto } from './dto/register-temporary-supplier.dto';
import { CreateChangeRequestDto } from './dto/create-change-request.dto';
import { CreateQualificationDto } from './dto/create-qualification.dto';
import { CreateEvaluationDto } from './dto/create-evaluation.dto';
import { CreateClassificationDto, UpdateClassificationDto } from './dto/create-classification.dto';
import { NegotiationConfigDto } from './dto/negotiation-config.dto';
import { isSupplierChangeAllowedField } from './supplier-change-fields';
import { shouldAutoDisable, aggregatePerformance } from './supplier-performance';
import { buildSupplierPortrait } from './supplier-portrait.util';
import { generateBusinessTags, TAG_MIN } from './business-tags';
import { LlmService } from '../local-ai/llm.service';

// 等级→数值映射（与 expert-admin.service.ts 共享语义，ExpertLevel: A=5 B=4 C=3 D=2 E=1）
const GRADE_SCORE: Record<ExpertLevel, number> = { A: 5, B: 4, C: 3, D: 2, E: 1 };
const SCORE_GRADE: Record<number, ExpertLevel> = { 5: 'A', 4: 'B', 3: 'C', 2: 'D', 1: 'E' };

/** 加权计算综合等级：
 *  completeness(20%) + responsiveness(30%) + cooperation(20%) + compliance(20%) + comprehensive(10%)
 */
function computeFinalGrade(
  completeness: ExpertLevel,
  responsiveness: ExpertLevel,
  cooperation: ExpertLevel,
  compliance: ExpertLevel,
  comprehensive: ExpertLevel,
): ExpertLevel {
  const w =
    GRADE_SCORE[completeness] * 0.2 +
    GRADE_SCORE[responsiveness] * 0.3 +
    GRADE_SCORE[cooperation] * 0.2 +
    GRADE_SCORE[compliance] * 0.2 +
    GRADE_SCORE[comprehensive] * 0.1;
  return SCORE_GRADE[Math.round(w)];
}

@Injectable()
export class SupplierService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
    @Inject('REDIS_CLIENT') private redis: any,
    private llm: LlmService,
  ) {}

  /**
   * 生成供应商编号 SUP-000001（6 位递增数字）。
   * 使用 PG 序列 supplier_no_seq 原子递增，并发注册安全。
   * 序列在迁移 20260807000000_supplier_no 中创建。
   */
  private async generateSupplierNo(tx: Prisma.TransactionClient): Promise<string> {
    const [row] = await tx.$queryRaw<Array<{ supplier_no: string }>>`
      SELECT 'SUP-' || lpad(nextval('supplier_no_seq')::text, 6, '0') AS supplier_no
    `;
    return row.supplier_no;
  }

  async register(dto: RegisterSupplierDto) {
    // 检查信用代码是否重复
    const existingCreditCode = await this.prisma.supplier.findUnique({
      where: { creditCode: dto.creditCode },
    });
    if (existingCreditCode) {
      throw new BadRequestException({ error: '统一社会信用代码已存在', code: 'DUPLICATE_CREDIT_CODE' });
    }

    // 检查企业名称是否重复（标准化）
    const normalizedName = dto.name.trim().toLowerCase();
    const existingName = await this.prisma.supplier.findUnique({
      where: { normalizedName },
    });
    if (existingName) {
      throw new BadRequestException({ error: '企业名称已存在', code: 'DUPLICATE_NAME' });
    }

    // 检查用户名是否重复
    const existingUser = await this.prisma.user.findFirst({
      where: { username: dto.username, role: 'supplier' },
    });
    if (existingUser) {
      throw new BadRequestException({ error: '用户名已存在', code: 'DUPLICATE_USERNAME' });
    }

    // 创建用户和供应商 — 事务保证原子性
    const { user, supplier } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: dto.username.trim(),
          displayName: dto.displayName,
          email: dto.email,
          passwordHash: hashSync(dto.password, 10),
          role: 'supplier',
          isActive: false, // 待审核后激活
        },
      });

      const supplierNo = await this.generateSupplierNo(tx);
      const supplier = await tx.supplier.create({
        data: {
          userId: user.id,
          supplierNo,
          name: dto.name,
          normalizedName,
          creditCode: dto.creditCode,
          enterpriseType: dto.enterpriseType,
          legalPerson: dto.legalPerson,
          registeredAddress: dto.registeredAddress,
          businessScope: dto.businessScope,
          tags: dto.tags,
          contacts: {
            create: dto.contacts.map(c => ({
              name: c.name,
              phone: c.phone,
              email: c.email,
              isPrimary: c.isPrimary,
              position: c.position,
            })),
          },
          qualifications: {
            create: dto.qualifications.map(q => ({
              type: q.type,
              name: q.name,
              fileUrl: q.fileUrl,
              validFrom: q.validFrom ? new Date(q.validFrom) : undefined,
              validTo: q.validTo ? new Date(q.validTo) : undefined,
            })),
          },
        },
        include: {
          contacts: true,
          qualifications: true,
        },
      });

      return { user, supplier };
    });

    // 通知采购管理员：新供应商待审批（待办型，审批后自动 resolve）
    // 注意：绝不回传 user.passwordHash —— 注册响应泄漏密码哈希属安全事故，仅返回安全字段。
    const { passwordHash: _omit, ...safeUser } = user;
    void _omit;

    void Promise.all(['admin', 'leader', 'staff'].map(r => this.notificationService.sendToRole(r, {
      type: 'SUPPLIER_PENDING',
      title: '新供应商注册待审批',
      content: `${supplier.name} 提交了注册申请，信用代码 ${supplier.creditCode}，请前往审批。`,
      link: `/supplier/${supplier.id}`,
    })));

    return { user: safeUser, supplier };
  }

  // ═══════════════════════════════════════════════════════════
  //  临时供应商邀请码（采购端生成，有效期 30/180/360 天）
  // ═══════════════════════════════════════════════════════════
  // X-2：有效期档位可经 INVITATION_VALIDITY_DAYS env 配置（逗号分隔的正整数），默认 30/180/360
  static readonly INVITATION_VALIDITY_DAYS: readonly number[] = (process.env.INVITATION_VALIDITY_DAYS || '30,180,360')
    .split(',').map(s => parseInt(s.trim(), 10)).filter((n: number) => Number.isFinite(n) && n > 0);
  // 去除易混字符（O/0/I/1），保证人工抄录与口传无误
  private static readonly CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  private async generateUniqueCode(): Promise<string> {
    const alphabet = SupplierService.CODE_ALPHABET;
    for (let attempt = 0; attempt < 12; attempt++) {
      let code = '';
      for (let i = 0; i < 8; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
      const exists = await this.prisma.supplierInvitation.findUnique({ where: { code }, select: { id: true } });
      if (!exists) return code;
    }
    throw new BadRequestException({ error: '邀请码生成失败，请重试', code: 'CODE_GEN_FAILED' });
  }

  // 把已过期但仍为 ACTIVE 的邀请码标记为 EXPIRED（惰性同步，避免定时任务）
  private async syncExpiredStatus(): Promise<void> {
    await this.prisma.supplierInvitation.updateMany({
      where: { status: 'ACTIVE', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });
  }

  async createInvitation(dto: CreateInvitationDto, creatorId: string) {
    if (!(SupplierService.INVITATION_VALIDITY_DAYS as readonly number[]).includes(dto.validityDays)) {
      throw new BadRequestException({ error: '有效期仅支持 30/180/360 天', code: 'INVALID_VALIDITY' });
    }
    const code = await this.generateUniqueCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + dto.validityDays * 86400000);
    return this.prisma.supplierInvitation.create({
      data: {
        code,
        validityDays: dto.validityDays,
        note: dto.note?.trim() || null,
        boundCreditCode: dto.boundCreditCode?.trim() || null,
        createdById: creatorId,
        expiresAt,
      },
      include: {
        createdBy: { select: { id: true, displayName: true } },
      },
    });
  }

  async listInvitations(params: { page?: number; pageSize?: number; status?: string }) {
    await this.syncExpiredStatus();
    const page = params.page ?? 1;
    const pageSize = Math.min(params.pageSize ?? 20, 100);
    const where = params.status ? { status: params.status as any } : {};
    const [items, total] = await Promise.all([
      this.prisma.supplierInvitation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          createdBy: { select: { id: true, displayName: true } },
          usedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.supplierInvitation.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async revokeInvitation(id: string, userId: string) {
    const inv = await this.prisma.supplierInvitation.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException('邀请码不存在');
    if (inv.status === 'USED') throw new BadRequestException({ error: '已使用的邀请码不可作废', code: 'ALREADY_USED' });
    if (inv.status === 'REVOKED') throw new BadRequestException({ error: '邀请码已作废', code: 'ALREADY_REVOKED' });
    if (inv.status === 'EXPIRED') throw new BadRequestException({ error: '已过期邀请码不可作废', code: 'ALREADY_EXPIRED' });
    return this.prisma.supplierInvitation.update({
      where: { id },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedById: userId },
    });
  }

  // 公开校验邀请码（临时注册前用）——仅回 valid + validityDays + expiresAt，不泄漏创建者/使用者
  async verifyInvitationCode(rawCode: string) {
    await this.syncExpiredStatus();
    const code = rawCode.toUpperCase().trim();
    const inv = await this.prisma.supplierInvitation.findUnique({
      where: { code },
      select: { validityDays: true, status: true, expiresAt: true },
    });
    if (!inv) return { valid: false, reason: '邀请码不存在' };
    if (inv.status === 'USED') return { valid: false, reason: '邀请码已被使用' };
    if (inv.status === 'REVOKED') return { valid: false, reason: '邀请码已作废' };
    if (inv.status === 'EXPIRED' || inv.expiresAt < new Date()) return { valid: false, reason: '邀请码已过期' };
    return { valid: true, validityDays: inv.validityDays, expiresAt: inv.expiresAt };
  }

  // ═══════════════════════════════════════════════════════════
  //  临时供应商注册（凭邀请码，极简字段；审批通过后由供应商补全资料）
  // ═══════════════════════════════════════════════════════════
  async registerTemporary(dto: RegisterTemporarySupplierDto) {
    const code = dto.invitationCode.toUpperCase().trim();
    await this.syncExpiredStatus();
    const inv = await this.prisma.supplierInvitation.findUnique({ where: { code } });
    if (!inv) throw new BadRequestException({ error: '邀请码不存在', code: 'INVITATION_NOT_FOUND' });
    if (inv.status === 'USED') throw new BadRequestException({ error: '邀请码已被使用', code: 'INVITATION_USED' });
    if (inv.status === 'REVOKED') throw new BadRequestException({ error: '邀请码已作废', code: 'INVITATION_REVOKED' });
    if (inv.status === 'EXPIRED' || inv.expiresAt < new Date()) throw new BadRequestException({ error: '邀请码已过期', code: 'INVITATION_EXPIRED' });
    // R-3：若邀请码绑定了信用代码，校验注册企业必须匹配（防码泄漏被任意企业使用）
    if (inv.boundCreditCode && inv.boundCreditCode !== dto.creditCode.trim()) {
      throw new BadRequestException({ error: '该邀请码已绑定其他企业，无法使用', code: 'INVITATION_BOUND_MISMATCH' });
    }

    const normalizedName = dto.name.trim().toLowerCase();
    // 企业名称即登录用户名：同名企业 = 同 username，与 normalizedName 唯一性一致
    const username = dto.name.trim();
    const existingName = await this.prisma.supplier.findUnique({ where: { normalizedName } });
    if (existingName) throw new BadRequestException({ error: '企业名称已存在', code: 'DUPLICATE_NAME' });
    const existingCredit = await this.prisma.supplier.findUnique({ where: { creditCode: dto.creditCode.trim() } });
    if (existingCredit) throw new BadRequestException({ error: '统一社会信用代码已存在', code: 'DUPLICATE_CREDIT_CODE' });
    const existingUser = await this.prisma.user.findFirst({ where: { username, role: 'supplier' } });
    if (existingUser) throw new BadRequestException({ error: '企业名称已被注册', code: 'DUPLICATE_USERNAME' });

    const { user, supplier } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username,
          displayName: dto.displayName,
          phone: dto.phone,
          passwordHash: hashSync(dto.password, 10),
          role: 'supplier',
          isActive: false, // 仍需审核
        },
      });
      const supplier = await tx.supplier.create({
        data: {
          userId: user.id,
          name: dto.name,
          normalizedName,
          creditCode: dto.creditCode.trim(),
          supplierNo: await this.generateSupplierNo(tx),
          // 临时供应商必填字段留空（DB NOT NULL 用空串满足），不写入占位/虚假内容；
          // 审批通过后由供应商在企业信息中自行补全。
          enterpriseType: '',
          legalPerson: '',
          registeredAddress: '',
          businessScope: '',
          isTemporary: true,
          temporaryExpiresAt: inv.expiresAt,
          invitation: { connect: { id: inv.id } },
          contacts: { create: [{ name: dto.displayName, phone: dto.phone, isPrimary: true, position: '联系人' }] },
        },
        include: { contacts: true },
      });
      // P0-7 邀请码消费原子化：并发同码双注册时仅一方能把 status 从 ACTIVE 置 USED，
      // 另一方 count=0 → 事务回滚（其 user/supplier 创建一并撤销），杜绝孤儿 supplier 与占位冲突。
      const claimedInv = await tx.supplierInvitation.updateMany({
        where: { id: inv.id, status: 'ACTIVE' },
        data: { status: 'USED', usedById: supplier.id, usedAt: new Date() },
      });
      if (claimedInv.count === 0) {
        throw new BadRequestException({ error: '邀请码已被使用或已失效', code: 'INVITATION_CONFLICT' });
      }
      return { user, supplier };
    });

    const expireLabel = inv.expiresAt.toISOString().slice(0, 10);
    const { passwordHash: _omit, ...safeUser } = user; void _omit;
    void Promise.all(['admin', 'leader', 'staff'].map(r => this.notificationService.sendToRole(r, {
      type: 'SUPPLIER_PENDING',
      title: '新临时供应商注册待审批',
      content: `${supplier.name}（临时供应商，有效期至 ${expireLabel}）提交了注册申请，请前往审批。`,
      link: `/supplier/${supplier.id}`,
    })));

    return { user: safeUser, supplier, temporaryExpiresAt: inv.expiresAt, validityDays: inv.validityDays };
  }

  async list(params: { status?: string; classificationId?: string; search?: string; page?: number; pageSize?: number; sort?: 'completeness' | 'createdAt'; enterpriseTypes?: string[]; dateFrom?: string; dateTo?: string; evalLevel?: string; qualificationStatus?: string; isTemporary?: boolean; scopeUserId?: string }) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const sortMode = params.sort ?? 'completeness';

    const where: any = {};
    // 数据隔离：supplier 角色只能看到自己企业，防止跨企枚举与主联系人 PII 泄露。
    if (params.scopeUserId) where.userId = params.scopeUserId;
    if (params.status) {
      // 支持「排除若干状态」语义：前端「全部」标签传 `exclude:PENDING,RETURNED`，使默认列表不含待审核/退回补正。
      if (params.status.startsWith('exclude:')) {
        const excl = params.status.slice('exclude:'.length).split(',').filter(Boolean);
        where.status = excl.length === 1 ? { not: excl[0] } : { notIn: excl };
      } else {
        where.status = params.status;
      }
    }
    if (params.classificationId) where.classificationId = params.classificationId;
    if (params.enterpriseTypes?.length) where.enterpriseType = { in: params.enterpriseTypes };
    if (params.dateFrom || params.dateTo) {
      where.createdAt = {};
      if (params.dateFrom) where.createdAt.gte = new Date(params.dateFrom);
      if (params.dateTo) where.createdAt.lte = new Date(params.dateTo + 'T23:59:59.999Z');
    }
    if (params.evalLevel) {
      where.evaluations = { some: { finalGrade: params.evalLevel } };
    }
    if (params.qualificationStatus) {
      where.qualifications = { some: { status: params.qualificationStatus } };
    }
    // 临时供应商筛选（凭邀请码注册、有效期由邀请码绑定）。与状态可叠加，如 isTemporary=true & status=APPROVED。
    if (params.isTemporary === true) where.isTemporary = true;
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { creditCode: { contains: params.search } },
      ];
    }

    // 资料完整度排序：关键字段填充计数降序，同分按时间降序
    if (sortMode === 'completeness') {
      return this.listByCompleteness(where, { page, pageSize });
    }

    const [total, items] = await Promise.all([
      this.prisma.supplier.count({ where }),
      this.prisma.supplier.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          classification: true,
          contacts: { where: { isPrimary: true } },
          _count: { select: { evaluations: true } },
          evaluations: {
            select: { finalGrade: true, comprehensiveGrade: true, evidence: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
    ]);

    // 批量附平均评分
    await this.attachAvgScores(items);

    return { total, page, pageSize, items };
  }

  /** 按资料完整度排序（PostgreSQL raw query — 4 项关键字段各计 1 分） */
  private async listByCompleteness(
    where: any,
    pagination: { page: number; pageSize: number },
  ): Promise<{ total: number; page: number; pageSize: number; items: any[] }> {
    const { page, pageSize } = pagination;
    const skip = (page - 1) * pageSize;

    // Build WHERE clause with Prisma.sql for safety
    const conditions: Prisma.Sql[] = [];
    // 数据隔离：supplier 角色仅见本企业（与 list() 的 Prisma 路径 where.userId 对齐，否则 raw 路径会丢弃该过滤）。
    if (where.userId) conditions.push(Prisma.sql`s."userId" = ${where.userId}`);
    // status 列是 SupplierStatus 枚举，参数需显式 cast，否则 PG 报 operator does not exist: SupplierStatus = text
    if (where.status) {
      if (where.status.notIn) {
        conditions.push(Prisma.sql`s."status" <> ALL(${where.status.notIn}::"SupplierStatus"[])`);
      } else if (where.status.not) {
        conditions.push(Prisma.sql`s."status" <> ${where.status.not}::"SupplierStatus"`);
      } else {
        conditions.push(Prisma.sql`s."status" = ${where.status}::"SupplierStatus"`);
      }
    }
    if (where.classificationId) conditions.push(Prisma.sql`"classificationId" = ${where.classificationId}`);
    if (where.OR) {
      // search: name ILIKE or creditCode contains
      const search = where.OR[0].name.contains;
      conditions.push(Prisma.sql`("name" ILIKE ${'%' + search + '%'} OR "creditCode" ILIKE ${'%' + search + '%'})`);
    }
    // 以下为默认 completeness 排序路径此前丢弃的筛选——必须与 list() 的 Prisma 路径行为一致，
    // 否则前端「高级筛选/企业类型/日期/评价等级/资质状态」在默认排序下形同虚设。
    if (where.enterpriseType) {
      if (where.enterpriseType.in) {
        conditions.push(Prisma.sql`s."enterpriseType" = ANY(${where.enterpriseType.in})`);
      } else {
        conditions.push(Prisma.sql`s."enterpriseType" = ${where.enterpriseType}`);
      }
    }
    if (where.createdAt) {
      if (where.createdAt.gte) conditions.push(Prisma.sql`s."createdAt" >= ${where.createdAt.gte}`);
      if (where.createdAt.lte) conditions.push(Prisma.sql`s."createdAt" <= ${where.createdAt.lte}`);
    }
    if (where.evaluations?.some?.level) {
      conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "SupplierEvaluation" e WHERE e."supplierId" = s.id AND e."finalGrade" = ${where.evaluations.some.level}::"ExpertLevel")`);
    }
    if (where.qualifications?.some?.status) {
      conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "SupplierQualification" q WHERE q."supplierId" = s.id AND q."status" = ${where.qualifications.some.status})`);
    }
    if (where.isTemporary === true) {
      conditions.push(Prisma.sql`s."isTemporary" = TRUE`);
    }
    const whereSql = conditions.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;

    const result = await this.prisma.$queryRaw<Array<{ id: string; total_count: bigint }>>`
      SELECT s.id, COUNT(*) OVER()::int AS total_count
      FROM "Supplier" s
      ${whereSql}
      ORDER BY (
        CASE WHEN s."creditCode" IS NOT NULL AND s."creditCode" != '' THEN 1 ELSE 0 END +
        CASE WHEN s."businessScope" IS NOT NULL AND s."businessScope" != '' THEN 1 ELSE 0 END +
        CASE WHEN s."registeredAddress" IS NOT NULL AND s."registeredAddress" != '' THEN 1 ELSE 0 END +
        CASE WHEN s."classificationId" IS NOT NULL THEN 1 ELSE 0 END
      ) DESC, s."createdAt" DESC
      LIMIT ${pageSize} OFFSET ${skip}
    `;

    const total = result.length > 0 ? Number(result[0].total_count) : 0;
    const ids = result.map((r: any) => r.id);

    if (ids.length === 0) {
      return { total, page, pageSize, items: [] };
    }

    const items = await this.prisma.supplier.findMany({
      where: { id: { in: ids } },
      include: {
        classification: true,
        contacts: { where: { isPrimary: true } },
        _count: { select: { evaluations: true } },
        evaluations: {
          select: { finalGrade: true, comprehensiveGrade: true, evidence: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    const idOrder = new Map(ids.map((id, i) => [id, i]));
    items.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));

    await this.attachAvgScores(items);

    return { total, page, pageSize, items };
  }

  /** 批量附综合评价概览到每个 supplier item */
  private async attachAvgScores(items: any[]) {
    if (items.length === 0) return;
    const ids = items.map(i => i.id);
    const evals = await this.prisma.supplierEvaluation.groupBy({
      by: ['supplierId', 'finalGrade'],
      where: { supplierId: { in: ids } },
      _count: { finalGrade: true },
    });
    // 对每个 supplier 取出现最多的 finalGrade 作为概览等级
    const gradeMap = new Map<string, ExpertLevel>();
    const countMap = new Map<string, Map<string, number>>();
    for (const e of evals) {
      if (!countMap.has(e.supplierId)) countMap.set(e.supplierId, new Map());
      countMap.get(e.supplierId)!.set(e.finalGrade, e._count.finalGrade);
    }
    for (const [sid, grades] of countMap) {
      let best = 'C';
      let bestCount = 0;
      for (const [g, c] of grades) {
        if (c > bestCount) { best = g; bestCount = c; }
      }
      gradeMap.set(sid, best as ExpertLevel);
    }
    for (const item of items) {
      // 字段名 _avgGrade 与前端（供应商库 / 评价页）读取一致；此前误写 _avgScore 致评价页平均等级列恒空。
      item._avgGrade = gradeMap.get(item.id) ?? null;
      // 最近一次评价等级：evaluations 已在查询中 take:1，取首个即可
      item._latestEvalLevel = item.evaluations?.[0]?.finalGrade ?? null;
    }
  }

  async get(id: string) {
    return this.prisma.supplier.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, username: true, displayName: true, email: true, role: true, isActive: true } },
        classification: true,
        contacts: true,
        qualifications: true,
        evaluations: { orderBy: { createdAt: 'desc' }, take: 10 },
        changeRecords: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
  }

  async getRegisterStatus(userId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { userId },
      select: { id: true, name: true, status: true, returnReason: true, rejectReason: true },
    });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    return supplier;
  }

  /** 公开：按统一社会信用代码查审核进度（注册后/审批前用）。不返回 id 等内部字段。 */
  async getRegisterStatusByCreditCode(creditCode: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { creditCode },
      select: { name: true, status: true, rejectReason: true, returnReason: true },
    });
    if (!supplier) {
      // 不区分「不存在」与「无记录」，避免被用于枚举信用代码是否注册。
      return { found: false as const, name: null, status: null, reason: null };
    }
    // P1-28：公开查询仅对 RETURNED 状态返回补正说明（供应商需知如何修改）；REJECTED 等原因可能含
    // 审核员内部备注，不对未登录公开，避免信息泄露与信用代码枚举爬取。
    const reason = supplier.status === 'RETURNED' ? (supplier.returnReason || null) : null;
    return { found: true as const, name: supplier.name, status: supplier.status, reason };
  }

  private async audit(userId: string, action: string, resourceId: string, details?: any) {
    // 审计写入失败不应阻断业务流程，但必须可观测——静默吞错会让 DB 故障期的合规审计悄悄丢失。
    await this.prisma.auditLog.create({ data: { userId, action, resourceType: 'supplier', resourceId, details: details ?? {} } })
      .catch((err: any) => console.error(`[audit] 写入失败 action=${action} resource=${resourceId}`, err?.message ?? err));
  }

  async approve(id: string, userId?: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id }, include: { user: true } });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    if (supplier.status !== 'PENDING' && supplier.status !== 'RETURNED') {
      throw new BadRequestException({ error: '供应商状态不允许审核', code: 'INVALID_STATUS' });
    }

    // 更新供应商状态和用户激活状态（P1-17 乐观锁：并发双审时仅一方能从 PENDING/RETURNED 转出）
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.supplier.updateMany({
        where: { id, status: { in: ['PENDING', 'RETURNED'] } },
        data: { status: 'APPROVED', returnReason: null, rejectReason: null },
      });
      if (claimed.count === 0) {
        throw new BadRequestException({ error: '供应商状态已变更，请刷新后重试', code: 'CONFLICT' });
      }
      await tx.user.update({ where: { id: supplier.userId }, data: { isActive: true } });
    });

    // 待办清零：resolve SUPPLIER_PENDING
    await this.notificationService.resolveActionable('SUPPLIER_PENDING', `/supplier/${id}`);

    // 发送通知给供应商
    await this.notificationService.create({
      userId: supplier.userId,
      type: 'SUPPLIER_APPROVED',
      title: '供应商审核通过',
      content: `您的供应商注册申请已审核通过，企业名称：${supplier.name}`,
      link: `/dashboard`,
    });

    if (userId) await this.audit(userId, 'SUPPLIER_APPROVED', id, { name: supplier.name });

    return { success: true };
  }

  async reject(id: string, reason: string, userId?: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    if (supplier.status !== 'PENDING' && supplier.status !== 'RETURNED') {
      throw new BadRequestException({ error: '供应商状态不允许审核', code: 'INVALID_STATUS' });
    }

    // P1-17 乐观锁：并发双审时仅一方能从 PENDING/RETURNED 转为 REJECTED。
    const claimed = await this.prisma.supplier.updateMany({
      where: { id, status: { in: ['PENDING', 'RETURNED'] } },
      data: { status: 'REJECTED', rejectReason: reason },
    });
    if (claimed.count === 0) {
      throw new BadRequestException({ error: '供应商状态已变更，请刷新后重试', code: 'CONFLICT' });
    }
    const result = await this.prisma.supplier.findUnique({ where: { id } });

    // 待办清零：resolve SUPPLIER_PENDING
    await this.notificationService.resolveActionable('SUPPLIER_PENDING', `/supplier/${id}`);

    // 发送通知给供应商
    await this.notificationService.create({
      userId: supplier.userId,
      type: 'SUPPLIER_REJECTED',
      title: '供应商审核不通过',
      content: `您的供应商注册申请审核不通过，原因：${reason}`,
    });

    if (userId) await this.audit(userId, 'SUPPLIER_REJECTED', id, { name: supplier.name, reason });

    return result;
  }

  async return(id: string, reason: string, userId?: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    if (supplier.status !== 'PENDING') {
      throw new BadRequestException({ error: '供应商状态不允许退回', code: 'INVALID_STATUS' });
    }

    // P1-17 乐观锁：return 仅允许 PENDING→RETURNED，并发时仅一方成功。
    const claimed = await this.prisma.supplier.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'RETURNED', returnReason: reason },
    });
    if (claimed.count === 0) {
      throw new BadRequestException({ error: '供应商状态已变更，请刷新后重试', code: 'CONFLICT' });
    }
    const result = await this.prisma.supplier.findUnique({ where: { id } });

    // 待办清零：resolve SUPPLIER_PENDING
    await this.notificationService.resolveActionable('SUPPLIER_PENDING', `/supplier/${id}`);

    // 发送通知给供应商
    await this.notificationService.create({
      userId: supplier.userId,
      type: 'SUPPLIER_RETURNED',
      title: '供应商注册退回补正',
      content: `您的供应商注册申请需补充修改，原因：${reason}`,
      link: `/profile`,
    });

    if (userId) await this.audit(userId, 'SUPPLIER_RETURNED', id, { name: supplier.name, reason });

    return result;
  }

  async updateStatus(id: string, status: 'DISABLED' | 'BLACKLIST', reason: string, userId?: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    if (supplier.status !== 'APPROVED') {
      throw new BadRequestException({ error: '只有已入库供应商可以调整状态', code: 'INVALID_STATUS' });
    }

    // B6：停用/拉黑原因写入独立字段 disableReason（不再错用 returnReason）。
    // P0-2：停用/黑名单必须联动账号停用——否则被拉黑的供应商仍可登录、仍能投标（最严重数据一致性洞）。
    // P1-17：乐观锁，并发时仅一方能从 APPROVED 转出。
    const claimed = await this.prisma.supplier.updateMany({
      where: { id, status: 'APPROVED' },
      data: { status, disableReason: reason, eliminatedAt: null },
    });
    if (claimed.count === 0) {
      throw new BadRequestException({ error: '供应商状态已变更，请刷新后重试', code: 'CONFLICT' });
    }
    await this.prisma.user.update({ where: { id: supplier.userId }, data: { isActive: false } });
    if (userId) await this.audit(userId, `SUPPLIER_${status}`, id, { name: supplier.name, reason });
    return this.prisma.supplier.findUnique({ where: { id } });
  }

  /** 恢复/解禁：把 DISABLED/BLACKLIST 的供应商重新置为 APPROVED（解决「停用/黑名单断头、无恢复入口」）。 */
  async restoreStatus(id: string, userId?: string, reason?: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id }, select: { id: true, name: true, status: true, userId: true } });
    if (!supplier) throw new NotFoundException('供应商不存在');
    if (supplier.status !== 'DISABLED' && supplier.status !== 'BLACKLIST') {
      throw new BadRequestException({ error: '仅停用/黑名单供应商可恢复', code: 'INVALID_STATUS' });
    }
    // 黑名单解禁属高风险反向操作，必须留痕理由（停用恢复可选）。
    if (supplier.status === 'BLACKLIST' && !reason?.trim()) {
      throw new BadRequestException({ error: '黑名单解禁必须填写理由', code: 'MISSING_REASON' });
    }
    const claimed = await this.prisma.supplier.updateMany({
      where: { id, status: { in: ['DISABLED', 'BLACKLIST'] } },
      data: { status: 'APPROVED', disableReason: null, eliminatedAt: null },
    });
    if (claimed.count === 0) {
      throw new BadRequestException({ error: '供应商状态已变更，请刷新后重试', code: 'CONFLICT' });
    }
    // P0-2：恢复须同步重新激活账号。
    await this.prisma.user.update({ where: { id: supplier.userId }, data: { isActive: true } });
    if (userId) await this.audit(userId, 'SUPPLIER_RESTORED', id, { name: supplier.name, from: supplier.status, reason: reason ?? null });
    return { success: true };
  }

  /** P1-16 供应商补正后重新提交（RETURNED → PENDING），打通「退回补正」死胡同。 */
  async resubmit(supplierId: string, userId: string, note?: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true, status: true, userId: true },
    });
    if (!supplier) throw new NotFoundException('供应商不存在');
    if (supplier.userId !== userId) {
      throw new ForbiddenException({ error: '只能重新提交自己的申请', code: 'FORBIDDEN' });
    }
    if (supplier.status !== 'RETURNED') {
      throw new BadRequestException({ error: '仅被退回补正的申请可重新提交', code: 'INVALID_STATUS' });
    }
    const claimed = await this.prisma.supplier.updateMany({
      where: { id: supplierId, status: 'RETURNED' },
      data: { status: 'PENDING' },
    });
    if (claimed.count === 0) {
      throw new BadRequestException({ error: '状态已变更，请刷新后重试', code: 'CONFLICT' });
    }
    void Promise.all(['admin', 'leader', 'staff'].map(r => this.notificationService.sendToRole(r, {
      type: 'SUPPLIER_PENDING',
      title: '供应商重新提交审核',
      content: `${supplier.name} 已补正资料重新提交${note ? `（说明：${note}）` : ''}，请前往审核。`,
      link: `/supplier/${supplierId}`,
    })));
    await this.audit(userId, 'SUPPLIER_RESUBMITTED', supplierId, { name: supplier.name, note: note ?? null });
    return { success: true };
  }

  /** P1-16 管理员复活被拒绝的申请（REJECTED → PENDING），打通「拒绝」死胡同。 */
  async reactivate(id: string, userId?: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      select: { id: true, name: true, status: true },
    });
    if (!supplier) throw new NotFoundException('供应商不存在');
    if (supplier.status !== 'REJECTED') {
      throw new BadRequestException({ error: '仅被拒绝的供应商可重新激活', code: 'INVALID_STATUS' });
    }
    const claimed = await this.prisma.supplier.updateMany({
      where: { id, status: 'REJECTED' },
      data: { status: 'PENDING' },
    });
    if (claimed.count === 0) {
      throw new BadRequestException({ error: '状态已变更，请刷新后重试', code: 'CONFLICT' });
    }
    if (userId) await this.audit(userId, 'SUPPLIER_REACTIVATED', id, { name: supplier.name });
    return { success: true };
  }

  async listChanges(supplierId: string) {
    return this.prisma.supplierChangeRecord.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createChangeRequest(supplierId: string, userId: string, dto: CreateChangeRequestDto) {
    // 验证供应商状态
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
    });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    if (supplier.status !== 'APPROVED') {
      throw new BadRequestException({ error: '只有已入库供应商可以提交变更', code: 'INVALID_STATUS' });
    }

    // 验证所有权
    if (supplier.userId !== userId) {
      throw new ForbiddenException({ error: '只能提交自己的变更申请', code: 'FORBIDDEN' });
    }

    // 字段白名单校验
    if (!isSupplierChangeAllowedField(dto.fieldName)) {
      throw new BadRequestException({ error: '该字段不允许通过变更申请修改', code: 'FIELD_NOT_ALLOWED' });
    }

    // P1-19：同字段已有 PENDING 变更时拒绝——避免审核列表重复项 + 反复群发通知风暴。
    const dupPending = await this.prisma.supplierChangeRecord.findFirst({
      where: { supplierId, fieldName: dto.fieldName, status: 'PENDING' },
      select: { id: true },
    });
    if (dupPending) {
      throw new BadRequestException({ error: '该字段已有待审核的变更申请，请等待审核结果', code: 'DUPLICATE_PENDING_CHANGE' });
    }

    // 获取旧值
    const oldValue = supplier[dto.fieldName as keyof typeof supplier] as string;

    const record = await this.prisma.supplierChangeRecord.create({
      data: {
        supplierId,
        fieldName: dto.fieldName,
        fieldLabel: dto.fieldLabel,
        oldValue,
        newValue: dto.newValue,
        reason: dto.reason,
        status: 'PENDING',
      },
    });

    // 通知采购管理员：供应商变更申请待审核（待办型，审批后 resolve；此前提交变更无任何通知，
    // 管理员无感知。link 指向供应商详情页，其内有变更审批动作 approveChange/rejectChange）。
    void Promise.all(['admin', 'leader', 'staff'].map((r) =>
      this.notificationService.sendToRole(r, {
        type: 'SUPPLIER_PENDING',
        title: '供应商变更申请待审核',
        content: `${supplier.name} 提交了变更申请（${dto.fieldLabel}），请前往审核。`,
        link: `/supplier/${supplierId}`,
      }),
    ));

    return record;
  }

  async approveChange(changeId: string, reviewerId: string) {
    const change = await this.prisma.supplierChangeRecord.findUnique({
      where: { id: changeId },
    });
    if (!change) {
      throw new BadRequestException({ error: '变更记录不存在', code: 'NOT_FOUND' });
    }
    if (change.status !== 'PENDING') {
      throw new BadRequestException({ error: '变更记录已处理', code: 'INVALID_STATUS' });
    }

    // ★ 临时供应商转正申请：特殊处理（补全企业资料 + 创建联系人/资质 + 取消 isTemporary），
    //   不走普通字段变更白名单（convertToRegular 是聚合字段，非 supplier 实体列）
    if (change.fieldName === 'convertToRegular') {
      return this.approveConvertToRegular(change, reviewerId);
    }

    // 审批时再次校验白名单（不信任历史数据）
    if (!isSupplierChangeAllowedField(change.fieldName)) {
      throw new BadRequestException({ error: '该字段不允许通过变更申请修改', code: 'FIELD_NOT_ALLOWED' });
    }

    // #3 原子化：条件置位 + 应用字段变更并入同一事务。此前分两步，supplier.update 失败会留下
    // 「change 已 APPROVED 但字段未生效」且不可重试的不一致态。事务内 updateMany count=0 即冲突回滚。
    // #4 name 变更须同步 normalizedName 并查重，否则 register 按 normalizedName 查重失效→同名重复注册。
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.supplierChangeRecord.updateMany({
        where: { id: changeId, status: 'PENDING' },
        data: { status: 'APPROVED', reviewedBy: reviewerId, reviewedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new BadRequestException({ error: '变更记录已被处理，请勿重复审批', code: 'CONFLICT' });
      }

      const data: Record<string, any> = { [change.fieldName]: change.newValue };
      if (change.fieldName === 'name') {
        const normalizedName = String(change.newValue).trim().toLowerCase();
        const dup = await tx.supplier.findFirst({
          where: { normalizedName, NOT: { id: change.supplierId } },
          select: { id: true },
        });
        if (dup) {
          throw new BadRequestException({ error: '变更后的企业名称与已有供应商重复', code: 'DUPLICATE_NAME' });
        }
        data.normalizedName = normalizedName;
        // S-2：企业名即登录用户名，同步 user.username（防改名后无法登录）
        const newName = String(change.newValue).trim();
        const supRow = await tx.supplier.findUnique({ where: { id: change.supplierId }, select: { userId: true } });
        if (supRow) {
          const userDup = await tx.user.findFirst({
            where: { username: newName, role: 'supplier', NOT: { id: supRow.userId } },
            select: { id: true },
          });
          if (userDup) throw new BadRequestException({ error: '新企业名与已有供应商登录名冲突', code: 'DUPLICATE_USERNAME' });
          await tx.user.update({ where: { id: supRow.userId }, data: { username: newName } });
        }
      }

      if (change.fieldName === 'tags') {
        try {
          const parsed = JSON.parse(change.newValue || '[]');
          if (!Array.isArray(parsed)) throw new Error();
          data.tags = parsed.filter((t: any) => typeof t === 'string' && t.trim()).slice(0, 8);
          if (data.tags.length < 2) throw new BadRequestException({ error: '业务标签至少保留 2 个', code: 'INVALID_TAGS' });
        } catch (e) {
          if (e instanceof BadRequestException) throw e;
          throw new BadRequestException({ error: '业务标签格式不正确', code: 'INVALID_TAGS' });
        }
      }

      await tx.supplier.update({ where: { id: change.supplierId }, data });
    });

    // P1-20：变更审批（敏感操作）补审计留痕。
    await this.audit(reviewerId, 'SUPPLIER_CHANGE_APPROVED', change.supplierId, { field: change.fieldName });

    // 待办清零：resolve 该供应商的 SUPPLIER_PENDING（变更申请通知，link 与 createChangeRequest 全等）
    await this.notificationService.resolveActionable('SUPPLIER_PENDING', `/supplier/${change.supplierId}`);

    return { success: true };
  }

  // 临时供应商转正审批通过：补全企业资料 + 创建联系人/资质 + 取消 isTemporary
  private async approveConvertToRegular(change: any, reviewerId: string) {
    let payload: any = {};
    try {
      payload = JSON.parse(change.newValue || '{}');
    } catch {
      throw new BadRequestException({ error: '转正资料解析失败', code: 'INVALID_PAYLOAD' });
    }
    const { enterpriseType, legalPerson, registeredAddress, businessScope, creditCode, contacts = [], qualifications = [], tags = [] } = payload;
    if (![enterpriseType, legalPerson, registeredAddress, businessScope].every((v: any) => v && String(v).trim())) {
      throw new BadRequestException({ error: '转正资料不完整，无法通过审批', code: 'INCOMPLETE_DATA' });
    }
    if (!creditCode || !/^[0-9A-Z]{18}$/.test(String(creditCode))) {
      throw new BadRequestException({ error: '统一社会信用代码格式不正确', code: 'INVALID_CREDIT_CODE' });
    }

    await this.prisma.$transaction(async (tx) => {
      // 条件置位防并发双审
      const claimed = await tx.supplierChangeRecord.updateMany({
        where: { id: change.id, status: 'PENDING' },
        data: { status: 'APPROVED', reviewedBy: reviewerId, reviewedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new BadRequestException({ error: '变更记录已被处理，请勿重复审批', code: 'CONFLICT' });
      }

      // 0) 信用代码变更查重（转正时可修正临时注册时的错填）
      if (creditCode) {
        const dup = await tx.supplier.findFirst({
          where: { creditCode: String(creditCode), NOT: { id: change.supplierId } },
          select: { id: true },
        });
        if (dup) throw new BadRequestException({ error: '该统一社会信用代码已被其他供应商占用', code: 'DUPLICATE_CREDIT_CODE' });
      }

      // 1) 补全企业资料 + 信用代码 + 取消临时标记
      await tx.supplier.update({
        where: { id: change.supplierId },
        data: {
          enterpriseType,
          legalPerson,
          registeredAddress,
          businessScope,
          ...(creditCode ? { creditCode: String(creditCode) } : {}),
          isTemporary: false,
          temporaryExpiresAt: null,
          ...(Array.isArray(tags) && tags.length >= 2 ? { tags: tags.filter((t: any) => typeof t === 'string' && t.trim()).slice(0, 8) } : {}),
        },
      });

      // 2) 联系人：若新提交含主要联系人，先清除现有 primary（避免多个主要联系人）
      if (Array.isArray(contacts) && contacts.length > 0) {
        if (contacts.some((c: any) => c.isPrimary)) {
          await tx.supplierContact.updateMany({
            where: { supplierId: change.supplierId, isPrimary: true },
            data: { isPrimary: false },
          });
        }
        await tx.supplierContact.createMany({
          data: contacts.map((c: any) => ({
            supplierId: change.supplierId,
            name: String(c.name).trim(),
            phone: String(c.phone).trim(),
            email: c.email ? String(c.email).trim() : null,
            isPrimary: !!c.isPrimary,
            position: c.position ? String(c.position).trim() : null,
          })),
        });
      }

      // 3) 资质材料
      if (Array.isArray(qualifications) && qualifications.length > 0) {
        await tx.supplierQualification.createMany({
          data: qualifications
            .filter((q: any) => q && q.type && q.name)
            .map((q: any) => ({
              supplierId: change.supplierId,
              type: String(q.type).trim(),
              name: String(q.name).trim(),
              fileUrl: q.fileUrl || '',
              validFrom: q.validFrom ? new Date(q.validFrom) : null,
              validTo: q.validTo ? new Date(q.validTo) : null,
            })),
        });
      }
    });

    // resolve 待办 + 站内通知供应商转正成功
    await this.notificationService.resolveActionable('SUPPLIER_PENDING', `/supplier/${change.supplierId}`);
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: change.supplierId },
      select: { userId: true, name: true },
    });
    if (supplier) {
      await this.notificationService.create({
        userId: supplier.userId,
        type: 'SUPPLIER_APPROVED',
        title: '已转为正式供应商',
        content: `${supplier.name} 的转正申请已审核通过，临时权限限制已解除，可使用全部功能。`,
      }).catch(() => {});
    }
    await this.audit(reviewerId, 'SUPPLIER_CONVERTED_REGULAR', change.supplierId, { name: supplier?.name });
    return { success: true, converted: true };
  }

  async rejectChange(changeId: string, reviewerId: string, reason: string) {
    const change = await this.prisma.supplierChangeRecord.findUnique({
      where: { id: changeId },
    });
    if (!change) {
      throw new BadRequestException({ error: '变更记录不存在', code: 'NOT_FOUND' });
    }
    if (change.status !== 'PENDING') {
      throw new BadRequestException({ error: '变更记录已处理', code: 'INVALID_STATUS' });
    }

    // 并发双审防护：条件更新，affected=0 即已被他人处理。
    const claimed = await this.prisma.supplierChangeRecord.updateMany({
      where: { id: changeId, status: 'PENDING' },
      data: {
        status: 'REJECTED',
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        rejectReason: reason,
      },
    });
    if (claimed.count === 0) {
      throw new BadRequestException({ error: '变更记录已被处理，请勿重复审批', code: 'CONFLICT' });
    }

    // P1-20：变更拒绝补审计。
    await this.audit(reviewerId, 'SUPPLIER_CHANGE_REJECTED', change.supplierId, { field: change.fieldName, reason });

    // 待办清零：resolve 该供应商的 SUPPLIER_PENDING（变更申请通知）
    await this.notificationService.resolveActionable('SUPPLIER_PENDING', `/supplier/${change.supplierId}`);

    return { success: true };
  }

  async listQualifications(supplierId: string) {
    return this.prisma.supplierQualification.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addQualification(supplierId: string, dto: CreateQualificationDto) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
    });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }

    return this.prisma.supplierQualification.create({
      data: {
        supplierId,
        type: dto.type,
        name: dto.name,
        fileUrl: dto.fileUrl,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
        validTo: dto.validTo ? new Date(dto.validTo) : undefined,
      },
    });
  }

  async deleteQualification(supplierId: string, qualificationId: string) {
    const qualification = await this.prisma.supplierQualification.findUnique({
      where: { id: qualificationId },
    });
    if (!qualification || qualification.supplierId !== supplierId) {
      throw new BadRequestException({ error: '资质材料不存在或不属于此供应商', code: 'NOT_FOUND' });
    }

    return this.prisma.supplierQualification.delete({
      where: { id: qualificationId },
    });
  }

  async checkQualificationExpiry() {
    const now = new Date();
    const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // 查找即将过期的资质
    const expiringQualifications = await this.prisma.supplierQualification.findMany({
      where: {
        validTo: { lte: thirtyDaysLater, gte: now },
        status: '有效',
      },
      include: { supplier: true },
    });

    // 更新状态为即将过期
    for (const q of expiringQualifications) {
      await this.prisma.supplierQualification.update({
        where: { id: q.id },
        data: { status: '即将过期' },
      });
    }

    // 查找已过期的资质
    const expiredQualifications = await this.prisma.supplierQualification.findMany({
      where: {
        validTo: { lt: now },
        status: { not: '已过期' },
      },
    });

    for (const q of expiredQualifications) {
      await this.prisma.supplierQualification.update({
        where: { id: q.id },
        data: { status: '已过期' },
      });
    }

    return { expiring: expiringQualifications.length, expired: expiredQualifications.length };
  }

  async listEvaluations(supplierId: string) {
    return this.prisma.supplierEvaluation.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
      include: {
        evaluator: { select: { id: true, displayName: true } },
      },
    });
  }

  async createEvaluation(supplierId: string, evaluatorId: string, dto: CreateEvaluationDto, evaluatorRole?: string) {
    // 防自评刷分/越权：supplier 角色不得创建评价（既不能评自己，也不能评他企）。
    // 评价只能由采购侧角色（admin/leader/staff）发起——controller 已加 @Roles 兜底。
    if (evaluatorRole === 'supplier') {
      throw new ForbiddenException({ error: '供应商不能参与评价打分', code: 'FORBIDDEN' });
    }

    // 验证供应商状态
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
    });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    if (supplier.status !== 'APPROVED') {
      throw new BadRequestException({ error: '只能评价已入库供应商', code: 'INVALID_STATUS' });
    }

    // P1-27：同一评价人对同一供应商（+同一项目）已评价过则拒绝，防刷分触发误淘汰。
    const dupEval = await this.prisma.supplierEvaluation.findFirst({
      where: { supplierId, evaluatorId, projectId: dto.projectId ?? null },
      select: { id: true },
    });
    if (dupEval) {
      throw new BadRequestException({ error: '您已对该供应商提交过评价，不可重复评价', code: 'ALREADY_EVALUATED' });
    }

    // 加权计算综合等级
    const finalGrade = computeFinalGrade(
      dto.completenessGrade,
      dto.responsivenessGrade,
      dto.cooperationGrade,
      dto.complianceGrade,
      dto.comprehensiveGrade,
    );

    const created = await this.prisma.supplierEvaluation.create({
      data: {
        supplierId,
        projectId: dto.projectId,
        evaluatorId,
        finalGrade,
        completenessGrade: dto.completenessGrade,
        responsivenessGrade: dto.responsivenessGrade,
        cooperationGrade: dto.cooperationGrade,
        complianceGrade: dto.complianceGrade,
        comprehensiveGrade: dto.comprehensiveGrade,
        comment: dto.comment,
        evidence: dto.evidence ?? undefined,
      },
    });

    // P1-20：评价影响画像/淘汰，补审计。
    await this.audit(evaluatorId, 'SUPPLIER_EVALUATION_CREATED', supplierId, { finalGrade, projectId: dto.projectId ?? null });

    // 决策 #3：不自动停用。连续低分由 reviewEliminationCandidates()（cron + 人工）产出预警，
    // 实际淘汰须经 admin 调 confirmEliminate() 确认。此处仅返回评价结果。
    return created;
  }

  /* ── 供应商画像（Track E §3.3） ── */

  /** 综合画像：参与次数、中标率、绩效均分/趋势、价格偏离度（数据可得时）。 */
  async getSupplierPortrait(supplierId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true },
    });
    if (!supplier) throw new NotFoundException('供应商不存在');

    const [bidSuppliers, evaluations] = await Promise.all([
      this.prisma.bidSupplier.findMany({
        where: { supplierId },
        select: { id: true, projectId: true },
      }),
      this.prisma.supplierEvaluation.findMany({
        where: { supplierId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { finalGrade: true, createdAt: true },
      }),
    ]);

    const participations: Array<{ won: boolean }> = [];
    for (const bs of bidSuppliers) {
      const result = await this.prisma.bidEvaluationResult.findFirst({
        where: { projectId: bs.projectId, supplierId: bs.id },
        select: { recommended: true },
      }).catch(() => null);
      participations.push({ won: !!result?.recommended });
    }

    return buildSupplierPortrait({
      supplierId,
      name: supplier.name,
      participations,
      evaluations: evaluations.map(e => ({ finalGrade: e.finalGrade, createdAt: e.createdAt })),
    });
  }

  /* ── 淘汰预警 + 人工确认（决策 #3：只预警，不自动改状态） ── */

  /** 扫描淘汰候选（最近 3 次绩效均为 E），通知管理员；不修改 status。 */
  async reviewEliminationCandidates() {
    const suppliers = await this.prisma.supplier.findMany({
      where: { status: 'APPROVED' },
      select: { id: true, name: true },
    });

    const candidates: Array<{ supplierId: string; name: string; reason: string }> = [];
    for (const s of suppliers) {
      const recent = await this.prisma.supplierEvaluation.findMany({
        where: { supplierId: s.id },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { finalGrade: true },
      });
      if (shouldAutoDisable(recent.map(r => ({ finalGrade: r.finalGrade })))) {
        candidates.push({ supplierId: s.id, name: s.name, reason: '最近 3 次绩效综合评价均为 E 级（不合格）' });
      }
    }

    if (candidates.length > 0) {
      const names = candidates.map(c => `${c.name}（${c.reason}）`).join('；');
      const payload = {
        type: 'SUPPLIER_ELIMINATE_CANDIDATE',
        title: '供应商淘汰预警',
        content: `${candidates.length} 家供应商进入淘汰候选，请人工复核：${names}`,
        link: '/supplier',
      };
      await Promise.all(['admin', 'leader', 'staff'].map(r => this.notificationService.sendToRole(r, payload)));
    }

    return candidates;
  }

  /** 人工确认淘汰：置 status=DISABLED。 */
  async confirmEliminate(supplierId: string, reason: string, userId?: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, status: true, name: true, userId: true },
    });
    if (!supplier) throw new NotFoundException('供应商不存在');
    // 校验原状态：仅已入库供应商可被淘汰，避免对 PENDING/已停用 误操作。
    if (supplier.status !== 'APPROVED') {
      throw new BadRequestException({ error: '仅已入库供应商可确认淘汰', code: 'INVALID_STATUS' });
    }
    // B12：淘汰=DISABLED + eliminatedAt 时间戳（区分手动停用：后者 eliminatedAt 为 null）。
    // P1-17 乐观锁 + P0-2 联动账号停用。
    const claimed = await this.prisma.supplier.updateMany({
      where: { id: supplierId, status: 'APPROVED' },
      data: { status: 'DISABLED', disableReason: reason, eliminatedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new BadRequestException({ error: '供应商状态已变更，请刷新后重试', code: 'CONFLICT' });
    }
    await this.prisma.user.update({ where: { id: supplier.userId }, data: { isActive: false } });
    if (userId) await this.audit(userId, 'SUPPLIER_ELIMINATED', supplierId, { name: supplier.name, reason });
    return { success: true };
  }

  /* ── 资质到期预警看板 ── */
  async getQualificationAlerts(userId?: string) {
    const now = Date.now();
    const in90 = new Date(now + 90 * 86400000);
    // 取「已过期 或 90 天内到期」的资质（覆盖过期+即将过期两态，避免 status 字段未同步导致漏报）。
    const items = await this.prisma.supplierQualification.findMany({
      where: { validTo: { not: null, lte: in90 } },
      include: {
        supplier: { select: { id: true, name: true } },
        acks: userId ? { where: { userId }, select: { id: true } } : false,
      },
      orderBy: { validTo: 'asc' },
    });
    const withStatus = items.map((q) => {
      const daysRemaining = q.validTo ? Math.ceil((new Date(q.validTo).getTime() - now) / 86400000) : null;
      // 状态以到期日派生，与前端 tab 口径一致。
      const derivedStatus = daysRemaining !== null && daysRemaining < 0 ? '已过期' : '即将过期';
      return {
        id: q.id,
        supplierId: q.supplierId,
        supplierName: q.supplier.name,
        type: q.type,
        name: q.name,
        validTo: q.validTo,
        status: derivedStatus,
        daysRemaining,
        acked: userId ? (q.acks?.length ?? 0) > 0 : false,
      };
    });
    return {
      items: withStatus,
      expiredCount: withStatus.filter((q) => q.status === '已过期').length,
      expiringCount: withStatus.filter((q) => q.status === '即将过期').length,
      affectedSupplierCount: new Set(withStatus.map((q) => q.supplierId)).size,
    };
  }

  /** 标记资质预警已处理（B11 入库）：upsert 当前用户对该资质的确认记录。 */
  async acknowledgeQualificationAlert(qualificationId: string, userId: string) {
    if (!userId) throw new ForbiddenException({ error: '未登录', code: 'UNAUTHORIZED' });
    const qual = await this.prisma.supplierQualification.findUnique({ where: { id: qualificationId }, select: { id: true, supplierId: true } });
    if (!qual) throw new NotFoundException('资质记录不存在');
    await this.prisma.qualificationAlertAck.upsert({
      where: { qualificationId_userId: { qualificationId, userId } },
      create: { qualificationId, userId, supplierId: qual.supplierId },
      update: {},
    });
    return { success: true };
  }

  /* ── 供应商生命周期时间线 ── */
  /** 管理员直接修改供应商业务标签（不走变更审批流程） */
  async updateTags(supplierId: string, tags: string[], reviewerId: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true, tags: true } });
    if (!supplier) throw new NotFoundException('供应商不存在');
    const cleaned = tags.filter(t => typeof t === 'string' && t.trim()).slice(0, 8);
    if (cleaned.length < 2) throw new BadRequestException({ error: '业务标签至少保留 2 个', code: 'INVALID_TAGS' });
    await this.prisma.supplier.update({ where: { id: supplierId }, data: { tags: cleaned } });
    await this.audit(reviewerId, 'SUPPLIER_TAGS_UPDATED', supplierId, { before: supplier.tags, after: cleaned });
    return { tags: cleaned };
  }

  async getSupplierTimeline(supplierId: string) {
    const [supplier, auditLogs, evaluations, bidSuppliers, catalogApps, contractPrices] = await Promise.all([
      this.prisma.supplier.findUnique({
        where: { id: supplierId },
        select: { id: true, name: true, status: true, createdAt: true, updatedAt: true, isTemporary: true, classification: { select: { name: true } } },
      }),
      this.prisma.auditLog.findMany({
        where: { resourceType: 'supplier', resourceId: supplierId },
        orderBy: { createdAt: 'asc' },
        select: { action: true, details: true, createdAt: true, userId: true, user: { select: { displayName: true } } },
      }),
      this.prisma.supplierEvaluation.findMany({
        where: { supplierId },
        orderBy: { createdAt: 'asc' },
        select: { finalGrade: true, createdAt: true, evaluator: { select: { displayName: true } } },
      }),
      this.prisma.bidSupplier.findMany({
        where: { supplierId },
        select: { project: { select: { name: true, projectCode: true } }, submitStatus: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.supplierCatalogApplication.findMany({
        where: { supplierId },
        select: { catalogItem: { select: { name: true } }, proposedName: true, status: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.contractPrice.findMany({
        where: { supplierId },
        select: { catalogItem: { select: { name: true } }, agreedPrice: true, contractNo: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    if (!supplier) throw new NotFoundException('供应商不存在');

    const events: Array<{ type: string; label: string; detail: string; at: string }> = [];

    // #1 注册
    const regLabel = supplier.isTemporary ? '临时注册' : '注册提交';
    events.push({ type: 'register', label: regLabel, detail: `${supplier.name} 提交${supplier.isTemporary ? '临时' : ''}注册申请`, at: supplier.createdAt.toISOString() });

    // #2 审核日志（注册审批、变更审批、状态变更、转正等）
    for (const log of auditLogs) {
      const labelMap: Record<string, string> = {
        SUPPLIER_APPROVED: '审核通过',
        SUPPLIER_REJECTED: '审核不通过',
        SUPPLIER_RETURNED: '退回补正',
        SUPPLIER_DISABLED: '停用',
        SUPPLIER_BLACKLIST: '拉黑',
        SUPPLIER_ELIMINATED: '淘汰',
        SUPPLIER_RESTORED: '恢复',
        SUPPLIER_RESUBMITTED: '重新提交',
        SUPPLIER_REACTIVATED: '重新激活',
        SUPPLIER_CHANGE_APPROVED: '资料变更通过',
        SUPPLIER_CHANGE_REJECTED: '资料变更驳回',
        SUPPLIER_CONVERTED_REGULAR: '转为正式供应商',
        SUPPLIER_TAGS_UPDATED: '业务标签更新',
        SUPPLIER_EVALUATION_CREATED: '绩效评价',
      };
      const label = labelMap[log.action];
      if (!label) continue; // 跳过无标签的审计事件
      let detail = label;
      const deets = log.details as any;
      if (deets?.field) {
        const fieldLabels: Record<string, string> = { name: '企业名称', enterpriseType: '企业类型', legalPerson: '法定代表人', registeredAddress: '注册地址', businessScope: '经营范围', tags: '业务标签' };
        detail = `${label}：${fieldLabels[deets.field] || deets.field}`;
      }
      if (deets?.reason) detail += `（${deets.reason}）`;
      if (deets?.finalGrade) detail = `绩效评价：${deets.finalGrade} 级`;
      if (deets?.from) detail = `从「${deets.from}」恢复`;
      if (deets?.before && deets?.after) {
        const before = Array.isArray(deets.before) ? deets.before.join('、') || '（空）' : '';
        const after = Array.isArray(deets.after) ? deets.after.join('、') : '';
        detail = `${label}：${before} → ${after}`;
      }
      events.push({ type: log.action, label, detail, at: log.createdAt.toISOString() });
    }

    // #3 绩效评价（扣除 auditLog 中已覆盖的，补充遗漏的）
    const auditEvalAts = new Set(auditLogs.filter(l => l.action === 'SUPPLIER_EVALUATION_CREATED').map(l => l.createdAt.getTime()));
    for (const e of evaluations) {
      if (auditEvalAts.has(e.createdAt.getTime())) continue;
      events.push({ type: 'evaluation', label: '绩效评价', detail: `${e.finalGrade} 级 · 评价人：${e.evaluator?.displayName || '—'}`, at: e.createdAt.toISOString() });
    }

    // #4 参与项目（投标/合作）
    for (const bs of bidSuppliers) {
      const statusText = bs.submitStatus === '已提交' ? ' · 已投标' : bs.submitStatus !== '待提交' ? ` · ${bs.submitStatus}` : '';
      const detail = `${bs.project.name}（${bs.project.projectCode}）${statusText}`;
      events.push({ type: 'bid', label: '参与项目', detail, at: bs.createdAt.toISOString() });
    }

    // #5 供货申请
    const catalogStatusLabel: Record<string, string> = { APPROVED: '已通过', REJECTED: '未通过', PENDING: '审核中', COUNTERED: '已议价', RETURNED: '退回' };
    for (const ca of catalogApps) {
      const itemName = ca.catalogItem?.name || ca.proposedName || '未知品类';
      events.push({ type: 'catalog_apply', label: '供货申请', detail: `${itemName}（${catalogStatusLabel[ca.status] || ca.status}）`, at: ca.createdAt.toISOString() });
    }

    // #6 合同/报价
    for (const cp of contractPrices) {
      events.push({ type: 'contract', label: '合同报价', detail: `${cp.catalogItem?.name || '未知品类'} · ¥${cp.agreedPrice.toFixed(2)}${cp.contractNo ? ' · ' + cp.contractNo : ''}`, at: cp.createdAt.toISOString() });
    }

    events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return { supplierId, supplierName: supplier.name, events };
  }

  /** 供应商绩效画像：等级分布、趋势。 */
  async getSupplierPerformanceProfile(supplierId: string) {
    const evals = await this.prisma.supplierEvaluation.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'asc' },
      select: { finalGrade: true, createdAt: true },
    });
    return aggregatePerformance(
      evals.map(e => ({ finalGrade: e.finalGrade, createdAt: e.createdAt })),
    );
  }

  async getEvaluationStats() {
    const evaluations = await this.prisma.supplierEvaluation.findMany({
      select: { finalGrade: true },
    });

    const levelCounts = {
      A: evaluations.filter(e => e.finalGrade === 'A').length,
      B: evaluations.filter(e => e.finalGrade === 'B').length,
      C: evaluations.filter(e => e.finalGrade === 'C').length,
      D: evaluations.filter(e => e.finalGrade === 'D').length,
      E: evaluations.filter(e => e.finalGrade === 'E').length,
    };

    const excellentRatio = evaluations.length > 0
      ? Math.round(((levelCounts.A + levelCounts.B) / evaluations.length) * 1000) / 10
      : 0;

    return { levelCounts, excellentRatio, total: evaluations.length };
  }

  async getStats() {
    const [total, pending, approved, disabled, blacklist, returned, temporaryApproved] = await Promise.all([
      this.prisma.supplier.count(),
      this.prisma.supplier.count({ where: { status: 'PENDING' } }),
      this.prisma.supplier.count({ where: { status: 'APPROVED' } }),
      this.prisma.supplier.count({ where: { status: 'DISABLED' } }),
      this.prisma.supplier.count({ where: { status: 'BLACKLIST' } }),
      this.prisma.supplier.count({ where: { status: 'RETURNED' } }),
      this.prisma.supplier.count({ where: { status: 'APPROVED', isTemporary: true } }),
    ]);

    return { total, pending, approved, disabled, blacklist, returned, temporaryApproved };
  }

  /** 业务标签词表：聚合已入库供应商 tags 的出现频次，供选取/邀请页的标签多选控件。
   *  tags 是 String[]，Prisma 无法 groupBy 数组元素，故拉 tags 列在内存 tally（已入库 ~500 行，开销可忽略）。 */
  async getTagVocabulary(limit = 80) {
    const rows = await this.prisma.supplier.findMany({
      where: { status: 'APPROVED' },
      select: { tags: true },
    });
    const counts = new Map<string, number>();
    for (const r of rows) for (const t of r.tags || []) {
      const k = t.trim();
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const items = [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh'))
      .slice(0, Math.max(1, limit));
    return { items, totalDistinct: counts.size };
  }

  /** 业务标签全量回填：规则引擎为每个供应商生成 2~8 个标签写入 tags。
   *  默认仅填空标签（幂等，不覆盖人工/AI 已写的标签）；force=true 则全量重算。
   *  纯 CPU/字符串运算 + 逐行 update，无网络调用，500+ 行可同步完成，无超时风险。 */
  async backfillBusinessTags(opts: { force?: boolean; userId?: string } = {}) {
    const rows = await this.prisma.supplier.findMany({
      select: { id: true, name: true, businessScope: true, tags: true, classification: { select: { name: true } } },
    });
    let processed = 0, updated = 0, skipped = 0, belowMin = 0;
    const sample: Array<{ name: string; tags: string[] }> = [];
    for (const r of rows) {
      processed++;
      const hasTags = Array.isArray(r.tags) && r.tags.length > 0;
      if (hasTags && !opts.force) { skipped++; continue; }
      const tags = generateBusinessTags({ name: r.name, businessScope: r.businessScope, classificationName: r.classification?.name });
      if (tags.length < TAG_MIN) belowMin++; // 仅统计，便于核对覆盖率；极端稀疏数据不强造标签
      // 标签未变化则不写库（force 模式下也跳过无变化的，减少无效写与审计噪声）。
      if (hasTags && JSON.stringify(tags) === JSON.stringify(r.tags)) { skipped++; continue; }
      await this.prisma.supplier.update({ where: { id: r.id }, data: { tags } });
      updated++;
      if (sample.length < 6) sample.push({ name: r.name, tags });
    }
    if (opts.userId) {
      await this.audit(opts.userId, 'SUPPLIER_TAGS_BACKFILL', 'batch', { processed, updated, skipped, belowMin, force: !!opts.force });
    }
    return { processed, updated, skipped, belowMin, sample };
  }

  /** P0-14：企业类型分布后端聚合——替代看板拉 1000 条客户端计数（>1000 家偏少 + 首页开销大）。 */
  async getEnterpriseTypeDistribution() {
    const rows = await this.prisma.supplier.groupBy({
      by: ['enterpriseType'],
      where: { status: 'APPROVED' },
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.enterpriseType || '未分类'] = r._count._all;
    return { counts };
  }

  /** 公开大屏：仅返回非敏感计数（总数/已入库/待审核）。评价等级分布、分类计数、绩效趋势等
   *  经营敏感数据须鉴权访问（见 getBigscreenDetail），杜绝未登录爬取竞争性情报。 */
  async getBigscreenStats() {
    const stats = await this.getStats();
    return { total: stats.total, approved: stats.approved, pending: stats.pending };
  }

  async getBigscreenDetail() {
    const [stats, evals, classifications] = await Promise.all([
      this.getStats(),
      this.prisma.supplierEvaluation.findMany({
        select: { finalGrade: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.supplierClassification.findMany({
        select: {
          id: true,
          name: true,
          _count: { select: { suppliers: true } },
        },
        orderBy: { suppliers: { _count: 'desc' } },
      }),
    ]);

    const levelCounts = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    for (const e of evals) {
      const key = e.finalGrade as 'A'|'B'|'C'|'D'|'E';
      if (key in levelCounts) levelCounts[key]++;
    }
    const total = evals.length;
    const gradeScores = { A: 5, B: 4, C: 3, D: 2, E: 1 };
    const avgGradeScore = total > 0
      ? evals.reduce((s, e) => s + (gradeScores[e.finalGrade as keyof typeof gradeScores] ?? 3), 0) / total
      : 0;

    // 趋势：近半 vs 前半（基于等级数值）
    let trend: 'improving' | 'stable' | 'declining' = 'stable';
    if (total >= 2) {
      const half = Math.ceil(total / 2);
      const firstHalf = evals.slice(0, half);
      const secondHalf = evals.slice(-half);
      const avgGrade = (arr: typeof evals) => arr.reduce((s, e) => s + (gradeScores[e.finalGrade as keyof typeof gradeScores] ?? 3), 0) / arr.length;
      const firstAvg = avgGrade(firstHalf);
      const secondAvg = avgGrade(secondHalf);
      if (secondAvg > firstAvg + 0.5) trend = 'improving';
      else if (secondAvg < firstAvg - 0.5) trend = 'declining';
    }

    const cats = classifications.map(c => ({
      id: c.id,
      name: c.name,
      count: c._count.suppliers,
    }));

    return { ...stats, levelCounts, avgGradeScore, evalTotal: total, trend, cats };
  }

  async listClassifications() {
    return this.prisma.supplierClassification.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { suppliers: true } },
      },
    });
  }

  async createClassification(dto: CreateClassificationDto) {
    // 检查名称和代码是否重复
    const existingName = await this.prisma.supplierClassification.findUnique({
      where: { name: dto.name },
    });
    if (existingName) {
      throw new BadRequestException({ error: '分类名称已存在', code: 'DUPLICATE_NAME' });
    }

    const existingCode = await this.prisma.supplierClassification.findUnique({
      where: { code: dto.code },
    });
    if (existingCode) {
      throw new BadRequestException({ error: '分类代码已存在', code: 'DUPLICATE_CODE' });
    }

    return this.prisma.supplierClassification.create({
      data: {
        name: dto.name,
        code: dto.code,
        description: dto.description,
      },
    });
  }

  async updateClassification(id: string, dto: UpdateClassificationDto) {
    return this.prisma.supplierClassification.update({
      where: { id },
      data: {
        name: dto.name,
        code: dto.code,
        description: dto.description,
      },
    });
  }

  async deleteClassification(id: string) {
    // 检查是否有供应商使用此分类
    const suppliersCount = await this.prisma.supplier.count({
      where: { classificationId: id },
    });
    if (suppliersCount > 0) {
      throw new BadRequestException({ error: '此分类下有供应商，无法删除', code: 'HAS_SUPPLIERS' });
    }

    return this.prisma.supplierClassification.delete({
      where: { id },
    });
  }

  /* ━━━ 供应商多分类管理 ━━━ */

  async getSupplierClassifications(supplierId: string) {
    return this.prisma.supplierClassificationLink.findMany({
      where: { supplierId },
      include: { classification: true },
    });
  }

  async setSupplierClassifications(supplierId: string, classificationIds: string[]) {
    // 校验供应商存在
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw new NotFoundException('供应商不存在');

    // #19 存在性+去重校验：非法/不存在的 classificationId 此前会撞 FK P2003 → 裸 500；重复 id 会撞 P2002。
    const uniqueIds = Array.from(new Set(classificationIds ?? []));
    if (uniqueIds.length > 0) {
      const existing = await this.prisma.supplierClassification.findMany({
        where: { id: { in: uniqueIds } },
        select: { id: true },
      });
      if (existing.length !== uniqueIds.length) {
        const found = new Set(existing.map(e => e.id));
        const missing = uniqueIds.filter(id => !found.has(id));
        throw new BadRequestException({ error: `分类不存在：${missing.join(', ')}`, code: 'INVALID_CLASSIFICATION' });
      }
    }

    // 事务：先删后插 + 同步旧 classificationId 字段（P1：全部并入同一事务，避免半同步态）。
    await this.prisma.$transaction(async (tx) => {
      await tx.supplierClassificationLink.deleteMany({ where: { supplierId } });
      await Promise.all(uniqueIds.map(cid =>
        tx.supplierClassificationLink.create({ data: { supplierId, classificationId: cid } }),
      ));
      await tx.supplier.update({
        where: { id: supplierId },
        data: { classificationId: uniqueIds[0] || null },
      });
    });

    return this.getSupplierClassifications(supplierId);
  }

  /* ━━━ 通知供应商 ━━━ */

  async notifySuppliers(
    supplierIds: string[],
    channels: string[],
    payload: { type: string; title: string; content: string; link?: string },
  ) {
    const suppliers = await this.prisma.supplier.findMany({
      where: { id: { in: supplierIds } },
      select: { id: true, name: true, userId: true },
    });

    const results: Array<{ supplierId: string; supplierName: string; userId: string; channels: Record<string, string> }> = [];

    for (const s of suppliers) {
      // 占位符替换：{供应商名称} / {name} / {supplierName} → 实际供应商名称
      const title = payload.title.replace(/\{(供应商名称|name|supplierName)\}/g, s.name);
      const content = payload.content.replace(/\{(供应商名称|name|supplierName)\}/g, s.name);
      // link 透传：逐家发送时由调用方填入该供应商专属回执链接，使站内信可点击直达回执页。
      const r = await this.notificationService.sendToUser(s.userId, channels, { type: payload.type, title, content, link: payload.link ?? null });
      results.push({ supplierId: s.id, supplierName: s.name, userId: s.userId, channels: r.results });
    }

    const notFound = supplierIds.length - suppliers.length;
    return { totalTargets: supplierIds.length, sent: results.length, notFound, results };
  }

  /* ━━━ 供应商关注/收藏 ━━ */

  async toggleFavorite(supplierId: string, userId: string) {
    const existing = await this.prisma.supplierFavorite.findFirst({
      where: { supplierId, userId },
    });
    if (existing) {
      await this.prisma.supplierFavorite.delete({ where: { id: existing.id } });
      return { favorited: false };
    }
    await this.prisma.supplierFavorite.create({ data: { supplierId, userId } });
    return { favorited: true };
  }

  async getFavorites(userId: string) {
    const favs = await this.prisma.supplierFavorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    if (favs.length === 0) return [];
    const supplierIds = favs.map(f => f.supplierId);
    const suppliers = await this.prisma.supplier.findMany({
      where: { id: { in: supplierIds } },
      include: { classification: { select: { id: true, name: true } } },
    });
    const sMap = new Map(suppliers.map(s => [s.id, s]));
    return favs.map(f => {
      const s = sMap.get(f.supplierId);
      return {
        id: f.id,
        supplierId: f.supplierId,
        supplier: s ? { id: s.id, name: s.name, enterpriseType: s.enterpriseType, classification: s.classification } : null,
      };
    }).filter(f => f.supplier);
  }

  /* ━━━ 近期动态 ━━━ */

  async getRecentActivities(limit = 15) {
    const logs = await this.prisma.auditLog.findMany({
      where: { resourceType: 'supplier' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { user: { select: { displayName: true } } },
    });
    return logs.map(l => ({
      id: l.id, action: l.action, resourceId: l.resourceId,
      details: l.details, actorName: l.user?.displayName || '系统',
      at: l.createdAt.toISOString(),
    }));
  }

  /* ━━━ 评价维度统计 ━━━ */

  async getEvaluationDimensionStats() {
    const evals = await this.prisma.supplierEvaluation.findMany({
      select: { completenessGrade: true, responsivenessGrade: true, cooperationGrade: true, complianceGrade: true, comprehensiveGrade: true },
    });
    const gradeKeys: ExpertLevel[] = ['A', 'B', 'C', 'D', 'E'];
    const initCounts = (): Record<ExpertLevel, number> => ({ A: 0, B: 0, C: 0, D: 0, E: 0 });
    const counters = {
      completeness: initCounts(),
      responsiveness: initCounts(),
      cooperation: initCounts(),
      compliance: initCounts(),
      comprehensive: initCounts(),
    };
    for (const e of evals) {
      for (const dim of ['completeness', 'responsiveness', 'cooperation', 'compliance', 'comprehensive'] as const) {
        const gradeField = `${dim}Grade` as keyof typeof e;
        const grade = e[gradeField] as ExpertLevel;
        if (grade && (counters as any)[dim][grade] !== undefined) {
          (counters as any)[dim][grade]++;
        }
      }
    }
    const toNumberKey = (r: Record<ExpertLevel, number>): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const k of gradeKeys) out[k] = r[k];
      return out;
    };
    return {
      completeness: toNumberKey(counters.completeness),
      responsiveness: toNumberKey(counters.responsiveness),
      cooperation: toNumberKey(counters.cooperation),
      compliance: toNumberKey(counters.compliance),
      comprehensive: toNumberKey(counters.comprehensive),
      total: evals.length,
    };
  }

  /* ━━━ 沟通记录 ━━━ */

  async getSupplierCommunications(supplierId: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId }, select: { userId: true } });
    if (!supplier) throw new NotFoundException('供应商不存在');
    const notifications = await this.prisma.notification.findMany({
      where: { userId: supplier.userId },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    const notificationIds = notifications.map(n => n.id);
    const logs = await this.prisma.notificationDeliveryLog.findMany({
      where: { notificationId: { in: notificationIds } },
      select: { notificationId: true, channel: true, status: true },
    });
    const logMap = new Map<string, { channel: string; status: string }[]>();
    for (const l of logs) {
      if (!logMap.has(l.notificationId!)) logMap.set(l.notificationId!, []);
      logMap.get(l.notificationId!)!.push({ channel: l.channel, status: l.status });
    }
    return notifications.map(n => ({
      id: n.id, type: n.type, title: n.title, content: n.content,
      isRead: n.isRead, channels: (logMap.get(n.id) || []).map(l => l.channel),
      createdAt: n.createdAt.toISOString(),
    }));
  }

  /* ━━━ 文件档案 CRUD ━━ */

  async listDocuments(supplierId: string) {
    const docs = await this.prisma.supplierDocument.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
    });
    if (docs.length === 0) return [];
    const uploaderIds = [...new Set(docs.map(d => d.uploaderId))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: uploaderIds } },
      select: { id: true, displayName: true },
    });
    const uMap = new Map(users.map(u => [u.id, u]));
    return docs.map(d => ({
      id: d.id, type: d.type, name: d.name, fileUrl: d.fileUrl,
      fileSize: d.fileSize, note: d.note, createdAt: d.createdAt.toISOString(),
      uploader: { displayName: uMap.get(d.uploaderId)?.displayName ?? '—' },
    }));
  }

  async uploadDocument(
    supplierId: string,
    dto: { type: string; name: string; fileUrl: string; fileSize?: number; note?: string },
    userId: string,
  ) {
    return this.prisma.supplierDocument.create({
      data: {
        supplierId,
        type: dto.type ?? 'other',
        name: dto.name,
        fileUrl: dto.fileUrl,
        fileSize: dto.fileSize ?? null,
        note: dto.note ?? null,
        uploaderId: userId,
      },
    });
  }

  async deleteDocument(id: string) {
    await this.prisma.supplierDocument.delete({ where: { id } }).catch(() => {});
    return { success: true };
  }

  // ── 谈判采购配置下发 ──
  async sendNegotiationConfig(dto: NegotiationConfigDto) {
    const key = `negotiation-config:${dto.projectId}`;
    const payload = {
      ...dto,
      deliveredAt: new Date().toISOString(),
    };
    await this.redis.set(key, JSON.stringify(payload), 'EX', 86400 * 30); // 30 天过期

    // 配置写回 BidProject：openTime=开标时间，deadline=开标前半小时，downloadDeadline=获取截止
    const bidOpening = new Date(dto.bidOpeningTime);
    const acquireEnd = new Date(dto.acquireEndTime);
    if (!isNaN(bidOpening.getTime())) {
      await this.prisma.bidProject.update({
        where: { id: dto.projectId },
        data: {
          openTime: bidOpening,
          deadline: new Date(bidOpening.getTime() - 30 * 60 * 1000),
          ...(acquireEnd && !isNaN(acquireEnd.getTime()) ? { downloadDeadline: acquireEnd } : {}),
        },
      }).catch(() => { /* 项目可能不存在，忽略 */ });
    }

    // 确保受邀供应商进入候选名单（决定其在供应商端「可投标项目」的可见性）
    if (dto.supplierIds.length > 0) {
      const suppliers = await this.prisma.supplier.findMany({
        where: { id: { in: dto.supplierIds } },
        select: { id: true, name: true },
      });
      for (const s of suppliers) {
        await this.prisma.bidSupplier.upsert({
          where: { projectId_supplierName: { projectId: dto.projectId, supplierName: s.name } },
          create: { projectId: dto.projectId, supplierId: s.id, supplierName: s.name },
          update: { supplierId: s.id },
        }).catch(() => {});
      }
    }

    // 预生成 AI 融合概览并缓存（采购内容 + 招标范围 + 通知 + 两个时间），详情页直接读缓存
    void this.generateAndCacheOverview(dto.projectId).catch(() => {});

    return { delivered: dto.supplierIds.length };
  }

  /** 生成并缓存项目概览（采购内容/招标范围/通知/两个时间 → AI 融合文本），存 Redis */
  private async generateAndCacheOverview(projectId: string): Promise<void> {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { name: true, projectCode: true, procurementMethod: true, scope: true, qualification: true, budget: true, qualityRequirement: true, riskNote: true, contact: true },
    });
    if (!project) return;

    let nego: any = null;
    try {
      const raw = await this.redis.get(`negotiation-config:${projectId}`);
      if (raw) nego = JSON.parse(raw);
    } catch { /* ignore */ }

    // 邀请通知原文（任意受邀供应商的 SELECTION_NOTIFY，内容含项目名）
    let notification: string | null = null;
    try {
      const invited = await this.prisma.bidSupplier.findMany({
        where: { projectId, supplierId: { not: null } },
        select: { supplierId: true },
        take: 5,
      });
      const supplierIds = invited.map(s => s.supplierId).filter((u): u is string => !!u);
      const suppliers = supplierIds.length > 0
        ? await this.prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { userId: true } })
        : [];
      const userIds = suppliers.map(s => s.userId).filter((u): u is string => !!u);
      if (userIds.length > 0) {
        const notifs = await this.prisma.notification.findMany({
          where: { userId: { in: userIds }, type: { in: ['SELECTION_NOTIFY', 'BID_INVITED'] } },
          orderBy: { createdAt: 'desc' },
          take: 15,
          select: { content: true },
        });
        const hit = notifs.find(n => (n.content || '').includes(project.name));
        notification = hit?.content || null;
      }
    } catch { /* ignore */ }

    const fmt = (t?: string) => (t ? new Date(t).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
    const context = {
      项目名称: project.name,
      项目编号: project.projectCode,
      采购方式: project.procurementMethod,
      招标范围与采购内容: project.scope || '（未填写）',
      资质要求: project.qualification || '（未填写）',
      质量要求: project.qualityRequirement || '（未填写）',
      预算: project.budget ? `¥${project.budget}` : '（未填写）',
      风险提示: project.riskNote || '（无）',
      联系人: project.contact || '（未填写）',
      采购文件获取时间: nego ? `${fmt(nego.acquireStartTime)} 至 ${fmt(nego.acquireEndTime)}` : '（未配置）',
      开标时间: nego ? fmt(nego.bidOpeningTime) : '（未配置）',
      下载模式: nego?.downloadMode || '（未配置）',
      邀请通知原文: notification || '（无）',
    };

    const sys = `你是采购项目说明助手。基于提供的项目数据，为投标供应商生成一段融合性项目概览，必须涵盖：招标范围与采购内容（综合招标范围/资质/质量/预算）、关键时间安排（采购文件获取窗口、开标时间）、注意事项（下载模式、风险提示、联系人）。用流畅的中文段落表达，关键时间用具体日期，不要编造数据中不存在的信息。输出纯文本，2-3 段，不要 markdown 标题或列表符号。`;
    let overview = '';
    try {
      overview = await this.llm.chat(sys, JSON.stringify(context, null, 2), 0.3);
    } catch {
      overview = `${project.name}（${project.procurementMethod}），招标范围：${project.scope || '详见采购文件'}。${
        nego ? `采购文件获取时间 ${fmt(nego.acquireStartTime)} 至 ${fmt(nego.acquireEndTime)}，开标时间 ${fmt(nego.bidOpeningTime)}。` : ''
      }${project.riskNote ? `风险提示：${project.riskNote}。` : ''}`;
    }

    await this.redis.set(
      `negotiation-overview:${projectId}`,
      JSON.stringify({
        overview,
        notification,
        acquireStartTime: nego?.acquireStartTime || null,
        acquireEndTime: nego?.acquireEndTime || null,
        bidOpeningTime: nego?.bidOpeningTime || null,
        downloadMode: nego?.downloadMode || null,
        generatedAt: new Date().toISOString(),
      }),
      'EX', 86400 * 30,
    ).catch(() => {});
  }

  async getNegotiationConfig(projectId: string) {
    const key = `negotiation-config:${projectId}`;
    const raw = await this.redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  }
}