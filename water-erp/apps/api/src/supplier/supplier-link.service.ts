import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { CompanyScopeService } from '../company/company-scope';
import type { AuthenticatedUser } from '../auth/auth.types';

/** 供应商多公司归属（2026-10-16 spec）：SupplierCompanyLink 唯一通道=供应商自主申请（三级审批）。
 *  公司侧无任何全系统供应商检索/邀请入口（用户裁决 2026-10-16）。
 *  三级级权限/通知逻辑与 SupplierService 注册审批同口径——原实现为其私有方法，
 *  此处复制同款（约 60 行）避免与 4k 行 SupplierService 强耦合；口径漂移以 spec 为准。 */
@Injectable()
export class SupplierLinkService {
  private static readonly STAGE_LABELS: Record<string, string> = { STAFF: '初审', LEADER: '复审', ADMIN: '终审' };

  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
    private companyScope: CompanyScopeService,
  ) {}

  private err(code: string, error: string): never {
    throw new BadRequestException({ error, code });
  }

  /** 审批动作审计留痕（逐级动作落 AuditLog——与 SupplierService.audit·supplier.service.ts:1949 同款：
   *  失败不阻断业务但可观测）。schema 注：SupplierCompanyLink.reviewedById 只记末级动作人。 */
  private async audit(userId: string, action: string, linkId: string, details?: any) {
    await this.prisma.auditLog.create({ data: { userId, action, resourceType: 'supplier_company_link', resourceId: linkId, details: details ?? {} } })
      .catch((err: any) => console.error(`[audit] 写入失败 action=${action} resource=${linkId}`, err?.message ?? err));
  }

  /** 只读公司解析（与 SupplierService.resolveSupplierCompany·supplier.service.ts:197 同口径）：id 优先、名称兜底。
   *  有意差异：link 侧只读——查不到返回 null（由调用方报 COMPANY_NOT_FOUND），不建档；
   *  注册侧按名称归一化 upsert 建档（注册页公司多数不在既有主数据）。 */
  private async resolveCompanyRef(companyId?: string, companyName?: string): Promise<{ id: string; name: string } | null> {
    if (companyId) {
      const c = await this.prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } });
      if (c) return c;
    }
    const name = (companyName ?? '').trim();
    if (!name) return null;
    return this.prisma.company.findUnique({ where: { name }, select: { id: true, name: true } });
  }

  private async requireSupplier(userId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { userId },
      select: { id: true, name: true, companyId: true, status: true, isTemporary: true, userId: true },
    });
    if (!supplier) this.err('SUPPLIER_NOT_FOUND', '供应商信息不存在');
    return supplier;
  }

  // ───────────────────────── 供应商侧 ─────────────────────────

  async myLinks(userId: string) {
    const supplier = await this.requireSupplier(userId);
    const links = await this.prisma.supplierCompanyLink.findMany({
      where: { supplierId: supplier.id },
      orderBy: { createdAt: 'asc' },
      include: { company: { select: { name: true } } },
    });
    return links.map(({ company, ...rest }) => ({
      ...rest,
      companyName: company.name,
      isPrimary: rest.companyId === supplier.companyId,
    }));
  }

  async apply(userId: string, dto: { companyId?: string; companyName?: string; note?: string }) {
    const supplier = await this.requireSupplier(userId);
    if (supplier.isTemporary) this.err('TEMPORARY_NOT_ALLOWED', '临时供应商须先转正，方可申请加入其他公司');
    if (supplier.status !== 'APPROVED') this.err('SUPPLIER_NOT_APPROVED', '账号当前不在库状态，暂不能申请加入公司');

    const company = await this.resolveCompanyRef(dto.companyId, dto.companyName);
    if (!company) this.err('COMPANY_NOT_FOUND', '归属公司不存在，请重新选择');

    const existing = await this.prisma.supplierCompanyLink.findUnique({
      where: { supplierId_companyId: { supplierId: supplier.id, companyId: company.id } },
    });
    const note = dto.note?.trim() || null;
    let linkId: string;
    if (existing && existing.status === 'PENDING') this.err('LINK_PENDING_EXISTS', '已有进行中的加入申请，请等待该公司处理');
    if (existing && existing.status === 'APPROVED') this.err('ALREADY_IN_COMPANY', '贵司已在该公司的供应商库中');
    if (existing && existing.status === 'DISABLED') this.err('LINK_DISABLED', '贵司已被该公司停用，请联系该公司恢复');
    if (existing) {
      // REJECTED → 原行复用重新走三级
      await this.prisma.supplierCompanyLink.update({
        where: { id: existing.id },
        data: { status: 'PENDING', reviewStage: 'STAFF', note, rejectReason: null, appliedAt: new Date() },
      });
      linkId = existing.id;
    } else {
      try {
        const created = await this.prisma.supplierCompanyLink.create({
          data: { supplierId: supplier.id, companyId: company.id, status: 'PENDING', reviewStage: 'STAFF', note, appliedAt: new Date() },
        });
        linkId = created.id;
      } catch (e) {
        // 并发竞态：findUnique-then-create 间隙另一请求已建同 (supplierId, companyId) 行 → 复合唯一兜底 P2002
        if ((e as { code?: string })?.code === 'P2002') this.err('LINK_PENDING_EXISTS', '已有进行中的加入申请，请等待该公司处理');
        throw e;
      }
    }

    await this.notifyStageApprovers('STAFF', company.id, {
      type: 'SUPPLIER_LINK_PENDING',
      title: '供应商申请加入贵公司（初审）',
      content: `${supplier.name} 申请加入贵公司供应商库，请前往审批。${note ? `申请说明：${note}` : ''}`,
      link: `/supplier?tab=company-links`,
    });
    return { id: linkId };
  }

  // ───────────────────────── 内部：通知（与注册审批同口径） ─────────────────────────

  /** 按级解析审批待办收件人（staff→无则 leader→无则 admin 上浮），与 SupplierService.resolveStageApprovers 同口径 */
  private async notifyStageApprovers(stage: string, companyId: string | null, payload: { type: string; title: string; content: string; link: string }) {
    const pick = async (where: object) => (await this.prisma.user.findMany({ where, select: { id: true } })).map((u) => u.id);
    let ids: string[] = [];
    if (stage === 'STAFF' && companyId) {
      ids = await pick({ role: 'staff', isActive: true, companyId });
      if (ids.length === 0) ids = await pick({ role: 'leader', isActive: true, companyId });
      if (ids.length === 0) ids = await pick({ role: 'admin', isActive: true });
    } else if (stage === 'LEADER' && companyId) {
      ids = await pick({ role: 'leader', isActive: true, companyId });
      if (ids.length === 0) ids = await pick({ role: 'admin', isActive: true });
    } else {
      ids = await pick({ role: 'admin', isActive: true });
    }
    await Promise.allSettled(ids.map((id) => this.notificationService.create({ userId: id, ...payload })));
  }

  // ───────────────────────── 公司侧（仅审批与库内停用——零检索面，用户裁决 2026-10-16） ─────────────────────────

  async listForCompany(actor: AuthenticatedUser, params: { status?: string; reviewStage?: string; companyId?: string } = {}) {
    // admin 可 ?companyId= 切单公司视野（与 :3005 供应商库同款）；非 admin 传参被 resolveScope 自身忽略（防伪造）
    const scope = await this.companyScope.resolveScope(actor, params.companyId);
    const companyIds = scope.all ? null : scope.companyIds;
    const where: any = {};
    if (companyIds) where.companyId = { in: companyIds };
    if (params.status) where.status = params.status;
    if (params.reviewStage) where.reviewStage = params.reviewStage;
    return this.prisma.supplierCompanyLink.findMany({
      where,
      orderBy: { updatedAt: 'asc' },
      include: {
        company: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true, supplierNo: true, creditCode: true, status: true, isTemporary: true } },
      },
    });
  }

  async approveLink(linkId: string, userId: string, reason?: string) {
    const link = await this.prisma.supplierCompanyLink.findUnique({
      where: { id: linkId },
      include: { supplier: { select: { id: true, name: true, userId: true } }, company: { select: { name: true } } },
    });
    if (!link) throw new NotFoundException({ error: '加入关系不存在', code: 'LINK_NOT_FOUND' });
    if (link.status !== 'PENDING' || !link.reviewStage) {
      this.err('INVALID_STATUS', '该申请不在待审状态');
    }
    const stage = link.reviewStage;
    const reviewer = userId ? await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, companyId: true } }) : null;
    await this.assertStageApprover(stage, reviewer, link.companyId);

    const trimmed = (reason ?? '').trim();
    if (stage !== 'ADMIN' && !trimmed) {
      this.err('REVIEW_REASON_REQUIRED', `请填写${SupplierLinkService.STAGE_LABELS[stage]}的同意缘由（后级审批人将据此复核）`);
    }

    if (stage === 'ADMIN') {
      const claimed = await this.prisma.supplierCompanyLink.updateMany({
        where: { id: linkId, status: 'PENDING', reviewStage: stage },
        data: { status: 'APPROVED', reviewStage: null, rejectReason: null, reviewedById: userId ?? null, reviewedAt: new Date() },
      });
      if (claimed.count === 0) throw new ConflictException({ error: '申请状态已变更，请刷新后重试', code: 'CONFLICT' });
      if (userId) await this.audit(userId, 'SUPPLIER_LINK_APPROVED', linkId, { supplierId: link.supplierId, companyId: link.companyId, stage });
      await this.notificationService.create({
        userId: link.supplier.userId,
        type: 'SUPPLIER_LINK_APPROVED',
        title: `已加入 ${link.company.name} 供应商库`,
        content: `贵司加入 ${link.company.name} 的申请已通过三级审核，正式入库。`,
        link: `/profile/company-links`,
      });
      return { success: true as const, stage: 'DONE' as const };
    }

    const nextStage = stage === 'STAFF' ? 'LEADER' : 'ADMIN';
    const claimed = await this.prisma.supplierCompanyLink.updateMany({
      where: { id: linkId, status: 'PENDING', reviewStage: stage },
      data: { reviewStage: nextStage },
    });
    if (claimed.count === 0) throw new ConflictException({ error: '申请状态已变更，请刷新后重试', code: 'CONFLICT' });
    if (userId) await this.audit(userId, `SUPPLIER_LINK_PASSED_${stage}`, linkId, { supplierId: link.supplierId, companyId: link.companyId, fromStage: stage, nextStage, reason: trimmed });
    await this.notifyStageApprovers(nextStage, link.companyId, {
      type: 'SUPPLIER_LINK_PENDING',
      title: `供应商加入申请待${SupplierLinkService.STAGE_LABELS[nextStage]}`,
      content: `${link.supplier.name} 申请加入贵公司，已通过${SupplierLinkService.STAGE_LABELS[stage]}（缘由：${trimmed}），请前往审批。`,
      link: `/supplier?tab=company-links`,
    });
    return { success: true as const, stage: nextStage };
  }

  async rejectLink(linkId: string, userId: string, reason: string) {
    const link = await this.prisma.supplierCompanyLink.findUnique({
      where: { id: linkId },
      include: { supplier: { select: { userId: true, name: true } }, company: { select: { name: true } } },
    });
    if (!link) throw new NotFoundException({ error: '加入关系不存在', code: 'LINK_NOT_FOUND' });
    if (link.status !== 'PENDING' || !link.reviewStage) this.err('INVALID_STATUS', '该申请不在待审状态');
    const trimmed = reason.trim();
    if (!trimmed) this.err('REASON_REQUIRED', '驳回必须填写原因');
    const reviewer = userId ? await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, companyId: true } }) : null;
    await this.assertStageApprover(link.reviewStage, reviewer, link.companyId);
    const claimed = await this.prisma.supplierCompanyLink.updateMany({
      where: { id: linkId, status: 'PENDING', reviewStage: link.reviewStage },
      data: { status: 'REJECTED', rejectReason: trimmed, reviewedById: userId ?? null, reviewedAt: new Date() },
    });
    if (claimed.count === 0) throw new ConflictException({ error: '申请状态已变更，请刷新后重试', code: 'CONFLICT' });
    if (userId) await this.audit(userId, 'SUPPLIER_LINK_REJECTED', linkId, { supplierId: link.supplierId, companyId: link.companyId, stage: link.reviewStage, reason: trimmed });
    await this.notificationService.create({
      userId: link.supplier.userId,
      type: 'SUPPLIER_LINK_REJECTED',
      title: `加入 ${link.company.name} 申请未通过`,
      content: `贵司加入 ${link.company.name} 的申请未通过审核。原因：${trimmed}`,
      link: `/profile/company-links`,
    });
    return { success: true as const };
  }

  async setDisabled(linkId: string, userId: string, disabled: boolean) {
    const link = await this.prisma.supplierCompanyLink.findUnique({ where: { id: linkId } });
    if (!link) throw new NotFoundException({ error: '加入关系不存在', code: 'LINK_NOT_FOUND' });
    const target = disabled ? 'DISABLED' : 'APPROVED';
    const from = disabled ? 'APPROVED' : 'DISABLED';
    if (link.status !== from) this.err('INVALID_STATUS', disabled ? '仅库内（APPROVED）供应商可停用' : '仅已停用（DISABLED）供应商可恢复');
    const claimed = await this.prisma.supplierCompanyLink.updateMany({
      where: { id: linkId, status: from },
      data: { status: target },
    });
    if (claimed.count === 0) throw new ConflictException({ error: '状态已变更，请刷新后重试', code: 'CONFLICT' });
    return { success: true as const };
  }

  /** 三级级权限断言（与 SupplierService.assertStageApprover 同口径；复制避免跨 4k 行服务耦合） */
  private async assertStageApprover(
    stage: string | null,
    reviewer: { id: string; role: string; companyId: string | null } | null,
    linkCompanyId: string | null,
  ): Promise<void> {
    if (!reviewer) return;
    const sameCompany = reviewer.role !== 'admin' && !!linkCompanyId && reviewer.companyId === linkCompanyId;
    const hasRole = async (role: 'staff' | 'leader') => linkCompanyId
      ? (await this.prisma.user.count({ where: { role, isActive: true, companyId: linkCompanyId } })) > 0
      : false;
    if (stage === 'STAFF') {
      if (reviewer.role === 'staff' && sameCompany) return;
      if (reviewer.role === 'leader' && sameCompany && !(await hasRole('staff'))) return;
      if (reviewer.role === 'admin' && !(await hasRole('staff')) && !(await hasRole('leader'))) return;
    } else if (stage === 'LEADER') {
      if (reviewer.role === 'leader' && sameCompany) return;
      if (reviewer.role === 'admin' && !(await hasRole('leader'))) return;
    } else if (stage === 'ADMIN') {
      if (reviewer.role === 'admin') return;
    }
    throw new ForbiddenException({
      error: `当前为${SupplierLinkService.STAGE_LABELS[stage ?? ''] ?? '本级'}，须由该级审批人操作`,
      code: 'REVIEW_STAGE_MISMATCH',
    });
  }
}
