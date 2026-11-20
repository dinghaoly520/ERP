import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { CompanyScopeService } from '../company/company-scope';
import type { AuthenticatedUser } from '../auth/auth.types';

/** 供应商多公司归属（2026-10-16 spec）：SupplierCompanyLink 唯一通道=供应商自主申请（三级审批）。
 *  公司侧无任何全系统供应商检索/邀请入口（用户裁决 2026-10-16）。
 *  三级级权限/通知逻辑与 SupplierService 注册审批同口径——原实现为其私有方法，
 *  此处复制同款（约 60 行）避免与 4k 行 SupplierService 强耦合；口径漂移以 spec 为准。
 *  退库轨（2026-11-10）：已在库供应商可申请退出（applyLeave）——同款三级审批（LEAVE_PENDING），
 *  终审通过 → WITHDRAWN（可重新申请加入）；驳回 → 回 APPROVED（仍在库）。
 *  审批期间（LEAVE_PENDING）库内权益暂停：全库消费端均按 APPROVED 过滤，天然排除、零改动。
 *  退光全部归属 → 登录闸拒绝（auth.service SUPPLIER_NO_COMPANY，2026-11-10 用户裁定）。 */
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
    if (existing && existing.status === 'LEAVE_PENDING') this.err('LINK_PENDING_EXISTS', '该公司存在进行中的退库申请，请等待处理完成后再申请加入');
    if (existing && existing.status === 'APPROVED') this.err('ALREADY_IN_COMPANY', '贵司已在该公司的供应商库中');
    if (existing && existing.status === 'DISABLED') this.err('LINK_DISABLED', '贵司已被该公司停用，请联系该公司恢复');
    if (existing) {
      // REJECTED / WITHDRAWN → 原行复用重新走三级（驳回后重申、退库后重新加入）
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
      // linkId=本申请行指针（办结联动消解按 type+link 精确圈定，页面侧仅读 tab、多余参数无感）
      link: `/supplier?tab=company-links&linkId=${linkId}`,
    });
    return { id: linkId };
  }

  /** 申请退库（2026-11-10）：已在库归属申请退出该公司供应商库，走同款三级审批。
   *  行情态：APPROVED → LEAVE_PENDING（审批期间库内权益暂停）→ 终审 WITHDRAWN / 驳回回 APPROVED。
   *  主归属同样可退（退光全部归属由登录闸兜底，用户裁定 2026-11-10）；终审通过时主归属自动改挂
   *  其他在库公司（无则置空）。文字确认（输入「确认退库」）为门户表单闸，此处不重复校验。 */
  async applyLeave(userId: string, dto: { companyId: string; note?: string }) {
    const supplier = await this.requireSupplier(userId);
    if (supplier.isTemporary) this.err('TEMPORARY_NOT_ALLOWED', '临时供应商须先转正，方可办理归属变更');
    if (supplier.status !== 'APPROVED') this.err('SUPPLIER_NOT_APPROVED', '账号当前不在库状态，暂不能申请退库');

    const link = await this.prisma.supplierCompanyLink.findUnique({
      where: { supplierId_companyId: { supplierId: supplier.id, companyId: dto.companyId } },
      include: { company: { select: { id: true, name: true } } },
    });
    if (!link) this.err('LINK_NOT_FOUND', '未找到贵司在该公司的在库归属');
    if (link.status === 'LEAVE_PENDING') this.err('LINK_PENDING_EXISTS', '已有进行中的退库申请，请等待该公司处理');
    if (link.status !== 'APPROVED') this.err('INVALID_STATUS', '仅已在库的归属可申请退库');

    const note = dto.note?.trim() || null;
    const claimed = await this.prisma.supplierCompanyLink.updateMany({
      where: { id: link.id, status: 'APPROVED' },
      data: { status: 'LEAVE_PENDING', reviewStage: 'STAFF', note, rejectReason: null, appliedAt: new Date() },
    });
    if (claimed.count === 0) this.err('INVALID_STATUS', '该归属状态已变更，请刷新后重试');

    await this.notifyStageApprovers('STAFF', link.companyId, {
      type: 'SUPPLIER_LINK_PENDING',
      title: '供应商申请退出贵公司供应商库（初审）',
      content: `${supplier.name} 申请退出贵公司供应商库，请前往审批。${note ? `申请说明：${note}` : ''}`,
      link: `/supplier?tab=company-links&linkId=${link.id}`,
    });
    return { id: link.id };
  }

  // ───────────────────────── 内部：通知（与注册审批同口径） ─────────────────────────

  /** 按级解析审批待办收件人（staff→无则 leader，止于此），与 SupplierService.resolveStageApprovers 同口径
   *  （2026-11-20 裁定：admin 禁代审，不再上浮 admin——发了待办也不能办；在编探测排除冻结账号） */
  private async notifyStageApprovers(stage: string, companyId: string | null, payload: { type: string; title: string; content: string; link: string }) {
    const pick = async (where: object) => (await this.prisma.user.findMany({ where, select: { id: true } })).map((u) => u.id);
    let ids: string[] = [];
    if (stage === 'STAFF' && companyId) {
      ids = await pick({ role: 'staff', isActive: true, isFrozen: false, companyId });
      if (ids.length === 0) ids = await pick({ role: 'leader', isActive: true, isFrozen: false, companyId });
    } else if (stage === 'LEADER' && companyId) {
      ids = await pick({ role: 'leader', isActive: true, isFrozen: false, companyId });
    } else {
      ids = await pick({ role: 'admin', isActive: true });
    }
    await Promise.allSettled(ids.map((id) => this.notificationService.create({ userId: id, ...payload })));
  }

  /** 办结联动消解（2026-11-20 用户实录：同公司两账号都收到加入/退库待办，一人审批后
   *  另一人的待办长期挂着）：本类待办是群发型（同级审批人每人一行），任一人处理后该级
   *  待办即整体过期——此前 approveLink/rejectLink 零消解钩子，他人副本要等每日 sweep
   *  且全库 link 队列清空才走。两轨：
   *  - 新形态（link 带 linkId）：type+link 精确圈定本申请的全部副本，跨收件人一次消解；
   *  - 存量无 id 形态：按「content 前缀=供应商名 + 收件人属目标公司（或 admin 兜底收件）」
   *    先查后改——同名供应商并行申请多家公司时他司收件人不受牵连（updateMany 无法 join，
   *    须显式两步；名称以空格为界，前缀同名「X公司/X公司分公司」不互伤）。 */
  private async resolveLinkPendingTodos(linkId: string, supplierName: string, companyId: string) {
    await this.notificationService
      .resolveActionable('SUPPLIER_LINK_PENDING', `/supplier?tab=company-links&linkId=${linkId}`)
      .catch(() => {});
    try {
      const rows = await this.prisma.notification.findMany({
        where: { type: 'SUPPLIER_LINK_PENDING', link: '/supplier?tab=company-links', resolvedAt: null },
        select: { id: true, userId: true, content: true },
      });
      if (rows.length === 0) return;
      const prefix = `${supplierName} `;
      // 两条件缺一不可：content 前缀锁本供应商的申请，收件人公司域锁本公司副本——
      // in-scope 用户持有的他名申请（前缀不合）与他名公司的同名申请（收件人不合）都保留
      const matched = rows.filter((n) => (n.content ?? '').startsWith(prefix));
      const hitUserIds = [...new Set(matched.map((n) => n.userId))];
      if (hitUserIds.length === 0) return;
      const users = await this.prisma.user.findMany({
        where: { id: { in: hitUserIds } },
        select: { id: true, role: true, companyId: true },
      });
      // 收件人=目标公司审批人；公司无审批账号时曾兜底发全体 admin（notifyStageApprovers 上浮）
      const inScope = new Set(users.filter((u) => u.role === 'admin' || u.companyId === companyId).map((u) => u.id));
      const ids = matched.filter((n) => inScope.has(n.userId)).map((n) => n.id);
      if (ids.length > 0) {
        await this.prisma.notification.updateMany({
          where: { id: { in: ids }, resolvedAt: null },
          data: { resolvedAt: new Date() },
        });
      }
    } catch { /* 消解失败不阻断审批结果（sweep 每日兜底） */ }
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
      include: { supplier: { select: { id: true, name: true, userId: true, companyId: true } }, company: { select: { name: true } } },
    });
    if (!link) throw new NotFoundException({ error: '加入关系不存在', code: 'LINK_NOT_FOUND' });
    if ((link.status !== 'PENDING' && link.status !== 'LEAVE_PENDING') || !link.reviewStage) {
      this.err('INVALID_STATUS', '该申请不在待审状态');
    }
    const isLeave = link.status === 'LEAVE_PENDING';
    const stage = link.reviewStage;
    const reviewer = userId ? await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, companyId: true } }) : null;
    await this.assertStageApprover(stage, reviewer, link.companyId);

    const trimmed = (reason ?? '').trim();
    if (stage !== 'ADMIN' && !trimmed) {
      this.err('REVIEW_REASON_REQUIRED', `请填写${SupplierLinkService.STAGE_LABELS[stage]}的同意缘由（后级审批人将据此复核）`);
    }

    if (stage === 'ADMIN') {
      if (isLeave) {
        // 退库终审：LEAVE_PENDING → WITHDRAWN；若退的是主归属公司，主归属改挂其他在库公司（无则置空）
        const claimed = await this.prisma.supplierCompanyLink.updateMany({
          where: { id: linkId, status: 'LEAVE_PENDING', reviewStage: stage },
          data: { status: 'WITHDRAWN', reviewStage: null, rejectReason: null, reviewedById: userId ?? null, reviewedAt: new Date() },
        });
        if (claimed.count === 0) throw new ConflictException({ error: '申请状态已变更，请刷新后重试', code: 'CONFLICT' });
        if (userId) await this.audit(userId, 'SUPPLIER_LINK_LEAVE_APPROVED', linkId, { supplierId: link.supplierId, companyId: link.companyId, stage });
        await this.resolveLinkPendingTodos(linkId, link.supplier.name, link.companyId);
        if (link.supplier.companyId === link.companyId) {
          const next = await this.prisma.supplierCompanyLink.findFirst({
            where: { supplierId: link.supplierId, status: 'APPROVED', companyId: { not: link.companyId } },
            orderBy: { appliedAt: 'asc' },
            include: { company: { select: { name: true } } },
          });
          await this.prisma.supplier.update({
            where: { id: link.supplierId },
            data: { companyId: next?.companyId ?? null, companyName: next?.company.name ?? null },
          }).catch((err: any) => console.error(`[supplier-link] 主归属改挂失败 supplier=${link.supplierId}`, err?.message ?? err));
        }
        // 退库非入库前置事件，站内信即可（不走短信单点放行清单）
        await this.notificationService.create({
          userId: link.supplier.userId,
          type: 'SUPPLIER_LINK_WITHDRAWN',
          title: `已退出 ${link.company.name} 供应商库`,
          content: `贵司退出 ${link.company.name} 的申请已通过三级审核，退库完成。如需再次加入，可在「公司归属管理」重新申请。`,
          link: `/profile/company-links`,
        });
        return { success: true as const, stage: 'DONE' as const };
      }

      const claimed = await this.prisma.supplierCompanyLink.updateMany({
        where: { id: linkId, status: 'PENDING', reviewStage: stage },
        data: { status: 'APPROVED', reviewStage: null, rejectReason: null, reviewedById: userId ?? null, reviewedAt: new Date() },
      });
      if (claimed.count === 0) throw new ConflictException({ error: '申请状态已变更，请刷新后重试', code: 'CONFLICT' });
      if (userId) await this.audit(userId, 'SUPPLIER_LINK_APPROVED', linkId, { supplierId: link.supplierId, companyId: link.companyId, stage });
      await this.resolveLinkPendingTodos(linkId, link.supplier.name, link.companyId);
      // 入库完成显式短信（2026-11-10 增补）：站内信+短信双通道（11-05 裁定后 create() 不外发短信，
      // 入库结果是供应商参与该公司采购的前置，须及时知晓——收窄清单内单点放行）
      await this.notificationService.sendToUser(link.supplier.userId, ['in_app', 'sms'], {
        type: 'SUPPLIER_LINK_APPROVED',
        title: `已加入 ${link.company.name} 供应商库`,
        content: `贵司加入 ${link.company.name} 的申请已通过三级审核，正式入库。`,
        link: `/profile/company-links`,
      });
      return { success: true as const, stage: 'DONE' as const };
    }

    const nextStage = stage === 'STAFF' ? 'LEADER' : 'ADMIN';
    const claimed = await this.prisma.supplierCompanyLink.updateMany({
      where: { id: linkId, status: link.status, reviewStage: stage },
      data: { reviewStage: nextStage },
    });
    if (claimed.count === 0) throw new ConflictException({ error: '申请状态已变更，请刷新后重试', code: 'CONFLICT' });
    if (userId) await this.audit(userId, `SUPPLIER_LINK_${isLeave ? 'LEAVE_' : ''}PASSED_${stage}`, linkId, { supplierId: link.supplierId, companyId: link.companyId, fromStage: stage, nextStage, reason: trimmed });
    // 先消解本级群发副本（含同公司他人行），再通知下一级——本级待办对全体收件人过期
    await this.resolveLinkPendingTodos(linkId, link.supplier.name, link.companyId);
    await this.notifyStageApprovers(nextStage, link.companyId, {
      type: 'SUPPLIER_LINK_PENDING',
      title: `供应商${isLeave ? '退库' : '加入'}申请待${SupplierLinkService.STAGE_LABELS[nextStage]}`,
      content: `${link.supplier.name} 申请${isLeave ? '退出' : '加入'}贵公司，已通过${SupplierLinkService.STAGE_LABELS[stage]}（缘由：${trimmed}），请前往审批。`,
      link: `/supplier?tab=company-links&linkId=${linkId}`,
    });
    return { success: true as const, stage: nextStage };
  }

  async rejectLink(linkId: string, userId: string, reason: string) {
    const link = await this.prisma.supplierCompanyLink.findUnique({
      where: { id: linkId },
      include: { supplier: { select: { userId: true, name: true } }, company: { select: { name: true } } },
    });
    if (!link) throw new NotFoundException({ error: '加入关系不存在', code: 'LINK_NOT_FOUND' });
    if ((link.status !== 'PENDING' && link.status !== 'LEAVE_PENDING') || !link.reviewStage) this.err('INVALID_STATUS', '该申请不在待审状态');
    const isLeave = link.status === 'LEAVE_PENDING';
    const trimmed = reason.trim();
    if (!trimmed) this.err('REASON_REQUIRED', '驳回必须填写原因');
    const reviewer = userId ? await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, companyId: true } }) : null;
    await this.assertStageApprover(link.reviewStage, reviewer, link.companyId);
    // 退库被驳回 ≠ 移出：状态回 APPROVED（贵司仍在其库中），rejectReason 留痕（门户归属卡提示+可重新申请退库）
    const claimed = await this.prisma.supplierCompanyLink.updateMany({
      where: { id: linkId, status: link.status, reviewStage: link.reviewStage },
      data: isLeave
        ? { status: 'APPROVED', reviewStage: null, rejectReason: trimmed, reviewedById: userId ?? null, reviewedAt: new Date() }
        : { status: 'REJECTED', rejectReason: trimmed, reviewedById: userId ?? null, reviewedAt: new Date() },
    });
    if (claimed.count === 0) throw new ConflictException({ error: '申请状态已变更，请刷新后重试', code: 'CONFLICT' });
    if (userId) await this.audit(userId, isLeave ? 'SUPPLIER_LINK_LEAVE_REJECTED' : 'SUPPLIER_LINK_REJECTED', linkId, { supplierId: link.supplierId, companyId: link.companyId, stage: link.reviewStage, reason: trimmed });
    await this.resolveLinkPendingTodos(linkId, link.supplier.name, link.companyId);
    await this.notificationService.create({
      userId: link.supplier.userId,
      type: 'SUPPLIER_LINK_REJECTED',
      title: isLeave ? `退出 ${link.company.name} 申请未通过` : `加入 ${link.company.name} 申请未通过`,
      content: isLeave
        ? `贵司退出 ${link.company.name} 的申请未通过审核，贵司仍在其供应商库中。原因：${trimmed}`
        : `贵司加入 ${link.company.name} 的申请未通过审核。原因：${trimmed}`,
      link: `/profile/company-links`,
    });
    return { success: true as const };
  }

  /** 库内停用/恢复（公司治理动作，leader）。I1 终审修复（2026-10-19）：
   *  - :id 公司域断言——此前无 actor 视野校验，任意公司 leader 可停用/恢复他司 link（越权写）。
   *    非 admin 须本公司 link（resolveScope → assertInScope，同邀请码作废/其余 :id 变更口径）；admin 全视野放行。
   *  - 审计留痕 SUPPLIER_LINK_DISABLED/ENABLED（audit 内部 catch 隔离，失败不阻断业务）；
   *  - 停用通知供应商（软移出影响其参与本公司业务，须被动知晓）；恢复不通知（供应商 myLinks 自见状态）。 */
  async setDisabled(linkId: string, actor: AuthenticatedUser, disabled: boolean) {
    const userId = actor.sub;
    const link = await this.prisma.supplierCompanyLink.findUnique({
      where: { id: linkId },
      include: { supplier: { select: { userId: true, name: true } }, company: { select: { name: true } } },
    });
    if (!link) throw new NotFoundException({ error: '加入关系不存在', code: 'LINK_NOT_FOUND' });
    const scope = await this.companyScope.resolveScope(actor);
    this.companyScope.assertInScope(link.companyId, scope); // 跨公司 → 403 COMPANY_SCOPE_FORBIDDEN（admin scope.all 放行）
    const target = disabled ? 'DISABLED' : 'APPROVED';
    const from = disabled ? 'APPROVED' : 'DISABLED';
    if (link.status !== from) this.err('INVALID_STATUS', disabled ? '仅库内（APPROVED）供应商可停用' : '仅已停用（DISABLED）供应商可恢复');
    const claimed = await this.prisma.supplierCompanyLink.updateMany({
      where: { id: linkId, status: from },
      data: { status: target },
    });
    if (claimed.count === 0) throw new ConflictException({ error: '状态已变更，请刷新后重试', code: 'CONFLICT' });
    if (userId) {
      await this.audit(userId, disabled ? 'SUPPLIER_LINK_DISABLED' : 'SUPPLIER_LINK_ENABLED', linkId, {
        supplierId: link.supplierId, companyId: link.companyId, from, to: target,
      });
    }
    if (disabled) {
      await this.notificationService.create({
        userId: link.supplier.userId,
        type: 'SUPPLIER_LINK_DISABLED',
        title: `已被 ${link.company.name} 停用`,
        content: `贵司已被 ${link.company.name} 在其供应商库内停用（软移出，不影响贵司在其他公司的库内状态）。如需恢复，请联系该公司采购管理部门。`,
        link: `/profile/company-links`,
      }).catch((err: any) => console.error(`[notify] SUPPLIER_LINK_DISABLED 发送失败 link=${linkId}`, err?.message ?? err));
    }
    return { success: true as const };
  }

  /** 三级级权限断言（与 SupplierService.assertStageApprover 同口径；复制避免跨 4k 行服务耦合）。
   *  2026-11-20 裁定：admin 禁代审（link.companyId 必填外键，无孤儿分支）——STAFF=同公司 staff
   *  （无 staff 时同公司 leader 代初审），LEADER=同公司 leader，ADMIN=admin。在编探测排除冻结账号。 */
  private async assertStageApprover(
    stage: string | null,
    reviewer: { id: string; role: string; companyId: string | null } | null,
    linkCompanyId: string | null,
  ): Promise<void> {
    if (!reviewer) return;
    const sameCompany = reviewer.role !== 'admin' && !!linkCompanyId && reviewer.companyId === linkCompanyId;
    const hasRole = async (role: 'staff' | 'leader') => linkCompanyId
      ? (await this.prisma.user.count({ where: { role, isActive: true, isFrozen: false, companyId: linkCompanyId } })) > 0
      : false;
    if (stage === 'STAFF') {
      if (reviewer.role === 'staff' && sameCompany) return;
      if (reviewer.role === 'leader' && sameCompany && !(await hasRole('staff'))) return;
    } else if (stage === 'LEADER') {
      if (reviewer.role === 'leader' && sameCompany) return;
    } else if (stage === 'ADMIN') {
      if (reviewer.role === 'admin') return;
    }
    throw new ForbiddenException({
      error: `当前为${SupplierLinkService.STAGE_LABELS[stage ?? ''] ?? '本级'}，须由该级审批人操作`,
      code: 'REVIEW_STAGE_MISMATCH',
    });
  }
}
