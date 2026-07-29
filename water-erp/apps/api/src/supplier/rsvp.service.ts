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

  /** 校验链接 token，返回展示信息 + 当前回执状态。公开调用，失败抛错由控制器转 400。 */
  async verify(token: string): Promise<RsvpView> {
    const row = await this.prisma.invitationRsvp.findUnique({
      where: { token },
      select: { id: true, status: true, respondedAt: true, expiresAt: true, title: true, summary: true, supplierName: true, projectId: true },
    });
    if (!row) throw new NotFoundException({ error: '回执链接无效或已失效', code: 'RSVP_NOT_FOUND' });
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
    const updated = await this.prisma.invitationRsvp.update({
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
    if (body.status === 'ACCEPTED' && row.projectId) {
      await this.prisma.bidSupplier.upsert({
        where: { projectId_supplierName: { projectId: row.projectId, supplierName: row.supplierName } },
        create: { projectId: row.projectId, supplierId: row.supplierId, supplierName: row.supplierName },
        update: { supplierId: row.supplierId },
      });
    }

    return { success: true, status: updated.status as RsvpStatus, respondedAt: updated.respondedAt!.toISOString(), rsvpNo: updated.id.slice(-8).toUpperCase() };
  }

  /** 采购端回执看板：按项目（或批次）聚合 接受/拒绝/未回复 + 名单。 */
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
    const counts = { ACCEPTED: 0, DECLINED: 0, PENDING: 0 };
    const now = Date.now();
    const items = rows.map(r => {
      const st = r.status as RsvpStatus;
      if (st in counts) counts[st]++;
      return {
        rsvpNo: r.id.slice(-8).toUpperCase(),
        supplierId: r.supplierId, supplierName: r.supplierName, status: st,
        note: r.note, respondedAt: r.respondedAt ? r.respondedAt.toISOString() : null,
        expired: new Date(r.expiresAt).getTime() < now,
      };
    });
    return { total: rows.length, counts, items };
  }
}
