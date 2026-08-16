import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { verifyRsvpToken } from './rsvp-token.util';

export type RsvpStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED';

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
  constructor(private prisma: PrismaService) {}

  private parseSummary(raw: string): Record<string, string> {
    try { const o = JSON.parse(raw); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
  }

  /** 校验链接 token，返回展示信息 + 当前回执状态。公开调用，失败抛错由控制器转 400。
   *  若链接已过期且状态仍为 PENDING，自动标记为 DECLINED（视为自动弃权）。 */
  async verify(token: string): Promise<RsvpView> {
    const row = await this.prisma.invitationRsvp.findUnique({
      where: { token },
      select: { id: true, status: true, respondedAt: true, expiresAt: true, title: true, summary: true, supplierName: true, projectId: true },
    });
    if (!row) throw new NotFoundException({ error: '回执链接无效或已失效', code: 'RSVP_NOT_FOUND' });
    const expired = new Date(row.expiresAt).getTime() < Date.now();
    // 过期且仍未回执 → 自动标记为弃权
    if (expired && row.status === 'PENDING') {
      await this.prisma.invitationRsvp.update({
        where: { id: row.id },
        data: { status: 'DECLINED', respondedAt: new Date(), note: '链接超时（24小时），系统自动视为弃权' },
      });
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

    const note = (body.note ?? '').trim().slice(0, 500) || null;
    // P0-1：回执落库 + 纳入候选同事务（此前分散写：状态更新成功而 upsert FK 失败 → 半成功 + 误报「被篡改」）
    const updated = await this.prisma.$transaction(async (tx) => {
      const r = await tx.invitationRsvp.update({
        where: { id: row.id },
        data: {
          status: body.status,
          note,
          respondedAt: new Date(),
          responseIp: body.ip?.slice(0, 64) ?? null,
          responseUa: body.ua?.slice(0, 255) ?? null,
        },
      });

      // 接受 + 带项目：确保供应商进入项目候选（已存在则不动其投标进度，仅保证行存在）。
      // 拒绝：仅记录，不自动移出候选名单（由采购方在看板人工处理）——按用户确认的产品决策。
      // P0-1：rsvp.projectId 是邀请页写入的 ProjectManagementItem id（非 BidProject id），
      // 旧实现直接拿去 upsert BidSupplier → FK(P2003)。须先解析真实 BidProject；
      // 尚未懒创建（ensureBidProject 未跑）时仅记录回执，候选行由后续流程补挂。
      if (body.status === 'ACCEPTED' && row.projectId) {
        const bp = await tx.bidProject.findFirst({
          where: { projectManagementItemId: row.projectId },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        if (bp) {
          await tx.bidSupplier.upsert({
            where: { projectId_supplierName: { projectId: bp.id, supplierName: row.supplierName } },
            create: { projectId: bp.id, supplierId: row.supplierId, supplierName: row.supplierName },
            update: { supplierId: row.supplierId },
          });
        }
      }
      return r;
    });

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
      select: { id: true, supplierId: true, supplierName: true, status: true, note: true, respondedAt: true, expiresAt: true, createdAt: true },
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
    // 批量自动弃权：过期且仍为 PENDING 的行
    const expiredIds = rows.filter(r => new Date(r.expiresAt).getTime() < now && r.status === 'PENDING').map(r => r.id);
    if (expiredIds.length > 0) {
      await this.prisma.invitationRsvp.updateMany({
        where: { id: { in: expiredIds } },
        data: { status: 'DECLINED', respondedAt: new Date(), note: '链接超时（24小时），系统自动视为弃权' },
      });
      for (const r of rows) {
        if (expiredIds.includes(r.id)) { r.status = 'DECLINED'; r.respondedAt = new Date(); }
      }
    }

    // ── 清理重复行：同一 supplierId 只保留一行，确保通知链接与确认页面 rsvpNo 一致 ──
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
        // 若被删行有用户回复而保留行没有，转移回复到保留行
        if (r.status !== 'PENDING' && keep.status === 'PENDING') {
          await this.prisma.invitationRsvp.update({
            where: { id: keep.id },
            data: { status: r.status, respondedAt: r.respondedAt, note: r.note },
          });
          keep.status = r.status;
          keep.respondedAt = r.respondedAt;
          keep.note = r.note;
        }
        deleteIds.push(r.id);
      }
    }
    if (deleteIds.length > 0) {
      await this.prisma.invitationRsvp.deleteMany({ where: { id: { in: deleteIds } } });
    }
    const cleanRows = deleteIds.length > 0 ? rows.filter(r => !deleteIds.includes(r.id)) : rows;

    const counts = { ACCEPTED: 0, DECLINED: 0, PENDING: 0 };
    const items = cleanRows.map(r => {
      const st = r.status as RsvpStatus;
      if (st in counts) counts[st]++;
      return {
        rsvpNo: r.id.slice(-8).toUpperCase(),
        supplierId: r.supplierId, supplierName: r.supplierName, status: st,
        tags: r.supplierId ? (supplierTags.get(r.supplierId) ?? []) : [],
        note: r.note, respondedAt: r.respondedAt ? r.respondedAt.toISOString() : null,
        expired: new Date(r.expiresAt).getTime() < now,
      };
    });
    return { total: cleanRows.length, counts, items };
  }
}
