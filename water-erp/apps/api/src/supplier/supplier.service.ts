import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { hashSync } from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { RegisterSupplierDto } from './dto/register-supplier.dto';
import { CreateChangeRequestDto } from './dto/create-change-request.dto';
import { CreateQualificationDto } from './dto/create-qualification.dto';
import { CreateEvaluationDto } from './dto/create-evaluation.dto';
import { CreateClassificationDto, UpdateClassificationDto } from './dto/create-classification.dto';
import { isSupplierChangeAllowedField } from './supplier-change-fields';
import { shouldAutoDisable, aggregatePerformance } from './supplier-performance';
import { buildSupplierPortrait } from './supplier-portrait.util';

@Injectable()
export class SupplierService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) {}

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
          username: dto.username,
          displayName: dto.displayName,
          email: dto.email,
          passwordHash: hashSync(dto.password, 10),
          role: 'supplier',
          isActive: false, // 待审核后激活
        },
      });

      const supplier = await tx.supplier.create({
        data: {
          userId: user.id,
          name: dto.name,
          normalizedName,
          creditCode: dto.creditCode,
          enterpriseType: dto.enterpriseType,
          legalPerson: dto.legalPerson,
          registeredAddress: dto.registeredAddress,
          businessScope: dto.businessScope,
          contacts: {
            create: dto.contacts.map(c => ({
              name: c.name,
              phone: c.phone,
              email: c.email,
              isPrimary: c.isPrimary,
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
    void this.notificationService.sendToRole('procurement_staff', {
      type: 'SUPPLIER_PENDING',
      title: '新供应商注册待审批',
      content: `${supplier.name} 提交了注册申请，信用代码 ${supplier.creditCode}，请前往审批。`,
      link: `/supplier/${supplier.id}`,
    });

    return { user, supplier };
  }

  async list(params: { status?: string; classificationId?: string; search?: string; page?: number; pageSize?: number; sort?: 'completeness' | 'createdAt'; enterpriseTypes?: string[]; dateFrom?: string; dateTo?: string; evalLevel?: string; qualificationStatus?: string }) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const sortMode = params.sort ?? 'completeness';

    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.classificationId) where.classificationId = params.classificationId;
    if (params.enterpriseTypes?.length) where.enterpriseType = { in: params.enterpriseTypes };
    if (params.dateFrom || params.dateTo) {
      where.createdAt = {};
      if (params.dateFrom) where.createdAt.gte = new Date(params.dateFrom);
      if (params.dateTo) where.createdAt.lte = new Date(params.dateTo + 'T23:59:59.999Z');
    }
    if (params.evalLevel) {
      where.evaluations = { some: { level: params.evalLevel } };
    }
    if (params.qualificationStatus) {
      where.qualifications = { some: { status: params.qualificationStatus } };
    }
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
            select: { score: true, level: true, overallScore: true },
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
    // status 列是 SupplierStatus 枚举，参数需显式 cast，否则 PG 报 operator does not exist: SupplierStatus = text
    if (where.status) conditions.push(Prisma.sql`"status" = ${where.status}::"SupplierStatus"`);
    if (where.classificationId) conditions.push(Prisma.sql`"classificationId" = ${where.classificationId}`);
    if (where.OR) {
      // search: name ILIKE or creditCode contains
      const search = where.OR[0].name.contains;
      conditions.push(Prisma.sql`("name" ILIKE ${'%' + search + '%'} OR "creditCode" ILIKE ${'%' + search + '%'})`);
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
          select: { score: true, level: true, overallScore: true },
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

  /** 批量附平均评分到每个 supplier item */
  private async attachAvgScores(items: any[]) {
    if (items.length === 0) return;
    const ids = items.map(i => i.id);
    const aggs = await this.prisma.supplierEvaluation.groupBy({
      by: ['supplierId'],
      where: { supplierId: { in: ids } },
      _avg: { score: true },
    });
    const avgMap = new Map(aggs.map(a => [a.supplierId, a._avg.score]));
    for (const item of items) {
      item._avgScore = avgMap.get(item.id) ?? null;
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

  private async audit(userId: string, action: string, resourceId: string, details?: any) {
    await this.prisma.auditLog.create({ data: { userId, action, resourceType: 'supplier', resourceId, details: details ?? {} } }).catch(() => {});
  }

  async approve(id: string, userId?: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id }, include: { user: true } });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    if (supplier.status !== 'PENDING' && supplier.status !== 'RETURNED') {
      throw new BadRequestException({ error: '供应商状态不允许审核', code: 'INVALID_STATUS' });
    }

    // 更新供应商状态和用户激活状态
    await this.prisma.$transaction([
      this.prisma.supplier.update({
        where: { id },
        data: { status: 'APPROVED', returnReason: null, rejectReason: null },
      }),
      this.prisma.user.update({
        where: { id: supplier.userId },
        data: { isActive: true },
      }),
    ]);

    // 待办清零：resolve SUPPLIER_PENDING
    await this.notificationService.resolveActionable('SUPPLIER_PENDING', `/supplier/${id}`);

    // 发送通知给供应商
    await this.notificationService.create({
      userId: supplier.userId,
      type: 'SUPPLIER_APPROVED',
      title: '供应商审核通过',
      content: `您的供应商注册申请已审核通过，企业名称：${supplier.name}`,
      link: `/supplier/${id}`,
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

    const result = await this.prisma.supplier.update({
      where: { id },
      data: { status: 'REJECTED', rejectReason: reason },
    });

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

    const result = await this.prisma.supplier.update({
      where: { id },
      data: { status: 'RETURNED', returnReason: reason },
    });

    // 待办清零：resolve SUPPLIER_PENDING
    await this.notificationService.resolveActionable('SUPPLIER_PENDING', `/supplier/${id}`);

    // 发送通知给供应商
    await this.notificationService.create({
      userId: supplier.userId,
      type: 'SUPPLIER_RETURNED',
      title: '供应商注册退回补正',
      content: `您的供应商注册申请需补充修改，原因：${reason}`,
      link: `/supplier/register`,
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

    const result = await this.prisma.supplier.update({
      where: { id },
      data: { status, returnReason: reason },
    });
    if (userId) await this.audit(userId, `SUPPLIER_${status}`, id, { name: supplier.name, reason });
    return result;
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

    // 获取旧值
    const oldValue = supplier[dto.fieldName as keyof typeof supplier] as string;

    return this.prisma.supplierChangeRecord.create({
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

    // 审批时再次校验白名单（不信任历史数据）
    if (!isSupplierChangeAllowedField(change.fieldName)) {
      throw new BadRequestException({ error: '该字段不允许通过变更申请修改', code: 'FIELD_NOT_ALLOWED' });
    }

    // 更新变更记录和供应商字段
    await this.prisma.$transaction([
      this.prisma.supplierChangeRecord.update({
        where: { id: changeId },
        data: {
          status: 'APPROVED',
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
        },
      }),
      this.prisma.supplier.update({
        where: { id: change.supplierId },
        data: { [change.fieldName]: change.newValue },
      }),
    ]);

    return { success: true };
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

    return this.prisma.supplierChangeRecord.update({
      where: { id: changeId },
      data: {
        status: 'REJECTED',
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        rejectReason: reason,
      },
    });
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

  async createEvaluation(supplierId: string, evaluatorId: string, dto: CreateEvaluationDto) {
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

    // 计算总分
    const totalScore = dto.completenessScore + dto.responsivenessScore + dto.cooperationScore + dto.complianceScore + dto.overallScore;

    // 确定等级
    let level: string;
    if (totalScore >= 90) {
      level = 'A';
    } else if (totalScore >= 80) {
      level = 'B';
    } else if (totalScore >= 60) {
      level = 'C';
    } else {
      level = 'D';
    }

    const created = await this.prisma.supplierEvaluation.create({
      data: {
        supplierId,
        projectId: dto.projectId,
        evaluatorId,
        score: totalScore,
        level,
        completenessScore: dto.completenessScore,
        responsivenessScore: dto.responsivenessScore,
        cooperationScore: dto.cooperationScore,
        complianceScore: dto.complianceScore,
        overallScore: dto.overallScore,
        comment: dto.comment,
      },
    });

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
        select: { score: true, level: true, createdAt: true },
      }),
    ]);

    // 逐项目查中标结果（recommended）以判定是否中标。
    // 注意 BidEvaluationResult.supplierId 引用的是 BidSupplier.id（投标记录 id），非 Supplier.id。
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
      evaluations: evaluations.map(e => ({ overallScore: Number(e.score), level: e.level, createdAt: e.createdAt })),
    });
  }

  /* ── 淘汰预警 + 人工确认（决策 #3：只预警，不自动改状态） ── */

  /** 扫描淘汰候选（最近 3 次绩效均 ≤60），通知管理员；不修改 status。 */
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
        select: { score: true },
      });
      if (shouldAutoDisable(recent.map(r => ({ overallScore: Number(r.score) })), 60)) {
        candidates.push({ supplierId: s.id, name: s.name, reason: '最近 3 次绩效综合得分均 ≤ 60' });
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
      await Promise.all([
        this.notificationService.sendToRole('admin', payload),
        this.notificationService.sendToRole('procurement_staff', payload),
      ]);
    }

    return candidates;
  }

  /** 人工确认淘汰：置 status=DISABLED。 */
  async confirmEliminate(supplierId: string, reason: string, userId?: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, status: true, name: true },
    });
    if (!supplier) throw new NotFoundException('供应商不存在');
    await this.prisma.supplier.update({ where: { id: supplierId }, data: { status: 'DISABLED' } });
    if (userId) await this.audit(userId, 'SUPPLIER_ELIMINATED', supplierId, { name: supplier.name, reason });
    return { success: true };
  }

  /* ── 资质到期预警看板 ── */
  async getQualificationAlerts() {
    const items = await this.prisma.supplierQualification.findMany({
      where: { status: { not: '有效' } },
      include: { supplier: { select: { id: true, name: true } } },
      orderBy: { validTo: 'asc' },
    });
    const now = Date.now();
    return {
      items: items.map((q) => ({
        id: q.id,
        supplierId: q.supplierId,
        supplierName: q.supplier.name,
        type: q.type,
        name: q.name,
        validTo: q.validTo,
        status: q.status,
        daysRemaining: q.validTo ? Math.ceil((new Date(q.validTo).getTime() - now) / 86400000) : null,
      })),
      expiredCount: items.filter((q) => q.status === '已过期').length,
      expiringCount: items.filter((q) => q.status === '即将过期').length,
      affectedSupplierCount: new Set(items.map((q) => q.supplierId)).size,
    };
  }

  /* ── 供应商生命周期时间线 ── */
  async getSupplierTimeline(supplierId: string) {
    const [supplier, auditLogs, evaluations, bidSuppliers] = await Promise.all([
      this.prisma.supplier.findUnique({
        where: { id: supplierId },
        select: { id: true, name: true, status: true, createdAt: true, updatedAt: true, classification: { select: { name: true } } },
      }),
      this.prisma.auditLog.findMany({
        where: { resourceType: 'supplier', resourceId: supplierId },
        orderBy: { createdAt: 'asc' },
        select: { action: true, details: true, createdAt: true, userId: true, user: { select: { displayName: true } } },
      }),
      this.prisma.supplierEvaluation.findMany({
        where: { supplierId },
        orderBy: { createdAt: 'asc' },
        select: { score: true, level: true, createdAt: true, evaluator: { select: { displayName: true } } },
      }),
      this.prisma.bidSupplier.findMany({
        where: { supplierId },
        select: { project: { select: { name: true, projectCode: true } }, createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 10,
      }),
    ]);
    if (!supplier) throw new NotFoundException('供应商不存在');

    const events: Array<{ type: string; label: string; detail: string; at: string }> = [];
    events.push({ type: 'register', label: '注册提交', detail: `${supplier.name} 提交注册申请`, at: supplier.createdAt.toISOString() });

    for (const log of auditLogs) {
      const labelMap: Record<string, string> = {
        SUPPLIER_APPROVED: '审核通过', SUPPLIER_REJECTED: '审核不通过', SUPPLIER_RETURNED: '退回补正',
        SUPPLIER_DISABLED: '停用', SUPPLIER_BLACKLIST: '黑名单', SUPPLIER_ELIMINATED: '淘汰',
      };
      const detail = log.details && (log.details as any).reason ? `${labelMap[log.action] || log.action}：${(log.details as any).reason}` : (labelMap[log.action] || log.action);
      events.push({ type: log.action, label: labelMap[log.action] || log.action, detail, at: log.createdAt.toISOString() });
    }

    for (const e of evaluations) {
      events.push({ type: 'evaluation', label: '绩效评价', detail: `${Number(e.score)}分 · ${e.level}级 · 评价人：${e.evaluator?.displayName || '—'}`, at: e.createdAt.toISOString() });
    }

    for (const bs of bidSuppliers) {
      events.push({ type: 'bid_invited', label: '参与项目', detail: `${bs.project.name}（${bs.project.projectCode}）`, at: bs.createdAt.toISOString() });
    }

    events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return { supplierId, supplierName: supplier.name, events };
  }

  /** 供应商绩效画像：历史均分、趋势、等级分布。 */
  async getSupplierPerformanceProfile(supplierId: string) {
    const evals = await this.prisma.supplierEvaluation.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'asc' },
      select: { overallScore: true, level: true, createdAt: true },
    });
    return aggregatePerformance(
      evals.map(e => ({ overallScore: Number(e.overallScore), level: e.level, createdAt: e.createdAt })),
    );
  }

  async getEvaluationStats() {
    const evaluations = await this.prisma.supplierEvaluation.findMany({
      select: { level: true, score: true },
    });

    const levelCounts = {
      A: evaluations.filter(e => e.level === 'A').length,
      B: evaluations.filter(e => e.level === 'B').length,
      C: evaluations.filter(e => e.level === 'C').length,
      D: evaluations.filter(e => e.level === 'D').length,
    };

    const avgScore = evaluations.length > 0
      ? evaluations.reduce((sum, e) => sum + Number(e.score), 0) / evaluations.length
      : 0;

    return { levelCounts, avgScore, total: evaluations.length };
  }

  async getStats() {
    const [total, pending, approved, disabled, blacklist] = await Promise.all([
      this.prisma.supplier.count(),
      this.prisma.supplier.count({ where: { status: 'PENDING' } }),
      this.prisma.supplier.count({ where: { status: 'APPROVED' } }),
      this.prisma.supplier.count({ where: { status: 'DISABLED' } }),
      this.prisma.supplier.count({ where: { status: 'BLACKLIST' } }),
    ]);

    return { total, pending, approved, disabled, blacklist };
  }

  async getBigscreenStats() {
    const [stats, evals, classifications] = await Promise.all([
      this.getStats(),
      this.prisma.supplierEvaluation.findMany({
        select: { level: true, overallScore: true, createdAt: true },
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

    const levelCounts = { A: 0, B: 0, C: 0, D: 0 };
    let scoreSum = 0;
    for (const e of evals) {
      const key = e.level as 'A'|'B'|'C'|'D';
      if (key in levelCounts) levelCounts[key]++;
      scoreSum += Number(e.overallScore);
    }
    const total = evals.length;
    const avgScore = total > 0 ? Math.round((scoreSum / total) * 10) / 10 : 0;

    // 趋势：近半 vs 前半
    let trend: 'improving' | 'stable' | 'declining' = 'stable';
    if (total >= 2) {
      const half = Math.ceil(total / 2);
      const firstHalf = evals.slice(0, half);
      const secondHalf = evals.slice(-half);
      const firstAvg = firstHalf.reduce((s, e) => s + Number(e.overallScore), 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((s, e) => s + Number(e.overallScore), 0) / secondHalf.length;
      if (secondAvg > firstAvg + 3) trend = 'improving';
      else if (secondAvg < firstAvg - 3) trend = 'declining';
    }

    const cats = classifications.map(c => ({
      id: c.id,
      name: c.name,
      count: c._count.suppliers,
    }));

    return { ...stats, levelCounts, avgScore, evalTotal: total, trend, cats };
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

    // 事务：先删后插
    await this.prisma.$transaction([
      this.prisma.supplierClassificationLink.deleteMany({ where: { supplierId } }),
      ...classificationIds.map(cid =>
        this.prisma.supplierClassificationLink.create({
          data: { supplierId, classificationId: cid },
        }),
      ),
    ]);

    // 同步更新旧 classificationId 字段为第一个分类（向后兼容）
    await this.prisma.supplier.update({
      where: { id: supplierId },
      data: { classificationId: classificationIds[0] || null },
    });

    return this.getSupplierClassifications(supplierId);
  }

  /* ━━━ 供应商关注/收藏（模型已移除，保留接口兼容）━━━ */

  async toggleFavorite(_supplierId: string, _userId: string) {
    return { favorited: false };
  }

  async getFavorites(_userId: string) {
    return [];
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
      select: { completenessScore: true, responsivenessScore: true, cooperationScore: true, complianceScore: true, overallScore: true },
    });
    const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : 0;
    const scores = { completeness: evals.map(e => Number(e.completenessScore)), responsiveness: evals.map(e => Number(e.responsivenessScore)), cooperation: evals.map(e => Number(e.cooperationScore)), compliance: evals.map(e => Number(e.complianceScore)), overall: evals.map(e => Number(e.overallScore)) };
    return {
      completenessAvg: avg(scores.completeness), responsivenessAvg: avg(scores.responsiveness),
      cooperationAvg: avg(scores.cooperation), complianceAvg: avg(scores.compliance), overallAvg: avg(scores.overall),
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

  /* ━━━ 文件档案 CRUD（模型已移除，保留接口兼容）━━━ */

  async listDocuments(_supplierId: string) {
    return [];
  }

  async uploadDocument(_supplierId: string, _dto: any, _userId: string) {
    throw new BadRequestException('文件档案功能已移除');
  }

  async deleteDocument(_id: string) {
    return null;
  }
}