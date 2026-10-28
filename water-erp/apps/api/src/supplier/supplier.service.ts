import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException, Inject, Logger } from '@nestjs/common';
import { hashSync } from 'bcryptjs';
import { Prisma, ExpertLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildSubjectCode, BID_DEADLINE_BEFORE_OPENING_MS } from '@water-erp/shared';
import { encryptPasswordVault } from '../auth/password-vault.util';
import { NotificationService } from '../notification/notification.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { VerificationService } from '../verification/verification.service';
import { RegisterSupplierDto } from './dto/register-supplier.dto';
import { CorrectionSubmitDto } from './dto/correction-request.dto';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { RegisterTemporarySupplierDto } from './dto/register-temporary-supplier.dto';
import { AddSupplierRecordDto } from './dto/add-supplier-record.dto';
import { UpdateContactPersonnelDto } from './dto/update-contact-personnel.dto';
import { CreateChangeRequestDto } from './dto/create-change-request.dto';
import { CreateQualificationDto } from './dto/create-qualification.dto';
import { CreateEvaluationDto } from './dto/create-evaluation.dto';
import { CreateClassificationDto, UpdateClassificationDto } from './dto/create-classification.dto';
import { NegotiationConfigDto } from './dto/negotiation-config.dto';
import { isSupplierChangeAllowedField } from './supplier-change-fields';
import { shouldAutoDisable } from './supplier-performance';
import { buildSupplierPortrait } from './supplier-portrait.util';
import { generateBusinessTags, TAG_MAX, TAG_MIN } from './business-tags';
import { LlmService } from '../local-ai/llm.service';
import { CompanyScopeService, scopeCompanyIds } from '../company/company-scope';
import { supplierCompanyWhere } from './supplier-company-filter';
import * as XLSX from 'xlsx';
import { createHash } from 'crypto';
import { registrationAssetIdFromUrl, registrationUploadNamespace } from '../upload/registration-upload';
import { sealPii, openPii, blindIndexPii } from '../common/crypto/sm-field-crypto';
import { assertContactPhonesUnique, assertContactsArrayPhonesUnique, assertPrimaryContactMatchesAccount } from './contact-phone-unique';
import { isSealedFieldSm, openPiiForMask } from '../common/crypto/sm-field-crypto';
import { logSensitiveAccess } from '../common/sensitive-access.util';
import { EVALUATION_COOLDOWN_MS, reevalAllowed, latestSupplierEvals } from '../common/evaluation-dedupe.util';
import { openChangeValue, maskChangeValue } from './change-record-pii';
import { maskPhone, maskIdNumber, maskEmail, maskBankAccount } from '../common/pii-mask';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';

// 等级→数值映射（与 expert-admin.service.ts 共享语义，ExpertLevel: A=5 B=4 C=3 D=2 E=1）
const GRADE_SCORE: Record<ExpertLevel, number> = { A: 5, B: 4, C: 3, D: 2, E: 1 };
const SCORE_GRADE: Record<number, ExpertLevel> = { 5: 'A', 4: 'B', 3: 'C', 2: 'D', 1: 'E' };

function normalizeRegistrationTags(tags: string[]): string[] {
  return [...new Set((tags || []).map((tag) => tag.trim()).filter(Boolean))];
}

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
  private readonly logger = new Logger(SupplierService.name);

  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
    @Inject('REDIS_CLIENT') private redis: any,
    private llm: LlmService,
    private verificationService: VerificationService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  /**
   * 生成供应商编号 SUP-000001（6 位递增数字）。
   * 使用 PG 序列 supplier_no_seq 原子递增，并发注册安全。
   * 序列在迁移 20260807000000_supplier_no 中创建。
   */
  /** 审批人公司域守卫：admin 豁免；leader/staff 须与供应商归属公司一致。 */
  private async assertCompanyApprover(userId: string | undefined, supplierCompanyId: string | null) {
    if (!userId) return; // 系统触发（seed 等）不拦
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, companyId: true } });
    if (!user) return;
    if (user.role === 'admin') return;
    if ((user.role === 'leader' || user.role === 'staff') && supplierCompanyId && user.companyId === supplierCompanyId) return;
    throw new ForbiddenException({ error: '供应商审批仅限其归属公司的管理账号（或平台管理员）', code: 'COMPANY_APPROVER_ONLY' });
  }

  // ── 三级注册审批（2026-09-29 用户设计）：同公司 staff 初审 → 同公司 leader 复审 → 平台 admin 终审。
  //    Supplier.reviewStage 记录当前待审级；每级动作落 SupplierApprovalRecord（含 stage + 缘由），
  //    后级审批人可查看前级同意缘由；任一级可驳回（终态）或退回补正（补正后回到退回的那一级）。──

  static readonly REVIEW_STAGES = ['STAFF', 'LEADER', 'ADMIN'] as const;
  static readonly REVIEW_STAGE_LABELS: Record<string, string> = {
    STAFF: '初审',
    LEADER: '复审',
    ADMIN: '终审',
  };

  /** 公司内是否有指定角色的在编账号（IsActive）——用于无 staff/leader 公司的代审放行 */
  private async companyHasActiveRole(role: 'staff' | 'leader', companyId: string | null): Promise<boolean> {
    if (!companyId) return false;
    const c = await this.prisma.user.count({ where: { role, isActive: true, companyId } });
    return c > 0;
  }

  /** 三级审批的级权限断言：
   *  STAFF 级 = 同公司 staff（公司无 staff 时同公司 leader 代初审；公司连 leader 也没有时平台 admin 代初审）
   *  LEADER 级 = 同公司 leader（公司无 leader 时平台 admin 代复审）
   *  ADMIN 级 = 平台 admin（最终确认） */
  private async assertStageApprover(
    stage: string | null,
    reviewer: { id: string; role: string; companyId: string | null } | null,
    supplierCompanyId: string | null,
  ): Promise<void> {
    if (!reviewer) return; // 系统触发（seed 等）不拦
    const sameCompany = reviewer.role !== 'admin' && !!supplierCompanyId && reviewer.companyId === supplierCompanyId;
    if (stage === 'STAFF') {
      if (reviewer.role === 'staff' && sameCompany) return;
      if (reviewer.role === 'leader' && sameCompany && !(await this.companyHasActiveRole('staff', supplierCompanyId))) return;
      // 公司完全无办公账号（无 staff 且无 leader）：平台 admin 代初审（2026-10-09 方案 A）——
      // 通知侧 resolveStageApprovers 本就回退 admin，此处对齐，防「admin 收到待办却 403」死锁
      if (
        reviewer.role === 'admin' &&
        !(await this.companyHasActiveRole('staff', supplierCompanyId)) &&
        !(await this.companyHasActiveRole('leader', supplierCompanyId))
      ) return;
    } else if (stage === 'LEADER') {
      if (reviewer.role === 'leader' && sameCompany) return;
      if (reviewer.role === 'admin' && !(await this.companyHasActiveRole('leader', supplierCompanyId))) return;
    } else if (stage === 'ADMIN') {
      if (reviewer.role === 'admin') return;
    }
    throw new ForbiddenException({
      error: `当前为${SupplierService.REVIEW_STAGE_LABELS[stage ?? ''] ?? '本级'}，须由该级审批人操作`,
      code: 'REVIEW_STAGE_MISMATCH',
    });
  }

  /** 按级解析审批待办收件人（逐级流转：staff → leader → admin；各级无人时向上回退防悬空） */
  private async resolveStageApprovers(stage: string, companyId: string | null | undefined): Promise<string[]> {
    const pick = async (where: object) => (await this.prisma.user.findMany({ where, select: { id: true } })).map(u => u.id);
    if (stage === 'STAFF' && companyId) {
      const staff = await pick({ role: 'staff', isActive: true, companyId });
      if (staff.length) return staff;
      const leaders = await pick({ role: 'leader', isActive: true, companyId });
      if (leaders.length) return leaders;
    }
    if (stage === 'LEADER' && companyId) {
      const leaders = await pick({ role: 'leader', isActive: true, companyId });
      if (leaders.length) return leaders;
    }
    return pick({ role: 'admin', isActive: true });
  }

  /** 按级发送审批待办（三级流转通知主入口） */
  private async notifyStageApprovers(
    stage: string,
    companyId: string | null | undefined,
    payload: { type: string; title: string; content: string; link: string },
  ): Promise<void> {
    const ids = await this.resolveStageApprovers(stage, companyId);
    await Promise.allSettled(ids.map(id => this.notificationService.create({ userId: id, ...payload })));
  }

  /** 归属公司审批人解析（2026-09-26 用户裁定：供应商审批归归属公司的管理权限账号）：
   *  该公司 leader+staff（IsActive）；公司无人可审时回退平台 admin（防待办悬空）。
   *  admin 不在主路径——平台 admin 只管管理端账号注册/修改。 */
  private async resolveCompanyApprovers(companyId: string | null | undefined): Promise<string[]> {
    if (companyId) {
      const approvers = await this.prisma.user.findMany({
        where: { role: { in: ['leader', 'staff'] }, isActive: true, companyId },
        select: { id: true },
      });
      if (approvers.length > 0) return approvers.map(u => u.id);
    }
    const admins = await this.prisma.user.findMany({
      where: { role: 'admin', isActive: true },
      select: { id: true },
    });
    return admins.map(u => u.id);
  }

  /** 按公司域发送审批待办（resolveCompanyApprovers + 逐人 create，保持 WS 推送与待办语义）。 */
  private async notifyCompanyApprovers(companyId: string | null | undefined, payload: { type: string; title: string; content: string; link: string }) {
    const ids = await this.resolveCompanyApprovers(companyId);
    await Promise.allSettled(ids.map(id => this.notificationService.create({ userId: id, ...payload })));
  }

  /** 供应商公司归属解析（账号管理分组）：companyId 无效时静默未归属，不阻断注册。 */
  /** 归属公司解析（2026-09-17）：companyId 命中主数据 → 用之；否则按 companyName
   *  归一化 upsert 建档（注册页改用集团 62 家名单选择，多数不在既有主数据；与工作人员注册的自动建档同型）。 */
  private async resolveSupplierCompany(companyId?: string, companyName?: string): Promise<{ id: string | null; name: string | null }> {
    if (companyId) {
      const c = await this.prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } });
      if (c) return { id: c.id, name: c.name };
    }
    const name = (companyName ?? '').trim();
    if (!name) throw new BadRequestException({ error: '归属公司不存在，请重新选择', code: 'COMPANY_NOT_FOUND' });
    const up = await this.prisma.company.upsert({
      where: { name },
      update: {},
      create: { name },
      select: { id: true, name: true },
    });
    return { id: up.id, name: up.name };
  }

  private async generateSupplierNo(tx: Prisma.TransactionClient): Promise<string> {
    const [row] = await tx.$queryRaw<Array<{ supplier_no: string }>>`
      SELECT 'SUP-' || lpad(nextval('supplier_no_seq')::text, 6, '0') AS supplier_no
    `;
    return row.supplier_no;
  }

  /** 只读公司解析（查重分流用）：companyId 优先、companyName 兜底，均查不到返回 null——不建档（区别于 resolveSupplierCompany） */
  private async findCompanyRef(companyId?: string, companyName?: string): Promise<{ id: string; name: string } | null> {
    if (companyId) {
      const c = await this.prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } });
      if (c) return c;
    }
    const name = (companyName ?? '').trim();
    if (!name) return null;
    return this.prisma.company.findUnique({ where: { name }, select: { id: true, name: true } });
  }

  async register(dto: RegisterSupplierDto) {
    // 注册实名核验——主联系人手机号验证前置校验。内部批量导入用哨兵码跳过（管理端已实名核验的建档渠道）。
    // 双轨（2026-10-09）：token 轨=步骤 0 已消费验证码换发的注册会话；旧轨=验证码非消费校验（最终消费）。
    const isInternalImport = dto.registrationCode === '__INTERNAL_IMPORT__';
    if (!isInternalImport) {
      if (dto.registrationToken) {
        const session = await this.verificationService.assertRegistrationSession(dto.registrationToken);
        if (session.phone !== dto.registrationPhone.trim()) {
          throw new BadRequestException({
            error: '验证会话与注册手机号不一致',
            code: 'REGISTRATION_PHONE_SESSION_MISMATCH',
          });
        }
      } else {
        await this.verificationService.assertRegistrationCodeForUpload(dto.registrationPhone, dto.registrationCode);
      }

      const primaryContacts = (dto.contacts ?? []).filter((contact) => contact.isPrimary);
      if (primaryContacts.length !== 1) {
        throw new BadRequestException({
          error: '正式注册须指定且只能指定一名主要联系人',
          code: 'REGISTRATION_PRIMARY_CONTACT_REQUIRED',
        });
      }
      if (primaryContacts[0].phone.trim() !== dto.registrationPhone.trim()) {
        throw new BadRequestException({
          error: '主要联系人手机号须与短信验证手机号一致',
          code: 'REGISTRATION_PHONE_CONTACT_MISMATCH',
        });
      }

      const businessLicense = (dto.qualifications ?? []).find(
        (qualification) => qualification.type.trim() === '营业执照',
      );
      if (!businessLicense?.fileUrl) {
        throw new BadRequestException({
          error: '正式注册须上传营业执照',
          code: 'REGISTRATION_LICENSE_REQUIRED',
        });
      }
    }

    // ★ 用户名强制 = 统一社会信用代码（机构代码）：忽略调用方传入的 username。
    //   creditCode 唯一 → 登录用户名天然唯一。
    const creditCode = dto.creditCode.trim();
    const username = creditCode;

    // 信用代码命中：REJECTED 壳（驳回数据最小化留壳，2026-10-14）→ 走壳重开复用原行；
    // PENDING/RETURNED → 硬拦截（重复提交）；已入库（APPROVED/DISABLED/BLACKLIST）→ 多公司归属分流（2026-10-16）。
    const existingSupplier = await this.prisma.supplier.findUnique({
      where: { creditCode },
    });
    if (existingSupplier && existingSupplier.status !== 'REJECTED') {
      if (existingSupplier.status === 'PENDING' || existingSupplier.status === 'RETURNED') {
        throw new BadRequestException({ error: '统一社会信用代码已存在', code: 'DUPLICATE_CREDIT_CODE' });
      }
      // 多公司归属（2026-10-16）：已有平台账号（APPROVED/DISABLED/BLACKLIST）——
      // 本公司已入=纯重复；否则不拦死，引导用原账号登录走「申请加入」
      const candidate = await this.findCompanyRef(dto.companyId, dto.companyName);
      if (candidate) {
        const link = await this.prisma.supplierCompanyLink.findUnique({
          where: { supplierId_companyId: { supplierId: existingSupplier.id, companyId: candidate.id } },
          select: { status: true },
        });
        if (link?.status === 'APPROVED') {
          throw new BadRequestException({ error: '统一社会信用代码已存在', code: 'DUPLICATE_CREDIT_CODE' });
        }
      }
      throw new BadRequestException({
        error: '该企业已有平台账号，请使用原账号登录，在「公司归属管理」中申请加入贵公司',
        code: 'ACCOUNT_EXISTS_JOIN_INSTEAD',
      });
    }

    // 公司名允许重复，不再按名称查重；唯一标识由统一社会信用代码（creditCode）承担（上方已查重）

    // 检查用户名（统一社会信用代码）是否被非供应商角色占用（信用代码唯一性已由上方校验）。
    // 壳重开例外：驳回清洗（purgeRejectedSupplier）保留 username/role，壳自身残存的 User 行会命中
    // 本查重——命中的正是 existingSupplier.userId 时放行，事务内复用该行原位覆盖。
    const existingUser = await this.prisma.user.findFirst({
      where: { username, role: 'supplier' },
    });
    if (existingUser && existingUser.id !== existingSupplier?.userId) {
      throw new BadRequestException({ error: '该统一社会信用代码已被注册为登录账号', code: 'DUPLICATE_USERNAME' });
    }

    // 法定代表人身份证号查重（软约束：同一法人身份证号不允许重复注册）
    // F1（2026-10-14）：存量 REJECTED 壳（驳回清洗功能上线前被驳回、数据未清洗）的
    // legalPersonIdCardIdx 仍残存——查重须自排除壳自身，否则壳重开被自己的旧数据拦死。
    // 存量壳补清洗脚本：apps/api/scripts/purge-existing-rejected-suppliers.ts
    if (dto.legalPersonIdCard) {
      const existingLegal = await this.prisma.supplier.findFirst({
        where: {
          legalPersonIdCardIdx: blindIndexPii(dto.legalPersonIdCard) ?? undefined, // 密文列等值查重走盲索引
          ...(existingSupplier ? { NOT: { id: existingSupplier.id } } : {}),
        },
        select: { id: true },
      });
      if (existingLegal) {
        throw new BadRequestException({ error: '该法定代表人身份证号已用于其他供应商注册', code: 'DUPLICATE_LEGAL_ID_CARD' });
      }
    }

    // 手机号唯一绑定（2026-10-14）：主联系人手机号 = 短信验证手机号，盲索引查重（User.phoneIdx 唯一约束双保险）
    // F1：存量壳的 User 行 phoneIdx 未清洗仍残存——自排除壳自身 User。
    const registerPhoneIdx = blindIndexPii(dto.registrationPhone.trim());
    if (registerPhoneIdx) {
      const existingPhone = await this.prisma.user.findFirst({
        where: {
          phoneIdx: registerPhoneIdx,
          ...(existingSupplier ? { NOT: { id: existingSupplier.userId } } : {}),
        },
        select: { id: true },
      });
      if (existingPhone) {
        throw new BadRequestException({ error: '该手机号已绑定其他供应商账号，请更换', code: 'DUPLICATE_PHONE' });
      }
    }

    // 联系人身份证号查重（软约束：同一联系人身份证号不允许重复注册）
    // F1：存量壳的联系人子表未清洗仍残存——自排除壳自身的联系人行。
    const contactIdCards = dto.contacts.map(c => c.idCard?.trim()).filter((x): x is string => !!x);
    if (contactIdCards.length > 0) {
      const existingContact = await this.prisma.supplierContact.findFirst({
        where: {
          idCardIdx: { in: contactIdCards.map(c => blindIndexPii(c)).filter((x): x is string => !!x) },
          ...(existingSupplier ? { NOT: { supplierId: existingSupplier.id } } : {}),
        },
        select: { id: true },
      });
      if (existingContact) {
        throw new BadRequestException({ error: '该联系人身份证号已用于其他供应商注册', code: 'DUPLICATE_CONTACT_ID_CARD' });
      }
    }

    // 联系人手机号供应商内去重（2026-10-14）：注册时供应商未建档，数组内查重即可；
    // 主联系人手机号全局唯一已由上方 User.phoneIdx 查重覆盖。
    assertContactsArrayPhonesUnique(dto.contacts);

    const registrationAssetRequirements = (() => {
      if (isInternalImport) return [];

      const submittedUrls = [
        ...(dto.logoUrl ? [{ url: dto.logoUrl, category: 'general' }] : []),
        ...(dto.qualifications ?? []).flatMap((qualification) => [
          { url: qualification.fileUrl, category: 'qualification' },
          ...((qualification.attachments ?? []).map((attachment) => ({
            url: attachment.url,
            category: 'qualification',
          }))),
        ]),
        ...((dto.performances ?? []).flatMap((performance) =>
          (performance.proofFiles ?? []).map((proof) => ({
            url: proof.url,
            category: 'qualification',
          })))),
      ];
      const parsedRequirements = submittedUrls.map(({ url, category }) => ({
        id: registrationAssetIdFromUrl(url),
        category,
      }));
      if (parsedRequirements.some(({ id }) => !id)) {
        throw new BadRequestException({
          error: '注册附件必须通过本页上传，不接受外部或伪造文件地址',
          code: 'REGISTRATION_ASSET_URL_INVALID',
        });
      }
      return parsedRequirements as Array<{ id: string; category: string }>;
    })();
    const registrationAssetIds = Array.from(new Set(
      registrationAssetRequirements.map(({ id }) => id),
    ));

    if (registrationAssetIds.length > 0) {
      const assets = await this.prisma.fileAsset.findMany({
        where: {
          id: { in: registrationAssetIds },
          uploaderId: null,
          category: { in: ['qualification', 'general'] },
          key: { startsWith: `${registrationUploadNamespace(dto.registrationPhone)}/` },
        },
        select: { id: true, category: true },
      });
      const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
      const hasInvalidAsset = registrationAssetRequirements.some(({ id, category }) =>
        assetsById.get(id)?.category !== category,
      );
      if (assets.length !== registrationAssetIds.length || hasInvalidAsset) {
        throw new BadRequestException({ error: '注册附件无效或不属于当前验证手机号', code: 'REGISTRATION_ASSET_INVALID' });
      }
    }

    // 所有字段和附件通过校验后再消费验证凭据，减少校验错误导致凭据无谓失效。
    // token 轨消费注册会话（一次性）；旧轨消费短信码（e2e/兼容路径不变）。
    if (!isInternalImport) {
      if (dto.registrationToken) {
        await this.verificationService.consumeRegistrationSession(dto.registrationToken);
      } else {
        await this.verificationService.verifyRegistrationCode(dto.registrationPhone, dto.registrationCode);
      }
    }

    const companyRef = await this.resolveSupplierCompany(dto.companyId, dto.companyName);

    // 供应商写字段公共映射（正常创建与 REJECTED 壳重开两分支共用；含联系人 phoneIdx 盲索引）
    const supplierWriteData = {
      name: dto.name,
      normalizedName: dto.name.trim().toLowerCase(),
      creditCode: dto.creditCode,
      subjectCode: buildSubjectCode(dto.creditCode), // A1（B.4.2）：B+统一社会信用代码
      enterpriseType: dto.enterpriseType,
      legalPerson: dto.legalPerson,
      legalPersonIdCard: sealPii(dto.legalPersonIdCard || null) ?? null, // PII 国密密封（等保+密评）
      legalPersonPhone: sealPii(dto.legalPersonPhone || null) ?? null,
      legalPersonIdCardIdx: blindIndexPii(dto.legalPersonIdCard) ?? null,
      registeredAddress: dto.registeredAddress,
      detailedAddress: dto.detailedAddress || null,
      businessScope: dto.businessScope,
      logoUrl: dto.logoUrl || null,
      organizationCode: dto.creditCode.trim(), // 机构代码 = 统一社会信用代码
      country: dto.country || null,
      region: dto.region || null,
      registeredCapital: dto.registeredCapital || null,
      industry: dto.industry || null,
      establishedDate: dto.establishedDate ? new Date(dto.establishedDate) : null,
      companyProfile: dto.companyProfile || null,
      companyEmail: dto.companyEmail || null,
      companyWebsite: dto.companyWebsite || null,
      tags: dto.tags,
      companyId: companyRef.id,
      companyName: companyRef.name,
      contacts: {
        create: dto.contacts.map(c => ({
          name: c.name,
          gender: c.gender || null,
          phone: sealPii(c.phone) as string, // PII 国密密封（等保+密评）
          phoneIdx: blindIndexPii(c.phone) ?? null, // 联系人手机号盲索引（2026-10-14 唯一性查重）
          idCard: sealPii(c.idCard) ?? null,
          idCardIdx: blindIndexPii(c.idCard) ?? null,
          email: sealPii(c.email) ?? null,
          isPrimary: c.isPrimary,
          position: c.position,
        })),
      },
      qualifications: {
        create: dto.qualifications.map(q => ({
          type: q.type,
          name: q.name,
          fileUrl: q.fileUrl,
          attachments: (q as any).attachments ?? undefined,
          validFrom: q.validFrom ? new Date(q.validFrom) : undefined,
          validTo: q.validTo ? new Date(q.validTo) : undefined,
        })),
      },
      bankAccounts: dto.bankAccounts?.length ? {
        create: dto.bankAccounts.map(b => ({
          accountName: b.accountName,
          bankName: b.bankName,
          bankBranch: b.bankBranch || null,
          accountNo: sealPii(b.accountNo) as string, // 银行账号国密密封（等保+密评）
          isDefault: b.isDefault ?? false,
        })),
      } : undefined,
      performances: dto.performances?.length ? {
        create: dto.performances.map(p => ({
          projectName: p.projectName,
          clientName: p.clientName || null,
          contractAmount: p.contractAmount || null,
          signDate: p.signDate ? new Date(p.signDate) : undefined,
          description: p.description || null,
          proofFiles: p.proofFiles ?? [],
        })),
      } : undefined,
    };

    // 业务标签：库内标签直接用；非库标签自动创建 PENDING 自创标签，采购端审核通过后入池可选（事务外预算，两分支共用）
    const submittedTags = (dto.tags || []).map((t) => t.trim()).filter(Boolean);

    // 创建/重开用户与供应商 — 事务保证原子性。
    // REJECTED 壳重开（2026-10-14）：被驳回公司以同一信用代码重新注册时，复用原 User+Supplier 行
    // 原位覆盖（supplierNo 不变、SupplierApprovalRecord 留痕链延续），视同新申请从首级 STAFF 重新走审。
    const { user, supplier, customTags } = await this.prisma.$transaction(async (tx) => {
      if (existingSupplier) {
        // —— 壳重开分支：复用原 User+Supplier 行 ——
        // F4（2026-10-14）：乐观锁认领（对齐 submitCorrection 模式）——校验读与事务写之间壳可能被
        // 并发流转（如补正重提/他处重开），where 带 REJECTED 保证并发下仅一方成功，防 TOCTOU。
        const claimed = await tx.supplier.updateMany({
          where: { id: existingSupplier.id, status: 'REJECTED' },
          data: { status: 'PENDING' },
        });
        if (claimed.count === 0) {
          throw new BadRequestException({ error: '该信用代码的申请状态已变更，请刷新后重试', code: 'CONFLICT' });
        }

        const user = await tx.user.update({
          where: { id: existingSupplier.userId },
          data: {
            displayName: dto.displayName,
            email: sealPii(dto.email) ?? null, // PII 国密密封（等保+密评）
            passwordHash: hashSync(dto.password, 10),
            passwordVault: encryptPasswordVault(dto.password) ?? null,
            isActive: false, // 待审核后激活（phone/phoneIdx 不动：正式注册本就不写账号手机号，purge 已置 null）
          },
        });

        if (registrationAssetIds.length > 0) {
          const claimed = await tx.fileAsset.updateMany({
            where: { id: { in: registrationAssetIds }, uploaderId: null },
            data: { uploaderId: user.id },
          });
          if (claimed.count !== registrationAssetIds.length) {
            throw new ConflictException({ error: '注册附件已被其他申请占用，请重新上传', code: 'REGISTRATION_ASSET_ALREADY_CLAIMED' });
          }
        }

        // 删旧子表再按新申请重建（purge 已删空，防御性重删——联系人手机号有供应商内唯一 DB 约束）
        await tx.supplierContact.deleteMany({ where: { supplierId: existingSupplier.id } });
        await tx.supplierQualification.deleteMany({ where: { supplierId: existingSupplier.id } });
        await tx.supplierBankAccount.deleteMany({ where: { supplierId: existingSupplier.id } });
        await tx.supplierPerformance.deleteMany({ where: { supplierId: existingSupplier.id } });

        const supplier = await tx.supplier.update({
          where: { id: existingSupplier.id },
          data: {
            ...supplierWriteData,
            status: 'PENDING',
            reviewStage: 'STAFF', // 三级注册审批（2026-09-29）：壳重开从首级 STAFF 起走
            rejectReason: null,
            returnReason: null,
            urgedAt: null,
            isTemporary: false,
            temporaryExpiresAt: null,
          },
          include: {
            contacts: true,
            qualifications: true,
            bankAccounts: true,
            performances: true,
          },
        });
        const customTags = await this.persistRegistrationTags(tx, submittedTags, supplier.id);
        return { user, supplier, customTags };
      }

      // —— 正常创建分支 ——
      const user = await tx.user.create({
        data: {
          username, // = 机构代码
          displayName: dto.displayName,
          email: sealPii(dto.email) ?? null, // PII 国密密封（等保+密评）
          passwordHash: hashSync(dto.password, 10),
          passwordVault: encryptPasswordVault(dto.password) ?? null,
          role: 'supplier',
          isActive: false, // 待审核后激活
        },
      });

      if (registrationAssetIds.length > 0) {
        const claimed = await tx.fileAsset.updateMany({
          where: { id: { in: registrationAssetIds }, uploaderId: null },
          data: { uploaderId: user.id },
        });
        if (claimed.count !== registrationAssetIds.length) {
          throw new ConflictException({ error: '注册附件已被其他申请占用，请重新上传', code: 'REGISTRATION_ASSET_ALREADY_CLAIMED' });
        }
      }

      const supplierNo = await this.generateSupplierNo(tx);
      const supplier = await tx.supplier.create({
        data: {
          ...supplierWriteData,
          userId: user.id,
          // 三级注册审批（2026-09-29）：新注册从首级 STAFF 起走
          reviewStage: 'STAFF',
          supplierNo,
        },
        include: {
          contacts: true,
          qualifications: true,
          bankAccounts: true,
          performances: true,
        },
      });

      const customTags = await this.persistRegistrationTags(tx, submittedTags, supplier.id);
      return { user, supplier, customTags };
    });

    // 通知采购管理员：新供应商待审批（待办型，审批后自动 resolve）
    // 注意：绝不回传 passwordHash/passwordVault/PII 密文等敏感字段——公开注册响应白名单化
    //（2026-10-14 测试发现：原「仅剥 passwordHash」的展开写法会把 KMS 保险库与密封字段一并外发）。
    const safeUser = { id: user.id, username: user.username, displayName: user.displayName, role: user.role, isActive: user.isActive };

    // 三级审批：注册通知发首级（STAFF）审批人；后级由上一级通过时逐级流转
    await this.notifyStageApprovers('STAFF', supplier.companyId, {
      type: 'SUPPLIER_PENDING',
      title: '新供应商注册待初审',
      content: `${supplier.name} 提交了注册申请，信用代码 ${supplier.creditCode}，请前往初审。`,
      link: `/supplier/approval?supplierId=${supplier.id}`,
    });

    // 含自创业务标签时，额外提醒到供应商管理中心审核标签入池
    if (customTags.length) {
      await this.notifyCompanyApprovers(supplier.companyId, {
        type: 'SUPPLIER_PENDING',
        title: '新自创业务标签待审核',
        content: `${supplier.name} 注册时自创标签：${customTags.join('、')}，审核通过后将进入标签库供后续注册选择。`,
        link: '/supplier',
      });
    }

    return { user: safeUser, supplier };
  }

  /** 注册业务标签持久化（正常创建与 REJECTED 壳重开两分支共用）：
   *  库内标签直接用；非库标签自动创建 PENDING 自创标签，采购端审核通过后入池可选。 */
  private async persistRegistrationTags(tx: Prisma.TransactionClient, submittedTags: string[], supplierId: string): Promise<string[]> {
    const customTags: string[] = [];
    for (const t of submittedTags) {
      const persistedTag = await tx.businessTag.upsert({
        where: { name: t },
        create: { name: t, status: 'PENDING', source: 'supplier_register', createdBySupplierId: supplierId },
        update: {},
      });
      if (persistedTag.createdBySupplierId === supplierId) {
        customTags.push(t);
      }
    }
    return customTags;
  }

  
  //  临时供应商邀请码（采购端生成，有效期 30/180/360 天）
  
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

  async listInvitations(params: { page?: number; pageSize?: number; status?: string; actor?: any }) {
    await this.syncExpiredStatus();
    // 邀请码历史公司隔离（2026-10-16 用户裁定）：非 admin 仅看本司创建人生成的邀请码——
    // 邀请码表无公司列，经创建人 User.companyId 关联过滤（读时关联，不加列不迁移）；
    // admin 经 resolveScope 全量视角；无归属创建人（companyId=null）落入 NO_COMPANY 哨兵=空集。
    const scope = params.actor ? await this.companyScope.resolveScope(params.actor) : { all: true, companyIds: [] };
    const where: any = {
      ...(params.status ? { status: params.status as any } : {}),
      ...(scope.all ? {} : { createdBy: this.companyScope.filter(scope) }),
    };
    const page = params.page ?? 1;
    const pageSize = Math.min(params.pageSize ?? 20, 100);
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

  async revokeInvitation(id: string, userId: string, actor?: any) {
    // 公司隔离同口径（2026-10-16）：列表已按创建人公司过滤，作废按 :id 也要越权 403——
    // 否则 leader 可凭枚举 id 作废他司邀请码（真隔离=where 注入+:id 越权 403）。
    const inv = await this.prisma.supplierInvitation.findUnique({ where: { id }, include: { createdBy: { select: { companyId: true } } } });
    if (!inv) throw new NotFoundException('邀请码不存在');
    if (actor) {
      this.companyScope.assertInScope(inv.createdBy?.companyId ?? null, await this.companyScope.resolveScope(actor));
    }
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
    if (inv.status === 'USED') return { valid: false, reason: '该邀请码已被使用（每个邀请码仅可注册一次）；若贵司已注册请直接登录，临时资格过期请到登录页凭新邀请码续期' };
    if (inv.status === 'REVOKED') return { valid: false, reason: '邀请码已作废' };
    if (inv.status === 'EXPIRED' || inv.expiresAt < new Date()) return { valid: false, reason: '邀请码已过期' };
    return { valid: true, validityDays: inv.validityDays, expiresAt: inv.expiresAt };
  }

  
  //  临时供应商注册（凭邀请码，极简字段；审批通过后由供应商补全资料）
  
  async registerTemporary(dto: RegisterTemporarySupplierDto) {
    const submittedTags = normalizeRegistrationTags(dto.tags);
    if (submittedTags.length < TAG_MIN || submittedTags.length > TAG_MAX) {
      throw new BadRequestException({
        error: `业务标签须选择 ${TAG_MIN} 至 ${TAG_MAX} 项`,
        code: 'INVALID_BUSINESS_TAGS',
      });
    }

    const code = dto.invitationCode.toUpperCase().trim();
    await this.syncExpiredStatus();
    const inv = await this.prisma.supplierInvitation.findUnique({ where: { code } });
    if (!inv) throw new BadRequestException({ error: '邀请码不存在', code: 'INVITATION_NOT_FOUND' });
    if (inv.status === 'USED') throw new BadRequestException({ error: '该邀请码已被使用（每个邀请码仅可注册一次）；若贵司已注册请直接登录，临时资格过期请到登录页凭新邀请码续期', code: 'INVITATION_USED' });
    if (inv.status === 'REVOKED') throw new BadRequestException({ error: '邀请码已作废', code: 'INVITATION_REVOKED' });
    if (inv.status === 'EXPIRED' || inv.expiresAt < new Date()) throw new BadRequestException({ error: '邀请码已过期', code: 'INVITATION_EXPIRED' });
    // R-3：若邀请码绑定了信用代码，校验注册企业必须匹配（防码泄漏被任意企业使用）
    if (inv.boundCreditCode && inv.boundCreditCode !== dto.creditCode.trim()) {
      throw new BadRequestException({ error: '该邀请码已绑定其他企业，无法使用', code: 'INVITATION_BOUND_MISMATCH' });
    }

    const normalizedName = dto.name.trim().toLowerCase();
    // ★ 用户名强制 = 机构代码（与正式注册一致）
    const creditCode = dto.creditCode.trim();
    const username = creditCode; // 用户名强制 = 统一社会信用代码（机构代码）
    const existingCredit = await this.prisma.supplier.findUnique({ where: { creditCode: dto.creditCode.trim() } });
    if (existingCredit) throw new BadRequestException({ error: '统一社会信用代码已存在', code: 'DUPLICATE_CREDIT_CODE' });
    const existingUser = await this.prisma.user.findFirst({ where: { username, role: 'supplier' } });
    if (existingUser) throw new BadRequestException({ error: '该机构代码已被注册为登录账号，请更换', code: 'DUPLICATE_USERNAME' });

    // 手机号唯一绑定（2026-10-14）：盲索引查重，防临时注册/转正引入重复手机号（User.phoneIdx 唯一约束双保险）
    const phoneIdx = blindIndexPii(dto.phone);
    if (phoneIdx) {
      const existingPhone = await this.prisma.user.findFirst({ where: { phoneIdx }, select: { id: true } });
      if (existingPhone) throw new BadRequestException({ error: '该手机号已绑定其他供应商账号，请更换', code: 'DUPLICATE_PHONE' });
    }
    // 法定代表人身份证号查重（对齐正式注册：同一法人身份证号不允许重复注册）
    const legalIdCardIdx = blindIndexPii(dto.legalPersonIdCard.trim());
    if (legalIdCardIdx) {
      const existingLegal = await this.prisma.supplier.findFirst({ where: { legalPersonIdCardIdx: legalIdCardIdx }, select: { id: true } });
      if (existingLegal) throw new BadRequestException({ error: '该法定代表人身份证号已用于其他供应商注册', code: 'DUPLICATE_LEGAL_ID_CARD' });
    }

    // 手机验证：事务前仅非消费校验（防错码进事务）；消费移到事务成功后——事务失败不烧码，
    // 修复「首次提交失败→重试验证码已过期」的连带（2026-10-14 用户报告）。
    await this.verificationService.assertRegistrationCodeForUpload(dto.phone, dto.registrationCode);

    const companyRef = await this.resolveSupplierCompany(dto.companyId, dto.companyName);

    const { user, supplier, customTags } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username,
          displayName: dto.displayName,
          phone: sealPii(dto.phone) as string, // PII 国密密封（等保+密评）
          phoneIdx: blindIndexPii(dto.phone) ?? null,
          passwordHash: hashSync(dto.password, 10),
          passwordVault: encryptPasswordVault(dto.password) ?? null,
          role: 'supplier',
          isActive: false, // 仍需审核
        },
      });
      const supplier = await tx.supplier.create({
        data: {
          userId: user.id,
          // 三级注册审批（2026-09-29）：临时注册同样从 STAFF 起走（仍需审核）
          reviewStage: 'STAFF',
          name: dto.name,
          normalizedName,
          creditCode: dto.creditCode.trim(),
          subjectCode: buildSubjectCode(dto.creditCode.trim()), // A1（B.4.2）
          organizationCode: dto.creditCode.trim(), // 机构代码 = 统一社会信用代码
          supplierNo: await this.generateSupplierNo(tx),
          // 临时注册 2.0：法人三件套与地址随注册写入（此前留空串占位）；
          // enterpriseType/businessScope 仍留空，审批通过后由供应商在企业信息中自行补全。
          legalPerson: dto.legalPerson.trim(),
          legalPersonIdCard: sealPii(dto.legalPersonIdCard.trim()) as string, // PII 国密密封（等保+密评）
          legalPersonIdCardIdx: blindIndexPii(dto.legalPersonIdCard.trim()) ?? null,
          registeredAddress: dto.registeredAddress?.trim() || '',
          region: dto.region?.trim() || null,
          enterpriseType: '',
          businessScope: '',
          tags: submittedTags,
          isTemporary: true,
          temporaryExpiresAt: inv.expiresAt,
          companyId: companyRef.id,
          companyName: companyRef.name,
          invitation: { connect: { id: inv.id } },
          contacts: { create: [{ name: dto.displayName, phone: sealPii(dto.phone) as string, phoneIdx: blindIndexPii(dto.phone) ?? null, email: sealPii(dto.email || null) ?? null, isPrimary: true, position: '联系人' }] },
        },
        include: { contacts: true },
      });

      // 与正式注册保持一致：库外标签进入待审核池，并在事务完成后触发管理员提醒。
      const customTags: string[] = [];
      for (const tag of submittedTags) {
        const persistedTag = await tx.businessTag.upsert({
          where: { name: tag },
          create: {
              name: tag,
              status: 'PENDING',
              source: 'supplier_register',
              createdBySupplierId: supplier.id,
          },
          update: {},
        });
        if (persistedTag.createdBySupplierId === supplier.id) {
          customTags.push(tag);
        }
      }
      // 邀请码消费原子化：并发同码双注册时仅一方能把 status 从 ACTIVE 置 USED，
      // 另一方 count=0 → 事务回滚（其 user/supplier 创建一并撤销），杜绝孤儿 supplier 与占位冲突。
      const claimedInv = await tx.supplierInvitation.updateMany({
        where: { id: inv.id, status: 'ACTIVE' },
        data: { status: 'USED', usedById: supplier.id, usedAt: new Date() },
      });
      if (claimedInv.count === 0) {
        throw new BadRequestException({ error: '邀请码已被使用或已失效', code: 'INVITATION_CONFLICT' });
      }
      return { user, supplier, customTags };
    });

    // 事务成功后才消费验证码：失败已回滚、码未烧，用户可原码重试（消费失败仅告警，不阻断成功结果）
    try {
      await this.verificationService.verifyRegistrationCode(dto.phone, dto.registrationCode);
    } catch { /* 数据已落库；验证码残留由 TTL 兜底，不影响本次注册结果 */ }

    const expireLabel = inv.expiresAt.toISOString().slice(0, 10);
    // 响应白名单化（同正式注册，2026-10-14）：passwordVault/PII 密文不外发
    const safeUser = { id: user.id, username: user.username, displayName: user.displayName, role: user.role, isActive: user.isActive };
    await this.notifyStageApprovers('STAFF', supplier.companyId, {
      type: 'SUPPLIER_PENDING',
      title: '新临时供应商注册待初审',
      content: `${supplier.name}（临时供应商，有效期至 ${expireLabel}）提交了注册申请，请前往初审。`,
      link: `/supplier/approval?supplierId=${supplier.id}`,
    });

    // 含自创业务标签时，额外提醒到供应商管理中心审核标签入池
    if (customTags.length) {
      await this.notifyCompanyApprovers(supplier.companyId, {
        type: 'SUPPLIER_PENDING',
        title: '新自创业务标签待审核',
        content: `${supplier.name} 注册时自创标签：${customTags.join('、')}，审核通过后将进入标签库供后续注册选择。`,
        link: '/supplier',
      });
    }

    return { user: safeUser, supplier, temporaryExpiresAt: inv.expiresAt, validityDays: inv.validityDays };
  }

  /**
   * 候选供应商对比面板：按 ID 批量取供应商库实时资料。
   *
   * 背景：对比维度扩到 13 项后，此前数据取自推荐负载（快照）——旧会话恢复的
   * 推荐结果无扩充字段，对比页大面积「—」。改为面板打开时按 supplierId 实时
   * 抓取库内资料（与 ai.service 推荐组装同源 include），对比数据永远以库为准。
   */
  /** 候选对比（公司视野过滤 2026-10-19）：含明文联系人电话（遴选/邀请场景裁定）——
   *  出视野 id 静默丢弃（结果列缺席），不得向视野外供应商出口资料。 */
  async compareProfiles(ids: string[], actor?: AuthenticatedUser, companyId?: string): Promise<Record<string, unknown>> {
    const cleaned = [...new Set((ids ?? []).map((i) => String(i).trim()).filter(Boolean))].slice(0, 12);
    if (cleaned.length === 0) return {};

    const f = actor ? supplierCompanyWhere(await this.companyScope.resolveScope(actor, companyId)) : {};
    const suppliers = await this.prisma.supplier.findMany({
      where: { id: { in: cleaned }, ...f },
      include: {
        classification: true,
        contacts: { where: { isPrimary: true }, take: 2 },
        qualifications: { select: { name: true, type: true, status: true, validTo: true }, take: 5, orderBy: { createdAt: 'asc' } },
        evaluations: { select: { finalGrade: true }, orderBy: { createdAt: 'desc' } },
        bidSuppliers: { where: { project: { stage: { notIn: ['ARCHIVED'] } } }, select: { id: true } },
      },
    });

    const result: Record<string, unknown> = {};
    for (const s of suppliers) {
      const evals = (s as any).evaluations ?? [];
      result[s.id] = {
        supplierId: s.id,
        name: s.name,
        supplierNo: s.supplierNo,
        classification: s.classification?.name ?? undefined,
        enterpriseType: s.enterpriseType,
        legalPerson: s.legalPerson,
        registeredCapital: s.registeredCapital || undefined,
        region: s.region || undefined,
        industry: s.industry || undefined,
        businessScope: s.businessScope || undefined,
        registeredAddress: s.registeredAddress || undefined,
        tags: (s.tags ?? []) as string[],
        qualifications: ((s as any).qualifications ?? []).map(
          (q: { name: string; type: string; status: string; validTo: Date | null }) => ({
            name: q.name,
            type: q.type,
            status: q.status,
            validTo: q.validTo ? q.validTo.toISOString().slice(0, 10) : undefined,
          }),
        ),
        contacts: ((s as any).contacts ?? []).map((c: { name: string; phone: string; isPrimary: boolean }) => ({
          name: c.name,
          // 遴选/邀请场景明文出口（2026-10-12 用户裁定）：对比面板用于敲定邀请名单并电话联系，
          // 此处无点击揭示机制，掩码即不可见；存储仍密封
          phone: openPiiForMask(c.phone),
          isPrimary: c.isPrimary,
        })),
        evaluation: evals.length > 0 ? { level: evals[0].finalGrade || '', count: evals.length } : undefined,
        activeProjects: ((s as any).bidSuppliers ?? []).length,
      };
    }
    return result;
  }

  async list(params: { status?: string; classificationId?: string; search?: string; page?: number; pageSize?: number; sort?: 'completeness' | 'createdAt'; enterpriseTypes?: string[]; dateFrom?: string; dateTo?: string; evalLevel?: string; qualificationStatus?: string; isTemporary?: boolean; reviewStage?: string; scopeUserId?: string; companyId?: string; actor?: AuthenticatedUser }) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const sortMode = params.sort ?? 'completeness';

    const where: any = {};
    // 公司域已注入的公司 id 集（null=未注入/全部视野）——leader 代初审展开前提取值
    let scopedCompanyIds: string[] | null = null;
    // 数据隔离：supplier 角色只能看到自己企业，防止跨企枚举与主联系人 PII 泄露。
    if (params.scopeUserId) where.userId = params.scopeUserId;
    // 公司级数据隔离（2026-10-16 多公司归属换形）：APPROVED link 存在性替代 where.companyId——
    // B 公司库可见已加入供应商；存量由 backfill 脚本镜像为 APPROVED link，PENDING 审批件不受影响。
    // admin 可 ?companyId= 切单/多公司（默认全部）、非 admin 强制本公司；supplier 角色走 scopeUserId
    // 既有收敛，不叠加公司过滤。
    if (!params.scopeUserId && params.actor) {
      const scope = await this.companyScope.resolveScope(params.actor, params.companyId);
      scopedCompanyIds = scopeCompanyIds(scope);
      // 审批流上下文（C1 终审修复 2026-10-19）：reviewStage 显式给定，或 status 正向选定
      // PENDING/RETURNED/REJECTED 之一 → 审批中心注册列表。exclude: 形式（库「全部」标签
      // exclude:PENDING,RETURNED）与缺省均为库视图——exclude 语义是「排除待审」而非「选定待审」，
      // 不触发双谓词。新注册件提交即落 Supplier.companyId，但 APPROVED link 要到 ADMIN 终审才
      // upsert（approve·终审事务）——单用 link 谓词会「角标有数（myPendingReviewCount 按
      // companyId 计）、列表却空」。审批流面改双谓词：APPROVED link 在视野 OR 主归属在视野；
      // 库视图保持 APPROVED link-only 不动（Task 7 口径，spec 裁定）。
      const approvalFlow = !!params.reviewStage
        || (!!params.status
          && !params.status.startsWith('exclude:')
          && ['PENDING', 'RETURNED', 'REJECTED'].includes(params.status));
      if (scopedCompanyIds !== null) {
        if (approvalFlow) {
          // 双谓词须单组 OR（Prisma 顶层字段为 AND 语义），放 where.AND 组——与 search 的顶层
          // where.OR、代审展开的 AND 追加均不冲突（各自 conjunctive）
          where.AND = [...(Array.isArray(where.AND) ? where.AND : []), {
            OR: [
              { companyLinks: { some: { companyId: { in: scopedCompanyIds }, status: 'APPROVED' } } },
              { companyId: { in: scopedCompanyIds } },
            ],
          }];
        } else {
          const w = supplierCompanyWhere(scope);
          if (w.companyLinks) where.companyLinks = (w as any).companyLinks;
        }
      }
    }
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
    // 资质状态筛选按 validTo 派生（2026-09-29 S4 终稿）：qualifications.status 字段
    // 自创建后无人回写（默认'有效'恒不变）——此前选"已过期/即将过期"恒空；与资质预警
    // 面板同口径（已过期=validTo<今；即将过期=今~+30天；有效=null 或 ≥+30天）
    if (params.qualificationStatus === '已过期') {
      where.qualifications = { some: { validTo: { lt: new Date() } } };
    } else if (params.qualificationStatus === '即将过期') {
      const soon = new Date(); soon.setDate(soon.getDate() + 30);
      where.qualifications = { some: { validTo: { gte: new Date(), lt: soon } } };
    } else if (params.qualificationStatus === '有效') {
      const soon = new Date(); soon.setDate(soon.getDate() + 30);
      where.qualifications = { some: { OR: [{ validTo: null }, { validTo: { gte: soon } }] } };
    }
    // 临时供应商筛选（凭邀请码注册、有效期由邀请码绑定）。与状态可叠加，如 isTemporary=true & status=APPROVED。
    if (params.isTemporary === true) where.isTemporary = true;
    // 三级审批当前级筛选（2026-09-29，审批中心分列）：STAFF / LEADER / ADMIN。
    // admin 查 ADMIN 级时同步带上「归属公司无在编 leader」的 LEADER 级代复审件（2026-10-08 A 方案，
    // 与 myPendingReviewCount/assertStageApprover 同口径）：raw 路径按 __delegatedExpand 标记翻译 SQL，
    // ORM 路径在查询前展开并剥离标记（标记不得泄入 Prisma 参数）。
    const delegatedExpand = params.actor?.role === 'admin' && params.reviewStage === 'ADMIN';
    // leader 查 LEADER 级时带上本公司 STAFF 级代初审件（2026-10-09）：公司无在编 staff 时
    // leader 代初审——权限/通知/角标均已达成，唯列表不可见（角标有数、列表却空）。
    // 前提：公司域已注入（scopedCompanyIds 非 null；2026-10-16 换形后自 link 注入点取值），
    // 否则不展开——无归属 leader 不得拖全库 STAFF 件。leader 视野恒单公司，取首 id 判 staff。
    const leaderExpand = params.actor?.role === 'leader' && params.reviewStage === 'LEADER'
      && scopedCompanyIds !== null && !(await this.companyHasActiveRole('staff', scopedCompanyIds[0]));
    if (params.reviewStage && !delegatedExpand && !leaderExpand) where.reviewStage = params.reviewStage;
    if (delegatedExpand) (where as any).__delegatedExpand = true; // raw 路径翻译为 SQL；ORM 路径在查询前展开并剥离
    if (leaderExpand) (where as any).__leaderExpand = true; // 同上（两级 OR）
    // 退回补正/已驳回可见性（2026-09-30 用户裁定）：admin 全见；同公司 leader（公司管理员）全见
    // （公司域由 companyScope 已注入）；同公司 staff 仅见自己经手的（退回/驳回动作 reviewer=本人）。
    if (
      (params.status === 'RETURNED' || params.status === 'REJECTED') &&
      !params.reviewStage
    ) {
      // admin 不可见（2026-09-30 用户裁定）：退回/驳回仅归公司管理账号（leader 全见、staff 见自己经手）
      if (params.actor?.role === 'admin') {
        where.id = { in: [] }; // 恒空
      } else if (params.actor && params.actor.role === 'staff') {
        where.approvalRecords = { some: { action: params.status, reviewerUserId: params.actor.sub } };
      }
    }
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { creditCode: { contains: params.search } },
        { normalizedName: { contains: params.search, mode: 'insensitive' } },
        { tags: { hasSome: [params.search] } },
      ];
    }

    // 资料完整度排序：关键字段填充计数降序，同分按时间降序
    if (sortMode === 'completeness') {
      const res = await this.listByCompleteness(where, { page, pageSize });
      if (delegatedExpand) this.markDelegatedReview(res.items);
      else if (leaderExpand) this.markDelegatedReview(res.items, ['STAFF']);
      return res;
    }

    // 代审展开（A 方案）：内部标记 → ORM where 的 AND/OR 结构
    const ormWhere: any = where;
    if ((where as any).__delegatedExpand) {
      delete ormWhere.__delegatedExpand;
      ormWhere.AND = [...(Array.isArray(where.AND) ? where.AND : []), {
        OR: [
          { reviewStage: 'ADMIN' },
          // companyId=null 分支同 myPendingReviewCount：未归属件归 admin 代审（与 raw/权限断言同口径）
          { reviewStage: 'LEADER', OR: [{ companyId: null }, { company: { users: { none: { role: 'leader', isActive: true } } } }] },
          { reviewStage: 'STAFF', OR: [{ companyId: null }, { company: { users: { none: { OR: [{ role: 'staff' }, { role: 'leader' }], isActive: true } } } }] },
        ],
      }];
    } else if ((where as any).__leaderExpand) {
      // leader 代初审展开（2026-10-09）：LEADER（本职）OR STAFF（本公司无 staff 的代审件）；
      // 公司域由 companyScope 注入的 where.companyLinks 限定（2026-10-16 换形）
      delete ormWhere.__leaderExpand;
      ormWhere.AND = [...(Array.isArray(where.AND) ? where.AND : []), {
        OR: [{ reviewStage: 'LEADER' }, { reviewStage: 'STAFF' }],
      }];
    }

    const [total, items] = await Promise.all([
      this.prisma.supplier.count({ where: ormWhere }),
      this.prisma.supplier.findMany({
        where: ormWhere,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          classification: true,
          contacts: { where: { isPrimary: true } },
          _count: { select: { evaluations: true, qualifications: true, contacts: true } },
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
    if (delegatedExpand) this.markDelegatedReview(items);
    else if (leaderExpand) this.markDelegatedReview(items, ['STAFF']);

    return { total, page, pageSize, items };
  }

  /** 代审件标记（A 方案 2026-10-08；2026-10-09 扩 STAFF 孤儿/leader 代初审）：
   *  admin 展开（ADMIN 级 OR 无 leader 公司的 LEADER 级 OR 无 staff 无 leader 公司的 STAFF 级）
   *  命中的 LEADER/STAFF 级项即代审件；leader 展开（LEADER OR 本公司 STAFF）仅 STAFF 级为代审——
   *  where 已限定前提，前端据此亮「待我审」。 */
  private markDelegatedReview(items: any[], stages: string[] = ['LEADER', 'STAFF']) {
    for (const it of items) {
      if (stages.includes(it.reviewStage)) it.delegatedReview = true;
    }
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
    // 公司级数据隔离（2026-10-16 多公司归属）：link 存在性翻译——与 ORM 路径 companyLinks.some 同口径，
    // raw 路径漏译即静默 no-op（历史事故病根），改形状必须同步本件。companyId 参数只可能是
    // string 或 { in: string[] }（supplierCompanyWhere 产 { in }；string 分支为容错），逐元素
    // 参数化入 IN——对象本体不得直接插参（jsonb 500，2026-10-15 事故）。
    // C1 终审修复（2026-10-19）加译审批流双谓词（ORM 侧形状 where.AND[].OR[]）：
    // (EXISTS APPROVED link OR s."companyId" IN 视野集)；状态改自 where 形状读取（不再硬编码
    // 'APPROVED'）且空 in 集 → 恒 false（不再静默跳过=丢公司过滤）。
    const toCompanyIdList = (co: string | { in: string[] }): string[] => (typeof co === 'string' ? [co] : (co.in ?? []));
    const linkExistsSql = (companyId: string | { in: string[] }, status?: string): Prisma.Sql => {
      const list = toCompanyIdList(companyId);
      if (list.length === 0) return Prisma.sql`false`;
      // SupplierLinkStatus 枚举列同 SupplierStatus：参数化后须显式 cast，否则 PG 报
      // operator does not exist: "SupplierLinkStatus" = text（旧硬编码字面量无此问题）
      return Prisma.sql`EXISTS (SELECT 1 FROM "SupplierCompanyLink" l WHERE l."supplierId" = s.id AND l."companyId" IN (${Prisma.join(list)}) AND l."status" = ${status ?? 'APPROVED'}::"SupplierLinkStatus")`;
    };
    if (where.companyLinks?.some?.companyId) {
      conditions.push(linkExistsSql(where.companyLinks.some.companyId, where.companyLinks.some.status));
    }
    // 审批流双谓词组（C1）：AND 组内同时含 companyLinks 分支与 companyId 分支的 OR 组才翻译
    //（代审展开的 AND 组仅 reviewStage 分支，不在此列）
    for (const andPart of Array.isArray(where.AND) ? where.AND : []) {
      const orGroup = (andPart as any)?.OR;
      if (!Array.isArray(orGroup)) continue;
      const linkBranch = orGroup.find((o: any) => o?.companyLinks?.some?.companyId);
      const companyBranch = orGroup.find((o: any) => o?.companyId);
      if (!linkBranch || !companyBranch) continue;
      const list = toCompanyIdList(companyBranch.companyId);
      conditions.push(list.length === 0
        ? Prisma.sql`false`
        : Prisma.sql`(${linkExistsSql(linkBranch.companyLinks.some.companyId, linkBranch.companyLinks.some.status)} OR s."companyId" IN (${Prisma.join(list)}))`);
    }
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
      // 三级审批当前级（2026-09-30）：raw 路径须与 ORM 路径同口径（此前漏配致过滤失效）
      if (where.reviewStage) conditions.push(Prisma.sql`s."reviewStage" = ${where.reviewStage}`);
      // admin 代审展开（A 方案 2026-10-08；2026-10-09 扩 STAFF 孤儿）：ADMIN 级 + 「无在编
      // leader 公司」的 LEADER 级（admin 代复审）+ 「无 staff 且无 leader 公司」的 STAFF 级
      // （admin 代初审），与 list() ORM 路径同口径；User.role 为 text 列无需枚举 cast。
      if ((where as any).__delegatedExpand) {
        conditions.push(Prisma.sql`(s."reviewStage" = 'ADMIN' OR (s."reviewStage" = 'LEADER' AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."companyId" = s."companyId" AND u."role" = 'leader' AND u."isActive" = TRUE)) OR (s."reviewStage" = 'STAFF' AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."companyId" = s."companyId" AND u."isActive" = TRUE AND (u."role" = 'staff' OR u."role" = 'leader'))))`);
      }
      // leader 代初审展开（2026-10-09）：LEADER（本职）OR STAFF（本公司无 staff 的代审件）；
      // 公司域由 where.companyLinks 翻译的既有条件限定（2026-10-16 换形），无需重复判 staff
      if ((where as any).__leaderExpand) {
        conditions.push(Prisma.sql`(s."reviewStage" = 'LEADER' OR s."reviewStage" = 'STAFF')`);
      }
      // admin 对退回/驳回不可见（同 ORM 口径）：恒空条件
      if (where.id && Array.isArray(where.id.in) && where.id.in.length === 0) {
        conditions.push(Prisma.sql`false`);
      }
      // 退回/驳回经手过滤（同 ORM 路径口径；staff 仅见自己经手的）
      if (where.approvalRecords?.some) {
        const ar = where.approvalRecords.some;
        conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "SupplierApprovalRecord" r WHERE r."supplierId" = s.id AND r."action" = ${ar.action} AND r."reviewerUserId" = ${ar.reviewerUserId})`);
      }
    if (where.classificationId) conditions.push(Prisma.sql`"classificationId" = ${where.classificationId}`);
    if (where.OR) {
      // search: name ILIKE or creditCode contains
      const search = where.OR[0].name.contains;
      conditions.push(Prisma.sql`("name" ILIKE ${'%' + search + '%'} OR "creditCode" ILIKE ${'%' + search + '%'} OR "normalizedName" ILIKE ${'%' + search + '%'} OR EXISTS (SELECT 1 FROM unnest(s."tags") t WHERE t ILIKE ${'%' + search + '%'}))`);
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
    // 资质状态筛选（S4 终稿）：Prisma 路径产出的 validTo 派生形状三态翻译；
    // 旧 status 形状保留兜底。raw 路径漏译即静默 no-op（:4099 实测两口径同返 12 的病根）
    if (where.qualifications?.some) {
      const q = where.qualifications.some;
      if (q.validTo?.lt && !q.validTo.gte) {
        // 已过期
        conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "SupplierQualification" q WHERE q."supplierId" = s.id AND q."validTo" < ${q.validTo.lt})`);
      } else if (q.validTo?.gte && q.validTo?.lt) {
        // 即将过期（窗口 [gte, lt)）
        conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "SupplierQualification" q WHERE q."supplierId" = s.id AND q."validTo" >= ${q.validTo.gte} AND q."validTo" < ${q.validTo.lt})`);
      } else if (Array.isArray(q.OR)) {
        // 有效（validTo IS NULL OR validTo >= 阈值）
        const threshold = (q.OR.find((o: any) => o.validTo?.gte)?.validTo as any)?.gte;
        if (threshold) {
          conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "SupplierQualification" q WHERE q."supplierId" = s.id AND (q."validTo" IS NULL OR q."validTo" >= ${threshold}))`);
        }
      } else if (q.status) {
        conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "SupplierQualification" q WHERE q."supplierId" = s.id AND q."status" = ${q.status})`);
      }
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
        _count: { select: { evaluations: true, qualifications: true, contacts: true } },
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
    // 统计闸（方案B 多次评价）：众数概览等级按槽位去重计算（单人刷多条只算一票）——
    // groupBy 无法行级去重，改 findMany + latestSupplierEvals
    const evals = latestSupplierEvals(await this.prisma.supplierEvaluation.findMany({
      where: { supplierId: { in: ids } },
      select: { supplierId: true, finalGrade: true, evaluatorId: true, projectId: true, evaluationSource: true, createdAt: true, updatedAt: true },
    })).reduce<Array<{ supplierId: string; finalGrade: any; _count: { finalGrade: number } }>>((acc, e) => {
      let row = acc.find(r => r.supplierId === e.supplierId && r.finalGrade === e.finalGrade);
      if (!row) { row = { supplierId: e.supplierId, finalGrade: e.finalGrade, _count: { finalGrade: 0 } }; acc.push(row); }
      row._count.finalGrade++;
      return acc;
    }, []);
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

  /** 公司视野越权判定（多公司归属 2026-10-16）：任一 APPROVED/DISABLED link 在视野 或 主归属在视野（未回填兜底）。
   *  全部不命中 → 复用 assertInScope 的 403 语义。DISABLED 也放行（终审 I2 2026-10-19）：与本公司
   *  存在非终态关系的供应商可查看档案——否则本公司停用 link 后详情页 403，「恢复」按钮不可达（死锁）；
   *  库可见性（列表 supplierCompanyWhere）仍 APPROVED-only，不受本判定影响。 */
  private async assertSupplierInScope(supplier: { id: string; companyId: string | null }, actor: AuthenticatedUser) {
    const scope = await this.companyScope.resolveScope(actor);
    if (scope.all) return;
    const ids = scope.companyIds;
    if (supplier.companyId != null && ids.includes(supplier.companyId)) return;
    const links = await this.prisma.supplierCompanyLink.findMany({
      where: { supplierId: supplier.id, companyId: { in: ids }, status: { in: ['APPROVED', 'DISABLED'] } },
      select: { id: true },
      take: 1,
    });
    if (links.length > 0) return;
    this.companyScope.assertInScope(supplier.companyId, scope); // 403 COMPANY_SCOPE_FORBIDDEN
  }

  async get(id: string, actor?: AuthenticatedUser) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, username: true, displayName: true, email: true, role: true, isActive: true } },
        classification: true,
        contacts: true,
        qualifications: true,
        bankAccounts: { orderBy: { createdAt: 'asc' } },
        performances: { orderBy: { createdAt: 'desc' } },
        evaluations: { orderBy: { createdAt: 'desc' }, take: 10 },
        changeRecords: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
    if (!supplier) {
      // 自愈：供应商已被删除（直删库等非常规途径）时，指向它的
      // 待审批通知成为孤儿——点开 404 且待办计数不减。此处顺带 resolve 掉，
      // 待办列表下次刷新即消失；审批/拒绝/退回路径本来就会 resolve，不经过这里。
      await this.notificationService
        .resolveActionable('SUPPLIER_PENDING', `/supplier/${id}`)
        .catch(() => undefined);
    }
    // 公司级数据隔离（2026-09-26）：非 admin 直调他人公司供应商详情 → 403（admin 全视野放行；
    // supplier 角色另有归属校验，不走此闸；多公司归属 2026-10-16 起视野含 APPROVED link 公司）
    if (actor && actor.role !== 'supplier' && supplier) {
      await this.assertSupplierInScope(supplier, actor);
    }
    if (!supplier) return null;
    // 供应商编号（2026-10-22 用户口径·重编）：{归属公司编码}-{同公司入库序号}（如 SWHI-0001），
    // 与专家编号同体系；多公司挂靠以主归属 companyId 为准；无归属公司回退平台序列 supplierNo。
    // 序号按 (createdAt,id) 稳定排名、不滤状态（状态流转不改号）；存库 supplierNo 不动（种子/CI 序列对齐）。
    // 入库时间（2026-10-22 用户口径）：首次审批通过（SupplierApprovalRecord 首条 APPROVED）时刻，
    // 无审批留痕（种子直载等）回退注册提交时间 createdAt——详情页替代「注册 N 天」展示
    let entryAt: Date = supplier.createdAt;
    const firstApproved = await this.prisma.supplierApprovalRecord.findFirst({
      where: { supplierId: supplier.id, action: 'APPROVED' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }).catch(() => null);
    if (firstApproved) entryAt = firstApproved.createdAt;
    let companyNo: string | null = null;
    if (supplier.companyId) {
      const [company, rank] = await Promise.all([
        this.prisma.company.findUnique({ where: { id: supplier.companyId }, select: { code: true } }),
        this.prisma.supplier.count({
          where: {
            companyId: supplier.companyId,
            OR: [
              { createdAt: { lt: supplier.createdAt } },
              { createdAt: supplier.createdAt, id: { lt: supplier.id } },
            ],
          },
        }),
      ]);
      if (company?.code) companyNo = `${company.code.toUpperCase()}-${String(rank + 1).padStart(4, '0')}`;
    }
    // PII 出口（等保+密评）：supplier 本人自视明文（归属校验在 controller，跨企访问 403 于响应前拦截）；
    // 管理端（admin/leader/staff）默认脱敏，明文走 reveal 端点（SensitiveAccessLog 审计）。
    if (actor?.role === 'supplier') {
      return {
        ...supplier,
        companyNo,
        entryAt: entryAt.toISOString(),
        user: supplier.user ? { ...supplier.user, email: openPii(supplier.user.email) } : supplier.user,
        legalPersonIdCard: openPii(supplier.legalPersonIdCard),
        legalPersonPhone: openPii(supplier.legalPersonPhone),
        contacts: supplier.contacts.map(c => ({ ...c, phone: openPii(c.phone), idCard: openPii(c.idCard), email: openPii(c.email) })),
        bankAccounts: supplier.bankAccounts.map(b => ({ ...b, accountNo: openPii(b.accountNo) })),
        changeRecords: supplier.changeRecords.map(r => ({ ...r, oldValue: openChangeValue(r.fieldName, r.oldValue), newValue: openChangeValue(r.fieldName, r.newValue) })),
      };
    }
    return {
      ...supplier,
      companyNo,
      entryAt: entryAt.toISOString(),
      user: supplier.user ? { ...supplier.user, email: maskEmail(openPiiForMask(supplier.user.email)) } : supplier.user,
      legalPersonIdCard: maskIdNumber(openPiiForMask(supplier.legalPersonIdCard)),
      legalPersonPhone: maskPhone(openPiiForMask(supplier.legalPersonPhone)),
      contacts: supplier.contacts.map(c => ({ ...c, phone: maskPhone(openPiiForMask(c.phone)), idCard: maskIdNumber(openPiiForMask(c.idCard)), email: maskEmail(openPiiForMask(c.email)) })),
      bankAccounts: supplier.bankAccounts.map(b => ({ ...b, accountNo: maskBankAccount(openPiiForMask(b.accountNo)) })),
      changeRecords: supplier.changeRecords.map(r => ({ ...r, oldValue: maskChangeValue(r.fieldName, r.oldValue), newValue: maskChangeValue(r.fieldName, r.newValue) })),
    };
  }

  async getRegisterStatus(userId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { userId },
      select: { id: true, name: true, status: true, returnReason: true, rejectReason: true, reviewStage: true },
    });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    return { ...supplier, reviewStageLabel: supplier.reviewStage ? SupplierService.REVIEW_STAGE_LABELS[supplier.reviewStage] : null };
  }

  /** 公开：按统一社会信用代码查审核进度（注册后/审批前用）。不返回 id 等内部字段。 */
  async getRegisterStatusByCreditCode(creditCode: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { creditCode },
      select: { id: true, name: true, status: true, rejectReason: true, returnReason: true, urgedAt: true, reviewStage: true },
    });
    if (!supplier) {
      // 不区分「不存在」与「无记录」，避免被用于枚举信用代码是否注册。
      return { found: false as const, name: null, status: null, reason: null, reviewedAt: null, urgedAt: null };
    }
    return this.buildPublicRegisterStatus(supplier);
  }

  /** 公开进度查询（按企业名称，2026-10-14）：名称精确匹配，不做模糊检索（防公开端点枚举供应商库）。
   *  - 唯一命中：与信用代码查询同构返回，另附 creditCode（公开工商信息）供前端「催促审核」按钮复用；
   *  - 同名多条：ambiguous + 候选列表（信用代码打码 6+8+4），提示改用信用代码精确查询；
   *  - 零命中：found:false，与信用代码路径口径一致。 */
  async getRegisterStatusByName(name: string) {
    const suppliers = await this.prisma.supplier.findMany({
      where: { name },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, creditCode: true, status: true, returnReason: true, urgedAt: true, reviewStage: true },
    });
    if (suppliers.length === 0) {
      return { found: false as const, name: null, status: null, reason: null, reviewedAt: null, urgedAt: null };
    }
    if (suppliers.length > 1) {
      return {
        found: false as const,
        ambiguous: true as const,
        candidates: suppliers.slice(0, 5).map((s) => ({
          name: s.name,
          creditCodeMasked: s.creditCode ? `${s.creditCode.slice(0, 6)}********${s.creditCode.slice(-4)}` : '—',
          status: s.status,
          reviewStage: s.status === 'PENDING' ? (s.reviewStage ?? null) : null,
        })),
      };
    }
    return { ...(await this.buildPublicRegisterStatus(suppliers[0])), creditCode: suppliers[0].creditCode };
  }

  /** 公开进度查询的单供应商投影（信用代码/名称两条入口共用）。 */
  private async buildPublicRegisterStatus(supplier: {
    id: string; name: string; status: string; returnReason: string | null; urgedAt: Date | null; reviewStage: string | null;
  }) {
    // 审核时间 = 最近一次审核动作（approve/reject/return）的留痕时间；无留痕则回退 updatedAt（如退回补正）。
    const latest = await this.prisma.supplierApprovalRecord.findFirst({
      where: { supplierId: supplier.id, action: { in: ['APPROVED', 'REJECTED', 'RETURNED'] } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, action: true },
    });

    // 审核完成 3 日后停止公开查询（2026-10-15 用户裁定）：终态（APPROVED/REJECTED）自最近一次
    // 审核动作起算 3 天；RETURNED 为可行动状态（供应商须看补正原因）不受限。截止后仅回
    // closedAfterCompletion 标记，不再披露状态/时间线。
    const QUERY_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
    if (['APPROVED', 'REJECTED'].includes(supplier.status)) {
      const doneAt = latest?.createdAt ?? null;
      if (doneAt && Date.now() - doneAt.getTime() > QUERY_RETENTION_MS) {
        return {
          found: false as const,
          closedAfterCompletion: true as const,
          name: null, status: null, reason: null, reviewedAt: null, urgedAt: null,
        };
      }
    }

    // 审核节点时间线（2026-10-15）：全部审批留痕逐条可见（级/动作/时间）；reason 仅对
    // RETURNED 节点披露（与既有口径一致——REJECTED 缘由可能含审核员内部备注）。
    const records = await this.prisma.supplierApprovalRecord.findMany({
      where: { supplierId: supplier.id },
      orderBy: { createdAt: 'asc' },
      select: { stage: true, action: true, reason: true, createdAt: true },
    });
    const timeline = records.map((r) => ({
      stage: r.stage ?? null,
      action: r.action,
      at: r.createdAt,
      reason: r.action === 'RETURNED' ? (r.reason || null) : null,
    }));

    // 公开查询仅对 RETURNED 状态返回补正说明（供应商需知如何修改）；REJECTED 等原因可能含
    // 审核员内部备注，不对未登录公开，避免信息泄露与信用代码枚举爬取。
    const reason = supplier.status === 'RETURNED' ? (supplier.returnReason || null) : null;
    const reviewed = latest && supplier.status !== 'PENDING' ? { at: latest.createdAt, action: latest.action } : null;
    return {
      found: true as const,
      name: supplier.name,
      status: supplier.status,
      // 三级审批进度（2026-09-29）：在审返回当前级标签；已入库/被拒为 null
      reviewStage: supplier.status === 'PENDING' ? (supplier.reviewStage ?? null) : null,
      reviewStageLabel: supplier.status === 'PENDING' && supplier.reviewStage
        ? SupplierService.REVIEW_STAGE_LABELS[supplier.reviewStage]
        : null,
      timeline,
      reason,
      reviewedAt: reviewed?.at ?? null,
      reviewedAction: reviewed?.action ?? null,
      urgedAt: supplier.urgedAt ?? null,
    };
  }

  /** 供应商催促审核：向归属公司（Company）的采购工作人员（staff/leader/admin）发站内通知。
   *  公开接口（无需登录，凭信用代码定位），防刷限流已由 controller @Throttle 承担。
   *  业务约束：仅允许催促一次——urgedAt 非空即已催过；再次调用须距上次 ≥4 小时。 */
  async urgeReview(creditCode: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { creditCode },
      select: { id: true, name: true, status: true, companyId: true, companyName: true, urgedAt: true },
    });
    if (!supplier) {
      throw new BadRequestException({ error: '未找到该信用代码对应的注册记录', code: 'SUPPLIER_NOT_FOUND' });
    }
    if (supplier.status === 'APPROVED') {
      throw new BadRequestException({ error: '该申请已审核通过，无需催促', code: 'ALREADY_APPROVED' });
    }

    // 催促频控：已催过且距上次 < 4 小时 → 拒绝（前端可据此禁用按钮）
    const UGE_COOLDOWN_MS = 4 * 3600 * 1000;
    if (supplier.urgedAt) {
      const elapsed = Date.now() - supplier.urgedAt.getTime();
      if (elapsed < UGE_COOLDOWN_MS) {
        const minutesLeft = Math.ceil((UGE_COOLDOWN_MS - elapsed) / 60000);
        throw new BadRequestException({
          error: `已催促过审核，请等待 ${Math.max(1, Math.ceil(minutesLeft / 60))} 小时后再试`,
          code: 'URGE_TOO_FREQUENT',
        });
      }
    }

    // 收件人：归属公司的管理账号（leader+staff）；公司无人时回退平台 admin（2026-09-26 与审批权限同口径）
    const recipients = supplier.companyId
      ? await this.prisma.user.findMany({
          where: { role: { in: ['staff', 'leader'] }, isActive: true, companyId: supplier.companyId },
          select: { id: true },
        })
      : [];
    const targets = recipients.length > 0
      ? recipients
      : await this.prisma.user.findMany({
          where: { role: 'admin', isActive: true },
          select: { id: true },
        });

    // 先记 urgedAt（幂等：并发下 updateMany 只成功一次，避免重复发通知）
    const claimed = await this.prisma.supplier.updateMany({
      where: { id: supplier.id, urgedAt: supplier.urgedAt ?? null },
      data: { urgedAt: new Date() },
    });

    if (targets.length > 0) {
      const companyLabel = supplier.companyName ?? '未归属';
      await Promise.all(targets.map((u) =>
        this.notificationService.create({
          userId: u.id,
          type: 'SUPPLIER_REVIEW_URGE',
          title: '供应商催促审核',
          content: `供应商「${supplier.name}」（${creditCode}）催促审核，请尽快处理。所属公司：${companyLabel}`,
          link: `/supplier/repository?id=${supplier.id}`,
        }),
      ));
    }

    return { success: true, notified: targets.length, urgedAt: supplier.urgedAt ? null : new Date() };
  }

  // ── 退回补正回填（2026-10-14）：RETURNED 申请凭「公司名+信用代码」匹配，
  //    短信验证码发主联系人手机 → 换发一次性补正 token（复用注册会话轨）→
  //    凭 token 拉取已填资料回填（PII 解封·本人场景）→ 补正后原位更新重新提交。──

  /** 补正身份链：公司名+信用代码精确匹配 RETURNED 申请；含主联系人（供发码/比对）。 */
  private async findReturnedSupplier(name: string, creditCode: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { name: name.trim(), creditCode: creditCode.trim(), status: 'RETURNED' },
      include: { contacts: { where: { isPrimary: true }, take: 1 } },
    });
    return supplier;
  }

  /** submit 专用：仅按 creditCode 匹配 RETURNED 申请。creditCode 锁定不可改 + token 已证主联系人
   *  手机控制权，信用代码即身份锚；公司名是补正中的**可改**字段（spec §5，同步 normalizedName）——
   *  若按提交名匹配，改名后提交会 CORRECTION_NOT_FOUND 死循环。含主联系人（手机比对仍要）。
   *  request/verify/draft 三端点保持 name+creditCode 双因子不变（那是防枚举身份链）。 */
  private async findByCreditCodeReturned(creditCode: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { creditCode: creditCode.trim(), status: 'RETURNED' },
      include: { contacts: { where: { isPrimary: true }, take: 1 } },
    });
    return supplier;
  }

  async requestCorrection(name: string, creditCode: string, clientIp: string) {
    const supplier = await this.findReturnedSupplier(name, creditCode);
    if (!supplier || supplier.contacts.length === 0) {
      return { maskedPhone: null as string | null }; // 同形响应防枚举
    }
    const phone = openPii(supplier.contacts[0].phone) as string; // contacts.phone 列 NOT NULL，上方已拦空联系人
    await this.verificationService.sendRegistrationCode(phone, clientIp, 'supplier_registration');
    return { maskedPhone: maskPhone(phone) };
  }

  async verifyCorrection(name: string, creditCode: string, code: string) {
    const supplier = await this.findReturnedSupplier(name, creditCode);
    if (!supplier || supplier.contacts.length === 0) {
      throw new BadRequestException({ error: '未找到待补正的注册申请', code: 'CORRECTION_NOT_FOUND' });
    }
    const phone = openPii(supplier.contacts[0].phone) as string;
    const { token, expiresIn } = await this.verificationService.verifyAndStartRegistrationSession(phone, code);
    return { correctionToken: token, expiresIn };
  }

  async getCorrectionDraft(token: string, name: string, creditCode: string) {
    // 纵深防御：falsy token 进 assertRegistrationSession 会撞 hashToken(undefined) 的
    // crypto TypeError → 500（controller 已拦，此处兜住任何未来直调 service 的调用方）
    if (!token || !name || !creditCode) {
      throw new BadRequestException({ error: '请提供补正 token、公司名称与统一社会信用代码', code: 'MISSING_CORRECTION_PARAMS' });
    }
    const { phone } = await this.verificationService.assertRegistrationSession(token);
    const supplier = await this.findReturnedSupplier(name, creditCode);
    if (!supplier || supplier.contacts.length === 0) {
      throw new BadRequestException({ error: '未找到待补正的注册申请', code: 'CORRECTION_NOT_FOUND' });
    }
    const primaryPhone = openPii(supplier.contacts[0].phone);
    if (primaryPhone !== phone) {
      throw new BadRequestException({ error: '验证手机号与申请主联系人手机号不一致', code: 'CORRECTION_PHONE_MISMATCH' });
    }
    return this.buildCorrectionDraft(supplier.id);
  }

  /** 补正草稿：解封 PII（本人场景），形状对齐注册提交字段 + 补正原因/当前级。 */
  private async buildCorrectionDraft(supplierId: string) {
    const full = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      include: {
        contacts: { orderBy: { isPrimary: 'desc' } },
        qualifications: true,
        bankAccounts: true,
        performances: true,
      },
    });
    if (!full) throw new BadRequestException({ error: '申请不存在', code: 'NOT_FOUND' });
    return {
      name: full.name,
      creditCode: full.creditCode,
      enterpriseType: full.enterpriseType,
      legalPerson: full.legalPerson,
      legalPersonIdCard: openPii(full.legalPersonIdCard),
      legalPersonPhone: full.legalPersonPhone ? openPii(full.legalPersonPhone) : undefined,
      registeredAddress: full.registeredAddress,
      detailedAddress: full.detailedAddress ?? undefined,
      businessScope: full.businessScope,
      logoUrl: full.logoUrl ?? undefined,
      country: full.country ?? undefined,
      region: full.region ?? undefined,
      registeredCapital: full.registeredCapital ?? undefined,
      industry: full.industry ?? undefined,
      establishedDate: full.establishedDate ? full.establishedDate.toISOString().slice(0, 10) : undefined,
      companyProfile: full.companyProfile ?? undefined,
      companyEmail: full.companyEmail ?? undefined,
      companyWebsite: full.companyWebsite ?? undefined,
      companyId: full.companyId ?? undefined,
      companyName: full.companyName ?? undefined,
      tags: full.tags,
      contacts: full.contacts.map((c) => ({
        name: c.name, gender: c.gender ?? undefined,
        phone: openPii(c.phone), idCard: c.idCard ? openPii(c.idCard) : undefined,
        email: c.email ? openPii(c.email) : undefined, position: c.position ?? undefined, isPrimary: c.isPrimary,
      })),
      qualifications: full.qualifications.map((q) => ({
        type: q.type, name: q.name, fileUrl: q.fileUrl,
        attachments: q.attachments ?? [], validFrom: q.validFrom ? q.validFrom.toISOString().slice(0, 10) : undefined,
        validTo: q.validTo ? q.validTo.toISOString().slice(0, 10) : undefined,
      })),
      bankAccounts: full.bankAccounts.map((b) => ({
        accountName: b.accountName, bankName: b.bankName, bankBranch: b.bankBranch ?? undefined,
        accountNo: openPii(b.accountNo), isDefault: b.isDefault,
      })),
      performances: full.performances.map((p) => ({
        projectName: p.projectName, clientName: p.clientName ?? undefined,
        contractAmount: p.contractAmount ?? undefined, signDate: p.signDate ? p.signDate.toISOString().slice(0, 10) : undefined,
        description: p.description ?? undefined, proofFiles: p.proofFiles ?? [],
      })),
      returnReason: full.returnReason,
      reviewStage: full.reviewStage,
    };
  }

  async submitCorrection(dto: CorrectionSubmitDto) {
    const { phone } = await this.verificationService.assertRegistrationSession(dto.token);
    // 匹配仅按 creditCode（锁定不可改=身份锚）：公司名在补正中可改，按提交名匹配会让改名后提交死循环
    const supplier = await this.findByCreditCodeReturned(dto.creditCode);
    if (!supplier || supplier.contacts.length === 0) {
      throw new BadRequestException({ error: '未找到待补正的注册申请', code: 'CORRECTION_NOT_FOUND' });
    }
    if (openPii(supplier.contacts[0].phone) !== phone) {
      throw new BadRequestException({ error: '验证手机号与申请主联系人手机号不一致', code: 'CORRECTION_PHONE_MISMATCH' });
    }

    // ── F3（2026-10-14）：补齐 register 的三道闸（补正重提=一次完整的注册资料重报，
    //    缺闸会让被退回的必填项缺失/撞重申请再次流入审批）──
    // 闸一：营业执照必传（照 register 口径）
    const businessLicense = (dto.qualifications ?? []).find(
      (qualification) => qualification.type.trim() === '营业执照',
    );
    if (!businessLicense?.fileUrl) {
      throw new BadRequestException({ error: '正式注册须上传营业执照', code: 'REGISTRATION_LICENSE_REQUIRED' });
    }
    // 闸二：有且仅一名主要联系人
    if ((dto.contacts ?? []).filter((contact) => contact.isPrimary).length !== 1) {
      throw new BadRequestException({
        error: '正式注册须指定且只能指定一名主要联系人',
        code: 'REGISTRATION_PRIMARY_CONTACT_REQUIRED',
      });
    }
    // 闸三：法人/联系人身份证查重（自排除本申请旧数据——旧行将被 deleteMany 重建，命中他司才拦）
    if (dto.legalPersonIdCard) {
      const existingLegal = await this.prisma.supplier.findFirst({
        where: { legalPersonIdCardIdx: blindIndexPii(dto.legalPersonIdCard) ?? undefined, NOT: { id: supplier.id } },
        select: { id: true },
      });
      if (existingLegal) {
        throw new BadRequestException({ error: '该法定代表人身份证号已用于其他供应商注册', code: 'DUPLICATE_LEGAL_ID_CARD' });
      }
    }
    const correctionContactIdCards = dto.contacts.map(c => c.idCard?.trim()).filter((x): x is string => !!x);
    if (correctionContactIdCards.length > 0) {
      const existingContact = await this.prisma.supplierContact.findFirst({
        where: {
          idCardIdx: { in: correctionContactIdCards.map(c => blindIndexPii(c)).filter((x): x is string => !!x) },
          NOT: { supplierId: supplier.id },
        },
        select: { id: true },
      });
      if (existingContact) {
        throw new BadRequestException({ error: '该联系人身份证号已用于其他供应商注册', code: 'DUPLICATE_CONTACT_ID_CARD' });
      }
    }

    // 联系人手机号唯一性（2026-10-14 并行会话口径，同 register）：数组内查重 +
    // 主联系人全局占用（User.phoneIdx / 他供应商主联系人）——旧联系人行将被 deleteMany
    // 释放自身 phoneIdx，此处只拦被「其他」账号/供应商占用的手机号，给出明确错误而非裸撞唯一约束。
    assertContactsArrayPhonesUnique(dto.contacts);
    const primary = dto.contacts.find((c) => c.isPrimary);
    if (primary) {
      const primaryIdx = blindIndexPii(primary.phone.trim());
      if (primaryIdx) {
        const dupUser = await this.prisma.user.findFirst({
          where: { phoneIdx: primaryIdx, NOT: { id: supplier.userId } },
          select: { id: true },
        });
        if (dupUser) {
          throw new BadRequestException({ error: '该手机号已绑定其他供应商账号，请更换', code: 'DUPLICATE_PHONE' });
        }
        const dupPrimaryContact = await this.prisma.supplierContact.findFirst({
          where: { phoneIdx: primaryIdx, isPrimary: true, NOT: { supplierId: supplier.id } },
          select: { id: true },
        });
        if (dupPrimaryContact) {
          throw new BadRequestException({ error: '该手机号已是其他供应商的主要联系人，请更换', code: 'DUPLICATE_CONTACT_PHONE' });
        }
      }
    }

    const companyRef = await this.resolveSupplierCompany(dto.companyId, dto.companyName);

    // 附件：keepIds=DTO 引用的全部资产 id（已认领旧附件 + 未认领新附件）——清理旧附件的保留白名单；
    // claimIds=其中仍无主的子集——事务内 claim。两集合拆开是防「保留的旧附件被当垃圾清理」：
    // register 提交即 claim（uploaderId=userId）、return() 不清附件，补正保留的旧附件必然已认领，
    // 若把 claimIds 当 keepIds 用，保留中的旧附件会落入 notIn 反集被 MinIO+DB 双删（不可逆）。
    const { keepIds, claimIds } = await this.collectCorrectionAssetIds(dto, supplier.id);

    await this.prisma.$transaction(async (tx) => {
      // 乐观锁认领：仅 RETURNED 可补正。认领（置 PENDING + 主档覆写）、子表重建、附件 claim
      // 同一事务——任一步失败整体回滚，不留「PENDING 半态 + 旧子表」的中间状态。
      const claimed = await tx.supplier.updateMany({
        where: { id: supplier.id, status: 'RETURNED' },
        data: {
          name: dto.name,
          normalizedName: dto.name.trim().toLowerCase(),
          enterpriseType: dto.enterpriseType,
          legalPerson: dto.legalPerson,
          legalPersonIdCard: sealPii(dto.legalPersonIdCard || null) ?? null,
          legalPersonPhone: sealPii(dto.legalPersonPhone || null) ?? null,
          legalPersonIdCardIdx: blindIndexPii(dto.legalPersonIdCard) ?? null,
          registeredAddress: dto.registeredAddress,
          detailedAddress: dto.detailedAddress || null,
          businessScope: dto.businessScope,
          logoUrl: dto.logoUrl || null,
          country: dto.country || null,
          region: dto.region || null,
          registeredCapital: dto.registeredCapital || null,
          industry: dto.industry || null,
          establishedDate: dto.establishedDate ? new Date(dto.establishedDate) : null,
          companyProfile: dto.companyProfile || null,
          companyEmail: dto.companyEmail || null,
          companyWebsite: dto.companyWebsite || null,
          tags: dto.tags,
          companyId: companyRef.id,
          companyName: companyRef.name,
          status: 'PENDING', // reviewStage 保留 = 回到被退回的那一级
        },
      });
      if (claimed.count === 0) {
        throw new BadRequestException({ error: '申请状态已变更，请刷新后重试', code: 'CONFLICT' });
      }

      await tx.supplierContact.deleteMany({ where: { supplierId: supplier.id } });
      await tx.supplierQualification.deleteMany({ where: { supplierId: supplier.id } });
      await tx.supplierBankAccount.deleteMany({ where: { supplierId: supplier.id } });
      await tx.supplierPerformance.deleteMany({ where: { supplierId: supplier.id } });
      await tx.supplier.update({
        where: { id: supplier.id },
        data: {
          contacts: { create: dto.contacts.map((c) => ({ name: c.name, gender: c.gender || null, phone: sealPii(c.phone) as string, phoneIdx: blindIndexPii(c.phone) ?? null, idCard: sealPii(c.idCard) ?? null, idCardIdx: blindIndexPii(c.idCard) ?? null, email: sealPii(c.email) ?? null, isPrimary: c.isPrimary, position: c.position })) },
          qualifications: { create: dto.qualifications.map((q) => ({ type: q.type, name: q.name, fileUrl: q.fileUrl, attachments: (q as any).attachments ?? undefined, validFrom: q.validFrom ? new Date(q.validFrom) : undefined, validTo: q.validTo ? new Date(q.validTo) : undefined })) },
          bankAccounts: dto.bankAccounts?.length ? { create: dto.bankAccounts.map((b) => ({ accountName: b.accountName, bankName: b.bankName, bankBranch: b.bankBranch || null, accountNo: sealPii(b.accountNo) as string, isDefault: b.isDefault ?? false })) } : undefined,
          performances: dto.performances?.length ? { create: dto.performances.map((p) => ({ projectName: p.projectName, clientName: p.clientName || null, contractAmount: p.contractAmount || null, signDate: p.signDate ? new Date(p.signDate) : undefined, description: p.description || null, proofFiles: p.proofFiles ?? [] })) } : undefined,
        },
      });
      if (claimIds.length) {
        const claimedAssets = await tx.fileAsset.updateMany({
          where: { id: { in: claimIds }, uploaderId: null },
          data: { uploaderId: supplier.userId },
        });
        if (claimedAssets.count !== claimIds.length) {
          throw new ConflictException({ error: '注册附件已被其他申请占用，请重新上传', code: 'REGISTRATION_ASSET_ALREADY_CLAIMED' });
        }
      }
    });

    // 事务成功后才消费一次性补正 token（同 registerTemporary 口径）：事务失败已整体回滚、
    // 状态仍 RETURNED、token 未烧——用户可凭原 token 修正后原样重试。
    await this.verificationService.consumeRegistrationSession(dto.token);

    // 清理被替换的旧附件（best-effort；keepIds=全部引用集，保留的旧附件不在清理范围）
    await this.deleteStaleCorrectionAssets(supplier.id, supplier.userId, keepIds);

    const stage = supplier.reviewStage ?? 'STAFF';
    // F2（2026-10-14）：补正可改归属公司（事务内已落 companyRef）——审批权按新公司校验，
    // 待办也须发新公司（旧 supplier.companyId 是改名/改归属前的快照）；文案用提交名 dto.name
    //（补正中改名后 supplier.name 是旧名，避免通知/审计回退旧名快照）。
    await this.notifyStageApprovers(stage, companyRef.id, {
      type: 'SUPPLIER_PENDING',
      title: '供应商补正后重新提交',
      content: `${dto.name} 已补正资料重新提交，请继续${SupplierService.REVIEW_STAGE_LABELS[stage]}。`,
      link: `/supplier/approval?supplierId=${supplier.id}`,
    });
    await this.audit(supplier.userId, 'SUPPLIER_RESUBMITTED', supplier.id, { name: dto.name, note: '补正提交' });

    return { success: true };
  }

  /** 收集补正提交的附件 FileAsset id，按用途拆两集合：
   *  - keepIds：DTO 引用的全部资产 id（**含已认领的旧附件**）——deleteStaleCorrectionAssets
   *    的保留白名单（旧附件经 register 已 claim 到本 user，引用保留即不清理）；
   *  - claimIds：其中仍 uploaderId=null 的子集——事务内 claim（已有主的不重复 claim）。
   *  URL 解析失败的（外部/伪造地址）→ 400（与 register 同口径：先逐条判无效再去重——
   *  同一文件被多项资质引用是合法场景，按未去重计数比对会误伤）。 */
  private async collectCorrectionAssetIds(dto: CorrectionSubmitDto, supplierId: string): Promise<{ keepIds: string[]; claimIds: string[] }> {
    const urls: string[] = [
      ...(dto.logoUrl ? [dto.logoUrl] : []),
      ...(dto.qualifications ?? []).flatMap((q) => [q.fileUrl, ...((q as any).attachments ?? []).map((a: any) => a.url)]),
      ...((dto.performances ?? []).flatMap((p) => (p.proofFiles ?? []).map((f) => f.url))),
    ];
    const parsed = urls.map((u) => registrationAssetIdFromUrl(u));
    if (parsed.some((id) => !id)) {
      throw new BadRequestException({ error: '注册附件必须通过本页上传，不接受外部或伪造文件地址', code: 'REGISTRATION_ASSET_URL_INVALID' });
    }
    const keepIds = [...new Set(parsed)] as string[];
    const unclaimed = await this.prisma.fileAsset.findMany({
      where: { id: { in: keepIds }, uploaderId: null },
      select: { id: true },
    });
    return { keepIds, claimIds: unclaimed.map((a) => a.id) };
  }

  private async deleteStaleCorrectionAssets(supplierId: string, userId: string, keepIds: string[]) {
    const stale = await this.prisma.fileAsset.findMany({
      where: { uploaderId: userId, category: { in: ['qualification', 'general'] }, id: { notIn: keepIds } },
      select: { id: true, key: true, sealedPath: true },
    });
    for (const a of stale) {
      try { await minioClient.removeObject(MINIO_BUCKET, a.key); } catch { /* best-effort */ }
      if (a.sealedPath) { try { await minioClient.removeObject(MINIO_BUCKET, a.sealedPath); } catch { /* best-effort */ } }
    }
    if (stale.length) await this.prisma.fileAsset.deleteMany({ where: { id: { in: stale.map((a) => a.id) } } });
  }

  /** 查询供应商审核历史（不可变留痕，按时间倒序）。 */
  async getApprovalHistory(supplierId: string) {
    const records = await this.prisma.supplierApprovalRecord.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, action: true, stage: true, reason: true, attachmentIds: true, snapshot: true, createdAt: true,
        // role（2026-10-08 A 方案）：LEADER 级被 admin 完成=代复审、STAFF 级被 leader 完成=代初审，
        // 留痕展示侧据此加徽标，杜绝「采购中心管理员担任复审」的误读。
        reviewer: { select: { id: true, displayName: true, username: true, role: true } },
      },
    });
    return records;
  }

  /** 审批留痕附件解析（2026-09-30）：FileAsset id → 文件名/大小（历史与 stepper 展示用） */
  async resolveApprovalAttachments(ids: string[]) {
    if (!ids.length) return [];
    ids = [...new Set(ids)].slice(0, 200); // 加固：去重 + 上限
    const assets = await this.prisma.fileAsset.findMany({
      where: { id: { in: ids } },
      select: { id: true, originalName: true, size: true, mimeType: true },
    });
    const map = new Map(assets.map(a => [a.id, a]));
    return ids
      .map(id => map.get(id))
      .filter((a): a is { id: string; originalName: string; size: number; mimeType: string } => !!a)
      .map(a => ({ id: a.id, name: a.originalName, size: a.size, mimeType: a.mimeType }));
  }

  /** 全量审批记录（2026-09-30 用户裁定，admin only）：跨供应商全流程记录，
   *  含三级通过（STAFF/LEADER/ADMIN）+ 驳回 + 退回补正；倒序（最新在前）。 */
  async listAllApprovalRecords() {
    const records = await this.prisma.supplierApprovalRecord.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true, action: true, stage: true, reason: true, attachmentIds: true, createdAt: true,
        reviewer: { select: { id: true, displayName: true, username: true, role: true } },
        supplier: { select: { id: true, name: true, creditCode: true, status: true, reviewStage: true, companyName: true } },
      },
    });
    return records;
  }

  /** 注册前查重：统一社会信用代码（组织机构代码，硬拦截）、法定代表人身份证号、联系人身份证号（软提示）。
   *  公开端点，只回传「是否重复」布尔值，不回传命中的供应商名称/编号等敏感信息。 */
  async checkDuplicate(fields: { creditCode?: string; legalPersonIdCard?: string; contactIdCard?: string; phone?: string; companyId?: string; companyName?: string }) {
    // creditCodeIsTemporary/TemporaryExpired（2026-10-16）：临时过期不改 status（仍 APPROVED），
    // 前端凭这两个事实字段区分「临时已过期→引导登录页续期」与其他命中状态。
    const result: {
      creditCode: boolean;
      legalPersonIdCard: boolean;
      contactIdCard: boolean;
      phone: boolean;
      creditCodeStatus: string | null;
      creditCodeIsTemporary: boolean;
      creditCodeTemporaryExpired: boolean;
      registeredElsewhere: boolean;
    } = {
      creditCode: false,
      legalPersonIdCard: false,
      contactIdCard: false,
      phone: false,
      creditCodeStatus: null,
      creditCodeIsTemporary: false,
      creditCodeTemporaryExpired: false,
      registeredElsewhere: false,
    };

    const creditCode = (fields.creditCode ?? '').trim().toUpperCase();
    if (creditCode) {
      const hit = await this.prisma.supplier.findFirst({
        where: { creditCode },
        select: { id: true, status: true, isTemporary: true, temporaryExpiresAt: true },
      });
      result.creditCode = !!hit;
      result.creditCodeStatus = hit?.status ?? null;
      result.creditCodeIsTemporary = !!hit?.isTemporary;
      result.creditCodeTemporaryExpired =
        !!hit?.isTemporary && !!hit?.temporaryExpiresAt && hit.temporaryExpiresAt < new Date();
      // 多公司归属（2026-10-16）：他司已有在库账号且本公司未入 → 提示走「申请加入」而非拦死。
      // 防公开端点枚举：只回布尔，不回公司名。
      if (hit && ['APPROVED', 'DISABLED', 'BLACKLIST'].includes(hit.status)) {
        const candidate = await this.findCompanyRef(fields.companyId, fields.companyName);
        const link = candidate
          ? await this.prisma.supplierCompanyLink.findUnique({
              where: { supplierId_companyId: { supplierId: hit.id, companyId: candidate.id } },
              select: { status: true },
            })
          : null;
        result.registeredElsewhere = link?.status !== 'APPROVED';
      }
    }

    const legalPersonIdCard = (fields.legalPersonIdCard ?? '').trim();
    if (legalPersonIdCard) {
      const hit = await this.prisma.supplier.findFirst({
        where: { legalPersonIdCardIdx: blindIndexPii(legalPersonIdCard) ?? undefined }, // 密文列等值查重走盲索引
        select: { id: true },
      });
      result.legalPersonIdCard = !!hit;
    }

    const contactIdCard = (fields.contactIdCard ?? '').trim();
    if (contactIdCard) {
      const hit = await this.prisma.supplierContact.findFirst({
        where: { idCardIdx: blindIndexPii(contactIdCard) ?? undefined },
        select: { id: true },
      });
      result.contactIdCard = !!hit;
    }

    // 手机号查重（2026-10-16）：与提交口径同路数（registerTemporary/register 的 User.phoneIdx 盲索引查重），
    // 失焦预检用——公开端点，仅回布尔，靠限流兜底防枚举。
    const phone = (fields.phone ?? '').trim();
    if (phone) {
      const hit = await this.prisma.user.findFirst({
        where: { phoneIdx: blindIndexPii(phone) ?? undefined },
        select: { id: true },
      });
      result.phone = !!hit;
    }

    return result;
  }

  private async audit(userId: string, action: string, resourceId: string, details?: any) {
    // 审计写入失败不应阻断业务流程，但必须可观测——静默吞错会让 DB 故障期的合规审计悄悄丢失。
    await this.prisma.auditLog.create({ data: { userId, action, resourceType: 'supplier', resourceId, details: details ?? {} } })
      .catch((err: any) => console.error(`[audit] 写入失败 action=${action} resource=${resourceId}`, err?.message ?? err));
  }

  /** 构建审核历史快照：审核时点申请全部信息（不可变留痕的数据源） */
  // 业务标签库

  /** 公开：注册页可选标签（仅 APPROVED，按名称排序） */
  async listApprovedBusinessTags() {
    return this.prisma.businessTag.findMany({
      where: { status: 'APPROVED' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /** 管理端：标签列表（默认全部，可按状态过滤），含自创来源供应商名 */
  async listBusinessTags(status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
    return this.prisma.businessTag.findMany({
      where: status ? { status } : undefined,
      select: {
        id: true, name: true, status: true, source: true, createdAt: true, reviewedAt: true,
        // id（2026-10-08）：审核面板按来源供应商合并分组的分组键
        createdBySupplier: { select: { id: true, name: true, supplierNo: true } },
        reviewedBy: { select: { displayName: true } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
  }

  /** 审核通过：PENDING → APPROVED（入池，后续注册可选） */
  async approveBusinessTag(id: string, reviewerUserId?: string) {
    const tag = await this.prisma.businessTag.findUnique({ where: { id } });
    if (!tag) throw new BadRequestException({ error: '标签不存在', code: 'NOT_FOUND' });
    if (tag.status !== 'PENDING') throw new BadRequestException({ error: '该标签不在待审核状态', code: 'INVALID_STATUS' });
    const updated = await this.prisma.businessTag.update({
      where: { id },
      data: { status: 'APPROVED', reviewedById: reviewerUserId ?? null, reviewedAt: new Date() },
    });
    // 2026-09-27 待办闭环：标签入池通知（link=/supplier）随审批消音
    await this.notificationService.resolveActionable('SUPPLIER_PENDING', '/supplier').catch(() => {});
    return updated;
  }

  /** 审核拒绝：PENDING → REJECTED（不入池；供应商资料中已使用的标签文本不受影响） */
  async rejectBusinessTag(id: string, reviewerUserId?: string) {
    const tag = await this.prisma.businessTag.findUnique({ where: { id } });
    if (!tag) throw new BadRequestException({ error: '标签不存在', code: 'NOT_FOUND' });
    if (tag.status !== 'PENDING') throw new BadRequestException({ error: '该标签不在待审核状态', code: 'INVALID_STATUS' });
    const updated = await this.prisma.businessTag.update({
      where: { id },
      data: { status: 'REJECTED', reviewedById: reviewerUserId ?? null, reviewedAt: new Date() },
    });
    await this.notificationService.resolveActionable('SUPPLIER_PENDING', '/supplier').catch(() => {});
    return updated;
  }

  private async buildApprovalSnapshot(supplierId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      include: {
        contacts: { orderBy: { isPrimary: 'desc' } },
        qualifications: true,
        bankAccounts: true,
        performances: true,
        user: { select: { username: true, displayName: true, email: true } },
      },
    });
    if (!supplier) return null;
    return {
      name: supplier.name,
      creditCode: supplier.creditCode,
      supplierNo: supplier.supplierNo,
      enterpriseType: supplier.enterpriseType,
      legalPerson: supplier.legalPerson,
      legalPersonIdCard: maskIdNumber(openPiiForMask(supplier.legalPersonIdCard)), // 审批快照出口脱敏（等保+密评）
      legalPersonPhone: maskPhone(openPiiForMask(supplier.legalPersonPhone)),
      registeredAddress: supplier.registeredAddress,
      detailedAddress: supplier.detailedAddress,
      businessScope: supplier.businessScope,
      logoUrl: supplier.logoUrl,
      organizationCode: supplier.organizationCode,
      country: supplier.country,
      region: supplier.region,
      registeredCapital: supplier.registeredCapital,
      industry: supplier.industry,
      companyEmail: supplier.companyEmail,
      companyWebsite: supplier.companyWebsite,
      tags: supplier.tags,
      isTemporary: supplier.isTemporary,
      account: { username: supplier.user?.username, displayName: supplier.user?.displayName, email: maskEmail(openPiiForMask(supplier.user?.email)) },
      contacts: supplier.contacts.map(c => ({ name: c.name, gender: c.gender, phone: maskPhone(openPiiForMask(c.phone)), idCard: maskIdNumber(openPiiForMask(c.idCard)), email: maskEmail(openPiiForMask(c.email)), position: c.position, isPrimary: c.isPrimary })),
      qualifications: supplier.qualifications.map(q => ({ type: q.type, name: q.name, fileUrl: q.fileUrl, attachments: q.attachments, validFrom: q.validFrom, validTo: q.validTo })),
      bankAccounts: supplier.bankAccounts.map(b => ({ id: b.id, accountName: b.accountName, bankName: b.bankName, bankBranch: b.bankBranch, accountNo: maskBankAccount(openPiiForMask(b.accountNo)), isDefault: b.isDefault })),
      performances: supplier.performances.map(p => ({ id: p.id, projectName: p.projectName, clientName: p.clientName, contractAmount: p.contractAmount, signDate: p.signDate, description: p.description, proofFiles: p.proofFiles })),
    };
  }

  /** 写入不可变审核历史（approve/reject/return 调用）。失败不阻断审核流程但记录告警。 */
  private async recordApproval(supplierId: string, action: 'APPROVED' | 'REJECTED' | 'RETURNED', reviewerUserId: string | undefined, reason?: string, stage?: string, rawAttachmentIds: string[] = []) {
    const snapshot = await this.buildApprovalSnapshot(supplierId);
    if (!snapshot) return;
    // 附件加固（2026-09-30）：去重 + 上限 10 + 校验 FileAsset 真实存在（防伪造 id 入留痕）
    const unique = [...new Set(rawAttachmentIds)].slice(0, 10);
    const attachmentIds = unique.length
      ? (await this.prisma.fileAsset.findMany({ where: { id: { in: unique } }, select: { id: true } })).map(a => a.id)
      : [];
    if (attachmentIds.length < unique.length) {
      this.logger.warn(`[approval-record] 附件 id 部分无效（${unique.length - attachmentIds.length} 个），已过滤`);
    }
    await this.prisma.supplierApprovalRecord.create({
      data: { supplierId, action, stage: stage ?? null, reviewerUserId: reviewerUserId ?? null, reason: reason ?? null, attachmentIds, snapshot },
    }).catch((err: any) => console.error(`[approval-record] 写入失败 supplier=${supplierId} action=${action}`, err?.message ?? err));
  }

  /** 三级注册审批·通过（2026-09-29）：
   *  reviewStage=STAFF（同公司 staff，通过须填同意缘由）→ LEADER（同公司 leader，可见 staff 缘由，须填缘由）
   *  → ADMIN（平台 admin 终审确认）→ APPROVED + 账号激活。
   *  STAFF/LEADER 通过仅推进级；ADMIN 通过才落终态。乐观锁按当前级防并发双审。 */
  async approve(id: string, userId?: string, reason?: string, attachmentIds: string[] = []) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id }, include: { user: true } });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    if (supplier.status !== 'PENDING' && supplier.status !== 'RETURNED') {
      throw new BadRequestException({ error: '供应商状态不允许审核', code: 'INVALID_STATUS' });
    }

    const stage = supplier.reviewStage ?? 'STAFF'; // 存量无级数据兜底从首级走
    const reviewer = userId
      ? await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, companyId: true } })
      : null;
    await this.assertStageApprover(stage, reviewer, supplier.companyId);

    // staff/leader 通过须填同意缘由（后级审批依据）；admin 终审缘由可选
    const trimmed = (reason ?? '').trim();
    if (stage !== 'ADMIN' && !trimmed) {
      throw new BadRequestException({ error: `请填写${SupplierService.REVIEW_STAGE_LABELS[stage]}的同意缘由（后级审批人将据此复核）`, code: 'REVIEW_REASON_REQUIRED' });
    }

    if (stage === 'ADMIN') {
      // 终审通过：落终态 + 激活账号（三级闭环才入库）
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.supplier.updateMany({
          where: { id, status: { in: ['PENDING', 'RETURNED'] }, reviewStage: supplier.reviewStage },
          data: { status: 'APPROVED', reviewStage: null, returnReason: null, rejectReason: null },
        });
        if (claimed.count === 0) {
          throw new BadRequestException({ error: '供应商状态已变更，请刷新后重试', code: 'CONFLICT' });
        }
        await tx.user.update({ where: { id: supplier.userId }, data: { isActive: true } });
        // 多公司归属（2026-10-16）：终审通过同步落 APPROVED link（幂等；未归属跳过）
        if (supplier.companyId) {
          await tx.supplierCompanyLink.upsert({
            where: { supplierId_companyId: { supplierId: id, companyId: supplier.companyId } },
            create: {
              supplierId: id, companyId: supplier.companyId,
              status: 'APPROVED', appliedAt: supplier.createdAt,
            },
            update: { status: 'APPROVED', reviewStage: null, rejectReason: null },
          });
        }
      });
      await this.clearSupplierPendingTodos(id);
      await this.notificationService.create({
        userId: supplier.userId,
        type: 'SUPPLIER_APPROVED',
        title: '供应商审核通过',
        content: `您的供应商注册申请已通过三级审核（初审/复审/终审）正式入库，企业名称：${supplier.name}`,
        link: `/dashboard`,
      });
      if (userId) await this.audit(userId, 'SUPPLIER_APPROVED', id, { name: supplier.name, stage });
      await this.recordApproval(id, 'APPROVED', userId, trimmed, stage, attachmentIds);
      return { success: true, stage: 'DONE' as const };
    }

    // STAFF/LEADER 通过：仅推进级，通知下一级审批人（乐观锁带当前级防越级/双审）
    const nextStage = stage === 'STAFF' ? 'LEADER' : 'ADMIN';
    const claimed = await this.prisma.supplier.updateMany({
      where: { id, status: { in: ['PENDING', 'RETURNED'] }, reviewStage: supplier.reviewStage },
      data: { reviewStage: nextStage, returnReason: null },
    });
    if (claimed.count === 0) {
      throw new BadRequestException({ error: '供应商状态已变更，请刷新后重试', code: 'CONFLICT' });
    }
    await this.clearSupplierPendingTodos(id);
    await this.notifyStageApprovers(nextStage, supplier.companyId, {
      type: 'SUPPLIER_PENDING',
      title: `供应商注册待${nextStage === 'LEADER' ? '复审' : '终审'}`,
      content: `${supplier.name} 已通过${SupplierService.REVIEW_STAGE_LABELS[stage]}（缘由：${trimmed}），请前往${nextStage === 'LEADER' ? '复审' : '终审确认'}。`,
      link: `/supplier/approval?supplierId=${id}`,
    });
    if (userId) await this.audit(userId, `SUPPLIER_REVIEW_PASSED_${stage}`, id, { name: supplier.name, reason: trimmed, nextStage });
    await this.recordApproval(id, 'APPROVED', userId, trimmed, stage, attachmentIds);
    return { success: true, stage: nextStage };
  }

  /** 清该供应商的注册审批待办（精确到本供应商，2026-09-30 稳健性修复：
   *  旧 resolveActionable('/supplier/approval') 是无 id 批量 updateMany，会把所有供应商
   *  待办一并标记已办——现改按带 supplierId 的 link 精确清零，保留旧 link 兜底。 */
  private async clearSupplierPendingTodos(id: string) {
    await this.notificationService.resolveActionable('SUPPLIER_PENDING', `/supplier/${id}`).catch(() => {});
    await this.notificationService.resolveActionable('SUPPLIER_PENDING', `/supplier/approval?supplierId=${id}`).catch(() => {});
  }

  async reject(id: string, reason: string, userId?: string, attachmentIds: string[] = []) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    // 三级审批（2026-09-29）：按当前级断言审批人（驳回可发生在任一级）
    const stage = supplier.reviewStage ?? 'STAFF';
    const reviewer = userId
      ? await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, companyId: true } })
      : null;
    await this.assertStageApprover(stage, reviewer, supplier.companyId);

    if (supplier.status !== 'PENDING' && supplier.status !== 'RETURNED') {
      throw new BadRequestException({ error: '供应商状态不允许审核', code: 'INVALID_STATUS' });
    }

    // 乐观锁：并发双审时仅一方成功——where 带当前级，防「通过已推进级」与「驳回」交错
    //（reviewStage 保留=记录被拒于哪一级）。
    const claimed = await this.prisma.supplier.updateMany({
      // where 用读到的原始 reviewStage（存量 null 匹配 null；stage 变量为断言用兜底值）
      where: { id, status: { in: ['PENDING', 'RETURNED'] }, reviewStage: supplier.reviewStage },
      data: { status: 'REJECTED', rejectReason: reason },
    });
    if (claimed.count === 0) {
      throw new BadRequestException({ error: '供应商状态已变更，请刷新后重试', code: 'CONFLICT' });
    }
    const result = await this.prisma.supplier.findUnique({ where: { id } });

    await this.clearSupplierPendingTodos(id);

    // 发送通知给供应商
    await this.notificationService.create({
      userId: supplier.userId,
      type: 'SUPPLIER_REJECTED',
      title: '供应商审核不通过',
      content: `您的供应商注册申请在${SupplierService.REVIEW_STAGE_LABELS[stage]}环节审核不通过，原因：${reason}`,
    });

    // F5（2026-10-14）：审计 payload 落 purged:true——驳回即触发数据最小化清洗，留痕与快照口径一致。
    if (userId) await this.audit(userId, 'SUPPLIER_REJECTED', id, { name: supplier.name, reason, stage, purged: true });
    await this.recordApproval(id, 'REJECTED', userId, reason, stage, attachmentIds);

    // F6（2026-10-14）：清洗失败不 500 驳回端点——驳回语义（REJECTED+留壳字段）已完整落库，
    // 清洗残留只是旧数据未抹除，吞错落 error 日志供运维跟进（残留可由补清洗脚本收敛）。
    try {
      await this.purgeRejectedSupplier(id, {
        userId: supplier.userId,
        name: supplier.name,
        creditCode: supplier.creditCode,
        supplierNo: supplier.supplierNo,
      });
    } catch (err) {
      this.logger.error(`驳回清洗失败（数据已驳回留壳，清洗未完成）supplier=${id}: ${(err as Error).message}`);
    }

    return result;
  }

  /**
   * 驳回数据最小化（2026-10-14）：清洗供应商业务字段、子表、User 敏感列、审批快照与附件。
   * 留壳（name/creditCode/supplierNo/status=REJECTED/rejectReason/reviewStage）供审计与「壳重开」。
   */
  private async purgeRejectedSupplier(
    supplierId: string,
    meta: { userId: string; name: string; creditCode: string | null; supplierNo: string },
  ) {
    await this.prisma.$transaction(async (tx) => {
      // ① 子表删空
      await tx.supplierContact.deleteMany({ where: { supplierId } });
      await tx.supplierQualification.deleteMany({ where: { supplierId } });
      await tx.supplierBankAccount.deleteMany({ where: { supplierId } });
      await tx.supplierPerformance.deleteMany({ where: { supplierId } });
      await tx.supplierClassificationLink.deleteMany({ where: { supplierId } });

      // ② Supplier 业务字段置空（NOT NULL 文本列置 ''；tags 置 []；urgedAt 置 null）
      await tx.supplier.update({
        where: { id: supplierId },
        data: {
          enterpriseType: '', legalPerson: '', registeredAddress: '', businessScope: '',
          legalPersonIdCard: null, legalPersonPhone: null, legalPersonIdCardIdx: null,
          detailedAddress: null, logoUrl: null, organizationCode: null,
          country: null, region: null, registeredCapital: null, industry: null,
          companyEmail: null, companyWebsite: null, establishedDate: null,
          companyProfile: null, classificationId: null, urgedAt: null, tags: [],
        },
      });

      // ③ User 敏感列置 null（displayName 为 NOT NULL，置 ''；passwordHash=null 使登录天然拒绝）
      await tx.user.update({
        where: { id: meta.userId },
        data: {
          displayName: '', email: null, phone: null, phoneIdx: null,
          passwordHash: null, passwordVault: null,
        },
      });

      // ④ 审批快照最小化（全部 SupplierApprovalRecord）
      const records = await tx.supplierApprovalRecord.findMany({
        where: { supplierId },
        select: { id: true, action: true, stage: true, reason: true },
      });
      const purgedAt = new Date().toISOString();
      for (const r of records) {
        await tx.supplierApprovalRecord.update({
          where: { id: r.id },
          data: {
            snapshot: {
              purged: true, purgedAt,
              name: meta.name, creditCode: meta.creditCode, supplierNo: meta.supplierNo,
              action: r.action, stage: r.stage, reason: r.reason,
            },
          },
        });
      }
    });

    // ⑤ 附件：FileAsset 元数据（DB）+ MinIO 对象（best-effort，删除失败不阻断驳回）
    const assets = await this.prisma.fileAsset.findMany({
      where: { uploaderId: meta.userId, category: { in: ['qualification', 'general'] } },
      select: { id: true, key: true, sealedPath: true },
    });
    for (const a of assets) {
      try { await minioClient.removeObject(MINIO_BUCKET, a.key); } catch { /* best-effort */ }
      if (a.sealedPath) { try { await minioClient.removeObject(MINIO_BUCKET, a.sealedPath); } catch { /* best-effort */ } }
    }
    if (assets.length) {
      await this.prisma.fileAsset.deleteMany({ where: { id: { in: assets.map((a) => a.id) } } });
    }
  }

  async return(id: string, reason: string, userId?: string, attachmentIds: string[] = []) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    if (supplier.status !== 'PENDING') {
      throw new BadRequestException({ error: '供应商状态不允许退回', code: 'INVALID_STATUS' });
    }

    // 三级审批（2026-09-29）：按当前级断言；退回不重置 reviewStage——补正后回到被退回的那一级
    const stage = supplier.reviewStage ?? 'STAFF';
    const reviewer = userId
      ? await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, companyId: true } })
      : null;
    await this.assertStageApprover(stage, reviewer, supplier.companyId);

    // P1-17 乐观锁：return 仅允许 PENDING→RETURNED，并发时仅一方成功。

    const claimed = await this.prisma.supplier.updateMany({
      where: { id, status: 'PENDING', reviewStage: supplier.reviewStage },
      data: { status: 'RETURNED', returnReason: reason },
    });
    if (claimed.count === 0) {
      throw new BadRequestException({ error: '供应商状态已变更，请刷新后重试', code: 'CONFLICT' });
    }
    const result = await this.prisma.supplier.findUnique({ where: { id } });

    await this.clearSupplierPendingTodos(id);

    // 发送通知给供应商
    await this.notificationService.create({
      userId: supplier.userId,
      type: 'SUPPLIER_RETURNED',
      title: '供应商注册退回补正',
      content: `您的供应商注册申请在${SupplierService.REVIEW_STAGE_LABELS[stage]}环节被退回补正，原因：${reason}；补正后将从该环节继续审核。`,
      link: `/profile`,
    });

    if (userId) await this.audit(userId, 'SUPPLIER_RETURNED', id, { name: supplier.name, reason, stage });
    await this.recordApproval(id, 'RETURNED', userId, reason, stage, attachmentIds);

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
    // 停用/黑名单必须联动账号停用——否则被拉黑的供应商仍可登录、仍能投标（最严重数据一致性洞）。
    // 乐观锁，并发时仅一方能从 APPROVED 转出。
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
    // 恢复须同步重新激活账号。
    await this.prisma.user.update({ where: { id: supplier.userId }, data: { isActive: true } });
    if (userId) await this.audit(userId, 'SUPPLIER_RESTORED', id, { name: supplier.name, from: supplier.status, reason: reason ?? null });
    return { success: true };
  }

  /** 供应商补正后重新提交（RETURNED → PENDING），打通「退回补正」死胡同。 */
  async resubmit(supplierId: string, userId: string, note?: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true, status: true, userId: true, companyId: true, reviewStage: true },
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
    // 重新提交回到退回的那一级继续（reviewStage 未重置）；通知该级审批人
    const stage = supplier.reviewStage ?? 'STAFF';
    void this.notifyStageApprovers(stage, supplier.companyId, {
      type: 'SUPPLIER_PENDING',
      title: '供应商补正后重新提交',
      content: `${supplier.name} 已补正资料重新提交${note ? `（说明：${note}）` : ''}，请继续${SupplierService.REVIEW_STAGE_LABELS[stage]}。`,
      link: `/supplier/approval?supplierId=${supplierId}`,
    });
    await this.audit(userId, 'SUPPLIER_RESUBMITTED', supplierId, { name: supplier.name, note: note ?? null });
    return { success: true };
  }

  /** 管理员复活被拒绝的申请（REJECTED → PENDING），打通「拒绝」死胡同。 */
  async reactivate(id: string, userId?: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      select: { id: true, name: true, status: true, companyId: true },
    });
    if (!supplier) throw new NotFoundException('供应商不存在');
    if (supplier.status !== 'REJECTED') {
      throw new BadRequestException({ error: '仅被拒绝的供应商可重新激活', code: 'INVALID_STATUS' });
    }
    const claimed = await this.prisma.supplier.updateMany({
      where: { id, status: 'REJECTED' },
      // 三级审批（2026-09-29）：复活重走全流程（首级 STAFF），并清理上次的拒绝原因
      data: { status: 'PENDING', reviewStage: 'STAFF', rejectReason: null },
    });
    if (claimed.count === 0) {
      throw new BadRequestException({ error: '状态已变更，请刷新后重试', code: 'CONFLICT' });
    }
    void this.notifyStageApprovers('STAFF', supplier.companyId, {
      type: 'SUPPLIER_PENDING',
      title: '供应商申请已复活，待初审',
      content: `${supplier.name} 的被拒申请已由管理员复活，重新进入三级审核。`,
      link: `/supplier/approval?supplierId=${id}`,
    });
    if (userId) await this.audit(userId, 'SUPPLIER_REACTIVATED', id, { name: supplier.name });
    return { success: true };
  }

  async listChanges(supplierId: string) {
    const rows = await this.prisma.supplierChangeRecord.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
    });
    // enrich 审批人姓名（S10 终稿，2026-09-29）：reviewedBy 存 user id（标量列），
    // 此前前端直出 cuid UUID——此处反查补 reviewedByName
    const reviewerIds = [...new Set(rows.map(r => r.reviewedBy).filter((v): v is string => !!v))];
    if (reviewerIds.length === 0) return rows;
    const users = await this.prisma.user.findMany({
      where: { id: { in: reviewerIds } },
      select: { id: true, displayName: true, username: true },
    });
    const nameOf = new Map(users.map(u => [u.id, u.displayName || u.username]));
    // 管理端展示脱敏（等保+密评）：变更值 PII 拆封后掩码
    return rows.map(r => ({
      ...r,
      oldValue: maskChangeValue(r.fieldName, r.oldValue),
      newValue: maskChangeValue(r.fieldName, r.newValue),
      reviewedByName: r.reviewedBy ? nameOf.get(r.reviewedBy) ?? null : null,
    }));
  }

  /** 审批中心右上角角标（2026-09-29）：当前登录人「待我审」数量
   *  注册审批 = 我所在级的在审数（staff→STAFF 级·本公司；leader→LEADER 级·本公司 + 本公司无 staff 时的 STAFF 级；admin→ADMIN 级·全部）
   *  信息更新审批 = 待审变更数（办公权限：leader/staff·本公司；admin 全部可见）
   *  加入审批（多公司归属 2026-10-16）= SupplierCompanyLink 三级审批件，级/公司口径与注册审批同构（落在 link 表上） */
  async myPendingReviewCount(actor: AuthenticatedUser, companyIdFilter?: string | null): Promise<{ registration: number; changes: number; resets: number; joins: number }> {
    const regWhere: any = { status: 'PENDING' };
    let linkWhere: any = null; // null = 本角色无加入审批待办（supplier 等），不查 link 表
    if (actor.role === 'admin') {
      // A 方案（2026-10-08；2026-10-09 扩 STAFF 孤儿）：终审件 + 「无在编 leader」的 LEADER 级
      // 代复审件 + 「无 staff 且无 leader」的 STAFF 级代初审件都计入 admin 待办——
      // assertStageApprover 本就放行代审，角标口径须与之对齐（此前能审却看不见）。
      regWhere.AND = [{
        OR: [
          { reviewStage: 'ADMIN' },
          // 未归属公司（companyId=null）本就不属任何公司的管理账号 → 与 raw/权限断言同口径归 admin 代审；
          // ORM 对 null to-one 关系的 none 不命中，须显式补 companyId: null 分支（2026-10-09 真库冒烟抓到的口径分歧）
          { reviewStage: 'LEADER', OR: [{ companyId: null }, { company: { users: { none: { role: 'leader', isActive: true } } } }] },
          { reviewStage: 'STAFF', OR: [{ companyId: null }, { company: { users: { none: { OR: [{ role: 'staff' }, { role: 'leader' }], isActive: true } } } }] },
        ],
      }];
      if (companyIdFilter) regWhere.companyId = companyIdFilter;
      // 加入审批（link 表）同口径三批：ADMIN 级全部 + 「公司无 leader」的 LEADER 级 + 「公司无 staff 且无 leader」的 STAFF 级。
      // link.companyId 非空（必填外键）→ 无注册侧「未归属公司」分支。
      linkWhere = {
        status: 'PENDING',
        AND: [{
          OR: [
            { reviewStage: 'ADMIN' },
            { reviewStage: 'LEADER', company: { users: { none: { role: 'leader', isActive: true } } } },
            { reviewStage: 'STAFF', company: { users: { none: { OR: [{ role: 'staff' }, { role: 'leader' }], isActive: true } } } },
          ],
        }],
        ...(companyIdFilter ? { companyId: companyIdFilter } : {}),
      };
    } else if (actor.role === 'leader' || actor.role === 'staff') {
      // JWT payload 不携带 companyId（AuthenticatedUser 仅 sub/role/username）——查库取归属公司
      const me = await this.prisma.user.findUnique({ where: { id: actor.sub }, select: { companyId: true } });
      const myCompany = companyIdFilter ?? me?.companyId ?? null;
      if (!myCompany) return { registration: 0, changes: 0, resets: 0, joins: 0 }; // 无归属公司 → 无域内待审
      const stageList = ['LEADER'];
      if (actor.role === 'staff') {
        stageList.length = 0;
        stageList.push('STAFF');
      } else if (!(await this.companyHasActiveRole('staff', myCompany))) {
        stageList.push('STAFF'); // 本公司无 staff：leader 兼初审
      }
      regWhere.reviewStage = { in: stageList };
      regWhere.companyId = myCompany;
      linkWhere = { status: 'PENDING', reviewStage: { in: stageList }, companyId: myCompany };
    } else {
      return { registration: 0, changes: 0, resets: 0, joins: 0 }; // supplier 等角色无审批待办
    }
    const registration = await this.prisma.supplier.count({ where: regWhere });
    // 资料变更角标与列表/审批动作同口径（2026-10-22 对齐修复）：变更列表
    // （listPendingChanges）全量、approveChange 无公司闸（供应商域不隔离）——
    // 原角标按公司过滤会漏报（他司变更待审时角标不亮、点进去却有事可办）
    const changes = await this.prisma.supplierChangeRecord.count({
      where: { status: 'PENDING' },
    });
    // 供应商密码重置待审（2026-10-15 并入「信息更新审批」角标——此前不计数，审批中心外无被动发现渠道）
    const resets = await this.prisma.passwordResetRequest.count({
      where: { status: 'PENDING', matchedUser: { is: { role: 'supplier' } } },
    });
    // 加入审批待办（多公司归属 2026-10-16）：供应商自主申请的三级审批件
    const joins = linkWhere ? await this.prisma.supplierCompanyLink.count({ where: linkWhere }) : 0;
    return { registration, changes, resets, joins };
  }

  /** 审批中心：全部待审的供应商资料变更（:3004 供应商门户提交，跨供应商） */
  async listPendingChanges() {
    const rows = await this.prisma.supplierChangeRecord.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      include: { supplier: { select: { id: true, name: true, supplierNo: true } } },
    });
    // 审批场景明文出口（PII 口径 2026-10 密评裁定）：待审列表原值/新值拆封展示——
    // 此前裸出 SM4 密文（2026-10-22 实录「审批中出现密文」），审批人无法核对
    return rows.map(r => ({
      ...r,
      oldValue: openChangeValue(r.fieldName, r.oldValue),
      newValue: openChangeValue(r.fieldName, r.newValue),
    }));
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

    // 同字段已有 PENDING 变更时拒绝——避免审核列表重复项 + 反复群发通知风暴。
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
    void this.notifyCompanyApprovers(supplier.companyId, {
      type: 'SUPPLIER_PENDING',
      title: '供应商变更申请待审核',
      content: `${supplier.name} 提交了变更申请（${dto.fieldLabel}），请前往审核。`,
      link: `/supplier/${supplierId}`,
    });

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

      const data: Record<string, any> = { [change.fieldName]: change.newValue }; // PII 字段（法人身份证/电话）newValue 已密封落库，原样应用
      if (change.fieldName === 'legalPersonIdCard') {
        data.legalPersonIdCardIdx = blindIndexPii(openChangeValue('legalPersonIdCard', change.newValue)) ?? null;
      }
      // establishedDate 为 Date 列：newValue（ISO 字符串或空）须转换
      if (change.fieldName === 'establishedDate') {
        data.establishedDate = change.newValue ? new Date(change.newValue) : null;
      }
      if (change.fieldName === 'name') {
        // 公司名允许重复，不再按 normalizedName 查重；仅同步 normalizedName 与用户名（用户名仍须唯一，见下）
        const normalizedName = String(change.newValue).trim().toLowerCase();
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
          // 与注册同语义（2026-10-14）：变更引入的库外标签进待审池（PENDING），审核通过入池供后续选择；
          // 命中既有记录（含曾被拒）原样保留，不重复进队列。待审在 :3005 审批中心「业务标签」tab 可见。
          for (const tag of data.tags as string[]) {
            await tx.businessTag.upsert({
              where: { name: tag },
              update: {},
              create: { name: tag, status: 'PENDING', source: 'supplier_change', createdBySupplierId: change.supplierId },
            });
          }
        } catch (e) {
          if (e instanceof BadRequestException) throw e;
          throw new BadRequestException({ error: '业务标签格式不正确', code: 'INVALID_TAGS' });
        }
      }

      // 聚合字段：JSON 整体替换子表（非 supplier 列，须从 data 中剔除）
      if (change.fieldName === 'bankAccounts') {
        let parsed: any[];
        try { parsed = JSON.parse(change.newValue || '[]'); if (!Array.isArray(parsed)) throw new Error(); }
        catch { throw new BadRequestException({ error: '银行账户格式不正确', code: 'INVALID_BANK_ACCOUNTS' }); }
        await tx.supplierBankAccount.deleteMany({ where: { supplierId: change.supplierId } });
        for (const b of parsed) {
          if (!b?.accountName || !b?.bankName || !b?.accountNo) {
            throw new BadRequestException({ error: '银行账户信息不完整（户名/开户银行/账号必填）', code: 'INVALID_BANK_ACCOUNTS' });
          }
          await tx.supplierBankAccount.create({
            data: {
              supplierId: change.supplierId,
              accountName: String(b.accountName),
              bankName: String(b.bankName),
              bankBranch: b.bankBranch ? String(b.bankBranch) : null,
              // JSON 内已密封（sealChangeValue）则透传；明文防御性补密封
              accountNo: isSealedFieldSm(String(b.accountNo)) ? String(b.accountNo) : sealPii(String(b.accountNo)) as string,
              isDefault: !!b.isDefault,
            },
          });
        }
        delete data[change.fieldName];
      }

      if (change.fieldName === 'performances') {
        let parsed: any[];
        try { parsed = JSON.parse(change.newValue || '[]'); if (!Array.isArray(parsed)) throw new Error(); }
        catch { throw new BadRequestException({ error: '业绩格式不正确', code: 'INVALID_PERFORMANCES' }); }
        await tx.supplierPerformance.deleteMany({ where: { supplierId: change.supplierId } });
        for (const p of parsed) {
          if (!p?.projectName) {
            throw new BadRequestException({ error: '业绩项目名称必填', code: 'INVALID_PERFORMANCES' });
          }
          const proofFiles = Array.isArray(p.proofFiles) ? p.proofFiles : [];
          if (proofFiles.length === 0) {
            throw new BadRequestException({ error: '业绩须包含证明材料', code: 'INVALID_PERFORMANCES' });
          }
          await tx.supplierPerformance.create({
            data: {
              supplierId: change.supplierId,
              projectName: String(p.projectName),
              clientName: p.clientName ? String(p.clientName) : null,
              contractAmount: p.contractAmount ? String(p.contractAmount) : null,
              signDate: p.signDate ? new Date(p.signDate) : null,
              description: p.description ? String(p.description) : null,
              proofFiles,
            },
          });
        }
        delete data[change.fieldName];
      }

      await tx.supplier.update({ where: { id: change.supplierId }, data });
    });

    // 变更审批（敏感操作）补审计留痕。
    await this.audit(reviewerId, 'SUPPLIER_CHANGE_APPROVED', change.supplierId, { field: change.fieldName });

    // 待办清零：resolve 该供应商的 SUPPLIER_PENDING（变更申请通知，link 与 createChangeRequest 全等）
    await this.notificationService.resolveActionable('SUPPLIER_PENDING', `/supplier/${change.supplierId}`);

    return { success: true };
  }

  // 临时供应商转正审批通过：补全企业资料 + 创建联系人/资质 + 取消 isTemporary
  private async approveConvertToRegular(change: any, reviewerId: string) {
    let payload: any = {};
    try {
      // PII 在 JSON 内密封落库——审批应用时拆封（校验/落列按明文口径，落列处再密封）
      payload = JSON.parse(openChangeValue('convertToRegular', change.newValue) ?? '{}');
    } catch {
      throw new BadRequestException({ error: '转正资料解析失败', code: 'INVALID_PAYLOAD' });
    }
    const { enterpriseType, legalPerson, registeredAddress, businessScope, creditCode, contacts = [], qualifications = [], tags = [], legalPersonIdCard, legalIdFileUrl } = payload;
    if (![enterpriseType, legalPerson, registeredAddress, businessScope].every((v: any) => v && String(v).trim())) {
      throw new BadRequestException({ error: '转正资料不完整，无法通过审批', code: 'INCOMPLETE_DATA' });
    }
    if (!creditCode || !/^[0-9A-Z]{18}$/.test(String(creditCode))) {
      throw new BadRequestException({ error: '统一社会信用代码格式不正确', code: 'INVALID_CREDIT_CODE' });
    }
    // B2-4（2026-09-30）：法人身份证号+扫描件为注册必传口径——缺失/格式不对即资料不完整
    if (!legalPersonIdCard || !/^\d{17}[\dXx]$/.test(String(legalPersonIdCard))) {
      throw new BadRequestException({ error: '法定代表人身份证号缺失或格式不正确，无法通过审批', code: 'INVALID_LEGAL_ID_CARD' });
    }
    if (!legalIdFileUrl || !String(legalIdFileUrl).trim()) {
      throw new BadRequestException({ error: '缺少法定代表人身份证扫描件，无法通过审批', code: 'MISSING_LEGAL_ID_SCAN' });
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
          // B2-4：转正补全法人身份证号（注册必传口径）；国密密封 + 盲索引
          legalPersonIdCard: sealPii(String(legalPersonIdCard)) as string,
          legalPersonIdCardIdx: blindIndexPii(String(legalPersonIdCard)) ?? null,
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
        // 联系人手机号唯一性（2026-10-14）：主联系人全局唯一 + 额外联系人供应商内唯一
        await assertContactPhonesUnique(tx, {
          supplierId: change.supplierId,
          contacts: contacts.map((c: any) => ({ phone: String(c.phone ?? '').trim(), isPrimary: !!c.isPrimary })),
        });
        // 主联系人 = 账号（2026-10-14 稳健性）：换主联系人手机号须走资料变更，不随转正改账号手机号
        await assertPrimaryContactMatchesAccount(tx, {
          supplierId: change.supplierId,
          contacts: contacts.map((c: any) => ({ phone: String(c.phone ?? '').trim(), isPrimary: !!c.isPrimary })),
        });
        await tx.supplierContact.createMany({
          data: contacts.map((c: any) => ({
            supplierId: change.supplierId,
            name: String(c.name).trim(),
            phone: sealPii(String(c.phone).trim()) as string, // PII 国密密封（等保+密评）
            phoneIdx: blindIndexPii(String(c.phone).trim()) ?? null, // 联系人手机号盲索引
            email: c.email ? sealPii(String(c.email).trim()) as string : null,
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
      // 3.1) B2-4：法定代表人身份证扫描件——与正式注册同款落资质行（type=法定代表人身份证）；
      //      payload 资质里已手动录入同类型行则跳过，防重复
      const hasLegalIdQual = Array.isArray(qualifications)
        && qualifications.some((q: any) => q && String(q.type).trim() === '法定代表人身份证');
      if (!hasLegalIdQual && legalIdFileUrl) {
        await tx.supplierQualification.create({
          data: {
            supplierId: change.supplierId,
            type: '法定代表人身份证',
            name: `${String(legalPerson).trim()}·身份证扫描件`,
            fileUrl: String(legalIdFileUrl).trim(),
          },
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

    // 变更拒绝补审计。
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

  async listEvaluations(supplierId: string) {
    const evaluations = await this.prisma.supplierEvaluation.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
      include: {
        evaluator: { select: { id: true, displayName: true } },
      },
    });
    // SupplierEvaluation.projectId 为裸列（无 @relation），手工补项目名供前端历史展示
    const projectIds = [...new Set(evaluations.map(e => e.projectId).filter((p): p is string => !!p))];
    const projects = projectIds.length > 0
      ? await this.prisma.bidProject.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true, stage: true } })
      : [];
    const projectById = new Map(projects.map(p => [p.id, p]));
    return evaluations.map(e => ({ ...e, project: e.projectId ? projectById.get(e.projectId) ?? null : null }));
  }

  /**
   * 供应商真实参评项目列表（BidSupplier 实数据 + 评标结果对照；评价「关联项目」下拉数据源）。
   * 评标结果按 BidSupplier.id 匹配（与 generateEvaluationResults 写入口径一致）。
   */
  async listEvaluationProjects(supplierId: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true } });
    if (!supplier) throw new NotFoundException({ error: '供应商不存在', code: 'NOT_FOUND' });
    const bids = await this.prisma.bidSupplier.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, projectId: true, downloadStatus: true, submitStatus: true, decryptStatus: true, confirmStatus: true,
        project: { select: { id: true, name: true, stage: true, procurementMethod: true, openTime: true, deadline: true } },
      },
    });
    const results = bids.length > 0
      ? await this.prisma.bidEvaluationResult.findMany({
        where: { supplierId: { in: bids.map(b => b.id) } },
        select: { supplierId: true, rank: true, recommended: true, disqualified: true, bidPrice: true, generatedAt: true },
      })
      : [];
    const resultByBid = new Map(results.map(r => [r.supplierId, r]));
    return bids.map(b => {
      const r = resultByBid.get(b.id);
      return {
        projectId: b.projectId,
        project: b.project,
        downloadStatus: b.downloadStatus,
        submitStatus: b.submitStatus,
        decryptStatus: b.decryptStatus,
        confirmStatus: b.confirmStatus,
        result: r
          ? {
            rank: r.rank,
            recommended: r.recommended,
            disqualified: r.disqualified,
            bidPrice: r.bidPrice != null ? Number(r.bidPrice) : null,
            generatedAt: r.generatedAt,
          }
          : null,
      };
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

    // 关联项目校验：projectId 非空时项目须真实存在、且该供应商确实参与过（有 BidSupplier 记录），
    // 防虚构项目/未参与项目写评价污染画像、淘汰预警与统计下游（对齐专家评价 EXPERT_NOT_ON_PROJECT 口径）。
    if (dto.projectId) {
      const project = await this.prisma.bidProject.findUnique({ where: { id: dto.projectId }, select: { id: true } });
      if (!project) throw new BadRequestException({ error: '评价关联的项目不存在', code: 'PROJECT_NOT_FOUND' });
      const bid = await this.prisma.bidSupplier.findFirst({ where: { projectId: dto.projectId, supplierId }, select: { id: true } });
      if (!bid) throw new BadRequestException({ error: '该供应商未参与此项目，不能对其发起项目关联评价', code: 'SUPPLIER_NOT_ON_PROJECT' });
    }

    // 方案B（2026-10-21 用户裁定：工作人员可多次评价）——提交闸+频次闸：
    // ①提交闸（防手滑）：同评价人×同供应商×同项目×同来源 7 天内已评价 → 覆盖更新（视为修改，不增条目）
    // ②频次闸（防恶意刷）：7 天内对该供应商已有其他评价 → 须 leader/admin 或填「复评事由」
    // ③统计闸（防失真）见 latestSupplierEvals——排名/画像/淘汰预警按槽位取最新，单人只算一票
    const source = dto.evaluationSource === 'contract' ? 'contract' : 'procurement';
    const recent = await this.prisma.supplierEvaluation.findMany({
      where: { supplierId, evaluatorId, createdAt: { gte: new Date(Date.now() - EVALUATION_COOLDOWN_MS) } },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    const sameSlot = recent.find(
      (e) => (e.projectId ?? null) === (dto.projectId ?? null) && (e.evaluationSource ?? 'procurement') === source,
    );
    if (!sameSlot && recent.length > 0 && !reevalAllowed(evaluatorRole, dto.reviewReason)) {
      throw new BadRequestException({
        error: '7 天内已评价过该供应商，再次评价须填写复评事由（或由 leader/admin 发起）',
        code: 'EVALUATION_TOO_FREQUENT',
      });
    }

    // 加权计算综合等级
    const finalGrade = computeFinalGrade(
      dto.completenessGrade,
      dto.responsivenessGrade,
      dto.cooperationGrade,
      dto.complianceGrade,
      dto.comprehensiveGrade,
    );

    const evalData = {
      finalGrade,
      completenessGrade: dto.completenessGrade,
      responsivenessGrade: dto.responsivenessGrade,
      cooperationGrade: dto.cooperationGrade,
      complianceGrade: dto.complianceGrade,
      comprehensiveGrade: dto.comprehensiveGrade,
      comment: dto.comment,
      // A4（4.1.1.8）：区分采购过程评价与合同履约评价（C3 验收后触发后者）
      evaluationSource: source,
      evidence: dto.evidence ?? undefined,
      reviewReason: dto.reviewReason?.trim() || undefined,
    };

    // 提交闸命中：覆盖更新同槽位记录（视为修改，不增条目；统计面取最新一条本就如此取数）
    if (sameSlot) {
      const updated = await this.prisma.supplierEvaluation.update({
        where: { id: sameSlot.id },
        data: evalData,
      });
      await this.audit(evaluatorId, 'SUPPLIER_EVALUATION_UPDATED', supplierId, {
        finalGrade, projectId: dto.projectId ?? null, reviewReason: dto.reviewReason?.trim() || null, updated: true,
      });
      return updated;
    }

    const created = await this.prisma.supplierEvaluation.create({
      data: { supplierId, projectId: dto.projectId, evaluatorId, ...evalData },
    });

    // 评价影响画像/淘汰，补审计。
    await this.audit(evaluatorId, 'SUPPLIER_EVALUATION_CREATED', supplierId, {
      finalGrade, projectId: dto.projectId ?? null, reviewReason: dto.reviewReason?.trim() || null,
    });

    // 决策 #3：不自动停用。连续低分由 reviewEliminationCandidates()（cron + 人工）产出预警，
    // 实际淘汰须经 admin 调 confirmEliminate() 确认。此处仅返回评价结果。
    return created;
  }

  /* CTS A-213/215/216 投标人信息资源库 */

  /** A-215 拉黑：原因必填；审核完结状态才可拉黑；乐观锁防并发（操作留痕走全局 operation-log） */
  async blacklistSupplier(supplierId: string, reason: string, user?: AuthenticatedUser) {
    if (!user || !['admin', 'leader'].includes(user.role)) {
      throw new ForbiddenException({ error: '仅领导或管理员可执行黑名单操作', code: 'BLACKLIST_ROLE_FORBIDDEN' });
    }
    if (!reason?.trim()) throw new BadRequestException({ error: '拉黑必须填写原因', code: 'REASON_REQUIRED' });
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true, status: true, userId: true, companyId: true },
    });
    if (!supplier) throw new NotFoundException('供应商不存在');
    if (supplier.status === 'BLACKLIST') {
      throw new BadRequestException({ error: '该供应商已在黑名单中', code: 'ALREADY_BLACKLISTED' });
    }
    if (supplier.status === 'PENDING' || supplier.status === 'RETURNED') {
      throw new BadRequestException({ error: '审核未完结的供应商不可拉黑，请先完成审核或退回', code: 'INVALID_STATUS' });
    }
    const claimed = await this.prisma.supplier.updateMany({
      where: { id: supplierId, status: supplier.status },
      data: { status: 'BLACKLIST', disableReason: reason.trim() },
    });
    if (claimed.count === 0) {
      throw new ConflictException({ error: '供应商状态已变化，请刷新后重试', code: 'CONCURRENT_UPDATE' });
    }
    // 账号联动停用（与 updateStatus 同一不变式：黑名单供应商必须立刻丧失登录能力，
    // 否则被拉黑仍可登录/投标——本端点此前漏写，2026-10-15 复盘补上）
    await this.prisma.user.update({ where: { id: supplier.userId }, data: { isActive: false } });
    if (supplier.userId) {
      void this.notificationService
        .sendToUser(supplier.userId, ['in_app'], {
          type: 'SUPPLIER_BLACKLISTED',
          title: '账号已列入黑名单',
          content: `贵司已被列入供应商黑名单：${reason.trim()}。如有异议请联系采购中心。`,
          link: '/notifications',
        })
        .catch(() => undefined);
    }
    await this.audit(user!.sub, 'SUPPLIER_BLACKLIST', supplierId, { name: supplier.name, reason: reason.trim() });
    return this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true, status: true, disableReason: true },
    });
  }

  /** A-215 解除黑名单：恢复入库；解除原因必填（留痕走 operation-log） */
  async unblacklistSupplier(supplierId: string, reason: string, user?: AuthenticatedUser) {
    if (!user || !['admin', 'leader'].includes(user.role)) {
      throw new ForbiddenException({ error: '仅领导或管理员可执行黑名单操作', code: 'BLACKLIST_ROLE_FORBIDDEN' });
    }
    if (!reason?.trim()) throw new BadRequestException({ error: '解除黑名单必须填写原因', code: 'REASON_REQUIRED' });
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true, status: true, userId: true, companyId: true },
    });
    if (!supplier) throw new NotFoundException('供应商不存在');
    if (supplier.status !== 'BLACKLIST') {
      throw new BadRequestException({ error: '该供应商不在黑名单中', code: 'NOT_BLACKLISTED' });
    }
    const claimed = await this.prisma.supplier.updateMany({
      where: { id: supplierId, status: 'BLACKLIST' },
      data: { status: 'APPROVED', disableReason: null, eliminatedAt: null },
    });
    if (claimed.count === 0) {
      throw new ConflictException({ error: '供应商状态已变化，请刷新后重试', code: 'CONCURRENT_UPDATE' });
    }
    // 账号联动恢复（与 restoreStatus 同一不变式）：拉黑入口有两条——PATCH :id/status（停账号）
    // 与本端点 A-215。此前解禁只回滚供应商状态、不回滚账号，混合使用两条入口时
    // 「拉黑→解禁」后账号仍停用（isActive=false），供应商登录永返 ACCOUNT_PENDING（2026-10-15 实录）。
    await this.prisma.user.update({ where: { id: supplier.userId }, data: { isActive: true } });
    if (supplier.userId) {
      void this.notificationService
        .sendToUser(supplier.userId, ['in_app'], {
          type: 'SUPPLIER_UNBLACKLISTED',
          title: '黑名单已解除',
          content: `贵司黑名单已解除并恢复入库：${reason.trim()}。`,
          link: '/notifications',
        })
        .catch(() => undefined);
    }
    await this.audit(user!.sub, 'SUPPLIER_UNBLACKLIST', supplierId, { name: supplier.name, reason: reason.trim() });
    return this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true, status: true, disableReason: true },
    });
  }

  /** A-213 奖惩记录录入（复用 SupplierPerformance，recordType 区分） */
  async addSupplierRecord(supplierId: string, dto: AddSupplierRecordDto) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true },
    });
    if (!supplier) throw new NotFoundException('供应商不存在');
    if (!dto.recordNote?.trim()) {
      throw new BadRequestException({ error: '必须填写奖惩事由', code: 'RECORD_NOTE_REQUIRED' });
    }
    return this.prisma.supplierPerformance.create({
      data: {
        supplierId,
        projectName: dto.projectName.trim(),
        recordType: dto.recordType,
        recordNote: dto.recordNote.trim(),
        effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : null,
        clientName: dto.clientName?.trim() ?? null,
        contractAmount: dto.contractAmount != null ? String(dto.contractAmount) : null,
        proofFiles: [],
      },
    });
  }

  /** A-213 奖惩记录列表 */
  async listSupplierRecords(supplierId: string, recordType?: string) {
    const type =
      recordType === 'reward' || recordType === 'punishment' ? recordType : { in: ['reward', 'punishment'] };
    return this.prisma.supplierPerformance.findMany({
      where: { supplierId, recordType: type },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** A-216 联系人人员类别/执业证书标注 */
  async updateContactPersonnel(contactId: string, dto: UpdateContactPersonnelDto) {
    const contact = await this.prisma.supplierContact.findUnique({ where: { id: contactId }, select: { id: true } });
    if (!contact) throw new NotFoundException('联系人不存在');
    return this.prisma.supplierContact.update({
      where: { id: contactId },
      data: {
        ...(dto.personnelType !== undefined && { personnelType: dto.personnelType || null }),
        ...(dto.certTitle !== undefined && { certTitle: dto.certTitle || null }),
      },
    });
  }

  /* 供应商画像（Track E §3.3） */

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
      // 统计闸：画像等级走势按槽位去重后取最近 10 条（方案B 多次评价不放大单人票权）
      this.prisma.supplierEvaluation.findMany({
        where: { supplierId },
        orderBy: { createdAt: 'desc' },
        select: { supplierId: true, finalGrade: true, createdAt: true, evaluatorId: true, projectId: true, evaluationSource: true, updatedAt: true },
      }).then(rows => latestSupplierEvals(rows).slice(0, 10)),
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

  /* 淘汰预警 + 人工确认（决策 #3：只预警，不自动改状态） */

  /** 扫描淘汰候选（最近 3 次绩效均为 E），通知管理员；不修改 status。 */
  /** 淘汰候选扫描（公司隔离 2026-10-19）：候选池与知会范围均限视野——此前全量扫描
   *  APPROVED 供应商且 sendToRole 平台全员知会，他司淘汰名单（供应商名）跨公司外泄。
   *  限定视野走 notifyCompanyApprovers（逐视野公司发该公司 leader+staff）；全部公司
   *  视野（admin 默认）保持 sendToRole 原行为。 */
  async reviewEliminationCandidates(actor?: AuthenticatedUser, companyId?: string) {
    const scope = actor ? await this.companyScope.resolveScope(actor, companyId) : null;
    const f = scope ? supplierCompanyWhere(scope) : {};
    const suppliers = await this.prisma.supplier.findMany({
      where: { status: 'APPROVED', ...f },
      select: { id: true, name: true },
    });

    const candidates: Array<{ supplierId: string; name: string; reason: string }> = [];
    for (const s of suppliers) {
      // 统计闸：淘汰预警「最近 3 次」按槽位去重判定（方案B 多次评价——单人刷 E 不再触发误淘汰）
      const recent = latestSupplierEvals(await this.prisma.supplierEvaluation.findMany({
        where: { supplierId: s.id },
        orderBy: { createdAt: 'desc' },
        select: { supplierId: true, finalGrade: true, evaluatorId: true, projectId: true, evaluationSource: true, createdAt: true, updatedAt: true },
      })).slice(0, 3);
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
      // 淘汰复核属 :3005 供应商库管理（leader+staff）；admin 只管管理端账号，不收业务知会。
      // 限定视野时逐视野公司发该公司 approvers（知会不跨公司）；全部公司视野保持平台全员。
      if (scope && !scope.all) {
        for (const cid of scope.companyIds) {
          await this.notifyCompanyApprovers(cid, payload);
        }
      } else {
        await Promise.all(['leader', 'staff'].map(r => this.notificationService.sendToRole(r, payload)));
      }
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
    // 乐观锁 + 联动账号停用。
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

  /* 资质到期预警看板（公司隔离 2026-10-15：与 stats 同口径——预警 KPI 卡不得跨视野计数） */
  async getQualificationAlerts(actor?: AuthenticatedUser, companyId?: string) {
    const now = Date.now();
    const in90 = new Date(now + 90 * 86400000);
    const f = actor ? supplierCompanyWhere(await this.companyScope.resolveScope(actor, companyId)) : {};
    // 取「已过期 或 90 天内到期」的资质（覆盖过期+即将过期两态，避免 status 字段未同步导致漏报）。
    // 预警是否展示完全由 validTo 决定：供应商维护更新资质后（validTo 移出 90 天窗口）自动从看板消失。
    const items = await this.prisma.supplierQualification.findMany({
      where: { validTo: { not: null, lte: in90 }, supplier: { ...f } },
      include: {
        supplier: { select: { id: true, name: true } },
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
      };
    });
    return {
      items: withStatus,
      expiredCount: withStatus.filter((q) => q.status === '已过期').length,
      expiringCount: withStatus.filter((q) => q.status === '即将过期').length,
      affectedSupplierCount: new Set(withStatus.map((q) => q.supplierId)).size,
    };
  }

  /** 发送资质维护提醒通知：站内信触达供应商门户（link 指向 /profile 资质与证照 tab）。
   *  公司视野断言（2026-10-19）：此前可直打任意资质 id 向他司供应商发提醒。 */
  async notifyQualificationAlert(qualificationId: string, userId: string, actor?: AuthenticatedUser) {
    if (!userId) throw new ForbiddenException({ error: '未登录', code: 'UNAUTHORIZED' });
    const qual = await this.prisma.supplierQualification.findUnique({
      where: { id: qualificationId },
      select: { id: true, name: true, validTo: true, supplier: { select: { id: true, userId: true, companyId: true } } },
    });
    if (!qual) throw new NotFoundException('资质记录不存在');
    if (!qual.supplier?.userId) {
      throw new BadRequestException({ error: '该供应商尚未关联登录账号，无法发送通知', code: 'NO_SUPPLIER_ACCOUNT' });
    }
    if (actor && actor.role !== 'supplier') {
      await this.assertSupplierInScope(qual.supplier, actor);
    }

    const now = new Date();
    const date = qual.validTo ? new Date(qual.validTo).toISOString().slice(0, 10) : '';
    const daysLeft = qual.validTo ? Math.ceil((new Date(qual.validTo).getTime() - now.getTime()) / 86400000) : null;
    const expired = daysLeft !== null && daysLeft < 0;
    const content = expired
      ? `您的资质材料「${qual.name}」已于 ${date} 到期，请及时更新以免影响投标资格。`
      : `您的资质材料「${qual.name}」将于 ${date} 到期（剩 ${daysLeft} 天），请及时更新以免影响投标资格。`;

    await this.notificationService.create({
      userId: qual.supplier.userId,
      type: 'QUALIFICATION_EXPIRING',
      title: '资质到期维护提醒',
      content,
      link: '/profile',
    });
    return { success: true };
  }

  /* 供应商生命周期时间线 */
  /** 管理员直接修改供应商业务标签（不走变更审批流程） */
  async updateTags(supplierId: string, tags: string[], reviewerId: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true, tags: true, status: true } });
    if (!supplier) throw new NotFoundException('供应商不存在');
    // 待审核 / 退回补正期间资料暂不可修改（业务标签属资料维护，须审核通过后）
    if (supplier.status === 'PENDING' || supplier.status === 'RETURNED') {
      throw new BadRequestException({ error: '待审核期间资料暂不可修改，请先完成审核', code: 'SUPPLIER_PENDING_REVIEW' });
    }
    const cleaned = tags.filter(t => typeof t === 'string' && t.trim()).slice(0, 8);
    if (cleaned.length < 2) throw new BadRequestException({ error: '业务标签至少保留 2 个', code: 'INVALID_TAGS' });
    await this.prisma.supplier.update({ where: { id: supplierId }, data: { tags: cleaned } });
    await this.audit(reviewerId, 'SUPPLIER_TAGS_UPDATED', supplierId, { before: supplier.tags, after: cleaned });
    return { tags: cleaned };
  }

  async getSupplierTimeline(supplierId: string) {
    const [supplier, auditLogs, evaluations, bidSuppliers] = await Promise.all([
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

    events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return { supplierId, supplierName: supplier.name, events };
  }

  /** 评价统计（公司隔离 2026-10-15：与非 admin 视野一致，防止看板「0 供应商」旁出现全域评价数） */
  async getEvaluationStats(actor?: AuthenticatedUser, companyId?: string) {
    const f = actor ? supplierCompanyWhere(await this.companyScope.resolveScope(actor, companyId)) : {};
    // 统计闸：等级分布按槽位去重（方案B 多次评价不放大单人票权）
    const evaluations = latestSupplierEvals(await this.prisma.supplierEvaluation.findMany({
      select: { supplierId: true, finalGrade: true, evaluatorId: true, projectId: true, evaluationSource: true, createdAt: true, updatedAt: true },
      where: { supplier: { ...f } },
    }));

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

  async getStats(actor?: AuthenticatedUser, companyId?: string) {
    // 公司级数据隔离：统计在隔离集上算（口径同专家库），admin 可 ?companyId= 切单公司
    const scope = actor ? await this.companyScope.resolveScope(actor, companyId) : null;
    const f = scope ? supplierCompanyWhere(scope) : {};
    const ids = scope ? scopeCompanyIds(scope) : null;
    // C1 终审修复（2026-10-19）：pending/returned 是审批流转件——新注册在 ADMIN 终审落 APPROVED link
    // 前只有 Supplier.companyId，单用 link 谓词会漏计（与 myPendingReviewCount 角标的 companyId 口径
    // 漂移，列表/统计与角标不一致）。审批面两计数改双谓词（同 list() 审批流口径）；库内四态仍
    // link-only（库可见性口径不动）。
    const approvalF: Prisma.SupplierWhereInput = ids !== null
      ? { OR: [{ companyLinks: { some: { companyId: { in: ids }, status: 'APPROVED' } } }, { companyId: { in: ids } }] }
      : {};
    const [total, pending, approved, disabled, blacklist, returned, temporaryApproved] = await Promise.all([
      // 总数口径（2026-10-16 用户裁定）：只数库内四态——在库（含临时，临时=APPROVED+isTemporary）/停用/黑名单；
      // PENDING/RETURNED/REJECTED 为审批流转件（注册审批已迁出供应商库），不计入总数。
      this.prisma.supplier.count({ where: { status: { in: ['APPROVED', 'DISABLED', 'BLACKLIST'] }, ...f } }),
      this.prisma.supplier.count({ where: { status: 'PENDING', ...approvalF } }),
      this.prisma.supplier.count({ where: { status: 'APPROVED', ...f } }),
      this.prisma.supplier.count({ where: { status: 'DISABLED', ...f } }),
      this.prisma.supplier.count({ where: { status: 'BLACKLIST', ...f } }),
      this.prisma.supplier.count({ where: { status: 'RETURNED', ...approvalF } }),
      this.prisma.supplier.count({ where: { status: 'APPROVED', isTemporary: true, ...f } }),
    ]);

    return { total, pending, approved, disabled, blacklist, returned, temporaryApproved };
  }

  /** 按公司分组全量计数（admin 全部公司视图的分组标题全量口径，与列表同筛选；台账/专家库 company-counts 同款） */
  async companyCounts(params: { status?: string; search?: string; enterpriseTypes?: string[]; isTemporary?: boolean }, actor?: AuthenticatedUser) {
    const scope = await this.companyScope.resolveScope(actor);
    const where: any = { ...supplierCompanyWhere(scope) };
    if (params.status) {
      if (params.status.startsWith('exclude:')) {
        const excl = params.status.slice('exclude:'.length).split(',').filter(Boolean);
        where.status = excl.length === 1 ? { not: excl[0] } : { notIn: excl };
      } else {
        where.status = params.status;
      }
    }
    if (params.enterpriseTypes?.length) where.enterpriseType = { in: params.enterpriseTypes };
    if (params.isTemporary === true) where.isTemporary = true;
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { creditCode: { contains: params.search } },
        { normalizedName: { contains: params.search, mode: 'insensitive' } },
        { tags: { hasSome: [params.search] } },
      ];
    }
    const groups = await this.prisma.supplier.groupBy({ by: ['companyName'], where, _count: { _all: true } });
    return groups
      .map(g => ({ name: g.companyName?.trim() || '未归属', count: g._count._all }))
      .sort((a, b) => (a.name === '未归属' ? 1 : b.name === '未归属' ? -1 : b.count - a.count || a.name.localeCompare(b.name, 'zh')));
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

  /** 企业类型分布后端聚合——替代看板拉 1000 条客户端计数（>1000 家偏少 + 首页开销大）。 */
  /** 企业类型分布（公司隔离 2026-10-15：看板口径与 stats/列表同视野） */
  async getEnterpriseTypeDistribution(actor?: AuthenticatedUser, companyId?: string) {
    const f = actor ? supplierCompanyWhere(await this.companyScope.resolveScope(actor, companyId)) : {};
    const rows = await this.prisma.supplier.groupBy({
      by: ['enterpriseType'],
      where: { status: 'APPROVED', ...f },
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
      // 统计闸：大屏聚合按槽位去重（方案B 多次评价不放大单人票权）
      this.prisma.supplierEvaluation.findMany({
        select: { supplierId: true, finalGrade: true, createdAt: true, evaluatorId: true, projectId: true, evaluationSource: true, updatedAt: true },
        orderBy: { createdAt: 'asc' },
      }).then(latestSupplierEvals),
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

  /** 分类列表（公司隔离 2026-10-19）：_count 过滤计数（视野内供应商数，库口径=APPROVED link-only），
   *  总览「分类分布」曾全量计数跨视野；无 actor（内部调用）保持全量。 */
  async listClassifications(actor?: AuthenticatedUser, companyId?: string) {
    const f = actor ? supplierCompanyWhere(await this.companyScope.resolveScope(actor, companyId)) : {};
    return this.prisma.supplierClassification.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { suppliers: f.companyLinks ? { where: f } : true } },
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

  /* 供应商多分类管理 */

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

    // 事务：先删后插 + 同步旧 classificationId 字段（全部并入同一事务，避免半同步态）。
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

  /* 通知供应商 */

  /** 批量通知供应商（公司视野过滤 2026-10-19）：此前可直打任意 id 向他司供应商发站内+短信。
   *  出视野目标静默跳过（响应带 outOfScope 计数）——多选含过期项时整批不 403，与列表视野一致。 */
  async notifySuppliers(
    supplierIds: string[],
    channels: string[],
    payload: { type: string; title: string; content: string; link?: string },
    actor?: AuthenticatedUser,
    companyId?: string,
  ) {
    const existing = await this.prisma.supplier.findMany({
      where: { id: { in: supplierIds } },
      select: { id: true },
    });
    const f = actor ? supplierCompanyWhere(await this.companyScope.resolveScope(actor, companyId)) : {};
    const suppliers = await this.prisma.supplier.findMany({
      where: { id: { in: supplierIds }, ...f },
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

    const notFound = supplierIds.length - existing.length;
    const outOfScope = existing.length - suppliers.length;
    return { totalTargets: supplierIds.length, sent: results.length, notFound, outOfScope, results };
  }

  /* 供应商关注/收藏 */

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

  /** 我的收藏（公司隔离 2026-10-19）：解析供应商叠加 link 视野——出视野收藏（跨公司）
   *  不展示供应商信息，与库列表可见性同口径；未关联供应商记录的收藏本就过滤（下方 filter）。 */
  async getFavorites(userId: string, actor?: AuthenticatedUser, companyId?: string) {
    const favs = await this.prisma.supplierFavorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    if (favs.length === 0) return [];
    const supplierIds = favs.map(f => f.supplierId);
    const f = actor ? supplierCompanyWhere(await this.companyScope.resolveScope(actor, companyId)) : {};
    const suppliers = await this.prisma.supplier.findMany({
      where: { id: { in: supplierIds }, ...f },
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

  /* 近期动态 */

  /** 近期动态（公司隔离 2026-10-19）：总览页旁路端点曾全量拉 audit——跨公司供应商名外泄。
   *  AuditLog 无公司列，先取视野内供应商 id 集再限定 resourceId；供应商取数用审批流双谓词
   *  （APPROVED link OR 主归属）——动态含注册审批动作，流转件终审落 link 前只有 Supplier.companyId
   *  （对齐 C1 2026-10-19 口径）。全部公司视野（admin 默认）不加过滤，保持原行为。 */
  async getRecentActivities(limit = 15, actor?: AuthenticatedUser, companyId?: string) {
    const where: any = { resourceType: 'supplier' };
    if (actor) {
      const scope = await this.companyScope.resolveScope(actor, companyId);
      const ids = scopeCompanyIds(scope);
      if (ids !== null) {
        const inScope = await this.prisma.supplier.findMany({
          where: {
            OR: [
              { companyLinks: { some: { companyId: { in: ids }, status: 'APPROVED' } } },
              { companyId: { in: ids } },
            ],
          },
          select: { id: true },
        });
        where.resourceId = { in: inScope.map(s => s.id) };
      }
    }
    const logs = await this.prisma.auditLog.findMany({
      where,
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

  /** 供应商操作历史（审计）：不可变留痕，供「操作历史」只读看板追溯。
   *  覆盖入库/审核/停用/拉黑/恢复/变更/评价/淘汰/标签等全部 audit 落库动作。 */
  /** 供应商操作历史（公司隔离 2026-10-19）：全局模式曾全量拉审计流（nameMap 解析跨公司供应商名）；
   *  按供应商模式可直打他司 id。全局模式=视野内供应商 id 集（双谓词，同 getRecentActivities）；
   *  按供应商模式=该供应商须在视野（同详情页 assertSupplierInScope 谓词）。 */
  async listSupplierAuditLogs(opts: { page: number; pageSize: number; supplierId?: string; action?: string; dateFrom?: string; dateTo?: string }, actor?: AuthenticatedUser, companyId?: string) {
    const page = Math.max(1, opts.page);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize));
    const where: any = { resourceType: 'supplier' };
    if (opts.supplierId) {
      if (actor && actor.role !== 'supplier') {
        const supplier = await this.prisma.supplier.findUnique({
          where: { id: opts.supplierId },
          select: { id: true, companyId: true },
        });
        if (supplier) await this.assertSupplierInScope(supplier, actor);
      }
      where.resourceId = opts.supplierId;
    } else if (actor) {
      const scope = await this.companyScope.resolveScope(actor, companyId);
      const ids = scopeCompanyIds(scope);
      if (ids !== null) {
        const inScope = await this.prisma.supplier.findMany({
          where: {
            OR: [
              { companyLinks: { some: { companyId: { in: ids }, status: 'APPROVED' } } },
              { companyId: { in: ids } },
            ],
          },
          select: { id: true },
        });
        where.resourceId = { in: inScope.map(s => s.id) };
      }
    }
    if (opts.action) where.action = opts.action;
    // 日期范围（YYYY-MM-DD，按本地时区边界）：dateFrom 当日 00:00:00 起，dateTo 当日 23:59:59.999 止。
    if (opts.dateFrom || opts.dateTo) {
      where.createdAt = {};
      if (opts.dateFrom) where.createdAt.gte = new Date(`${opts.dateFrom}T00:00:00`);
      if (opts.dateTo) where.createdAt.lte = new Date(`${opts.dateTo}T23:59:59.999`);
    }

    const [total, logs] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { displayName: true, username: true } },
          // 解析 resourceId → 供应商名（操作历史展示用；供应商可能已删，故 left join）
        },
      }),
    ]);

    // 批量解析资源名：audit 的 resourceId 除批量回填外均为 supplierId，逐个查名。
    const supplierIds = [...new Set(logs.map(l => l.resourceId).filter((id): id is string => !!id))];
    const suppliers = supplierIds.length
      ? await this.prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true } })
      : [];
    const nameMap = new Map(suppliers.map(s => [s.id, s.name]));

    return {
      items: logs.map(l => ({
        id: l.id,
        action: l.action,
        resourceId: l.resourceId,
        resourceName: l.resourceId ? (nameMap.get(l.resourceId) ?? null) : null,
        details: l.details,
        actorName: l.user?.displayName || l.user?.username || '系统',
        createdAt: l.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  /* 评价维度统计 */

  /** 评价五维度统计（公司隔离 2026-10-15：同 getEvaluationStats 口径） */
  async getEvaluationDimensionStats(actor?: AuthenticatedUser, companyId?: string) {
    const f = actor ? supplierCompanyWhere(await this.companyScope.resolveScope(actor, companyId)) : {};
    // 统计闸：维度分布按槽位去重（方案B 多次评价不放大单人票权）
    const evals = latestSupplierEvals(await this.prisma.supplierEvaluation.findMany({
      select: { supplierId: true, completenessGrade: true, responsivenessGrade: true, cooperationGrade: true, complianceGrade: true, comprehensiveGrade: true, evaluatorId: true, projectId: true, evaluationSource: true, createdAt: true, updatedAt: true },
      where: { supplier: { ...f } },
    }));
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

  /* 沟通记录 */

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

  /* 文件档案 CRUD */

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
    const created = await this.prisma.supplierDocument.create({
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
    // 2026-10-23 修复：返回形状与 listDocuments 对齐——此前返回裸行（仅 uploaderId 裸列、
    // 无 uploader 对象），前端把响应直接入列 → 新上传行「上传人」恒显 '—'（刷新页面才恢复）
    const uploader = await this.prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
    return { ...created, uploader: { displayName: uploader?.displayName ?? '—' } };
  }

  async deleteDocument(supplierId: string, docId: string) {
    // 归属校验：仅允许删除该供应商名下的文档，避免跨供应商越权删除。
    const deleted = await this.prisma.supplierDocument.deleteMany({
      where: { id: docId, supplierId },
    });
    if (deleted.count === 0) {
      throw new NotFoundException('文档不存在或不属于该供应商');
    }
    return { success: true };
  }

  // 谈判采购配置下发
  async sendNegotiationConfig(dto: NegotiationConfigDto) {
    const key = `negotiation-config:${dto.projectId}`;
    // 先读旧配置（写入前）：是否曾下发过——固化判定的前提
    const prevConfigRaw = await this.redis.get(key).catch(() => null);
    const configDelivered = !!prevConfigRaw;
    const payload = {
      ...dto,
      deliveredAt: new Date().toISOString(),
    };

    // 配置写回 BidProject：openTime=开标时间，deadline=开标前间隔常量（10 分钟），downloadDeadline=获取截止
    // backlog §1.1：已下发过配置且截标已过（frozen 语义）→ 重发不得变更已固化截标时间。
    // 2026-09-10 收紧前提为「曾下发过配置」：ensureBidProject 自动建的轮次可能带
    // 项目旧字段推导的过期 deadline（无任何投标活动），首次下发配置必须放行，
    // 否则新项目永远发不出配置（实录：新项目误挂旧轮 + 自动推导过期截标连环触发）
    const bidOpening = new Date(dto.bidOpeningTime);
    const acquireEnd = new Date(dto.acquireEndTime);
    if (!isNaN(bidOpening.getTime())) {
      const prev = await this.prisma.bidProject.findUnique({
        where: { id: dto.projectId },
        select: { deadline: true },
      });
      // 2026-10-19 修复：曾硬编码 24h 与 10 分钟口径漂移——当天开标的谈判项目 deadline 落到一天前，
      // 供应商端投标机会列表（deadline > now）整体不可见。间隔随共享常量走（opening-deadline.util 同源）。
      const newDeadline = new Date(bidOpening.getTime() - BID_DEADLINE_BEFORE_OPENING_MS);
      if (configDelivered && prev?.deadline && prev.deadline.getTime() < Date.now()
          && prev.deadline.getTime() !== newDeadline.getTime()) {
        throw new ConflictException({
          error: `截标时间已固化（${prev.deadline.toISOString()}），不可变更；如需调整请走再次采购开新轮`,
          code: 'DEADLINE_FROZEN',
        });
      }
      await this.prisma.bidProject.update({
        where: { id: dto.projectId },
        data: {
          openTime: bidOpening,
          deadline: newDeadline,
          ...(acquireEnd && !isNaN(acquireEnd.getTime()) ? { downloadDeadline: acquireEnd } : {}),
        },
      }).catch(() => { /* 项目可能不存在，忽略 */ });
    }

    // 校验通过才落配置缓存（原实现先写后校验——409 时新配置仍被写入，状态失真）
    await this.redis.set(key, JSON.stringify(payload), 'EX', 86400 * 30); // 30 天过期

    // 确保受邀供应商进入候选名单（决定其在供应商端「可投标项目」的可见性）
    if (dto.supplierIds.length > 0) {
      const suppliers = await this.prisma.supplier.findMany({
        where: { id: { in: dto.supplierIds } },
        select: { id: true, name: true },
      });
      // 跨公司邀请闸（2026-10-20 用户裁定）：谈判配置的受邀名单仅限本项目公司库内
      // （APPROVED SupplierCompanyLink）供应商——与 inviteSuppliers 同口径；项目无归属不设闸。
      const proj = await this.prisma.bidProject.findUnique({
        where: { id: dto.projectId },
        select: { companyId: true },
      });
      if (proj?.companyId) {
        const linked = await this.prisma.supplierCompanyLink.findMany({
          where: { supplierId: { in: dto.supplierIds }, companyId: proj.companyId, status: 'APPROVED' },
          select: { supplierId: true },
        });
        const linkedSet = new Set(linked.map(l => l.supplierId));
        const cross = suppliers.filter(s => !linkedSet.has(s.id));
        if (cross.length > 0) {
          throw new BadRequestException({
            error: `仅可邀请本公司库内供应商：${cross.map(s => s.name).join('、')} 未归属本公司，请先在供应商库完成入库审批`,
            code: 'CROSS_COMPANY_INVITE',
          });
        }
      }
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

  // Excel 批量导入
  private SUPPLIER_IMPORT_COLUMNS = [
    '企业名称*', '统一社会信用代码*', '企业类型', '法定代表人', '法定代表人身份证号', '注册地址', '经营范围',
    '联系人姓名', '联系人手机号', '联系人邮箱', '联系人职位',
  ];

  /** 生成导入模板 Excel Buffer */
  getImportTemplate(): Buffer {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([this.SUPPLIER_IMPORT_COLUMNS]);
    ws['!cols'] = this.SUPPLIER_IMPORT_COLUMNS.map(c => ({ wch: Math.max(c.length * 2, 18) }));
    XLSX.utils.book_append_sheet(wb, ws, '供应商导入模板');
    return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }

  /** 从 Excel Buffer 解析并批量创建为 PENDING 供应商，返回导入摘要 */
  async importFromExcel(buffer: Buffer, createdById: string): Promise<{
    total: number; created: number; skipped: number; errors: string[];
  }> {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 }) as string[][];
    if (rows.length < 2) throw new BadRequestException('Excel 文件为空或仅有表头');

    const headers = rows[0].map((h: string) => (h || '').trim().replace(/\*$/, ''));
    const nameIdx = headers.findIndex((h: string) => h.startsWith('企业名称'));
    const creditIdx = headers.findIndex((h: string) => h.startsWith('统一社会信用代码'));
    if (nameIdx < 0 || creditIdx < 0) throw new BadRequestException('缺少必填列：企业名称、统一社会信用代码');

    const errors: string[] = [];
    let created = 0, skipped = 0;
    const total = rows.length - 1;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every(c => !c || !c.trim())) continue; // 空行跳过
      const name = (row[nameIdx] || '').trim();
      const creditCode = (row[creditIdx] || '').trim();
      if (!name || !creditCode) { skipped++; errors.push(`第${i + 1}行：企业名称或信用代码为空`); continue; }

      try {
        const password = `supplier@2026`;
        const displayName = name.slice(0, 20);
        // 登录账号 = 统一社会信用代码（机构代码）
        await this.register({
          name,
          creditCode,
          enterpriseType: (row[headers.indexOf('企业类型')] || '').trim() || '其他',
          legalPerson: (row[headers.indexOf('法定代表人')] || '').trim() || '未知',
          legalPersonIdCard: (row[headers.indexOf('法定代表人身份证号')] || '').trim() || '',
          registeredAddress: (row[headers.indexOf('注册地址')] || '').trim() || '未知',
          businessScope: (row[headers.indexOf('经营范围')] || '').trim() || '未知',
          displayName,
          organizationCode: creditCode, // 机构代码 = 统一社会信用代码
          companyId: '', // 内部批量导入不选归属（DTO 必选仅约束注册端点；直调服务无校验，空串=未归属）
          password,
          tags: [],
          contacts: [],
          qualifications: [],
          // 内部导入（管理端批量建档）跳过短信验证——直接调用内部建档绕过 verifyRegistrationCode
          registrationPhone: '',
          registrationCode: '__INTERNAL_IMPORT__',
        });
        created++;
      } catch (e: any) {
        skipped++;
        errors.push(`第${i + 1}行「${name}」：${e?.message || '创建失败'}`);
      }
    }

    return { total, created, skipped, errors };
  }

  /* ── PII 明文揭示（等保+密评：管理端默认掩码，明文走此处并留痕）── */

  private static readonly REVEAL_FIELDS: Record<string, { entity: string; fields: string[] }> = {
    supplier: { entity: 'Supplier', fields: ['legalPersonIdCard', 'legalPersonPhone'] },
    contact: { entity: 'SupplierContact', fields: ['phone', 'idCard', 'email'] },
    bankAccount: { entity: 'SupplierBankAccount', fields: ['accountNo'] },
  };

  /**
   * 揭示供应商 PII 明文（admin/leader/staff）。公司隔离同 get()；子记录按
   * { id, supplierId } 反查归属（防跨企枚举）；每次揭示写 SensitiveAccessLog。
   */
  async revealField(
    id: string,
    body: { entity: string; targetId?: string; field: string },
    actor: AuthenticatedUser | undefined,
    ip?: string,
  ): Promise<{ entity: string; targetId: string; field: string; value: string | null }> {
    const cfg = SupplierService.REVEAL_FIELDS[body.entity];
    if (!cfg || !cfg.fields.includes(body.field)) {
      throw new BadRequestException({ error: '该字段不允许揭示', code: 'FIELD_NOT_REVEALABLE' });
    }
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      select: { id: true, companyId: true, legalPersonIdCard: true, legalPersonPhone: true },
    });
    if (!supplier) throw new NotFoundException({ error: '供应商不存在', code: 'NOT_FOUND' });
    if (actor && actor.role !== 'supplier') {
      await this.assertSupplierInScope(supplier, actor);
    }

    let value: string | null;
    let targetId = id;
    if (body.entity === 'supplier') {
      value = openPii(body.field === 'legalPersonIdCard' ? supplier.legalPersonIdCard : supplier.legalPersonPhone);
    } else if (body.entity === 'contact') {
      const row = await this.prisma.supplierContact.findFirst({
        where: { id: body.targetId, supplierId: id },
        select: { id: true, phone: true, idCard: true, email: true },
      });
      if (!row) throw new NotFoundException({ error: '联系人不存在', code: 'NOT_FOUND' });
      targetId = row.id;
      value = openPii(row[body.field as 'phone' | 'idCard' | 'email']);
    } else {
      const row = await this.prisma.supplierBankAccount.findFirst({
        where: { id: body.targetId, supplierId: id },
        select: { id: true, accountNo: true },
      });
      if (!row) throw new NotFoundException({ error: '银行账户不存在', code: 'NOT_FOUND' });
      targetId = row.id;
      value = openPii(row.accountNo);
    }
    await logSensitiveAccess(this.prisma, actor, cfg.entity, targetId, body.field, ip);
    return { entity: body.entity, targetId, field: body.field, value };
  }
}
