import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { CompanyScopeService } from '../company/company-scope';

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

  /** 只读公司解析（与 SupplierService.findCompanyRef 同口径）：id 优先、名称兜底，查不到 null，不建档 */
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

  // 公司侧（listForCompany/approveLink/rejectLink/setDisabled）见 Task 4 追加
}
