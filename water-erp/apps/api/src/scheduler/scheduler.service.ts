import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { ExpertAdminService } from '../expert/expert-admin.service';
import { SupplierService } from '../supplier/supplier.service';
import { AnnouncementService } from '../announcement/announcement.service';
import { BidService } from '../bid/bid.service';
import { nudgeWindowOpen } from '../bid/opening-deadline.util';
import { pendingBondReturnWhere } from '../bid/bond-pending.util';
import { BID_DEADLINE_BEFORE_OPENING_MS } from '@water-erp/shared';

export function buildExpiryNotification(input: { qualificationName: string; validTo: Date; daysLeft: number }) {
  const date = input.validTo.toISOString().slice(0, 10);
  return {
    type: 'QUALIFICATION_EXPIRING',
    title: '资质即将到期提醒',
    content: `您的资质材料「${input.qualificationName}」将于 ${date} 到期（剩 ${input.daysLeft} 天），请及时更新以免影响投标资格。`,
    link: '/profile',
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
    private announcementService: AnnouncementService,
    private bidService: BidService,
  ) {}

  /** D2 归档时限扫描（DA/T 103-2024 §8.2/§10.1）：每日 05:00。
   *  流程终结（定标/合同阶段有件）但迟迟未导出 ASIP 的卷 → 分级提醒：
   *  - 终结满 ARCHIVE_TRANSFER_DUE_DAYS（默认 270 天，对齐「不晚于次年 3 月 31 日」）→ 提醒经办（staff+leader）
   *  - 终结满 ARCHIVE_OVERDUE_DAYS（默认 365 天，对齐「不晚于次年 6 月」）→ 升级 leader+admin
   *  幂等：同卷同类型未消通知已存在则跳过；导出完成即 resolve（ArchiveFlowService）。
   */
  @Cron('0 5 * * *')
  async scanArchiveDeadlines() {
    const dueDays = Number(process.env.ARCHIVE_TRANSFER_DUE_DAYS) || 270;
    const overdueDays = Number(process.env.ARCHIVE_OVERDUE_DAYS) || 365;

    // 候选：未回收、未导出、定标/合同阶段已有件
    const candidates = await this.prisma.projectManagementItem.findMany({
      where: {
        status: { not: 'RECYCLED' },
        archiveExportedAt: null,
        stages: {
          some: {
            stageKey: { in: ['AWARD_DECISION', 'CONTRACT'] },
            attachments: { some: {} },
          },
        },
      },
      select: {
        id: true, title: true, projectCode: true,
        stages: {
          where: { stageKey: { in: ['AWARD_DECISION', 'CONTRACT'] }, attachments: { some: {} } },
          select: { attachments: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } } },
        },
      },
      take: 500,
    });

    let reminded = 0;
    for (const item of candidates) {
      const terminalAt = item.stages
        .flatMap((st) => st.attachments.map((a) => a.createdAt?.getTime() ?? 0))
        .sort((a, b) => b - a)[0];
      if (!terminalAt) continue;
      const days = Math.floor((Date.now() - terminalAt) / 86400000);

      const type = days >= overdueDays ? 'ARCHIVE_OVERDUE' : days >= dueDays ? 'ARCHIVE_TRANSFER_DUE' : null;
      if (!type) continue;
      const link = `/archive?pmi=${item.id}`;
      const pending = await this.prisma.notification.count({ where: { type, link, resolvedAt: null } });
      if (pending > 0) continue; // 幂等

      const isOverdue = type === 'ARCHIVE_OVERDUE';
      const dto = {
        type,
        title: isOverdue ? '归档严重逾期' : '归档移交临期提醒',
        content: `「${item.title}」流程终结已 ${days} 天仍未导出归档信息包（DA/T 103-2024 §8.2 要求不晚于次年 3 月 31 日移交），请尽快完成四性检测与 ASIP 导出。`,
        link,
      };
      if (isOverdue) {
        await this.notification.sendToRole('leader', dto).catch(() => {});
        await this.notification.sendToRole('admin', dto).catch(() => {});
      } else {
        await this.notification.sendToRole('staff', dto).catch(() => {});
        await this.notification.sendToRole('leader', dto).catch(() => {});
      }
      reminded += 1;
    }
    if (reminded > 0) this.logger.warn(`[D2] 归档时限提醒已发 ${reminded} 卷`);
  }

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

  /** C1（GB/T 43711 7.5.2.5）：每日 08:00 扫描公示期已满、尚未发布成交公告的预成交公示，
   *  提醒管理端确认发布。幂等：metadata.winnerConfirmRemindedAt 已置或已派生成交公告则跳过，避免每日重复打扰。 */
  @Cron('0 8 * * *')
  async remindConfirmableWinnerNotices() {
    const pres = await this.prisma.announcement.findMany({
      where: { type: 'PRE_WIN_NOTICE', status: 'PUBLISHED', publicityEnd: { lt: new Date() } },
      select: { id: true, title: true, relatedProjectCode: true, metadata: true },
      take: 50,
    });

    let reminded = 0;
    for (const pre of pres) {
      const meta = (pre.metadata as Record<string, any>) ?? {};
      if (meta.winnerConfirmRemindedAt) continue;
      if (pre.relatedProjectCode) {
        const win = await this.prisma.announcement.findFirst({
          where: { relatedProjectCode: pre.relatedProjectCode, type: 'WIN_NOTICE' },
          select: { id: true },
        });
        if (win) continue;
      }
      void this.notification.sendToRole('staff', {
        type: 'SYSTEM',
        title: '预成交公示期满待确认',
        content: `「${pre.title}」公示期已满且无未决异议，请在公告管理中确认发布成交公告（GB/T 43711 7.5.2.5）`,
      }).catch(() => {});
      await this.prisma.announcement.update({
        where: { id: pre.id },
        data: { metadata: { ...meta, winnerConfirmRemindedAt: new Date().toISOString() } },
      }).catch(() => {});
      reminded++;
    }
    if (reminded > 0) this.logger.log(`[C1] 预成交公示期满提醒已发 ${reminded} 条`);
  }

  /** D2（GB/T 43711 4.1.5.2/8.3）：每月 1 日 05:30 抽检已归档项目指纹链——漂移=高风险告警（不可更改要求）。
   *  复用 BidService.verifyArchiveIntegrity（其内部已写监督日志）；再定向通知经办。 */
  @Cron('30 5 1 * *')
  async verifyArchivedIntegrity() {
    const archived = await this.prisma.bidProject.findMany({
      where: { stage: 'ARCHIVED' },
      select: { id: true, name: true },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });
    let mismatches = 0;
    for (const p of archived) {
      try {
        const r = await this.bidService.verifyArchiveIntegrity(p.id);
        if (!r.valid) mismatches++;
      } catch { /* 单项目失败不阻塞抽检 */ }
    }
    if (mismatches > 0) {
      void this.notification.sendToRole('staff', {
        type: 'SYSTEM',
        title: '档案完整性抽检告警',
        content: `月度抽检发现 ${mismatches} 个归档项目指纹链不匹配（GB/T 43711 8.3 不可更改要求）——详情见各项目监督日志，请立即核查。`,
      }).catch(() => {});
      this.logger.warn(`[D2] 档案指纹抽检：${mismatches}/${archived.length} 项不匹配`);
    } else {
      this.logger.log(`[D2] 档案指纹抽检通过：${archived.length} 项`);
    }
  }

  /** C4（GB/T 43711 7.5.4.4）/ A-105 逐家口径：每日 08:30 已签署/已验收合同与已归档项目、
   *  已提交供应商中仍有响应担保未登记逐家退还 → 提醒经办（附未退供应商名单）。
   *  幂等：systemConfig 记 marker（bond_return_reminded_at），同一项目只提醒一次。 */
  @Cron('30 8 * * *')
  async remindBondReturns() {
    const contracts = await this.prisma.contract.findMany({
      where: { status: { in: ['signed', 'performing', 'accepted'] } },
      select: { projectId: true },
    });
    const signedProjectIds = contracts.map(c => c.projectId).filter((id): id is string => !!id);
    const projects = await this.prisma.bidProject.findMany({
      where: {
        OR: [{ id: { in: signedProjectIds } }, { stage: 'ARCHIVED' }],
        bondRequired: true,
      },
      select: { id: true, projectCode: true, name: true },
      take: 50,
    });
    if (projects.length === 0) return;

    const toRemind: { id: string; projectCode: string; name: string }[] = [];
    const pendingNames: string[] = [];
    for (const p of projects) {
      const marker = await this.prisma.systemConfig.findUnique({ where: { key: `bond_return_reminded:${p.id}` } });
      if (marker) continue;
      // A-105：逐家口径——项目级 bondReturnedAt 不再参与判定，已提交、未退还且无不予退还终局理由的家数为 0 则视为收口
      //（终审 Critical#2：pending 谓词与定标 hook 收口共享 bond-pending.util，防口径漂移）
      const pendingCount = await this.prisma.bidSupplier.count({
        where: pendingBondReturnWhere({ projectId: p.id }),
      });
      if (pendingCount === 0) continue;
      toRemind.push(p);
      const pending = await this.prisma.bidSupplier.findMany({
        where: pendingBondReturnWhere({ projectId: p.id }),
        select: { supplierName: true },
        take: 5,
      });
      pendingNames.push(...pending.map(s => s.supplierName));
      await this.prisma.systemConfig.upsert({
        where: { key: `bond_return_reminded:${p.id}` },
        update: { value: new Date().toISOString() },
        create: { key: `bond_return_reminded:${p.id}`, value: new Date().toISOString() },
      }).catch(() => {});
    }
    if (toRemind.length === 0) return;

    const sample = toRemind.slice(0, 5).map(p => p.projectCode).join('、');
    const uniqueNames = Array.from(new Set(pendingNames));
    const nameSample = uniqueNames.slice(0, 5).join('、');
    void this.notification.sendToRole('staff', {
      type: 'SYSTEM',
      title: '响应担保待退还提醒',
      content: `${toRemind.length} 个已签署/归档项目尚有供应商响应担保未登记逐家退还（GB/T 43711 7.5.4.4 按约定及时退还）：${sample}${toRemind.length > 5 ? '…' : ''}；未退供应商：${nameSample}${uniqueNames.length > 5 ? '…' : ''}。请在项目管理-合同或归档面板逐家登记退还。`,
    }).catch(() => {});
    this.logger.log(`[C4] 响应担保逐家退还提醒已发 ${toRemind.length} 项`);
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
        // 委托给 AnnouncementService 统一通知逻辑（按可见范围 + notifyOnPublish 开关）
        await this.announcementService.notifySuppliersOnPublish(a.id, a.title, { ...meta, __type: a.type });
        this.logger.log(`定时公告发布: ${a.title} (${a.id})`);
      }
    }
  }

  /** 每分钟扫描"催促未投递供应商"的定时任务（status=SCHEDULED 且 sendAt<=now，通常=开标前 24h）。
   *  到点重算"已回执参加 + 未投递"目标集合，逐家按所选渠道投递；原子抢占一次性额度（人工已发则跳过）。 */
  @Cron('0 * * * * *')
  async fireScheduledSupplierNudges() {
    const now = new Date();
    const due = await this.prisma.bidSupplierNudge.findMany({
      where: { status: 'SCHEDULED', sendAt: { lte: now } },
      select: { id: true, bidProjectId: true, channels: true, messages: true },
    });
    for (const nudge of due) {
      try {
        const messages = (nudge.messages as Record<string, { title: string; body: string }> | null) ?? {};
        const channels = (nudge.channels as string[] | null) ?? ['in_app', 'sms', 'phone'];
        // 窗口闸门（2026-09-01）：开标时间被提前改期后，原定时点可能落入开标前 24h 内 →
        // 不再补发，撤销定时（保持"距开标不足 24h 一律不催"的不变式）
        const proj = await this.prisma.bidProject.findUnique({
          where: { id: nudge.bidProjectId },
          select: { openTime: true },
        });
        if (!nudgeWindowOpen(proj?.openTime, now)) {
          await this.prisma.bidSupplierNudge.updateMany({
            where: { id: nudge.id, status: 'SCHEDULED' },
            data: { status: null, sendAt: null },
          });
          this.logger.warn(`定时催促被撤销（已进入开标前 24h 窗口）: bidProject=${nudge.bidProjectId}`);
          continue;
        }
        const targets = await this.computeNudgeTargetsLocal(nudge.bidProjectId);
        // 原子抢占：仅当仍为 SCHEDULED 时置 SENT，避免与人工发送竞态导致重复催促
        const claimed = await this.prisma.bidSupplierNudge.updateMany({
          where: { id: nudge.id, status: 'SCHEDULED' },
          data: { status: 'SENT', sentAt: new Date() },
        });
        if (claimed.count === 0) continue; // 已被人工发送/取消，跳过
        let sent = 0;
        for (const t of targets) {
          const msg = messages[t.supplierId];
          if (!msg || !msg.body?.trim()) continue; // 无对应文案者跳过
          if (!t.userId) continue;
          try {
            await this.notification.sendToUser(t.userId, channels, {
              type: 'BID_NUDGE_SUPPLIER', title: msg.title, content: msg.body, link: null,
            });
            sent++;
          } catch (e) {
            this.logger.warn(`定时催促发送失败 supplier=${t.supplierId}: ${(e as Error).message}`);
          }
        }
        this.logger.log(`定时催促已发送: bidProject=${nudge.bidProjectId}, 收件 ${sent}/${targets.length}`);
      } catch (e) {
        this.logger.warn(`定时催促处理失败 nudge=${nudge.id}: ${(e as Error).message}`);
      }
    }
  }

  /** 与 BidService.computeNudgeTargets 同逻辑的本地副本（避免 Scheduler↔Bid 模块循环依赖）。 */
  private async computeNudgeTargetsLocal(
    bidProjectId: string,
  ): Promise<{ supplierId: string; userId: string | null }[]> {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: bidProjectId },
      select: { id: true, projectManagementItemId: true },
    });
    if (!project) return [];
    const pmId = project.projectManagementItemId;
    const [roster, submissions, rsvps] = await Promise.all([
      this.prisma.bidSupplier.findMany({
        where: { projectId: bidProjectId },
        select: { supplierId: true, submitStatus: true, supplier: { select: { userId: true } } },
      }),
      this.prisma.supplierBidSubmission.findMany({
        where: { projectId: bidProjectId },
        select: { supplierId: true, status: true },
      }),
      this.prisma.invitationRsvp.findMany({
        where: { projectId: { in: pmId ? [bidProjectId, pmId] : [bidProjectId] }, status: 'ACCEPTED' },
        select: { supplierId: true },
      }),
    ]);
    const subMap = new Map(submissions.map(s => [s.supplierId, s]));
    const userMap = new Map<string, string | null>();
    for (const r of roster) if (r.supplierId) userMap.set(r.supplierId, r.supplier?.userId ?? null);
    const seen = new Set<string>();
    const out: { supplierId: string; userId: string | null }[] = [];
    for (const r of rsvps) {
      const sid = r.supplierId;
      if (!sid || seen.has(sid)) continue;
      seen.add(sid);
      const submission = subMap.get(sid);
      const entry = roster.find(x => x.supplierId === sid);
      const submitted = submission?.status === 'submitted' || (!submission && entry?.submitStatus === '已提交');
      if (submitted) continue;
      out.push({ supplierId: sid, userId: userMap.get(sid) ?? null });
    }
    return out;
  }

  /** 每小时扫描：投标投递截止（开标前 24h）落在未来 1 小时窗口内的项目，自动催促未投递供应商 */
  @Cron('0 0 * * * *')
  async autoNudgePendingBidders() {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + 60 * 60 * 1000);
    const projects = await this.prisma.bidProject.findMany({
      where: { stage: { in: ['DOWNLOAD', 'SUBMIT'] } },
      select: { id: true, name: true, openTime: true, deadline: true },
    });
    for (const p of projects) {
      // P0-2 第六写点：优先取 DB deadline（frozen 延时下 openTime 已后移，openTime−12h 会在真实截标已过后仍误催）；
      // 历史行 deadline 缺失时按常量派生 openTime − 24h
      const deadline = p.deadline ?? new Date(p.openTime.getTime() - BID_DEADLINE_BEFORE_OPENING_MS);
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
