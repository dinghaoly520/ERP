import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { ExpertAdminService } from '../expert/expert-admin.service';
import { SupplierService } from '../supplier/supplier.service';

export function buildExpiryNotification(input: { qualificationName: string; validTo: Date; daysLeft: number }) {
  const date = input.validTo.toISOString().slice(0, 10);
  return {
    type: 'QUALIFICATION_EXPIRING',
    title: '资质即将到期提醒',
    content: `您的资质材料「${input.qualificationName}」将于 ${date} 到期（剩 ${input.daysLeft} 天），请及时更新以免影响投标资格。`,
    link: '/supplier/qualifications',
  };
}

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private prisma: PrismaService,
    private notification: NotificationService,
    private expertAdmin: ExpertAdminService,
    private supplierService: SupplierService,
  ) {}

  // R-4：每天扫描过期超 30 天的临时供应商，记录并通知采购端清理（不删数据，由管理员决定）
  @Cron('0 6 * * *')
  async cleanupExpiredTemporarySuppliers() {
    const cutoff = new Date(Date.now() - 30 * 86400000);
    const expired = await this.prisma.supplier.findMany({
      where: { isTemporary: true, temporaryExpiresAt: { lt: cutoff } },
      select: { id: true, name: true },
    });
    if (expired.length === 0) return;
    this.logger.warn(`[R-4] 发现 ${expired.length} 个过期临时供应商（超 30 天）：${expired.map(s => s.name).join('、')}`);
    const sample = expired.slice(0, 5).map(s => s.name).join('、');
    void this.notification.sendToRole('staff', {
      type: 'SYSTEM',
      title: '过期临时供应商待清理',
      content: `${expired.length} 个临时供应商已过期超过 30 天，建议清理或转正：${sample}${expired.length > 5 ? '…' : ''}`,
    }).catch(() => {});
  }

  /** 每日 03:00 清理过期的自定义抽取影子项目：仅删 isExtractionOnly 且停留在 DOWNLOAD（从未真正开评标）、
   *  创建超过保留期（默认 90 天）的项目，避免 BidProject 表与各类计数持续膨胀。级联删除其 BidExpert/通知等。 */
  @Cron('0 3 * * *')
  async cleanupStaleExtractionProjects() {
    const retentionDays = Number(process.env.EXTRACTION_PROJECT_RETENTION_DAYS ?? 90);
    const cutoff = new Date(Date.now() - retentionDays * 86400000);
    const result = await this.prisma.bidProject.deleteMany({
      where: { isExtractionOnly: true, stage: 'DOWNLOAD', createdAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      this.logger.log(`[影子项目清理] 已删除 ${result.count} 个超过 ${retentionDays} 天的自定义抽取影子项目`);
    }
  }

  /** 每日 09:00 扫描未来 N 天内到期且未通知的资质，向供应商发站内信（经多渠道分发）。 */
  @Cron('0 9 * * *')
  async scanExpiringQualifications() {
    const horizon = Number(process.env.QUALIFICATION_EXPIRY_DAYS ?? 30);
    const now = new Date();
    const cutoff = new Date(now.getTime() + horizon * 24 * 3600 * 1000);

    const expiring = await this.prisma.supplierQualification.findMany({
      where: { validTo: { gte: now, lte: cutoff }, status: '有效' },
      include: { supplier: { select: { userId: true, name: true } } },
    });

    for (const q of expiring) {
      const daysLeft = Math.ceil((q.validTo!.getTime() - now.getTime()) / (24 * 3600 * 1000));
      const dto = buildExpiryNotification({ qualificationName: q.name, validTo: q.validTo!, daysLeft });
      await this.notification.create({ userId: q.supplier.userId, ...dto });
    }

    this.logger.log(`资质到期扫描完成：通知 ${expiring.length} 条`);
  }

  /** 每周一 01:00 扫描专家退库 / 供应商淘汰候选（仅预警通知，不自动改状态——决策 #3）。 */
  @Cron('0 1 * * 1')
  async scanRetirementAndEliminationCandidates() {
    const [experts, suppliers] = await Promise.all([
      this.expertAdmin.reviewRetirementCandidates().catch((e: Error) => {
        this.logger.error(`专家退库扫描失败：${e.message}`);
        return [];
      }),
      this.supplierService.reviewEliminationCandidates().catch((e: Error) => {
        this.logger.error(`供应商淘汰扫描失败：${e.message}`);
        return [];
      }),
    ]);
    this.logger.log(`退库/淘汰预警扫描完成：专家候选 ${experts.length} 名，供应商候选 ${suppliers.length} 家`);
  }

  /** 每分钟扫描定时公告（status=DRAFT + metadata.scheduledPublishDate），到期设 PUBLISHED 并可选发通知 */
  @Cron('0 * * * * *')
  async publishScheduledAnnouncements() {
    const drafts = await this.prisma.announcement.findMany({
      where: { status: 'DRAFT' },
    });
    for (const a of drafts) {
      const meta = (a.metadata as Record<string, any>) || {};
      if (!meta.scheduledPublishDate) continue;
      if (new Date(meta.scheduledPublishDate) <= new Date()) {
        await this.prisma.announcement.update({
          where: { id: a.id },
          data: { status: 'PUBLISHED', publishDate: new Date() },
        });
        if (meta.notifyOnPublish) {
          await this.sendPublishNotifications(a.id, a.title, meta);
        }
        this.logger.log(`定时公告发布: ${a.title} (${a.id})`);
      }
    }
  }

  /** 按公告范围向供应商用户发送站内信通知 */
  private async sendPublishNotifications(
    annId: string,
    title: string,
    meta: Record<string, any>,
  ) {
    const visibility = meta.visibility || 'PUBLIC';
    let userIds: string[];
    if (
      visibility === 'RESTRICTED' &&
      Array.isArray(meta.restrictedSupplierIds) &&
      meta.restrictedSupplierIds.length > 0
    ) {
      const suppliers = await this.prisma.supplier.findMany({
        where: { id: { in: meta.restrictedSupplierIds } },
        select: { userId: true },
      });
      userIds = suppliers.map((s) => s.userId);
    } else {
      const users = await this.prisma.user.findMany({
        where: { role: 'supplier', isActive: true },
        select: { id: true },
      });
      userIds = users.map((u) => u.id);
    }
    for (const userId of userIds) {
      try {
        await this.notification.create({
          userId,
          type: 'ANNOUNCEMENT_PUBLISHED',
          title: `新采购公告：${title}`,
          content: `采购公告「${title}」已发布，请前往供应商门户查看详情。`,
          link: `/notice/${annId}`,
        });
      } catch (e) {
        this.logger.warn(`通知创建失败 userId=${userId}: ${(e as Error).message}`);
      }
    }
    this.logger.log(`公告通知已发送: ${title}, 收件人 ${userIds.length} 人`);
  }

  /** 每小时扫描：投标投递截止（开标前 12h）落在未来 1 小时窗口内的项目，自动催促未投递供应商 */
  @Cron('0 0 * * * *')
  async autoNudgePendingBidders() {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + 60 * 60 * 1000);
    const projects = await this.prisma.bidProject.findMany({
      where: { stage: { in: ['DOWNLOAD', 'SUBMIT'] } },
      select: { id: true, name: true, openTime: true },
    });
    for (const p of projects) {
      const deadline = new Date(p.openTime.getTime() - 12 * 60 * 60 * 1000);
      if (deadline >= now && deadline <= windowEnd) {
        try {
          await this.sendBidDeadlineNudge(p.id, p.name, deadline);
          this.logger.log(`自动催促投标: ${p.name} (截止 ${deadline.toISOString()})`);
        } catch (e) {
          this.logger.warn(`自动催促投标失败 ${p.id}: ${(e as Error).message}`);
        }
      }
    }
  }

  /** 向未投递供应商发送投标截止提醒（站内信）*/
  private async sendBidDeadlineNudge(projectId: string, projectName: string, deadline: Date) {
    const suppliers = await this.prisma.bidSupplier.findMany({
      where: { projectId, submitStatus: { not: '已提交' } },
      include: { supplier: { select: { userId: true } } },
    });
    const pad = (n: number) => String(n).padStart(2, '0');
    const fmt = `${deadline.getFullYear()}-${pad(deadline.getMonth() + 1)}-${pad(deadline.getDate())} ${pad(deadline.getHours())}:${pad(deadline.getMinutes())}`;
    let sent = 0;
    for (const s of suppliers) {
      const userId = s.supplier?.userId;
      if (!userId) continue;
      try {
        await this.notification.create({
          userId,
          type: 'BID_DEADLINE_NUDGE',
          title: `投标即将截止：${projectName}`,
          content: `项目「${projectName}」投标将于 ${fmt} 截止，请尽快前往供应商门户提交投标文件。`,
          link: '/dashboard',
        });
        sent += 1;
      } catch (e) {
        this.logger.warn(`催促通知失败 userId=${userId}: ${(e as Error).message}`);
      }
    }
    this.logger.log(`投标截止催促已发送: ${projectName}, 收件人 ${sent} 人`);
  }

  /** E2: 每小时扫描评标超时项目——已过 evaluationDeadline 的 EVALUATING 项目写监督日志 + 通知 */
  @Cron('0 30 * * * *')
  async scanEvaluationDeadlines() {
    const now = new Date();
    const projects = await this.prisma.bidProject.findMany({
      where: { stage: 'EVALUATING', evaluationDeadline: { lt: now } },
      select: { id: true, name: true, evaluationDeadline: true },
    });
    for (const p of projects) {
      // 去重：同一项目每天只通知一次（查当天是否已有超时日志）
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const existing = await this.prisma.bidSupervisionLog.findFirst({
        where: { projectId: p.id, action: '评标超时告警', time: { gte: todayStart } },
      });
      if (existing) continue;

      try {
        await this.prisma.bidSupervisionLog.create({
          data: {
            projectId: p.id,
            time: now,
            role: '系统',
            target: p.name,
            action: '评标超时告警',
            result: `评标截止时间 ${p.evaluationDeadline?.toISOString()} 已过`,
            riskFlag: '中',
          },
        });
        await this.notification.sendToRole('leader', {
          type: 'EVAL_DEADLINE_EXPIRED',
          title: `评标超时：${p.name}`,
          content: `项目「${p.name}」评标已超时（截止 ${p.evaluationDeadline?.toISOString().slice(0, 16)}），请及时跟进。`,
          link: '/projects',
        }).catch(() => {});
        this.logger.log(`评标超时告警: ${p.name}`);
      } catch (e) {
        this.logger.warn(`评标超时告警失败 ${p.id}: ${(e as Error).message}`);
      }
    }
  }
}
