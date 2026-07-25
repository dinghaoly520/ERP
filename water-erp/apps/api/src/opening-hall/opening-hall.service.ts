import { Injectable, Optional, Inject, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BidGateway } from '../bid/bid.gateway';
import { NotificationService } from '../notification/notification.service';
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
    // S4/S5：大厅是纯文本频道（两端均转义渲染：Vue `{{ }}` / React `{}`），与异议原因、澄清等
    // 其他文本字段口径一致——原文落库，不复用公告富文本消毒器（旧实现把 `A & B` 存成 `A &amp; B`、
    // 纯 `<script>` 消毒成空串仍落库）。DTO @IsNotEmpty 只挡空串，纯空白在此拒绝；
    // 码点安全截断（[...str] 按码点迭代）避免切断 emoji 代理对——超长主要由 DTO @MaxLength(2000)
    // （按 UTF-16 码元计）拦截，此处为防御纵深。
    const content = dto.content.trim();
    if (!content) throw new BadRequestException({ error: '消息内容不能为空', code: 'MESSAGE_EMPTY' });
    const clipped = [...content].slice(0, 2000).join('');

    const { project, session } = await this.loadGate(projectId);
    if (project.stage !== 'OPENING') throw new ForbiddenException({ error: '大厅仅在开标阶段开放', code: 'HALL_CLOSED' });
    const control = session?.exchangeControl ?? 'OPEN';
    if (control === 'CLOSED') throw new ForbiddenException({ error: '主持人已关闭互动', code: 'EXCHANGE_CLOSED' });
    const isSupplier = actor.role === 'supplier';
    if (control === 'MUTED' && isSupplier) throw new ForbiddenException({ error: '主持人已开启全员禁言', code: 'EXCHANGE_MUTED' });

    // 授权收口：非供应商角色仅主持人可以 HOST 身份发言（防其他角色冒充主持人留痕）；
    // 供应商须参投本项目（PUBLIC/PRIVATE 均门控，PRIVATE 分支内对主持发送方的目标成员校验保持不变）。
    if (!isSupplier) {
      this.assertHost(actor);
    } else {
      const member = await this.prisma.bidSupplier.findFirst({ where: { projectId, supplierId: actor.supplierId } });
      if (!member) throw new BadRequestException({ error: '您未参与该项目投标', code: 'NOT_PROJECT_MEMBER' });
    }

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
        content: clipped,
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
    if (actor.role !== 'supplier') this.assertHost(actor); // 非供应商仅主持人可读大厅消息（含私聊转录）
    // S6：limit 健壮化——NaN/非有限值（limit=abc / Infinity）回落默认 50，再夹取 [1,100]
    const limit = Number.isFinite(q.limit) ? Math.min(Math.max(Math.trunc(q.limit as number), 1), 100) : 50;
    // S6：cursor 先校验再进 Prisma——非法值 400（旧实现让 Invalid Date 进 SQL → 500）。
    // 复合游标格式 `<createdAt-ISO>|<id>`；无 `|` 的旧格式游标按纯时间处理（cursorId='' →
    // `id < ''` 恒不命中，退化到 createdAt lt 分支，向后兼容）。
    let cursorTime: Date | undefined;
    let cursorId = '';
    if (q.cursor) {
      const sep = q.cursor.indexOf('|');
      const iso = sep < 0 ? q.cursor : q.cursor.slice(0, sep);
      cursorId = sep < 0 ? '' : q.cursor.slice(sep + 1);
      const t = new Date(iso);
      if (isNaN(t.getTime())) throw new BadRequestException({ error: 'cursor 非法', code: 'INVALID_CURSOR' });
      cursorTime = t;
    }
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
        // S6：(createdAt, id) 复合游标翻页——同毫秒多条消息不再被 `createdAt < t` 跳过
        ...(cursorTime ? { OR: [
          { createdAt: { lt: cursorTime } },
          { createdAt: { equals: cursorTime }, id: { lt: cursorId } },
        ] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const last = page[page.length - 1];
    return { items: page.reverse(), nextCursor: hasMore ? `${last.createdAt.toISOString()}|${last.id}` : null };
  }

  private roomKeyFor(roomType: OpeningHallRoomType, supplierId?: string) {
    return roomType === 'PUBLIC' ? 'public' : `supplier:${supplierId}`;
  }

  async unreadCounts(actor: HallActor, projectId: string) {
    if (actor.role !== 'supplier') this.assertHost(actor); // 非供应商仅主持人可读未读分布
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

  async markRead(actor: HallActor, projectId: string, roomKey: string) {
    // S7 归属门：项目必须存在；roomKey 只能落在自己的会话上（防游标表无界增长/写 dangling 项目）
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (actor.role === 'supplier') {
      if (roomKey !== 'public' && roomKey !== `supplier:${actor.supplierId}`) {
        throw new ForbiddenException({ error: '无权操作该会话', code: 'ROOM_KEY_FORBIDDEN' });
      }
    } else if (HOST_ROLES_SET.has(actor.role)) {
      if (roomKey !== 'public') {
        const target = roomKey.slice('supplier:'.length);
        const member = await this.prisma.bidSupplier.findFirst({ where: { projectId, supplierId: target } });
        if (!member) throw new BadRequestException({ error: '会话对象未参与该项目', code: 'NOT_PROJECT_MEMBER' });
      }
    } else {
      this.assertHost(actor); // → 403 HOST_ONLY
    }
    return this.prisma.openingHallReadCursor.upsert({
      where: { projectId_userId_roomKey: { projectId, userId: actor.userId, roomKey } },
      create: { projectId, userId: actor.userId, roomKey, lastReadAt: new Date() },
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
    if (actor.role !== 'supplier') this.assertHost(actor); // 非供应商仅主持人可查完整在场名单
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
