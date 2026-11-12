import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

/** 确认参与未投递事故候选（内存态，未落库） */
interface NoShowCandidate { supplierId: string; track: 'INTENT' | 'RSVP'; commitmentAt: Date }

const POST_SUBMIT_STAGES = ['OPENING', 'EVALUATING', 'ARCHIVED'] as const;

/**
 * 投标意向履约监督（2026-11-12 设计 §8）：
 * - 事故判定：项目开标后（stage∈POST_SUBMIT_STAGES）承诺方（公开意向|回执确认参加）未投递；
 * - legacy：承诺时间早于本功能迁移完成时刻（_prisma_migrations.finished_at）——展示不计触发；
 * - 满 3 次非 legacy 事故自动拉黑（复用人工拉黑不变式：状态占用更新+disableReason+账号停用
 *   +SUPPLIER_BLACKLISTED 通知），另写 SupplierPenalty 自动留痕；
 * - 触发面：每日 Cron 兜底（真正保证）+ 阶段推进即时钩子（Task 7 接线）。
 */
@Injectable()
export class BidIntentOversightService {
  private readonly logger = new Logger(BidIntentOversightService.name);
  private deployRef: Date | null | undefined; // undefined=未解析

  constructor(
    private readonly prisma: PrismaService,
    private readonly notification: NotificationService,
  ) {}

  /** 功能部署时刻=本功能迁移完成时刻；解析失败返回 null（全部按 legacy 处理——宁可不罚不可误罚） */
  async resolveDeployRef(): Promise<Date | null> {
    if (this.deployRef !== undefined) return this.deployRef;
    try {
      const rows = await this.prisma.$queryRaw<{ finished_at: Date | null }[]>`
        SELECT finished_at FROM _prisma_migrations
        WHERE migration_name LIKE '%supplier_bid_intent%' AND finished_at IS NOT NULL
        ORDER BY finished_at ASC LIMIT 1`;
      this.deployRef = rows[0]?.finished_at ? new Date(rows[0].finished_at) : null;
    } catch {
      this.deployRef = null;
    }
    return this.deployRef;
  }

  /** 单项目扫描：写缺失的事故行；新建非 legacy 行时评估自动拉黑。幂等（唯一键兜底）。 */
  async sweepProject(projectId: string): Promise<{ created: number }> {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { id: true, stage: true, projectManagementItemId: true },
    });
    if (!project || !(POST_SUBMIT_STAGES as readonly string[]).includes(project.stage)) return { created: 0 };

    const candidates = await this.determineCandidates(project);
    if (candidates.length === 0) return { created: 0 };

    const deployRef = await this.resolveDeployRef();
    let created = 0;
    for (const c of candidates) {
      const existing = await this.prisma.supplierBidNoShow.findUnique({
        where: { projectId_supplierId: { projectId, supplierId: c.supplierId } },
        select: { id: true },
      });
      if (existing) continue; // 每项目每家一条，幂等
      const legacy = deployRef ? c.commitmentAt.getTime() < deployRef.getTime() : true;
      await this.prisma.supplierBidNoShow.create({
        data: { projectId, supplierId: c.supplierId, track: c.track, legacy },
      });
      created++;
      if (!legacy) {
        await this.evaluateAutoBlacklist(c.supplierId).catch((e) =>
          this.logger.error(`自动拉黑评估失败 supplier=${c.supplierId}: ${e instanceof Error ? e.message : e}`),
        );
      }
    }
    return { created };
  }

  /** 每日兜底扫描（04:20 低峰，避开既有 03:00/03:30/04:00/04:45 作业） */
  @Cron('20 4 * * *')
  async sweepAll(): Promise<{ projects: number; created: number }> {
    const projects = await this.prisma.bidProject.findMany({
      where: { stage: { in: [...POST_SUBMIT_STAGES] } },
      select: { id: true },
      take: 500,
    });
    let created = 0;
    for (const p of projects) {
      try {
        const r = await this.sweepProject(p.id);
        created += r.created;
      } catch (e) {
        this.logger.warn(`履约扫描失败 project=${p.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (created > 0) this.logger.log(`履约扫描：${projects.length} 项目新增 ${created} 条事故`);
    return { projects: projects.length, created };
  }

  /** 事故候选：承诺（INTENT 优先，其次 RSVP 最新回应 ACCEPTED）且未 submitted */
  private async determineCandidates(project: { id: string; projectManagementItemId: string | null }): Promise<NoShowCandidate[]> {
    const rsvpIds = [project.id, project.projectManagementItemId].filter(Boolean) as string[]; // RSVP 双 id 空间（2026-10-16 规范化前为 PMI id）
    const [intents, rsvps, submissions] = await Promise.all([
      this.prisma.supplierBidIntent.findMany({ where: { projectId: project.id }, select: { supplierId: true, confirmedAt: true } }),
      this.prisma.invitationRsvp.findMany({
        where: { projectId: { in: rsvpIds } },
        select: { supplierId: true, status: true, respondedAt: true },
      }),
      this.prisma.supplierBidSubmission.findMany({ where: { projectId: project.id }, select: { supplierId: true, status: true } }),
    ]);

    const submitted = new Set(submissions.filter((s) => s.status === 'submitted').map((s) => s.supplierId));
    const intentBySupplier = new Map(intents.map((i) => [i.supplierId, i]));
    // 同项目多批次回执：每家取 respondedAt 最新一条的当前生效状态（尊重代变更）
    const latestRsvp = new Map<string, { status: string; respondedAt: Date | null }>();
    for (const r of rsvps) {
      if (!r.respondedAt) continue;
      const prev = latestRsvp.get(r.supplierId);
      if (!prev || r.respondedAt.getTime() > prev.respondedAt!.getTime()) {
        latestRsvp.set(r.supplierId, { status: r.status, respondedAt: r.respondedAt });
      }
    }

    const candidates: NoShowCandidate[] = [];
    const seen = new Set<string>();
    for (const [supplierId, intent] of intentBySupplier) {
      seen.add(supplierId);
      if (!submitted.has(supplierId)) candidates.push({ supplierId, track: 'INTENT', commitmentAt: intent.confirmedAt });
    }
    for (const [supplierId, rsvp] of latestRsvp) {
      if (seen.has(supplierId) || submitted.has(supplierId)) continue;
      if (rsvp.status === 'ACCEPTED') candidates.push({ supplierId, track: 'RSVP', commitmentAt: rsvp.respondedAt! });
    }
    return candidates;
  }

  /** 非 legacy 事故 ≥3 → 自动拉黑（幂等：已在黑名单/待审核态/并发占用失败均静默跳过） */
  private async evaluateAutoBlacklist(supplierId: string) {
    const activeCount = await this.prisma.supplierBidNoShow.count({ where: { supplierId, legacy: false } });
    if (activeCount < 3) return;

    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true, status: true, userId: true },
    });
    if (!supplier || supplier.status === 'BLACKLIST') return;
    if (supplier.status === 'PENDING' || supplier.status === 'RETURNED') {
      this.logger.warn(`供应商 ${supplier.name} 事故满 3 次但审核未完结（${supplier.status}），跳过自动拉黑`);
      return;
    }

    const incidents = await this.prisma.supplierBidNoShow.findMany({
      where: { supplierId, legacy: false },
      include: { project: { select: { name: true, projectCode: true } } },
      orderBy: { detectedAt: 'desc' },
      take: 3,
    });
    const projectList = incidents.map((i) => `${i.project.name}（${i.project.projectCode}）`).join('、');
    const reason = `累计 ${activeCount} 次确认参与采购项目但未投递投标/响应文件（${projectList}），依据平台供应商履约规则自动列入黑名单`;

    // 与人工 blacklistSupplier（supplier.service.ts:3401）同一不变式：状态占用更新防并发 + 账号联动停用
    //（2026-10-15 平台裁定：黑名单必须立刻丧失登录能力）+ SUPPLIER_BLACKLISTED 通知（解黑后可见）
    const claimed = await this.prisma.supplier.updateMany({
      where: { id: supplierId, status: supplier.status },
      data: { status: 'BLACKLIST', disableReason: reason },
    });
    if (claimed.count === 0) return; // 并发状态变化，放弃本次
    if (supplier.userId) {
      await this.prisma.user.update({ where: { id: supplier.userId }, data: { isActive: false } }).catch(() => undefined);
    }

    // 自动留痕（cron 路径无 OperationLog，处罚表为留痕权威）
    for (let attempt = 0; attempt < 3; attempt++) {
      const docNo = `AUTO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 999)).padStart(3, '0')}`;
      const clash = await this.prisma.supplierPenalty.findFirst({ where: { penaltyDocNo: docNo }, select: { id: true } });
      if (clash) continue;
      await this.prisma.supplierPenalty.create({
        data: {
          supplierId,
          penaltyDocNo: docNo,
          authority: '采购中心',
          decisionDate: new Date(),
          penaltyContent: `${reason}（系统自动）`,
        },
      });
      break;
    }

    if (supplier.userId) {
      void this.notification
        .sendToUser(supplier.userId, ['in_app'], {
          type: 'SUPPLIER_BLACKLISTED',
          title: '单位已被自动列入黑名单',
          content: `${reason}。如有异议请联系采购中心。`,
          link: '/notifications',
        })
        .catch(() => undefined);
    }
    this.logger.warn(`自动拉黑生效：${supplier.name}（${reason}）`);
  }

  /** 供应商参与情况视图（:3005 供应商管理「参与情况」卡片数据源） */
  async getParticipation(supplierId: string) {
    const [intentRows, rsvpRows, submissionRows, incidentRows, supplier] = await Promise.all([
      this.prisma.supplierBidIntent.findMany({
        where: { supplierId },
        include: { project: { select: { id: true, name: true, projectCode: true, stage: true } } },
        orderBy: { confirmedAt: 'desc' },
      }),
      this.prisma.invitationRsvp.findMany({
        where: { supplierId, projectId: { not: null }, status: 'ACCEPTED' },
        select: { projectId: true, respondedAt: true },
      }),
      this.prisma.supplierBidSubmission.findMany({
        where: { supplierId, status: 'submitted' },
        select: { projectId: true, submittedAt: true },
      }),
      this.prisma.supplierBidNoShow.findMany({
        where: { supplierId },
        include: { project: { select: { name: true, projectCode: true, stage: true } } },
        orderBy: { detectedAt: 'desc' },
      }),
      this.prisma.supplier.findUnique({ where: { id: supplierId }, select: { status: true, disableReason: true } }),
    ]);
    const submittedProjectIds = new Set(submissionRows.map((s) => s.projectId));
    const activeCount = incidentRows.filter((i) => !i.legacy).length;
    const penalties = supplier?.status === 'BLACKLIST'
      ? await this.prisma.supplierPenalty.findMany({
          where: { supplierId },
          orderBy: { decisionDate: 'desc' },
          select: { penaltyDocNo: true, authority: true, decisionDate: true, penaltyContent: true },
        })
      : [];
    return {
      kpi: {
        intentTotal: intentRows.length,
        rsvpAcceptedTotal: rsvpRows.length,
        submittedTotal: submissionRows.length,
        noShowTotal: incidentRows.length,
        noShowActiveCount: activeCount,
        blacklistThreshold: 3,
      },
      incidents: incidentRows.map((i) => ({
        projectName: i.project.name,
        projectCode: i.project.projectCode,
        stage: i.project.stage,
        track: i.track,
        detectedAt: i.detectedAt,
        legacy: i.legacy,
      })),
      intents: intentRows.map((i) => ({
        projectName: i.project.name,
        projectCode: i.project.projectCode,
        stage: i.project.stage,
        confirmedAt: i.confirmedAt,
        submitted: submittedProjectIds.has(i.project.id),
      })),
      blacklist: supplier?.status === 'BLACKLIST' ? { reason: supplier.disableReason, penalties } : null,
    };
  }
}
