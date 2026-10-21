import { Injectable, BadRequestException, ConflictException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectManagementService } from '../project-management/project-management.service';
import { NotificationService } from '../notification/notification.service';

export type RsvpStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED';
/** 回执作答方：供应商链接自答 | 工作人员代回应 | 系统超时自动弃权（2026-10-21 回执锁定口径） */
export type RsvpActorType = 'SUPPLIER' | 'STAFF' | 'SYSTEM';

/** 回执轨迹条目（list/history 返回给 :3005 展示的精简口径） */
export interface RsvpTrailEntry {
  action: string;
  actorType: RsvpActorType;
  actorName: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  note: string | null;
  createdAt: string;
}

/** 轨迹落账（写侧统一入口——rsvp 任何状态流转都必须留痕，缺失即审计断链） */
async function writeRsvpLog(
  tx: { invitationRsvpLog: { create: (args: any) => Promise<unknown> } },
  data: {
    rsvpId: string; supplierId: string; projectId: string | null;
    action: string; actorType: RsvpActorType; actorId?: string | null; actorName?: string | null;
    fromStatus?: string | null; toStatus?: string | null; reason?: string | null; note?: string | null;
  },
) {
  await tx.invitationRsvpLog.create({
    data: {
      rsvpId: data.rsvpId,
      supplierId: data.supplierId,
      projectId: data.projectId,
      action: data.action,
      actorType: data.actorType,
      actorId: data.actorId ?? null,
      actorName: data.actorName ?? null,
      fromStatus: data.fromStatus ?? null,
      toStatus: data.toStatus ?? null,
      reason: data.reason ?? null,
      note: data.note ?? null,
    },
  }).catch((err: any) => {
    // 轨迹写失败不阻断主流程（回执/代变更优先），但必须暴露在日志里
    Logger.warn(`回执轨迹落账失败 rsvpId=${data.rsvpId} action=${data.action}: ${err?.message ?? err}`, 'RsvpService');
  });
}

/** 链接页/校验返回的展示快照（关键信息 + 供应商名称，全部来自签名 token 解密 + 行状态）。 */
export interface RsvpView {
  supplierName: string;
  title: string;
  summary: Record<string, string>;
  projectId: string | null;
  status: RsvpStatus;
  respondedAt: string | null;
  rsvpNo: string | null;
  expired: boolean;
  expiresAt: string;
}

@Injectable()
export class RsvpService {
  private readonly logger = new Logger(RsvpService.name);
  constructor(
    private prisma: PrismaService,
    private projectManagement: ProjectManagementService,
    private notification: NotificationService,
  ) {}

  private parseSummary(raw: string): Record<string, string> {
    try { const o = JSON.parse(raw); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
  }

  /** 校验链接 token，返回展示信息 + 当前回执状态。公开调用，失败抛错由控制器转 400。
   *  若链接已过期且状态仍为 PENDING，自动标记为 DECLINED（视为自动弃权）。 */
  async verify(token: string): Promise<RsvpView> {
    const row = await this.prisma.invitationRsvp.findUnique({
      where: { token },
      select: { id: true, status: true, respondedAt: true, expiresAt: true, title: true, summary: true, supplierName: true, supplierId: true, projectId: true },
    });
    if (!row) throw new NotFoundException({ error: '回执链接无效或已失效', code: 'RSVP_NOT_FOUND' });
    const expired = new Date(row.expiresAt).getTime() < Date.now();
    // 过期且仍未回执 → 自动标记为弃权（SYSTEM 作答方，与供应商主动拒绝区分展示）。
    // 守卫式条件更新（稳健性深检 GAP-5）：并发双开同一过期链接只有一方 count=1，
    // 轨迹只落一条，不双写
    if (expired && row.status === 'PENDING') {
      const guard = await this.prisma.invitationRsvp.updateMany({
        where: { id: row.id, status: 'PENDING' },
        data: { status: 'DECLINED', respondedAt: new Date(), note: '链接超时（24小时），系统自动视为弃权', respondentType: 'SYSTEM' },
      });
      if (guard.count > 0) {
        await writeRsvpLog(this.prisma, {
          rsvpId: row.id, supplierId: row.supplierId, projectId: row.projectId,
          action: 'AUTO_DECLINED', actorType: 'SYSTEM', toStatus: 'DECLINED',
          note: '链接超时（24小时），系统自动视为弃权',
        });
      }
      row.status = 'DECLINED';
      row.respondedAt = new Date();
    }
    return {
      supplierName: row.supplierName,
      title: row.title,
      summary: this.parseSummary(row.summary),
      projectId: row.projectId,
      status: row.status as RsvpStatus,
      respondedAt: row.respondedAt ? row.respondedAt.toISOString() : null,
      rsvpNo: row.id ? row.id.slice(-8).toUpperCase() : null,
      expired: new Date(row.expiresAt).getTime() < Date.now(),
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  /** 记录回执（幂等：可改主意，覆盖式更新）。接受且带项目 → 确保纳入项目（upsert BidSupplier）。 */
  async respond(token: string, body: { status: RsvpStatus; note?: string; ip?: string; ua?: string }) {
    if (body.status !== 'ACCEPTED' && body.status !== 'DECLINED') {
      throw new BadRequestException({ error: '回执状态非法', code: 'INVALID_RSVP_STATUS' });
    }
    const row = await this.prisma.invitationRsvp.findUnique({ where: { token } });
    if (!row) throw new NotFoundException({ error: '回执链接无效或已失效', code: 'RSVP_NOT_FOUND' });
    if (new Date(row.expiresAt).getTime() < Date.now()) {
      throw new BadRequestException({ error: '回执链接已过期，请联系采购方重新发送邀请', code: 'RSVP_EXPIRED' });
    }
    // 回执一次性锁定（2026-10-21 用户裁定）：确认/拒绝仅可提交一次，不允许供应商自行变更；
    // 采购方如需调整走 manualMark 代回应（必填理由 + 全程留痕）
    if (row.respondedAt) {
      throw new ConflictException({ error: '回执已提交，不可变更。如有疑问请联系采购方工作人员。', code: 'RSVP_ALREADY_RESPONDED' });
    }

    const note = (body.note ?? '').trim().slice(0, 500) || null;
    // 回执落库 + 纳入候选 + 轨迹留痕同事务（此前分散写：状态更新成功而 upsert FK 失败 → 半成功 + 误报「被篡改」）
    const updated = await this.prisma.$transaction(async (tx) => {
      // 原子锁定（稳健性深检 GAP-3）：以「respondedAt 为空」为闸做条件更新——并发双提交
      // 只有一个 count=1 成功，另一个 count=0 → 409；先读后查的窗口不再存在
      const lock = await tx.invitationRsvp.updateMany({
        where: { id: row.id, respondedAt: null },
        data: {
          status: body.status,
          note,
          respondedAt: new Date(),
          respondentType: 'SUPPLIER',
          respondedById: null,
          respondedByName: null,
          staffReason: null,
          responseIp: body.ip?.slice(0, 64) ?? null,
          responseUa: body.ua?.slice(0, 255) ?? null,
        },
      });
      if (lock.count === 0) {
        throw new ConflictException({ error: '回执已提交，不可变更。如有疑问请联系采购方工作人员。', code: 'RSVP_ALREADY_RESPONDED' });
      }
      const r = await tx.invitationRsvp.findUniqueOrThrow({ where: { id: row.id } });
      await writeRsvpLog(tx, {
        rsvpId: row.id, supplierId: row.supplierId, projectId: row.projectId,
        action: 'RESPONDED', actorType: 'SUPPLIER', fromStatus: row.status, toStatus: body.status, note,
      });

      // 接受 + 带项目：确保供应商进入项目候选（已存在则不动其投标进度，仅保证行存在）。
      // 拒绝：仅记录，不自动移出候选名单（由采购方在看板人工处理）——按用户确认的产品决策。
      // projectId 双 id 空间（2026-10-16）：生成端（ai.generateNotificationContent）已把回执行
      // projectId 规范化为 BidProject id；旧轨行可能仍是 PMI id——先按 BidProject 主键解析，
      // 落空再按 projectManagementItemId 反查（两代口径兼容）。旧实现直接拿 PMI id upsert
      // BidSupplier → FK(P2003)；规范化后若漏改，ACCEPTED 永远解析不到项目 → 候选不落、门户不可见。
      // BidProject 尚未懒创建时【事务提交后触发 ensureBidProject】而非仅记录回执——
      // 供应商确认参加后门户「可投标项目/工作台」需立即可见。ensureBidProject 幂等，
      // 且创建时会回填全部已接受回执的候选。
      if (body.status === 'ACCEPTED' && row.projectId) {
        const bp = (await tx.bidProject.findUnique({ where: { id: row.projectId }, select: { id: true } })) ||
          (await tx.bidProject.findFirst({
            where: { projectManagementItemId: row.projectId },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
          }));
        if (bp) {
          await tx.bidSupplier.upsert({
            where: { projectId_supplierName: { projectId: bp.id, supplierName: row.supplierName } },
            create: { projectId: bp.id, supplierId: row.supplierId, supplierName: row.supplierName },
            update: { supplierId: row.supplierId },
          });
        } else {
          // 【事务边界修复】ensureBidProject 使用根 prisma（独立连接），必须在 $transaction 回调
          // 之外调用——在事务内调用会造成：交互式事务 5s 超时导致 RSVP 状态回滚但 BidProject
          // 已提交（半成功态）+ 连接池双倍占用。此处只标记，事务提交后再懒创建（见下方）。
          this.logger.warn(`BidProject 未懒创建（将在事务外补挂）projectId=${row.projectId}`);
        }
      }
      return r;
    });

    // 【事务边界修复】事务提交后，若 ACCEPTED 且 BidProject 尚未懒创建，在此触发
    // （ensureBidProject 幂等，其内部自管事务；创建时自动回填全部已接受回执的候选）
    if (body.status === 'ACCEPTED' && row.projectId) {
      // 同上双 id 空间：主键命中 → 无需懒创建；仅当两查均落空才 ensureBidProject（吃 PMI id）
      const bp = (await this.prisma.bidProject.findUnique({ where: { id: row.projectId }, select: { id: true } })) ||
        (await this.prisma.bidProject.findFirst({
          where: { projectManagementItemId: row.projectId },
          select: { id: true },
        }));
      if (!bp) {
        try {
          await this.projectManagement.ensureBidProject(row.projectId);
        } catch (err: any) {
          this.logger.warn(`RSVP 事务后懒创建 BidProject 失败 pmi=${row.projectId}: ${err?.message ?? err}`);
        }
      }
    }

    // 邀请待办消音（2026-10-14 闭环）：回执即办结——按供应商账号 + SELECTION_NOTIFY +
    // link 含本 token 精确圈定该次邀请的站内通知（重发批次复用同 token 一并消音），
    // 不误伤其他项目邀请；失败不阻断回执结果（消音仅影响待办展示）
    try {
      const supplierUser = await this.prisma.supplier.findUnique({
        where: { id: row.supplierId },
        select: { userId: true },
      });
      await this.notification.resolveByLinkToken(supplierUser?.userId, 'SELECTION_NOTIFY', token);
    } catch (err: any) {
      this.logger.warn(`RSVP 回执后邀请待办消音失败 token=${token}: ${err?.message ?? err}`);
    }

    return { success: true, status: updated.status as RsvpStatus, respondedAt: updated.respondedAt!.toISOString(), rsvpNo: updated.id.slice(-8).toUpperCase() };
  }

  /** 采购端回执看板：按项目（或批次）聚合 接受/拒绝/未回复 + 名单。
   *  过期且未回执的记录自动标记为弃权，与 verify() 行为一致。 */
  async list(params: { projectId?: string; invitationId?: string }) {
    if (!params.projectId && !params.invitationId) {
      throw new BadRequestException({ error: '请提供 projectId 或 invitationId', code: 'MISSING_RSVP_SCOPE' });
    }
    const where: any = {};
    if (params.projectId) where.projectId = params.projectId;
    if (params.invitationId) where.invitationId = params.invitationId;
    const rows = await this.prisma.invitationRsvp.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, supplierId: true, supplierName: true, status: true, note: true,
        respondedAt: true, expiresAt: true, createdAt: true, projectId: true, notifiedAt: true,
        respondentType: true, respondedById: true, respondedByName: true, staffReason: true,
      },
    });
    // 补查供应商标签
    const supplierIds = [...new Set(rows.map(r => r.supplierId).filter(Boolean))];
    const supplierTags = new Map<string, string[]>();
    if (supplierIds.length > 0) {
      const suppliers = await this.prisma.supplier.findMany({
        where: { id: { in: supplierIds } },
        select: { id: true, tags: true },
      });
      for (const s of suppliers) supplierTags.set(s.id, s.tags as string[]);
    }
    const now = Date.now();
    // 批量自动弃权：过期且仍为 PENDING 的行（SYSTEM 作答方 + 轨迹留痕，与 verify() 同口径）。
    // 逐行守卫式更新（稳健性深检 GAP-5）：并发双开看板只有一方 count=1，轨迹不双写
    for (const r of rows) {
      if (new Date(r.expiresAt).getTime() >= now || r.status !== 'PENDING') continue;
      const guard = await this.prisma.invitationRsvp.updateMany({
        where: { id: r.id, status: 'PENDING' },
        data: { status: 'DECLINED', respondedAt: new Date(), note: '链接超时（24小时），系统自动视为弃权', respondentType: 'SYSTEM' },
      });
      if (guard.count > 0) {
        await writeRsvpLog(this.prisma, {
          rsvpId: r.id, supplierId: r.supplierId, projectId: r.projectId,
          action: 'AUTO_DECLINED', actorType: 'SYSTEM', toStatus: 'DECLINED',
          note: '链接超时（24小时），系统自动视为弃权',
        });
        r.status = 'DECLINED';
        r.respondedAt = new Date();
        r.respondentType = 'SYSTEM';
      }
    }

    // 清理重复行：同一 supplierId 只保留一行，确保通知链接与确认页面 rsvpNo 一致
    const bySupplier = new Map<string, typeof rows>();
    for (const r of rows) {
      const arr = bySupplier.get(r.supplierId) || [];
      arr.push(r);
      bySupplier.set(r.supplierId, arr);
    }
    const deleteIds: string[] = [];
    for (const [, group] of bySupplier) {
      if (group.length <= 1) continue;
      // 优先保留已回复的行；若多行已回复保留最新；全 PENDING 则保留最新（createdAt desc 已排）
      const responded = group.filter(r => r.status !== 'PENDING');
      const keep = responded.length > 0
        ? responded.sort((a, b) => (b.respondedAt?.getTime() ?? 0) - (a.respondedAt?.getTime() ?? 0))[0]
        : group[0];
      for (const r of group) {
        if (r.id === keep.id) continue;
        // 若被删行有用户回复而保留行没有，转移回复到保留行（作答方四列一并转移，防「代回应」标注丢失）
        if (r.status !== 'PENDING' && keep.status === 'PENDING') {
          await this.prisma.invitationRsvp.update({
            where: { id: keep.id },
            data: {
              status: r.status, respondedAt: r.respondedAt, note: r.note,
              respondentType: r.respondentType, respondedById: r.respondedById,
              respondedByName: r.respondedByName, staffReason: r.staffReason,
            },
          });
          keep.status = r.status;
          keep.respondedAt = r.respondedAt;
          keep.note = r.note;
        }
        // 轨迹随行迁移（稳健性深检 GAP-1）：InvitationRsvpLog.rsvpId FK 级联删除——
        // 不迁移直接删行会把被删行的全部轨迹（含供应商自答记录）连带抹掉，审计断链
        await this.prisma.invitationRsvpLog.updateMany({
          where: { rsvpId: r.id },
          data: { rsvpId: keep.id },
        }).catch((err: any) => {
          this.logger.warn(`去重时轨迹迁移失败 ${r.id}→${keep.id}: ${err?.message ?? err}`);
        });
        deleteIds.push(r.id);
      }
    }
    if (deleteIds.length > 0) {
      await this.prisma.invitationRsvp.deleteMany({ where: { id: { in: deleteIds } } });
    }
    const cleanRows = deleteIds.length > 0 ? rows.filter(r => !deleteIds.includes(r.id)) : rows;

    // 回执轨迹（2026-10-21）：看板行内可展开时间线——通知发送→自答→代变更→超时弃权
    const trailByRsvp = new Map<string, RsvpTrailEntry[]>();
    if (cleanRows.length > 0) {
      const logs = await this.prisma.invitationRsvpLog.findMany({
        where: { rsvpId: { in: cleanRows.map(r => r.id) } },
        orderBy: { createdAt: 'asc' },
      });
      for (const l of logs) {
        const arr = trailByRsvp.get(l.rsvpId) ?? [];
        arr.push({
          action: l.action, actorType: l.actorType as RsvpActorType, actorName: l.actorName,
          fromStatus: l.fromStatus, toStatus: l.toStatus, reason: l.reason, note: l.note,
          createdAt: l.createdAt.toISOString(),
        });
        trailByRsvp.set(l.rsvpId, arr);
      }
    }

    const counts = { ACCEPTED: 0, DECLINED: 0, PENDING: 0 };
    const items = cleanRows.map(r => {
      const st = r.status as RsvpStatus;
      if (st in counts) counts[st]++;
      return {
        rsvpNo: r.id.slice(-8).toUpperCase(),
        supplierId: r.supplierId, supplierName: r.supplierName, status: st,
        tags: r.supplierId ? (supplierTags.get(r.supplierId) ?? []) : [],
        note: r.note, respondedAt: r.respondedAt ? r.respondedAt.toISOString() : null,
        notifiedAt: r.notifiedAt ? r.notifiedAt.toISOString() : null,
        // 作答方口径（null=存量已回执行，展示层按供应商自答兜底）
        respondentType: (r.respondentType as RsvpActorType | null) ?? (r.respondedAt ? 'SUPPLIER' : null),
        respondedByName: r.respondedByName,
        staffReason: r.staffReason,
        trail: trailByRsvp.get(r.id) ?? [],
        expired: new Date(r.expiresAt).getTime() < now,
      };
    });
    return { total: cleanRows.length, counts, items };
  }

  /**
   * 工作人员代回应/代变更（2026-10-21 重设计，原「手动标记」）：
   * - 供应商未点链接（电话核实等）→ 代确认/代拒绝；
   * - 供应商已回执但采购方需调整（如确认后发现资质不符）→ 代为变更；
   * - 理由必填（≥5 字）且界面展示；每次变更落 InvitationRsvpLog 轨迹；
   * - 「确认参加 → 拒绝」的变更另发 RSVP_OVERRIDDEN 站内信通知供应商本人
   *   （该事件同时进入供应商详情「邀请回执」经历视图的 overrideAfterAccept 统计）。
   * 供应商自答一次性锁定与此不冲突：代回应是采购方留痕的正式渠道。
   */
  async manualMark(params: {
    projectId: string;
    supplierId: string;
    status: 'ACCEPTED' | 'DECLINED';
    actorId: string;
    reason: string;
  }) {
    const { projectId, supplierId, status, actorId } = params;
    if (!projectId || !supplierId || !['ACCEPTED', 'DECLINED'].includes(status)) {
      throw new BadRequestException({ error: '参数不完整或状态非法（代回应仅支持确认/拒绝，不允许重置为待回执）', code: 'BAD_INPUT' });
    }
    const reason = (params.reason ?? '').trim().slice(0, 500);
    if (reason.length < 5) {
      throw new BadRequestException({ error: '请填写代回应理由（至少 5 个字），理由将展示在回执看板', code: 'REASON_REQUIRED' });
    }
    // 操作人快照（回执行冗余存姓名，防后续改名/删号导致轨迹不可读）
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { displayName: true },
    });
    if (!actor) throw new NotFoundException({ error: '操作人账号不存在', code: 'ACTOR_NOT_FOUND' });
    const actorName = actor.displayName || '工作人员';

    // 兼容 PMI / BidProject 两个 id 空间（与邀请通知写入空间保持一致）
    const bp = await this.prisma.bidProject.findFirst({
      where: { projectManagementItemId: projectId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    const spaceIds = Array.from(new Set([projectId, bp?.id].filter(Boolean) as string[]));
    // 选行策略（稳健性深检 GAP-2）：优先作用于「供应商已回执的那条」——重发批次会产生
    // 更新的 PENDING 行，若按「最新行」选，代变更会打到 PENDING 新行而供应商的
    // ACCEPTED 旧行原封不动，同供应商两行状态矛盾。无已回执行才落最新行（代回应场景）。
    const candidates = await this.prisma.invitationRsvp.findMany({
      where: { supplierId, projectId: { in: spaceIds } },
      orderBy: { createdAt: 'desc' },
    });
    const respondedRows = candidates
      .filter(r => r.respondedAt !== null)
      .sort((a, b) => (b.respondedAt!.getTime() ?? 0) - (a.respondedAt!.getTime() ?? 0));
    const row = respondedRows[0] ?? candidates[0];

    // 已是目标状态：幂等返回，不产生新轨迹（重复点击不刷屏）
    if (row && row.status === status) {
      return { id: row.id, status: row.status, changed: false };
    }

    if (row) {
      const from = row.status;
      const updated = await this.prisma.invitationRsvp.update({
        where: { id: row.id },
        data: {
          status, respondedAt: new Date(),
          respondentType: 'STAFF', respondedById: actorId, respondedByName: actorName, staffReason: reason,
        },
        select: { id: true, status: true },
      });
      await writeRsvpLog(this.prisma, {
        rsvpId: row.id, supplierId, projectId: row.projectId,
        action: 'STAFF_MARKED', actorType: 'STAFF', actorId, actorName,
        fromStatus: from, toStatus: status, reason,
      });
      // 关键联动：供应商「确认参加」被改为「拒绝」——通知本人（站内信，失败不阻断）
      if (from === 'ACCEPTED' && status === 'DECLINED') {
        await this.notifyOverride(row, actorName, reason);
      }
      return { id: updated.id, status: updated.status, changed: true };
    }

    // 无回执行（电话核实、链接未送达）→ 补 manual 行，同样完整留痕
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId }, select: { name: true } });
    if (!supplier) throw new NotFoundException({ error: '供应商不存在', code: 'SUPPLIER_NOT_FOUND' });
    const created = await this.prisma.invitationRsvp.create({
      data: {
        token: `manual-${projectId}-${supplierId}`,
        invitationId: `manual-${projectId}`,
        projectId: bp?.id ?? projectId,
        supplierId,
        supplierName: supplier.name,
        title: '工作人员代回应（电话/线下核实）',
        summary: '{}',
        status,
        respondedAt: new Date(),
        respondentType: 'STAFF',
        respondedById: actorId,
        respondedByName: actorName,
        staffReason: reason,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
      select: { id: true, status: true },
    });
    await writeRsvpLog(this.prisma, {
      rsvpId: created.id, supplierId, projectId: bp?.id ?? projectId,
      action: 'STAFF_MARKED', actorType: 'STAFF', actorId, actorName,
      toStatus: status, reason,
    });
    return { id: created.id, status: created.status, changed: true };
  }

  /** 供应商「确认参加」被工作人员改为「拒绝」→ 站内信通知本人（RSVP_OVERRIDDEN） */
  private async notifyOverride(row: { supplierId: string; title: string }, actorName: string, reason: string) {
    try {
      const supplierUser = await this.prisma.supplier.findUnique({
        where: { id: row.supplierId },
        select: { userId: true },
      });
      if (!supplierUser?.userId) return;
      await this.notification.create({
        userId: supplierUser.userId,
        type: 'RSVP_OVERRIDDEN',
        title: '回执状态变更通知',
        content: `您对「${row.title}」的参加回执已被采购方变更：确认参加 → 无法参加。理由：${reason}（操作人：${actorName}）。如有疑问请联系采购中心。`,
      });
    } catch (err: any) {
      this.logger.warn(`RSVP 代变更通知发送失败 supplier=${row.supplierId}: ${err?.message ?? err}`);
    }
  }

  /**
   * 供应商邀请回执经历（供应商详情「邀请回执」tab 数据源，2026-10-21）：
   * 全量回执行 + 轨迹 + 汇总统计。overrideAfterAccept=「确认后被采购方改为拒绝」次数
   * （用户裁定的经历记录口径），另含接受率、超时弃权、被代回应次数等信用观察项。
   */
  async supplierHistory(supplierId: string) {
    if (!supplierId) throw new BadRequestException({ error: 'supplierId 必填', code: 'BAD_INPUT' });
    const [rows, logs] = await Promise.all([
      this.prisma.invitationRsvp.findMany({
        where: { supplierId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, title: true, projectId: true, status: true, note: true, staffReason: true,
          respondentType: true, respondedByName: true, respondedAt: true, notifiedAt: true, createdAt: true, expiresAt: true,
        },
      }),
      this.prisma.invitationRsvpLog.findMany({
        where: { supplierId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, rsvpId: true, action: true, actorType: true, actorName: true, fromStatus: true, toStatus: true, reason: true, note: true, createdAt: true },
      }),
    ]);
    const trailByRsvp = new Map<string, RsvpTrailEntry[]>();
    const chronological = [...logs].reverse(); // 轨迹按时间正序展示
    for (const l of chronological) {
      const arr = trailByRsvp.get(l.rsvpId) ?? [];
      arr.push({
        action: l.action, actorType: l.actorType as RsvpActorType, actorName: l.actorName,
        fromStatus: l.fromStatus, toStatus: l.toStatus, reason: l.reason, note: l.note,
        createdAt: l.createdAt.toISOString(),
      });
      trailByRsvp.set(l.rsvpId, arr);
    }
    const stats = {
      invited: rows.length,
      accepted: rows.filter(r => r.status === 'ACCEPTED').length,
      declined: rows.filter(r => r.status === 'DECLINED').length,
      pending: rows.filter(r => r.status === 'PENDING').length,
      // 接受率 = 确认参加 / 已回执（PENDING 不计分母）
      acceptRate: (() => {
        const responded = rows.filter(r => r.status !== 'PENDING').length;
        return responded > 0 ? ((rows.filter(r => r.status === 'ACCEPTED').length / responded) * 100).toFixed(1) : null;
      })(),
      systemDeclined: rows.filter(r => r.respondentType === 'SYSTEM').length,
      respondedByStaff: rows.filter(r => r.respondentType === 'STAFF').length,
      // 经历警示核心：确认后被工作人员改为拒绝（无论原确认来自自答还是代确认）
      overrideAfterAccept: logs.filter(l => l.action === 'STAFF_MARKED' && l.fromStatus === 'ACCEPTED' && l.toStatus === 'DECLINED').length,
    };
    return {
      supplierId,
      stats,
      items: rows.map(r => ({
        rsvpNo: r.id.slice(-8).toUpperCase(),
        title: r.title,
        projectId: r.projectId,
        status: r.status as RsvpStatus,
        note: r.note,
        staffReason: r.staffReason,
        respondentType: (r.respondentType as RsvpActorType | null) ?? (r.respondedAt ? 'SUPPLIER' : null),
        respondedByName: r.respondedByName,
        respondedAt: r.respondedAt ? r.respondedAt.toISOString() : null,
        notifiedAt: r.notifiedAt ? r.notifiedAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        trail: trailByRsvp.get(r.id) ?? [],
      })),
    };
  }

  /**
   * 邀请通知发送打戳（2026-10-20 用户口径）：时间轴「供应商邀请」= 点击「一键通知」的时刻，
   * 而非 token 签发时刻（进第 3 步自动生成通知内容时就已建行）。仅对 notifiedAt 为空的行写入
   * ——多轮补选后续打戳不覆盖首轮，时间轴取最早 notifiedAt 即首次发送时刻。
   */
  async markNotified(projectId: string, supplierIds: string[], actorId?: string) {
    if (!projectId || supplierIds.length === 0) {
      throw new BadRequestException({ error: 'projectId 与 supplierIds 必填', code: 'BAD_INPUT' });
    }
    // 兼容 PMI / BidProject 两个 id 空间（与 manualMark 同口径，双向都兜）
    const bp = await this.prisma.bidProject.findFirst({
      where: { projectManagementItemId: projectId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    const bpRow = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { projectManagementItemId: true },
    });
    const spaceIds = Array.from(new Set(
      [projectId, bp?.id, bpRow?.projectManagementItemId].filter(Boolean) as string[],
    ));
    // 轨迹首节点（稳健性深检 GAP-4）：打戳同时落 NOTIFIED 轨迹（操作人=点击一键通知的
    // 工作人员；无身份上下文时按 SYSTEM 记）——逐行守卫式更新防并发双写
    let actorName: string | null = null;
    if (actorId) {
      const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { displayName: true } }).catch(() => null);
      actorName = actor?.displayName ?? null;
    }
    let stamped = 0;
    const targets = await this.prisma.invitationRsvp.findMany({
      where: { supplierId: { in: supplierIds }, projectId: { in: spaceIds }, notifiedAt: null },
      select: { id: true, supplierId: true, projectId: true },
    });
    for (const t of targets) {
      const guard = await this.prisma.invitationRsvp.updateMany({
        where: { id: t.id, notifiedAt: null },
        data: { notifiedAt: new Date() },
      });
      if (guard.count > 0) {
        stamped++;
        await writeRsvpLog(this.prisma, {
          rsvpId: t.id, supplierId: t.supplierId, projectId: t.projectId,
          action: 'NOTIFIED', actorType: actorId ? 'STAFF' : 'SYSTEM', actorId: actorId ?? null, actorName,
          toStatus: 'PENDING',
        });
      }
    }
    return { stamped };
  }
}
