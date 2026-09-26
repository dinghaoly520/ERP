import { Injectable, Logger, Optional } from '@nestjs/common';
import { NOTIFICATION_REGISTRY, NOTIFICATION_REGISTRY_MAP } from '@water-erp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { NotificationGateway, type NotificationPushPayload } from './notification.gateway';
import { EmailChannel } from './channels/email.channel';
import { SmsChannel } from './channels/sms.channel';
import { PhoneChannel } from './channels/phone.channel';
import { shouldDispatch } from './channels/notification-channel.interface';

/** 可操作（待办类）类型集合——五段状态视图的 todo/done 判定依据（注册表派生） */
const ACTIONABLE_TYPES = NOTIFICATION_REGISTRY.filter(s => s.actionable).map(s => s.code);
const READONLY_TYPES = NOTIFICATION_REGISTRY.filter(s => !s.actionable).map(s => s.code);

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  /** 未知类型告警去重（每类型每进程一条，防刷屏） */
  private readonly warnedTypes = new Set<string>();

  /** 注册表校验：未登记类型 warn（2026-09-26 规范化）——不阻断投递，仅暴露漂移。 */
  private assertRegisteredType(type: string) {
    if (!NOTIFICATION_REGISTRY_MAP[type] && !this.warnedTypes.has(type)) {
      this.warnedTypes.add(type);
      this.logger.warn(`未登记的通知类型「${type}」——请补录 packages/shared/src/notification-registry.ts（继续投递）`);
    }
  }

  constructor(
    private prisma: PrismaService,
    private emailChannel: EmailChannel,
    private smsChannel: SmsChannel,
    private phoneChannel: PhoneChannel,
    // 站内信创建后 WS 即时推送（2026-09-22）；@Optional 防 e2e 测试环境无 gateway 时崩溃
    @Optional() private readonly gateway?: NotificationGateway,
  ) {}

  /** WS 实时推送：目标账号所有在线门户页面右下角弹窗（无 gateway/未连接时静默跳过）。 */
  private pushRealtime(userId: string, n: { id: string; type: string; title: string; content: string; link?: string | null; createdAt: Date | string }) {
    try {
      this.gateway?.pushToUser(userId, {
        id: n.id, type: n.type, title: n.title, content: n.content, link: n.link ?? null,
        createdAt: (n.createdAt instanceof Date ? n.createdAt : new Date(n.createdAt)).toISOString(),
      } satisfies NotificationPushPayload);
    } catch { /* 推送失败不影响通知落库 */ }
  }

  /** 写一条投递日志（Track A：多渠道投递可观测性）。失败不阻断主流程。 */
  private async logDelivery(userId: string, notificationId: string | null, channel: string, r: { status: string; error?: string }) {
    await this.prisma.notificationDeliveryLog.create({
      data: { userId, notificationId, channel, status: r.status, error: r.error ?? null },
    }).catch(() => {});
  }

  /** 站内信创建后，按用户联系方式异步分发到 Email/SMS/Phone（失败不阻断主流程）。 */
  private async dispatchExternal(userId: string, notificationId: string, payload: { type: string; title: string; content: string; link?: string | null }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }).catch(() => null);
    const contact = { email: user?.email ?? null, phone: null as string | null };
    const tasks: Promise<unknown>[] = [];
    if (shouldDispatch('email', contact)) {
      tasks.push(
        this.emailChannel.send({ userId, ...contact, ...payload })
          .then(r => this.logDelivery(userId, notificationId, 'email', r)),
      );
    }
    if (shouldDispatch('sms', contact)) {
      tasks.push(
        this.smsChannel.send({ userId, ...contact, ...payload })
          .then(r => this.logDelivery(userId, notificationId, 'sms', r)),
      );
    }
    if (shouldDispatch('phone', contact)) {
      tasks.push(
        this.phoneChannel.send({ userId, ...contact, ...payload })
          .then(r => this.logDelivery(userId, notificationId, 'phone', r)),
      );
    }
    await Promise.allSettled(tasks);
  }

  /** 指定渠道向单个用户发送通知 + 投递。phone 从 ExpertProfile 获取。 */
  async sendToUser(
    userId: string,
    channels: string[],
    payload: { type: string; title: string; content: string; link?: string | null },
  ): Promise<{ userId: string; results: Record<string, string> }> {
    this.assertRegisteredType(payload.type);
    const [user, profile, supplier] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }).catch(() => null),
      this.prisma.expertProfile.findUnique({ where: { userId }, select: { phone: true } }).catch(() => null),
      // #20 供应商无 ExpertProfile，回退取其主联系人电话，否则 sms/phone 恒空投却报 success。
      this.prisma.supplier.findUnique({
        where: { userId },
        select: { contacts: { where: { isPrimary: true }, select: { phone: true }, take: 1 } },
      }).catch(() => null),
    ]);
    const contact = { email: user?.email ?? null, phone: profile?.phone ?? supplier?.contacts?.[0]?.phone ?? null };

    // 站内信
    let notificationId: string | null = null;
    if (channels.includes('in_app')) {
      const n = await this.prisma.notification.create({
        data: { userId, type: payload.type, title: payload.title, content: payload.content, link: payload.link },
      });
      notificationId = n.id;
      this.pushRealtime(userId, n);
      await this.logDelivery(userId, notificationId, 'in_app', { status: 'sent' });
    }

    const results: Record<string, string> = {};
    const tasks: Promise<void>[] = [];

    if (channels.includes('email') && shouldDispatch('email', contact)) {
      tasks.push(
        this.emailChannel.send({ userId, ...contact, ...payload }).then(r => {
          results.email = r.status;
          return this.logDelivery(userId, notificationId, 'email', r);
        }),
      );
    }
    if (channels.includes('sms') && shouldDispatch('sms', contact)) {
      tasks.push(
        this.smsChannel.send({ userId, ...contact, ...payload }).then(r => {
          results.sms = r.status;
          return this.logDelivery(userId, notificationId, 'sms', r);
        }),
      );
    }
    if (channels.includes('phone') && shouldDispatch('phone', contact)) {
      tasks.push(
        this.phoneChannel.send({ userId, ...contact, ...payload }).then(r => {
          results.phone = r.status;
          return this.logDelivery(userId, notificationId, 'phone', r);
        }),
      );
    }

    await Promise.allSettled(tasks);
    if (channels.includes('in_app')) results.in_app = 'sent';
    return { userId, results };
  }

  async create(dto: CreateNotificationDto) {
    this.assertRegisteredType(dto.type);
    const n = await this.prisma.notification.create({
      data: {
        userId: dto.userId,
        type: dto.type,
        title: dto.title,
        content: dto.content,
        link: dto.link,
      },
    });
    // 站内信视为已投递；记录 in_app 投递日志后异步分发外部渠道
    await this.logDelivery(dto.userId, n.id, 'in_app', { status: 'sent' });
    this.pushRealtime(dto.userId, n);
    void this.dispatchExternal(dto.userId, n.id, { type: dto.type, title: dto.title, content: dto.content, link: dto.link });
    return n;
  }

  async sendToRole(role: string, dto: Omit<CreateNotificationDto, 'userId'>) {
    this.assertRegisteredType(dto.type);
    // 获取所有指定角色的用户
    const users = await this.prisma.user.findMany({
      where: { role, isActive: true },
      select: { id: true },
    });

    // 为每个用户创建通知
    const notifications = await Promise.all(
      users.map(user =>
        this.prisma.notification.create({
          data: {
            userId: user.id,
            type: dto.type,
            title: dto.title,
            content: dto.content,
            link: dto.link,
          },
        }),
      ),
    );

    // 多渠道异步分发（失败不阻断）；每条站内信先记 in_app 投递日志
    for (const n of notifications) this.pushRealtime(n.userId, n);
    void Promise.allSettled(
      notifications.map(n =>
        (async () => {
          await this.logDelivery(n.userId, n.id, 'in_app', { status: 'sent' });
          await this.dispatchExternal(n.userId, n.id, { type: dto.type, title: dto.title, content: dto.content, link: dto.link });
        })(),
      ),
    );

    return notifications;
  }

  async list(
    userId: string,
    page: number = 1,
    pageSize: number = 20,
    tab: 'all' | 'todo' | 'done' | 'toread' | 'read' = 'all',
    types: string[] = [],
    countTypes: string[] = [],
  ) {
    const skip = (page - 1) * pageSize;

    const where: any = { userId };
    // 五段状态（2026-09-26）：待办/已办=可操作类型（resolvedAt 分界，已读兜底归已办）；
    // 待阅/已阅=知会类型（isRead 分界）。tab=all 不过滤。
    if (tab === 'todo') {
      where.type = { in: ACTIONABLE_TYPES };
      where.resolvedAt = null;
      where.isRead = false;
    } else if (tab === 'done') {
      where.type = { in: ACTIONABLE_TYPES };
      where.OR = [{ resolvedAt: { not: null } }, { isRead: true }];
    } else if (tab === 'toread') {
      where.type = { in: READONLY_TYPES };
      where.isRead = false;
    } else if (tab === 'read') {
      where.type = { in: READONLY_TYPES };
      where.isRead = true;
    }
    if (types.length > 0) where.type = { in: types };

    // 类型计数基底：与列表同 tab，但不受单类型筛选影响——
    // 使筛选条的类型 chip 在选中任意一个后保持稳定（不随过滤结果消失）
    const countWhere: any = { userId };
    if (tab === 'todo') {
      countWhere.type = { in: ACTIONABLE_TYPES };
      countWhere.resolvedAt = null;
      countWhere.isRead = false;
    }
    if (countTypes.length > 0) countWhere.type = { in: countTypes };

    const [total, items, unreadCount, todoCount, typeGroups] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      // KPI 元信息（2026-09-09）：服务端口径，前端不再用当前页 items 估算
      this.prisma.notification.count({ where: { userId, isRead: false } }),
      this.prisma.notification.count({ where: { userId, isRead: false, resolvedAt: null } }),
      this.prisma.notification.groupBy({
        by: ['type'],
        where: countWhere,
        _count: { type: true },
      }),
    ]);

    const typeCounts = typeGroups
      .map((g) => ({ type: g.type, count: g._count.type }))
      .sort((a, b) => b.count - a.count);

    return { total, page, pageSize, items, unreadCount, todoCount, typeCounts };
  }

  /** 将某 type+link 对应的未 resolve 通知标记为已处理（待办清零）。 */
  async resolveActionable(type: string, link: string) {
    return this.prisma.notification.updateMany({
      where: { type, link, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
  }

  /** 仅完成某个用户的某个精确业务待办，避免同类型通知被批量误处理。 */
  async resolveActionableForUser(userId: string, type: string, link: string) {
    return this.prisma.notification.updateMany({
      where: { userId, type, link, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
  }

  async getUnreadCount(userId: string) {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  async markAsRead(notificationId: string, userId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification || notification.userId !== userId) {
      throw new Error('通知不存在或不属于此用户');
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }
}
