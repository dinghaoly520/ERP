import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { EmailChannel } from './channels/email.channel';
import { SmsChannel } from './channels/sms.channel';
import { shouldDispatch } from './channels/notification-channel.interface';

@Injectable()
export class NotificationService {
  constructor(
    private prisma: PrismaService,
    private emailChannel: EmailChannel,
    private smsChannel: SmsChannel,
  ) {}

  /** 写一条投递日志（Track A：多渠道投递可观测性）。失败不阻断主流程。 */
  private async logDelivery(userId: string, notificationId: string | null, channel: string, r: { status: string; error?: string }) {
    await this.prisma.notificationDeliveryLog.create({
      data: { userId, notificationId, channel, status: r.status, error: r.error ?? null },
    }).catch(() => {});
  }

  /** 站内信创建后，按用户联系方式异步分发到 Email/SMS（失败不阻断主流程）。 */
  private async dispatchExternal(userId: string, notificationId: string, payload: { type: string; title: string; content: string; link?: string | null }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }).catch(() => null);
    // User 当前无 phone 字段，sms 渠道恒 skip（待加 User.phone 后生效）
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
    await Promise.allSettled(tasks);
  }

  async create(dto: CreateNotificationDto) {
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
    void this.dispatchExternal(dto.userId, n.id, { type: dto.type, title: dto.title, content: dto.content, link: dto.link });
    return n;
  }

  async sendToRole(role: string, dto: Omit<CreateNotificationDto, 'userId'>) {
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

  async list(userId: string, page: number = 1, pageSize: number = 20, tab: 'all' | 'todo' = 'all') {
    const skip = (page - 1) * pageSize;

    const where: any = { userId };
    if (tab === 'todo') {
      // 「待办」= 未 resolve 的通知（actionable 与否由前端 META 判定，后端仅按 resolvedAt 过滤）
      where.resolvedAt = null;
    }

    const [total, items] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return { total, page, pageSize, items };
  }

  /** 将某 type+link 对应的未 resolve 通知标记为已处理（待办清零）。 */
  async resolveActionable(type: string, link: string) {
    return this.prisma.notification.updateMany({
      where: { type, link, resolvedAt: null },
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
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }
}
