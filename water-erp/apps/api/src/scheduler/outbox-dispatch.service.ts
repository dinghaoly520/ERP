/* =================================================================
   outbox-dispatch.service — Outbox 消费者（阶段2.5 T6）
   Cron 薄壳 + dispatchOnce 公共入口（测试直调）：
   findMany PENDING take20 → 逐条 CAS 抢占（PENDING→DISPATCHING）→
   topic registry 分发 → SENT（publishedAt）/ attempts+1 退避（≥5 FAILED）。
   幂等：CAS 抢占保证同事件单消费者；通知侧以状态 CAS 为准。
   ================================================================= */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

const MAX_ATTEMPTS = 5;

@Injectable()
export class OutboxDispatchService {
  private readonly logger = new Logger(OutboxDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async cronDispatch(): Promise<void> {
    await this.dispatchOnce().catch((e) => this.logger.warn(`outbox dispatch 轮询失败: ${(e as Error).message}`));
  }

  async dispatchOnce(): Promise<{ sent: number; failed: number; skipped: number }> {
    const sent = 0, failed = 0, skipped = 0;
    const result = { sent, failed, skipped };
    const pending = await this.prisma.outbox.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    for (const row of pending) {
      // CAS 抢占（PENDING→DISPATCHING）——并发第二笔 count=0 跳过
      const claim = await this.prisma.outbox.updateMany({
        where: { id: row.id, status: 'PENDING' },
        data: { status: 'DISPATCHING' },
      });
      if (claim.count === 0) continue;
      try {
        const outcome = await this.dispatchTopic(row.topic, row.payload as Record<string, unknown>);
        await this.prisma.outbox.updateMany({
          where: { id: row.id, status: 'DISPATCHING' },
          data: { status: 'SENT', publishedAt: new Date(), lastError: outcome.skipped ? `skipped: ${outcome.skipped}` : null },
        });
        if (outcome.skipped) result.skipped++; else result.sent++;
      } catch (e) {
        const attempts = row.attempts + 1;
        // 永久性错误（no handler——重试无意义）立即封顶；瞬时错误走退避
        const permanent = (e as Error).message.includes('no handler');
        const terminal = permanent || attempts >= MAX_ATTEMPTS;
        await this.prisma.outbox.updateMany({
          where: { id: row.id, status: 'DISPATCHING' },
          data: terminal
            ? { status: 'FAILED', attempts, lastError: (e as Error).message.slice(0, 500) }
            : { status: 'PENDING', attempts },
        });
        result.failed++;
        this.logger.warn(`outbox ${row.id} 派发失败（第 ${attempts} 次${terminal ? '，封顶 FAILED' : ''}）: ${(e as Error).message}`);
      }
    }
    return result;
  }

  /** topic registry——新 topic 在此登记 handler */
  private async dispatchTopic(topic: string, payload: Record<string, unknown>): Promise<{ skipped?: string }> {
    if (topic === 'bid.submitted.v3') {
      const projectId = String(payload.projectId ?? '');
      const project = await this.prisma.bidProject.findUnique({
        where: { id: projectId },
        select: { assignedHostUserId: true },
      });
      if (!project?.assignedHostUserId) return { skipped: 'no host' };
      await this.notificationService.sendToUser(project.assignedHostUserId, ['in_app'], {
        type: 'BID_SUBMITTED_V3',
        title: '新投标递交（dual-v3）',
        content: `项目 ${projectId} 有新的 dual-v3 投标递交（revision ${payload.revision ?? '-'}），请进入开标任务板关注。`,
        link: '/bid',
      });
      return {};
    }
    throw new Error(`no handler for topic '${topic}'`);
  }
}
