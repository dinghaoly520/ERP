import { Injectable, Optional, Inject, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BidGateway } from '../bid/bid.gateway';
import { NotificationService } from '../notification/notification.service';
import { sanitizeHtmlContent } from '../common/html-sanitize.util';
import type { OpeningHallRoomType, OpeningHallSenderRole, HallMessagePayload } from '@water-erp/shared';

export const HOST_ROLES_SET = new Set(['admin', 'bid_host', 'leader', 'staff']);

export interface HallActor {
  userId: string;
  role: string;
  supplierId?: string;   // Supplier.id（supplier 角色必有）
  supplierName?: string;
}

@Injectable()
export class OpeningHallService {
  constructor(
    private readonly prisma: PrismaService,
    // 联合类型 `BidGateway | undefined` 会让 TS 发射 Object 作 paramtype，
    // 必须用 @Inject(BidGateway) 固定 token，否则 @Optional 静默注入 undefined。
    @Optional() @Inject(BidGateway) private readonly gateway: BidGateway | undefined,
    private readonly notification: NotificationService,
  ) {}

  private assertHost(actor: HallActor) {
    if (!HOST_ROLES_SET.has(actor.role)) throw new ForbiddenException({ error: '仅主持人可执行此操作', code: 'HOST_ONLY' });
  }

  private async loadGate(projectId: string) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    const session = await this.prisma.bidOpeningSession.findUnique({ where: { projectId } });
    return { project, session };
  }

  async sendMessage(actor: HallActor, projectId: string, dto: { roomType: OpeningHallRoomType; supplierId?: string; content: string }) {
    const { project, session } = await this.loadGate(projectId);
    if (project.stage !== 'OPENING') throw new ForbiddenException({ error: '大厅仅在开标阶段开放', code: 'HALL_CLOSED' });
    const control = session?.exchangeControl ?? 'OPEN';
    if (control === 'CLOSED') throw new ForbiddenException({ error: '主持人已关闭互动', code: 'EXCHANGE_CLOSED' });
    const isSupplier = actor.role === 'supplier';
    if (control === 'MUTED' && isSupplier) throw new ForbiddenException({ error: '主持人已开启全员禁言', code: 'EXCHANGE_MUTED' });

    let supplierId: string | null = null;
    let supplierName: string | null = null;
    if (dto.roomType === 'PRIVATE') {
      if (!dto.supplierId) throw new BadRequestException({ error: '私聊须指定 supplierId', code: 'MISSING_SUPPLIER' });
      if (isSupplier && dto.supplierId !== actor.supplierId) {
        throw new ForbiddenException({ error: '只能在自己的私聊会话发言', code: 'PRIVATE_ROOM_MISMATCH' });
      }
      const member = await this.prisma.bidSupplier.findFirst({ where: { projectId, supplierId: dto.supplierId } });
      if (!member) throw new BadRequestException({ error: '对方未参与本项目', code: 'NOT_PROJECT_MEMBER' });
      supplierId = dto.supplierId;
      supplierName = member.supplierName;
    }

    const senderRole: OpeningHallSenderRole = isSupplier ? 'SUPPLIER' : 'HOST';
    const senderName = isSupplier ? (actor.supplierName ?? '供应商') : (actor.supplierName ?? actor.userId);
    // 注：OpeningHallMessage 模型无 supplierName 列（供应商名走 BidSupplier 快照，不在消息行冗余）；
    // supplierName 仅用于下方 WS payload。
    const msg = await this.prisma.openingHallMessage.create({
      data: {
        projectId, roomType: dto.roomType, supplierId,
        senderId: actor.userId, senderRole, senderName,
        content: sanitizeHtmlContent(dto.content).slice(0, 2000),
      },
    });

    const payload: HallMessagePayload = {
      id: msg.id, projectId, roomType: msg.roomType,
      supplierId: msg.supplierId, supplierName,
      senderId: msg.senderId, senderRole: msg.senderRole, senderName: msg.senderName,
      content: msg.content, createdAt: msg.createdAt.toISOString(), timestamp: Date.now(),
    };
    this.gateway?.notifyHallMessage(projectId, payload);

    // 主持人私聊回复且供应商离线 → 站内信兜底
    if (dto.roomType === 'PRIVATE' && !isSupplier && supplierId) {
      const online = this.gateway?.getOnlineSupplierIds(projectId) ?? new Set<string>();
      if (!online.has(supplierId)) {
        const supplierUser = await this.prisma.supplier.findFirst({ where: { id: supplierId }, select: { userId: true, name: true } });
        if (supplierUser?.userId) {
          await this.notification.create({
            userId: supplierUser.userId, type: 'HALL_MESSAGE',
            title: '开标大厅：主持人回复', content: msg.content.slice(0, 100),
            link: `/my-bids/${projectId}/opening-hall`,
          }).catch(() => {});
        }
      }
    }
    return msg;
  }

  async listMessages(actor: HallActor, projectId: string, q: { roomType: OpeningHallRoomType; supplierId?: string; cursor?: string; limit?: number }) {
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 100);
    if (q.roomType === 'PRIVATE') {
      if (actor.role === 'supplier' && q.supplierId !== actor.supplierId) {
        throw new ForbiddenException({ error: '只能查看自己的私聊', code: 'PRIVATE_ROOM_MISMATCH' });
      }
      if (!q.supplierId) throw new BadRequestException({ error: '私聊查询须指定 supplierId', code: 'MISSING_SUPPLIER' });
    }
    const items = await this.prisma.openingHallMessage.findMany({
      where: {
        projectId, roomType: q.roomType,
        ...(q.roomType === 'PRIVATE' ? { supplierId: q.supplierId } : {}),
        ...(q.cursor ? { createdAt: { lt: new Date(q.cursor) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return { items: page.reverse(), nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null };
  }

  private roomKeyFor(roomType: OpeningHallRoomType, supplierId?: string) {
    return roomType === 'PUBLIC' ? 'public' : `supplier:${supplierId}`;
  }

  async unreadCounts(actor: HallActor, projectId: string) {
    const countSince = async (roomKey: string, where: any) => {
      const cursor = await this.prisma.openingHallReadCursor.findUnique({
        where: { projectId_userId_roomKey: { projectId, userId: actor.userId, roomKey } },
      });
      return this.prisma.openingHallMessage.count({
        where: { ...where, ...(cursor ? { createdAt: { gt: cursor.lastReadAt } } : {}) },
      });
    };
    const publicUnread = await countSince('public', { projectId, roomType: 'PUBLIC' });
    if (actor.role === 'supplier') {
      const privateUnread = await countSince(`supplier:${actor.supplierId}`, { projectId, roomType: 'PRIVATE', supplierId: actor.supplierId });
      return { public: publicUnread, private: privateUnread, sessions: [] as any[] };
    }
    // 主持端：按供应商分组统计私聊未读
    const members = await this.prisma.bidSupplier.findMany({
      where: { projectId, supplierId: { not: null } },
      select: { supplierId: true, supplierName: true, checkInAt: true },
    });
    const sessions: Array<{ supplierId: string; supplierName: string; checkInAt: Date | null; unread: number }> = [];
    for (const m of members) {
      if (!m.supplierId) continue;
      const n = await countSince(`supplier:${m.supplierId}`, { projectId, roomType: 'PRIVATE', supplierId: m.supplierId });
      sessions.push({ supplierId: m.supplierId, supplierName: m.supplierName, checkInAt: m.checkInAt, unread: n });
    }
    return { public: publicUnread, private: sessions.reduce((s, x) => s + x.unread, 0), sessions };
  }

  async markRead(projectId: string, userId: string, roomKey: string) {
    return this.prisma.openingHallReadCursor.upsert({
      where: { projectId_userId_roomKey: { projectId, userId, roomKey } },
      create: { projectId, userId, roomKey, lastReadAt: new Date() },
      update: { lastReadAt: new Date() },
    });
  }

  async checkIn(actor: HallActor, projectId: string, meta: { ip?: string; ua?: string }) {
    if (actor.role !== 'supplier' || !actor.supplierId) throw new ForbiddenException({ error: '仅供应商可签到', code: 'SUPPLIER_ONLY' });
    const { project } = await this.loadGate(projectId);
    if (project.stage !== 'OPENING') throw new ForbiddenException({ error: '大厅仅在开标阶段开放', code: 'HALL_CLOSED' });
    const member = await this.prisma.bidSupplier.findFirst({ where: { projectId, supplierId: actor.supplierId } });
    if (!member) throw new BadRequestException({ error: '您未参与该项目投标', code: 'NOT_PROJECT_MEMBER' });
    if (member.checkInAt) return { checkInAt: member.checkInAt, already: true };

    const now = new Date();
    await this.prisma.bidSupplier.update({
      where: { id: member.id },
      data: { checkInAt: now, checkInMeta: JSON.stringify(meta) },
    });
    await this.prisma.bidSupervisionLog.create({
      data: {
        projectId, time: now, role: '供应商', target: member.supplierName,
        action: '在线签到', result: '供应商进入开标大厅并签到', riskFlag: '无',
      },
    });
    this.gateway?.notifyHallCheckin(projectId, {
      projectId, supplierId: actor.supplierId, supplierName: member.supplierName,
      checkInAt: now.toISOString(), timestamp: Date.now(),
    });
    this.gateway?.broadcastHallPresence(projectId)?.catch(() => {});
    return { checkInAt: now, already: false };
  }

  async presence(projectId: string, actor: HallActor) {
    const online = this.gateway?.getOnlineSupplierIds(projectId) ?? new Set<string>();
    const rows = await this.prisma.bidSupplier.findMany({
      where: { projectId, supplierId: { not: null } },
      select: { supplierId: true, supplierName: true, checkInAt: true, lastSeenAt: true },
    });
    const list = rows.map(r => ({
      supplierId: r.supplierId as string, supplierName: r.supplierName,
      checkInAt: r.checkInAt, online: online.has(r.supplierId as string),
    }));
    if (actor.role === 'supplier') {
      return { onlineCount: list.filter(x => x.online).length };
    }
    return { suppliers: list, onlineCount: list.filter(x => x.online).length };
  }

  async setExchangeControl(projectId: string, control: 'OPEN' | 'MUTED' | 'CLOSED', byName: string) {
    await this.prisma.bidOpeningSession.update({ where: { projectId }, data: { exchangeControl: control } });
    await this.prisma.bidSupervisionLog.create({
      data: {
        projectId, time: new Date(), role: '开标主持人', target: '开标大厅',
        action: '切换交流控制', result: control, riskFlag: '无',
      },
    });
    this.gateway?.notifyExchangeControl(projectId, { projectId, control, by: byName, timestamp: Date.now() });
    return { exchangeControl: control };
  }
}
