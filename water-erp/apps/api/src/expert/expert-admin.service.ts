import { Injectable, Optional, NotFoundException, BadRequestException, ForbiddenException, ConflictException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, BorderStyle } from 'docx';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashSync } from 'bcryptjs';
import { Prisma, ExpertLevel } from '@prisma/client';
import { resolveRsvpLinkOrigin, type PortalLinkHeaders } from '../common/portal-link-origin';
import { PrismaService } from '../prisma/prisma.service';
import { sealPii, openPii, openPiiForMask } from '../common/crypto/sm-field-crypto';
import { logSensitiveAccess } from '../common/sensitive-access.util';
import { maskPhone, maskIdNumber, maskEmail, maskLicenseNo } from '../common/pii-mask';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EmbeddingService } from '../local-ai/embedding.service';
import { LlmService } from '../local-ai/llm.service';
import { OcrService } from '../local-ai/ocr.service';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';
import { processFile } from '../ai-bid-analysis/utils/file-processor';
import { ExpertExtractionAiService, rsvpTtlHours, rsvpTtlLabel } from './expert-extraction-ai.service';
import { ExpertCrossConflictService } from './expert-cross-conflict.service';
import { ExpertExtractionService } from './expert-extraction.service';
import { findOpenEvaluationWindows } from './expert-room.util';
import type { CreateExpertDto } from './dto/create-expert.dto';
import { UpdateExpertStatusDto } from './dto/update-expert-status.dto';
import type { CreateExpertEvaluationDto } from './dto/create-expert-evaluation.dto';
import type { UpdateExpertProfileDto } from './dto/expert-admin-misc.dto';
import type { CommitteeAssignmentDto } from '../bid/dto/committee-assignment.dto';
import { computeExpertMeanDeviations, meanOrNull, shouldDeactivateExpert } from '../common/scoring/expert-deviation';
import { buildExpertPortrait } from './expert-portrait.util';
import { NotificationService } from '../notification/notification.service';
import { BidGateway } from '../bid/bid.gateway';
import { CompanyScopeService } from '../company/company-scope';
import type { CompanyWhere } from '../company/company-scope';
import { EVALUATION_COOLDOWN_MS, reevalAllowed, latestExpertEvals } from '../common/evaluation-dedupe.util';

/** 等级→分值（用于加权计算综合等级） */
const GRADE_SCORE: Record<ExpertLevel, number> = { A: 5, B: 4, C: 3, D: 2, E: 1 };
const SCORE_GRADE: Record<number, ExpertLevel> = { 5: 'A', 4: 'B', 3: 'C', 2: 'D', 1: 'E' };

function computeOverallGrade(
  qualityGrade: ExpertLevel,
  disciplineGrade: ExpertLevel,
  attendanceGrade: ExpertLevel,
): ExpertLevel {
  const w =
    GRADE_SCORE[qualityGrade] * 0.5 +
    GRADE_SCORE[disciplineGrade] * 0.3 +
    GRADE_SCORE[attendanceGrade] * 0.2;
  return SCORE_GRADE[Math.round(w)];
}

/** 专家管理审计动作白名单——「操作历史」页仅展示这些动作，其余审计动作（抽取/确认等）不混入 */
export const EXPERT_AUDIT_ACTIONS = [
  'EXPERT_CREATE',        // 录入专家
  'EXPERT_IMPORT',        // CSV 批量导入
  'EXPERT_APPROVE',       // 审核入库（PENDING→ACTIVE）
  'EXPERT_UPDATE',        // 更新资料
  'EXPERT_ENABLE',        // 启用
  'EXPERT_DISABLE',       // 停用
  'EXPERT_BATCH_ENABLE',  // 批量启用
  'EXPERT_BATCH_DISABLE', // 批量停用
  'EXPERT_SUSPEND',       // 暂停
  'EXPERT_RESUME',        // 恢复（暂停恢复 / 退库恢复）
  'EXPERT_RETIRE',        // 退库
  'EXPERT_RETIRE_IGNORE', // 忽略退库预警
  'EXPERT_EVALUATE',      // 履职评价
  'EXPERT_VIOLATION_RECORDED', // 违规记录
] as const;

/** 专家邀请作答方（2026-10-21 代为变更设计适配，口径与供应商 RsvpActorType 对齐） */
export type ExpertInvitationActor = 'EXPERT' | 'STAFF' | 'SYSTEM';

/** 邀请信用预警阈值（2026-10-21 用户口径）：连续拒绝 ≥3 次触发一次预警（同段连拒期不重复） */
const DECLINE_STREAK_ALERT_THRESHOLD = 3;

/**
 * 毁约归因（2026-10-21 深检修正，纯函数便于单测）：仅计「本人或代回应确认过」的
 * confirmed 被代婉拒——递补/替换转正（PROMOTED/SWAP_IN）是系统置 confirmed，专家
 * 并未亲口答应，随后被代婉拒不构成中途毁约。按笔归因（同一行的历史里可能既有
 * 本人确认又有系统转正）。
 */
export function expertBreachEventsFromLogs(
  logs: Array<{ bidExpertId: string; action: string; fromStatus: string | null; toStatus: string | null; reason: string | null; actorName: string | null; createdAt: Date }>,
  projectNameByBe: Map<string, string>,
): Array<{ projectName: string; at: string; reason: string | null; actorName: string | null }> {
  const logsByBe = new Map<string, typeof logs>();
  for (const l of logs) {
    const arr = logsByBe.get(l.bidExpertId) ?? [];
    arr.push(l);
    logsByBe.set(l.bidExpertId, arr);
  }
  const out: Array<{ projectName: string; at: string; reason: string | null; actorName: string | null }> = [];
  for (const [, arr] of logsByBe) {
    const sorted = [...arr].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    let lastConfirmedBy: string | null = null;
    for (const l of sorted) {
      if (l.action === 'STAFF_MARKED' && l.fromStatus === 'confirmed' && l.toStatus === 'declined' && lastConfirmedBy === 'SELF') {
        out.push({ projectName: projectNameByBe.get(l.bidExpertId) ?? '', at: l.createdAt.toISOString(), reason: l.reason, actorName: l.actorName });
      }
      if (l.toStatus === 'confirmed') {
        lastConfirmedBy = ['PROMOTED', 'SWAP_IN'].includes(l.action) ? 'SYSTEM' : 'SELF';
      }
    }
  }
  return out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

/** 邀请轨迹落账（写侧统一入口——邀请状态/角色任何流转必须留痕，缺失即审计断链；失败 warn 不阻断主流程） */
async function writeInvitationLog(
  tx: { expertInvitationLog: { create: (args: any) => Promise<unknown> } },
  data: {
    bidExpertId: string; projectId: string; userId: string;
    action: string; actorType: ExpertInvitationActor; actorId?: string | null; actorName?: string | null;
    fromStatus?: string | null; toStatus?: string | null; fromRole?: string | null; toRole?: string | null; reason?: string | null;
  },
) {
  await tx.expertInvitationLog.create({
    data: {
      bidExpertId: data.bidExpertId, projectId: data.projectId, userId: data.userId,
      action: data.action, actorType: data.actorType, actorId: data.actorId ?? null, actorName: data.actorName ?? null,
      fromStatus: data.fromStatus ?? null, toStatus: data.toStatus ?? null,
      fromRole: data.fromRole ?? null, toRole: data.toRole ?? null, reason: data.reason ?? null,
    },
  }).catch((err: any) => {
    Logger.warn(`专家邀请轨迹落账失败 be=${data.bidExpertId} action=${data.action}: ${err?.message ?? err}`, 'ExpertAdminService');
  });
}

@Injectable()
export class ExpertAdminService {
  // N6 收尾：TTL 真单源——毫秒值复用 rsvpTtlHours()（含 "abc"/"0" 等非法值回退 0.25），
  // 实际过期时间与所有文案（controller/extraction-ai/本文件）永远一致
  private readonly rsvpTtlMs = rsvpTtlHours() * 60 * 60 * 1000;

  constructor(
    private prisma: PrismaService,
    private crossConflict: ExpertCrossConflictService,
    private extractionAi: ExpertExtractionAiService,
    private notification: NotificationService,
    private embedding: EmbeddingService,
    private llm: LlmService,
    private ocr: OcrService,
    private readonly extraction: ExpertExtractionService,
    private readonly companyScope: CompanyScopeService,
    // FE-3（2026-09-24 全链审计）：递补也是委员会角色变更——广播 role_changed。
    // BidModule 已导出 BidGateway 且 ExpertModule 已 import（ExpertService 同款 @Optional 注入，无新增模块改动）
    @Optional() private readonly gateway?: BidGateway,
  ) {}

  /* ── 公司级数据隔离（2026-09-24 专家库接入，口径同 dashboard/procurements/progress）──
   * 规则：admin 默认全部公司、?companyId= 切单公司；非 admin 强制本人公司；
   * 专家归属落在 User.companyId（录入/导入时自操作人写时快照）。 */
  /** where 片段（spread 进 User 维度查询） */
  private async expertScopeFilter(user: AuthenticatedUser | undefined, companyId?: string): Promise<CompanyWhere> {
    const scope = await this.companyScope.resolveScope(user, companyId);
    return this.companyScope.filter(scope);
  }

  /** 单专家越权校验（:id 详情/写操作端点用；admin 全视野放行） */
  private async assertExpertInScope(expertId: string, user: AuthenticatedUser | undefined): Promise<void> {
    const scope = await this.companyScope.resolveScope(user);
    const expert = await this.prisma.user.findUnique({ where: { id: expertId }, select: { companyId: true } });
    if (!expert) throw new NotFoundException('专家不存在');
    this.companyScope.assertInScope(expert.companyId, scope);
  }

  /** 专家管理审计留痕（AuditLog 仅追加、无改删端点，天然不可篡改）。操作人缺失（种子导入等系统动作）静默跳过；写失败不阻断主流程。 */
  private async auditExpert(actorId: string | undefined, action: string, expertId: string, details?: Record<string, unknown>) {
    if (!actorId) return;
    try {
      await this.prisma.auditLog.create({
        data: { userId: actorId, action, resourceType: 'User', resourceId: expertId, details: (details ?? undefined) as any },
      });
    } catch (err) {
      new Logger(ExpertAdminService.name).warn(`专家审计留痕失败 [${action}] ${expertId}: ${(err as Error)?.message ?? err}`);
    }
  }

  /* ── 专家库 ── */

  /** 专家库列表（含 ExpertProfile，可按姓名或专业模糊搜索，服务端分页；公司隔离） */
  async listExperts(search?: string, specialty?: string, employer?: string, page = 1, pageSize = 20, user?: AuthenticatedUser, companyId?: string) {
    const where = {
      role: 'bid_expert' as const,
      // 公司级数据隔离：admin 可 ?companyId= 切单公司，非 admin 强制本人公司
      ...(await this.expertScopeFilter(user, companyId)),
      // 专业/公司筛选（ExpertProfile）：specialty 须独立于 employer——曾嵌在 employer 条件内，
      // 只传专业不传公司时筛选被静默丢弃，专业配额行人数恒为全库总数
      ...((specialty || employer) && { expertProfile: { ...(specialty && { specialty }), ...(employer && { employer }) } }),
      ...(search ? {
        OR: [
          { displayName: { contains: search, mode: 'insensitive' as const } },
          { expertProfile: { specialty: { contains: search, mode: 'insensitive' as const } } },
          { expertProfile: { employer: { contains: search, mode: 'insensitive' as const } } },
          { department: { name: { contains: search, mode: 'insensitive' as const } } },
        ],
      } : {}),
    };

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          displayName: true,
          email: true,
          isActive: true,
          company: true, // admin 全部公司视图按公司分组用
          department: { select: { id: true, name: true } },
          expertProfile: true,
          bidExperts: {
            select: { id: true, expertName: true, major: true, progress: true, signedIn: true, avoidanceConfirmed: true, totalScore: true, project: { select: { id: true, name: true, stage: true } } },
            orderBy: { createdAt: 'desc' },
          },
          _count: { select: { expertEvaluations: true } },
        },
        orderBy: { displayName: 'asc' },
      }),
    ]);

    // 补最新一次评价（A-E 等级制）；统计闸：按槽位取最新后再取专家最新（单人刷多条只算一票）
    const userIds = users.map(u => u.id);
    const latestEvals = latestExpertEvals(await this.prisma.expertEvaluation.findMany({
      where: { expertUserId: { in: userIds } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, expertUserId: true, overallGrade: true, createdAt: true, evaluatorId: true, projectId: true, updatedAt: true },
    }));
    const latestMap = new Map<string, any>();
    for (const e of latestEvals) {
      if (!latestMap.has(e.expertUserId)) latestMap.set(e.expertUserId, e);
    }
    for (const u of users as any[]) {
      const le = latestMap.get(u.id);
      u.latestEval = le ? { level: le.overallGrade, createdAt: le.createdAt } : null;
    }

    // 补平均等级（最常见等级，众数）——统计闸：槽位去重后计众数（方案B 多次评价不放大单人票权）
    const allEvals = latestExpertEvals(await this.prisma.expertEvaluation.findMany({
      where: { expertUserId: { in: userIds } },
      select: { expertUserId: true, overallGrade: true, evaluatorId: true, projectId: true, createdAt: true, updatedAt: true },
    }));
    const gradeCountsByUser = new Map<string, Record<string, number>>();
    for (const e of allEvals) {
      if (!gradeCountsByUser.has(e.expertUserId)) gradeCountsByUser.set(e.expertUserId, { A: 0, B: 0, C: 0, D: 0, E: 0 });
      const cnt = gradeCountsByUser.get(e.expertUserId)!;
      cnt[e.overallGrade] = (cnt[e.overallGrade] ?? 0) + 1;
    }
    for (const u of users as any[]) {
      const cnt = gradeCountsByUser.get(u.id);
      if (cnt) {
        let best = 'C', bestN = 0;
        for (const [g, n] of Object.entries(cnt)) { if (n > bestN) { best = g; bestN = n; } }
        u.avgGrade = best;
      } else {
        u.avgGrade = null;
      }
    }

    // 管理端列表默认脱敏（等保+密评）：PII 密文列出口掩码
    const items = (users as any[]).map(u => ({
      ...u,
      email: maskEmail(openPiiForMask(u.email)),
      expertProfile: u.expertProfile ? {
        ...u.expertProfile,
        phone: maskPhone(openPiiForMask(u.expertProfile.phone)),
        idNumber: maskIdNumber(openPiiForMask(u.expertProfile.idNumber)),
        licenseNo: maskLicenseNo(openPiiForMask(u.expertProfile.licenseNo)),
      } : u.expertProfile,
    }));
    return { total, page, pageSize, items };
  }

  /** 全部专业（去重；公司隔离——下拉只列可见专家的专业）。
   *  专家抽取不过滤（2026-10-20 用户裁定）：显式指定 companyId（支持逗号多选）时按所指公司并集
   *  取专业，任何账号放行——与抽取池 companyFilter 同口径（expert-extraction.service：配额声明
   *  公司=可跨公司抽，confirm 同白名单放行）。此前传参被登录人隔离吞掉，非 admin 配额行选多公司
   *  后专业下拉恒为本公司，看似"固定"。未指定时维持登录人公司口径（admin=全部，非 admin=本公司，
   *  供专家库列表页等非抽取场景复用）。
   *  scope='group'（抽取页挂载/AI 配额纠偏用）：全库去重专业、不挂任何公司过滤——与 AI 专业池
   *  （analyzeProjectSpecialties）、跨公司抽取同口径。专家库换血（2026-10-19，8 公司直挂）后各专业
   *  分散在全集团，挂载口径仍按本公司收窄会把 AI 配额行全部滤成 0 个专业。 */
  async listSpecialties(user?: AuthenticatedUser, companyId?: string, scope?: string) {
    const requested = (companyId ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && s !== 'all');
    let companyWhere: CompanyWhere;
    if (scope === 'group') {
      companyWhere = {};
    } else if (requested.length > 0) {
      const uniq = [...new Set(requested)];
      const valid = await this.prisma.company.findMany({ where: { id: { in: uniq } }, select: { id: true } });
      const validIds = new Set(valid.map((c) => c.id));
      companyWhere = { companyId: { in: uniq.filter((id) => validIds.has(id)) } };
    } else {
      companyWhere = await this.expertScopeFilter(user);
    }
    const rows = await this.prisma.expertProfile.findMany({
      where: { user: { isActive: true, role: 'bid_expert', ...companyWhere } },
      select: { specialty: true },
      distinct: ['specialty'],
      orderBy: { specialty: 'asc' },
    });
    return rows.map(r => r.specialty);
  }

  /** 全库各专业在库人数（抽取页配额卡「N人·库内」提示与行排序；不分公司，与 listSpecialties(scope=group) 同口径）。
   *  一次 groupBy 取代前端逐专业 listExperts 扇出（86 专业 × 1 次调用）。 */
  async specialtyPoolCounts() {
    const groups = await this.prisma.expertProfile.groupBy({
      by: ['specialty'],
      // 2026-10-28 口径收口：与 getDemandRepDirectory/抽取池同人口（ACTIVE+可用）——
      // 此前裸 isActive 会把 PENDING/SUSPENDED 专家计入「N人·库内」提示，递补预检按虚增池放行
      where: { entryStatus: 'ACTIVE', availability: '可用', user: { isActive: true, role: 'bid_expert' } },
      _count: { _all: true },
    });
    return groups
      .filter(g => g.specialty?.trim())
      .map(g => ({ specialty: g.specialty, count: g._count._all }))
      .sort((a, b) => b.count - a.count || a.specialty.localeCompare(b.specialty, 'zh'));
  }

  /**
   * 需求方代表目录（2026-10-20）：全库在用评标专家聚合为目录级字段（姓名/单位/部门/专业/公司id），
   * 供抽取页「公司→部门→专业」级联与指定代表搜索。**刻意不走公司隔离**——跨公司选需求方代表
   * 为 2026-09-24 用户拍板既定口径（抽取配额公司白名单，confirm 同白名单放行）；列表端点的隔离
   * 保护的是含电话/证件号/评价的全量档案浏览，本目录仅暴露抽取流程本就会回显的目录字段。
   * 前端曾在隔离列表端点上聚合级联，非 admin 只见本公司部门，其余公司误报「专家库内暂无专家」。
   */
  async getDemandRepDirectory() {
    const users = await this.prisma.user.findMany({
      where: {
        role: 'bid_expert',
        isActive: true,
        expertProfile: { entryStatus: 'ACTIVE', availability: '可用' },
      },
      select: {
        id: true,
        displayName: true,
        companyId: true,
        department: { select: { name: true } },
        expertProfile: { select: { employer: true, specialty: true } },
      },
      orderBy: { displayName: 'asc' },
    });
    return {
      items: users.map(u => ({
        userId: u.id,
        name: u.displayName,
        employer: u.expertProfile?.employer ?? '',
        specialty: u.expertProfile?.specialty ?? '',
        department: u.department?.name ?? '',
        companyId: u.companyId ?? '',
      })),
    };
  }

  /** 配额「公司」下拉候选（2026-10-20）：仅列库内确有可抽取专家的公司——与抽取池同资格口径
   *  （role=bid_expert + isActive + availability 可用 + entryStatus ACTIVE）。全公司口径：配额
   *  声明公司=用户拍板可跨公司（与 listSpecialties 显式 companyId 分支同语义），不受登录人 scope
   *  收窄。此前前端直拉 /companies 主数据全集，0 专家的残留公司也会进下拉（走查测试集团实录）。 */
  async listPoolCompanies() {
    const groups = await this.prisma.user.groupBy({
      by: ['companyId'],
      where: {
        role: 'bid_expert' as const,
        isActive: true,
        companyId: { not: null },
        expertProfile: { availability: '可用', entryStatus: 'ACTIVE' },
      },
    });
    const ids = [...new Set(groups.map((g) => g.companyId).filter((id): id is string => !!id))];
    if (ids.length === 0) return [];
    return this.prisma.company.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, shortName: true },
      orderBy: { name: 'asc' },
    });
  }

  /** 按公司分组全量计数（admin 全部公司视图的分组标题全量口径，与列表同 where；台账 company-counts 同款） */
  async companyCounts(search?: string, specialty?: string, employer?: string, user?: AuthenticatedUser) {
    const scope = await this.companyScope.resolveScope(user); // admin 默认全部 → 分组才有意义
    const groups = await this.prisma.user.groupBy({
      by: ['company'],
      where: {
        role: 'bid_expert' as const,
        ...this.companyScope.filter(scope),
        ...((specialty || employer) && { expertProfile: { ...(specialty && { specialty }), ...(employer && { employer }) } }),
        ...(search ? {
          OR: [
            { displayName: { contains: search, mode: 'insensitive' as const } },
            { expertProfile: { specialty: { contains: search, mode: 'insensitive' as const } } },
            { expertProfile: { employer: { contains: search, mode: 'insensitive' as const } } },
            { department: { name: { contains: search, mode: 'insensitive' as const } } },
          ],
        } : {}),
      },
      _count: { _all: true },
    });
    return groups
      .map(g => ({ name: g.company?.trim() || '未归属', count: g._count._all }))
      .sort((a, b) => (a.name === '未归属' ? 1 : b.name === '未归属' ? -1 : b.count - a.count || a.name.localeCompare(b.name, 'zh')));
  }

  /** 专家详情（公司隔离：非 admin 直调他人公司专家 → 403） */
  async getExpert(userId: string, actor?: AuthenticatedUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, displayName: true, email: true, role: true, isActive: true, companyId: true, company: true, department: { select: { id: true, name: true } }, createdAt: true, expertProfile: true },
    });
    if (!user || user.role !== 'bid_expert') throw new NotFoundException('专家不存在');
    if (actor) {
      const scope = await this.companyScope.resolveScope(actor);
      this.companyScope.assertInScope(user.companyId, scope);
    }

    const assignmentsRaw = await this.prisma.bidExpert.findMany({
      where: { userId },
      include: { project: { select: { id: true, projectCode: true, name: true, stage: true, procurementMethod: true, openTime: true } }, scoreRecords: { include: { scoreItem: { select: { name: true, category: true, maxScore: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    // 邀请全量轨迹（2026-10-21 用户口径：理由须全量记录，非仅最后一次）：按行挂载，
    // 含每次流转的时刻/操作人/理由——详情页逐条展示
    const assignmentLogs = assignmentsRaw.length > 0
      ? await this.prisma.expertInvitationLog.findMany({
          where: { bidExpertId: { in: assignmentsRaw.map(a => a.id) } },
          orderBy: { createdAt: 'asc' },
        }).catch(() => [])
      : [];
    const trailByAssignment = new Map<string, unknown[]>();
    for (const l of assignmentLogs) {
      const arr = (trailByAssignment.get(l.bidExpertId) ?? []) as unknown[];
      arr.push({
        action: l.action, actorType: l.actorType, actorName: l.actorName,
        fromStatus: l.fromStatus, toStatus: l.toStatus, fromRole: l.fromRole, toRole: l.toRole,
        reason: l.reason, createdAt: l.createdAt.toISOString(),
      });
      trailByAssignment.set(l.bidExpertId, arr);
    }
    const assignments = assignmentsRaw.map(a => ({
      ...a,
      invitationActorType: (a.invitationActorType as string | null) ?? (a.rsvpRespondedAt ? 'EXPERT' : null),
      invitationTrail: trailByAssignment.get(a.id) ?? [],
    }));

    // 邀请信用摘要（2026-10-21 用户口径：中途毁约记录在专家信息中 + 连续拒绝预警）——
    // 从已取的全量 assignments/logs 就地聚合，不新增查询
    const projectNameByBe = new Map(assignmentsRaw.map(a => [a.id, a.project?.name ?? '']));
    const decisionEvents = assignmentLogs
      .filter((l: any) => ['RESPONDED', 'STAFF_MARKED', 'AUTO_DECLINED'].includes(l.action) && ['confirmed', 'declined'].includes(l.toStatus ?? ''))
      .sort((a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime());
    let expertConsecutiveDeclined = 0;
    for (let i = decisionEvents.length - 1; i >= 0; i--) {
      if (decisionEvents[i].toStatus !== 'declined') break;
      expertConsecutiveDeclined++;
    }
    // 毁约归因（2026-10-21 深检修正，逻辑见 expertBreachEventsFromLogs 注释）：
    // 系统转正后的代婉拒不计毁约（专家未亲口答应），本人/代回应确认过的才计
    const breachEvents = expertBreachEventsFromLogs(assignmentLogs as any, projectNameByBe);
    const invitationSummary = {
      invited: assignmentsRaw.length,
      confirmed: assignmentsRaw.filter(a => a.invitationStatus === 'confirmed').length,
      declined: assignmentsRaw.filter(a => a.invitationStatus === 'declined').length,
      pending: assignmentsRaw.filter(a => a.invitationStatus === 'pending').length,
      overrideAfterConfirm: breachEvents.length, // 毁约次数：确认后被改为拒绝
      consecutiveDeclined: expertConsecutiveDeclined,
      breachEvents,
    };

    // R6-7③（2026-09-30 审计 A1）：获评次数此前 take:10 封顶——库页 _count 显示 15、
    // 详情显示 10、分布也只按最近 10 条算，同数两页矛盾。取全量算真实计数与分布，
    // 明细列表另限展示条数。
    const evaluations = await this.prisma.expertEvaluation.findMany({
      where: { expertUserId: userId },
      include: { evaluator: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const totalProjects = assignments.length;
    const completedProjects = assignments.filter(a => a.progress >= 100).length;
    const signedInProjects = assignments.filter(a => a.signedIn).length;
    const gradeCounts = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    for (const e of evaluations) gradeCounts[e.overallGrade] = (gradeCounts[e.overallGrade] ?? 0) + 1;

    // R6 终审 P2-5：计数/分布按全量算，但响应明细限最近 20 条（几百条评价时详情响应线性膨胀）
    // 管理端默认脱敏（等保+密评）：明文走 reveal 端点（入 SensitiveAccessLog 审计）
    // 专家编号（2026-10-22 用户口径：标注归属公司编码）：{公司码}-{同公司入库序号 4 位}，
    // 如设计院 SWHI-0001。序号按 (createdAt, id) 稳定排名（同库重算结果恒定）；无归属公司回退 ZJ。
    let expertNo = `ZJ-${String(user.id.slice(-6)).toUpperCase()}`;
    if (user.companyId) {
      const [company, rank] = await Promise.all([
        this.prisma.company.findUnique({ where: { id: user.companyId }, select: { code: true } }),
        this.prisma.user.count({
          where: {
            role: 'bid_expert',
            companyId: user.companyId,
            OR: [
              { createdAt: { lt: user.createdAt } },
              { createdAt: user.createdAt, id: { lt: user.id } },
            ],
          },
        }),
      ]);
      if (company?.code) expertNo = `${company.code.toUpperCase()}-${String(rank + 1).padStart(4, '0')}`;
    }

    return {
      ...user,
      expertNo,
      email: maskEmail(openPiiForMask(user.email)),
      expertProfile: user.expertProfile ? {
        ...user.expertProfile,
        phone: maskPhone(openPiiForMask(user.expertProfile.phone)),
        idNumber: maskIdNumber(openPiiForMask(user.expertProfile.idNumber)),
        licenseNo: maskLicenseNo(openPiiForMask(user.expertProfile.licenseNo)),
      } : user.expertProfile,
      assignments,
      evaluations: evaluations.slice(0, 20),
      statistics: { totalProjects, completedProjects, signedInProjects, evalCount: evaluations.length, gradeCounts },
      // 邀请信用摘要（2026-10-21）：毁约记录 + 连拒段预警口径
      invitationSummary,
    };
  }

  /** 专家参与的评审项目列表（公司隔离） */
  async listExpertProjects(userId: string, actor?: AuthenticatedUser) {
    if (actor) await this.assertExpertInScope(userId, actor);
    return this.prisma.bidExpert.findMany({
      where: { userId },
      include: { project: { select: { id: true, projectCode: true, name: true, stage: true, procurementMethod: true, openTime: true, deadline: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /* 专家录入 */

  async createExpert(dto: CreateExpertDto, operatorId?: string) {
    const normalizedName = dto.displayName.trim();
    if (await this.prisma.user.findFirst({ where: { username: dto.username, role: 'bid_expert' } })) {
      throw new BadRequestException({ error: '账号已存在', code: 'DUPLICATE_USERNAME' });
    }
    // 部门：按名称查找已有记录，不存在则新建
    let departmentId: string | undefined;
    if (dto.departmentName?.trim()) {
      const name = dto.departmentName.trim();
      const existing = await this.prisma.department.findUnique({ where: { name }, select: { id: true } });
      if (existing) {
        departmentId = existing.id;
      } else {
        const created = await this.prisma.department.create({ data: { name } });
        departmentId = created.id;
      }
    }
    try {
      // 公司归属写时快照（自操作人）：本公司账号录入的专家入本公司库。
      // 2026-10-15 工作单位=公司选择（:3005 注册同款 UnitSearchSelect 传单位名）：
      //  - companyId 轨（id 直选）：以所选公司为准，employer 同源为公司名（防两列漂移）；
      //  - 名称轨：单位名命中公司主数据即同源落归属；未命中（外部单位如设计院/高校）保留自由文本+操作人快照
      const { companyId: opCompanyId, companyName: opCompanyName } = operatorId ? await this.operatorCompanyOf(operatorId) : { companyId: null, companyName: null };
      let companyId = opCompanyId;
      let companyName = opCompanyName;
      let employer = dto.employer;
      if (dto.companyId?.trim()) {
        const selected = await this.prisma.company.findUnique({
          where: { id: dto.companyId },
          select: { id: true, name: true },
        });
        if (!selected) throw new BadRequestException({ error: '所选公司不存在，请重新选择工作单位', code: 'COMPANY_NOT_FOUND' });
        companyId = selected.id;
        companyName = selected.name;
        employer = selected.name;
      } else if (dto.employer?.trim()) {
        const byName = await this.prisma.company.findFirst({
          where: { name: dto.employer.trim() },
          select: { id: true, name: true },
        });
        if (byName) { companyId = byName.id; companyName = byName.name; }
      }
      return await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: dto.username,
          displayName: normalizedName,
          email: sealPii(dto.email) ?? null, // PII 国密密封（等保+密评）
          passwordHash: hashSync(dto.password?.trim() || dto.idNumber?.trim() || 'expert@2026', 10), // R2：缺省口令=身份证号（原文哈希，先于密封）
          role: 'bid_expert',
          isActive: true,
          departmentId,
          ...(companyId && { companyId, company: companyName }),
          expertProfile: {
            create: {
              specialty: dto.specialty,
              title: dto.title,
              employer,
              phone: sealPii(dto.phone) ?? null,
              idNumber: sealPii(dto.idNumber) ?? null,
              ethnicity: dto.ethnicity,
              education: dto.education,
              licenseNo: sealPii(dto.licenseNo) ?? null,
              availability: '可用',
              entryStatus: 'PENDING', // CTS A-218 录入后待审核，admin「审核入库」留痕 verifiedBy/At
              notes: dto.notes,
            },
          },
        },
        include: { expertProfile: true, department: { select: { id: true, name: true } } },
      });
      // 剥离密码哈希，避免敏感字段外泄；PII 密文列出口掩码（等保+密评，口径同列表/详情）
      const { passwordHash, ...safeUser } = user;
      if (safeUser.expertProfile) {
        (safeUser as any).expertProfile = {
          ...safeUser.expertProfile,
          phone: maskPhone(openPiiForMask(safeUser.expertProfile.phone)),
          idNumber: maskIdNumber(openPiiForMask(safeUser.expertProfile.idNumber)),
          licenseNo: maskLicenseNo(openPiiForMask(safeUser.expertProfile.licenseNo)),
        };
      }
      if (safeUser.email) (safeUser as any).email = maskEmail(openPiiForMask(safeUser.email));
      // 审计留痕：单条录入（CSV 导入与种子导入不在此列，各自单独记账）
      await this.auditExpert(operatorId, 'EXPERT_CREATE', user.id, {
        expertName: normalizedName, specialty: dto.specialty, employer: employer ?? null,
      });
      return safeUser;
      });
    } catch (err) {
      // 并发同名注册会双双通过 findFirst 查重，第二个 create 触发 @@unique([username, role]) P2002 → 转 409 语义而非 500
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException({ error: '账号已存在', code: 'DUPLICATE_USERNAME' });
      }
      throw err;
    }
  }

  /** 从种子数据批量导入专家（仅导入尚未存在于数据库中的专家） */
  async importFromSeed(operatorId?: string) {
    const logger = new Logger(ExpertAdminService.name);
    const seedDir = join(__dirname, '..', '..', '..', 'prisma', 'seed-data');
    // R2（2026-09-18 身份核验设计）：批量导入口令=各自档案身份证号，缺失回退 expert@2026（按口令去重哈希）
    const pwHashCache = new Map<string, string>();
    const hashOf = (pw: string) => {
      let h = pwHashCache.get(pw);
      if (!h) { h = hashSync(pw, 10); pwHashCache.set(pw, h); }
      return h;
    };

    // 读取种子数据
    let users: any[] = [];
    let profiles: any[] = [];
    try {
      users = JSON.parse(readFileSync(join(seedDir, 'User.json'), 'utf-8')) as any[];
      profiles = JSON.parse(readFileSync(join(seedDir, 'ExpertProfile.json'), 'utf-8')) as any[];
    } catch {
      throw new BadRequestException('种子数据文件不存在，请先运行 dump 导出快照');
    }

    const expertProfileUserIds = new Set(profiles.map((p: any) => p.userId));
    const seedExpertUsers = users.filter((u: any) => expertProfileUserIds.has(u.id) && u.role === 'bid_expert');

    // 已在库中的用户名
    const existingUsernames = new Set(
      (await this.prisma.user.findMany({ where: { role: 'bid_expert' }, select: { username: true } })).map(u => u.username)
    );

    let imported = 0;
    let skipped = 0;

    for (const seedUser of seedExpertUsers) {
      const targetUsername = (seedUser.displayName ?? '').trim() || seedUser.username;

      // 检查用户名是否已存在（bid_expert 下）
      if (existingUsernames.has(targetUsername)) {
        skipped++;
        continue;
      }

      const profile = profiles.find((p: any) => p.userId === seedUser.id);

      // 公司归属写时快照：种子导入同录入口径，归操作人公司
      const { companyId: opCompanyId, companyName: opCompanyName } = operatorId ? await this.operatorCompanyOf(operatorId) : { companyId: null, companyName: null };

      try {
        await this.prisma.user.create({
          data: {
            username: targetUsername,
            displayName: targetUsername,
            passwordHash: hashOf((profile?.idNumber ?? '').toString().trim() || 'expert@2026'),
            role: 'bid_expert',
            isActive: true,
            ...(opCompanyId && { companyId: opCompanyId, company: opCompanyName }),
            expertProfile: {
              create: {
                specialty: profile?.specialty ?? '未分类',
                title: profile?.title ?? '',
                employer: profile?.employer ?? '',
                phone: sealPii(profile?.phone ?? '') ?? '', // PII 国密密封（等保+密评）
                idNumber: sealPii(profile?.idNumber ?? null) ?? null,
                availability: '可用',
                entryStatus: 'PENDING', // CTS A-218 批量导入同样待审核入库
                notes: profile?.notes ?? '',
              },
            },
          },
        });
        existingUsernames.add(targetUsername);
        imported++;
      } catch (err: any) {
        logger.warn(`跳过专家「${targetUsername}」: ${err?.message ?? String(err)}`);
        skipped++;
      }
    }

    return { imported, skipped, total: seedExpertUsers.length };
  }

  /** 启用/停用专家（停用 = isActive=false + availability 停用；公司隔离） */
  async setAvailability(userId: string, available: boolean, operatorId?: string, actor?: AuthenticatedUser) {
    if (actor) await this.assertExpertInScope(userId, actor);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    // 仅限专家角色，防止越权停用任意账户（含 admin/员工）
    if (!user || user.role !== 'bid_expert') throw new NotFoundException('专家不存在');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { isActive: available } }),
      // 启用时清空退库标记，避免"可用却带退库标记"的脏数据；停用时保留退库字段供退库流程写入
      this.prisma.expertProfile.updateMany({
        where: { userId },
        data: {
          availability: available ? '可用' : '停用',
          ...(available ? { retiredAt: null, retireReason: null } : {}),
        },
      }),
    ]);
    await this.auditExpert(operatorId, available ? 'EXPERT_ENABLE' : 'EXPERT_DISABLE', userId, { expertName: user.displayName });
    return { success: true };
  }

  /** 更新专家资料（公司隔离） */
  async updateProfile(userId: string, dto: UpdateExpertProfileDto, operatorId?: string, actor?: AuthenticatedUser) {
    if (actor) await this.assertExpertInScope(userId, actor);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'bid_expert') throw new NotFoundException('专家不存在');

    // R6-7（2026-09-30 审计 B5）：已退库/暂停的专家禁止经编辑资料把 availability 改回
    // '可用'——退库时落 availability='停用'+entryStatus=RETIRED，此入口可单方面改回可用
    // 造矛盾档案（抽取虽按 entryStatus 拦，但统计/档案失真）
    if (dto.availability !== undefined) {
      const profile = await this.prisma.expertProfile.findUnique({ where: { userId }, select: { entryStatus: true } });
      if (profile && (profile.entryStatus === 'RETIRED' || profile.entryStatus === 'SUSPENDED') && dto.availability === '可用') {
        throw new BadRequestException({ error: '已退库/暂停的专家不能直接改为可用，请先恢复入库状态', code: 'EXPERT_STATUS_LOCKED' });
      }
    }

    // 部门：按名称查找已有记录，不存在则新建
    let departmentId: string | null | undefined;
    if (dto.departmentName !== undefined) {
      if (dto.departmentName.trim()) {
        const name = dto.departmentName.trim();
        const existing = await this.prisma.department.findUnique({ where: { name }, select: { id: true } });
        if (existing) {
          departmentId = existing.id;
        } else {
          const created = await this.prisma.department.create({ data: { name } });
          departmentId = created.id;
        }
      } else {
        departmentId = null; // 允许清空部门
      }
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          ...(dto.displayName && { displayName: dto.displayName }),
          ...(dto.email !== undefined && { email: sealPii(dto.email) ?? null }), // PII 国密密封
          ...(departmentId !== undefined && { departmentId }),
        },
      }),
      this.prisma.expertProfile.upsert({
        where: { userId },
        update: {
          ...(dto.specialty && { specialty: dto.specialty }),
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.employer !== undefined && { employer: dto.employer }),
          ...(dto.phone !== undefined && { phone: sealPii(dto.phone) ?? null }), // PII 国密密封
          ...(dto.idNumber !== undefined && { idNumber: sealPii(dto.idNumber) ?? null }),
          ...(dto.ethnicity !== undefined && { ethnicity: dto.ethnicity }),
          ...(dto.education !== undefined && { education: dto.education }),
          ...(dto.licenseNo !== undefined && { licenseNo: sealPii(dto.licenseNo) ?? null }),
          ...(dto.availability !== undefined && { availability: dto.availability }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          ...(dto.regionCode !== undefined && { regionCode: dto.regionCode }),
          ...(dto.expertLevel !== undefined && { expertLevel: dto.expertLevel }),
        },
        create: { userId, specialty: dto.specialty || '综合', title: dto.title, employer: dto.employer, phone: sealPii(dto.phone) ?? null, idNumber: sealPii(dto.idNumber) ?? null, ethnicity: dto.ethnicity, education: dto.education, licenseNo: sealPii(dto.licenseNo) ?? null, availability: dto.availability ?? '可用', notes: dto.notes, regionCode: dto.regionCode, expertLevel: dto.expertLevel },
      }),
    ]);
    await this.auditExpert(operatorId, 'EXPERT_UPDATE', userId, { expertName: user.displayName });
    return { success: true };
  }

  /** AI 选定评审组长：综合职称、专业、单位等，LLM 给出推荐 */
  async aiSelectLeader(projectId: string) {
    const experts = await this.prisma.bidExpert.findMany({
      where: { projectId, expertRole: '正选', invitationStatus: 'confirmed' },
      include: { user: { select: { expertProfile: { select: { title: true, employer: true, education: true } } } } },
    });
    if (experts.length === 0) throw new BadRequestException('暂无已确认参加的专家');

    // 构建专家摘要送 LLM
    const lines = experts.map((e, i) => {
      const p = e.user?.expertProfile;
      return `e${i} | ${e.expertName} | 专业:${e.major} | ${p?.title || '—'} | 学历:${p?.education || '—'} | ${p?.employer || '—'}`;
    }).join('\n');

    const system = [
      '你是评标组长选定助手。根据专家的职称、学历、专业、工作单位等维度，',
      '推荐最合适的评审组长（通常选职称最高、学历最高、综合资历最深的专家）。',
      '只输出 JSON：{"leaderId":"e0","reason":"≤40字说明为什么推荐此人"}',
    ].join('');
    const userPrompt = `已确认参加的专家：\n${lines}`;

    let leaderId: string | null = null;
    let reason = '';
    try {
      // 120s：内网 CPU 小模型（qwen3-4b · llama-server）prefill+生成远慢于云 API，15s 必超时；
      // 失败仍有 leaderId=null 兜底（手动指定组长）， retries=1 限制最坏等待（设计 §6.3，2026-10-30）
      const raw = await this.llm.chat(system, userPrompt, 0.2, undefined, undefined, { timeoutMs: 120_000, retries: 1 });
      const json = raw?.match(/\{[\s\S]*\}/);
      if (json) {
        const parsed = JSON.parse(json[0]);
        const idx = String(parsed.leaderId || '').match(/\d+/)?.[0];
        if (idx != null && +idx < experts.length) { leaderId = experts[+idx].userId; reason = String(parsed.reason || '').slice(0, 80); }
      }
    } catch {
      // AI 不可用 → 规则兜底
      const titleRank = (t?: string | null) => /正高|研究员/.test(t || '') ? 4 : /高级|副高/.test(t || '') ? 3 : /中级|工程师/.test(t || '') ? 2 : 1;
      const eduRank = (e?: string | null) => /博士/.test(e || '') ? 4 : /硕士/.test(e || '') ? 3 : /本科/.test(e || '') ? 2 : 1;
      let best = experts[0]; let bestScore = -1;
      for (const e of experts) {
        const p = e.user?.expertProfile;
        const score = titleRank(p?.title) * 10 + eduRank(p?.education);
        if (score > bestScore) { bestScore = score; best = e; }
      }
      leaderId = best.userId; reason = `规则推荐：${best.expertName}（${best.user?.expertProfile?.title || '—'}、${best.user?.expertProfile?.education || '—'}）`;
    }

    if (!leaderId) throw new Error('AI 未能选出组长，请手动切换');

    // 写入 DB
    await this.prisma.$transaction([
      this.prisma.bidExpert.updateMany({ where: { projectId, isLead: true }, data: { isLead: false } }),
      this.prisma.bidExpert.update({ where: { projectId_userId: { projectId, userId: leaderId } }, data: { isLead: true } }),
    ]);

    const expert = experts.find(e => e.userId === leaderId);
    return { leaderId, leaderName: expert?.expertName ?? '', reason };
  }

  /** 设置/切换评审组长：取消旧组长，设置新组长 */
  async setLeader(projectId: string, userId: string) {
    // 校验目标专家存在于该项目
    const target = await this.prisma.bidExpert.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!target) throw new NotFoundException('该专家不属于本项目');
    if (target.expertRole !== '正选') throw new BadRequestException('仅正选专家可设为组长');
    // I5（2026-09-24 全链审计）：pending/declined 正选不得任组长——兄弟路径只往 confirmed 转移组长；
    // declined 组长=末签/异议/表决全链死锁。
    if (target.invitationStatus !== 'confirmed') throw new BadRequestException('仅已确认参加的正选专家可设为组长');
    // P1-7（#47）：采购人代表不得担任评审组长（多地采购管理办法明确规定）
    if (target.isPurchaserRepresentative) throw new BadRequestException('采购人代表不得担任评审组长');

    await this.prisma.$transaction([
      // 取消所有现有组长
      this.prisma.bidExpert.updateMany({
        where: { projectId, isLead: true },
        data: { isLead: false },
      }),
      // 设置新组长
      this.prisma.bidExpert.update({
        where: { projectId_userId: { projectId, userId } },
        data: { isLead: true },
      }),
    ]);

    return { success: true, leaderId: userId };
  }

  /** A-132：评委职责分工（技术/商务分组 + 主审/复核），partial 更新，写入报告委员会名单（见 docx 任务） */
  async setCommitteeAssignment(projectId: string, dto: CommitteeAssignmentDto, actorId?: string) {
    // service 层白名单双保险（DTO IsIn 在管道层，绕过管道的内部调用仍被拦）
    const REVIEW_GROUPS = ['技术组', '商务组', '综合组'];
    const DUTY_ROLES = ['主审', '复核', '成员'];
    for (const a of dto.assignments) {
      // null=显式清除（写 NULL）、undefined=不动——两者都不在白名单拒绝面内
      if (a.reviewGroup !== null && a.reviewGroup !== undefined && !REVIEW_GROUPS.includes(a.reviewGroup)
        || a.dutyRole !== null && a.dutyRole !== undefined && !DUTY_ROLES.includes(a.dutyRole)) {
        throw new BadRequestException({ error: `专家 ${a.userId} 分工值非法（reviewGroup/dutyRole 不在白名单）`, code: 'INVALID_COMMITTEE_VALUE' });
      }
    }
    const roster = await this.prisma.bidExpert.findMany({ where: { projectId, expertRole: '正选' }, select: { userId: true } });
    const ids = new Set(roster.map(r => r.userId));
    for (const a of dto.assignments) {
      if (!ids.has(a.userId)) throw new BadRequestException({ error: `专家 ${a.userId} 不在本项目正选名单`, code: 'EXPERT_NOT_IN_COMMITTEE' });
    }
    await this.prisma.$transaction(async (tx) => {
      for (const a of dto.assignments) {
        await tx.bidExpert.update({ where: { projectId_userId: { projectId, userId: a.userId } },
          data: {
            reviewGroup: a.reviewGroup === undefined ? undefined : a.reviewGroup,
            dutyRole: a.dutyRole === undefined ? undefined : a.dutyRole,
          } });
      }
      await tx.bidSupervisionLog.create({ data: { projectId, time: new Date(), role: '系统', target: '评标委员会',
        action: '评委分工设置', result: dto.assignments.map(a => `${a.userId}:${a.reviewGroup ?? '—'}/${a.dutyRole ?? '—'}`).join('；'), riskFlag: '无', operatorId: actorId ?? undefined } });
    });
    return { success: true };
  }

  /** 查询项目专家邀请状态（正选+候补） */
  async getProjectInvitations(projectId: string) {
    // 先清理超时未回复的 pending 邀请——与 RSVP verify 行为一致（TTL 过期自动弃权并递补）
    const expiredPending = await this.prisma.bidExpert.findMany({
      where: { projectId, invitationStatus: 'pending', rsvpExpiresAt: { lt: new Date() } },
      select: { id: true, expertRole: true, userId: true, expertName: true },
    });
    if (expiredPending.length > 0) {
      await this.prisma.bidExpert.updateMany({
        where: { id: { in: expiredPending.map(e => e.id) } },
        data: { invitationStatus: 'declined', rsvpRespondedAt: new Date(), invitationActorType: 'SYSTEM' },
      });
      // 超时弃权轨迹（2026-10-21 留痕适配）：SYSTEM 作答方与专家主动婉拒区分展示 + 连拒预警
      for (const e of expiredPending) {
        await writeInvitationLog(this.prisma, {
          bidExpertId: e.id, projectId, userId: e.userId,
          action: 'AUTO_DECLINED', actorType: 'SYSTEM', fromStatus: 'pending', toStatus: 'declined',
          reason: '邀请链接超时未回复，系统自动视为弃权',
        });
        await this.maybeAlertExpertDeclineStreak(e.userId, e.expertName ?? '');
      }
      // 仅正选过期才递补（候补过期不占正选席位）；失败静默，不阻塞列表返回
      if (expiredPending.some(e => e.expertRole === '正选')) {
        await this.maybeAutoPromote(projectId).catch(() => null); // I2：阶段感知递补——评标中抑制、终态拒绝
      }
    }

    const records = await this.prisma.bidExpert.findMany({
      where: { projectId },
      orderBy: [{ expertRole: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true, userId: true, expertName: true, major: true,
        isLead: true, expertRole: true, invitationStatus: true,
        reviewGroup: true, dutyRole: true,
        rsvpToken: true, rsvpRespondedAt: true, rsvpExpiresAt: true,
        // 邀请作答留痕（2026-10-21）：作答方/理由/自答快照 + 行内轨迹
        invitationActorType: true, invitationActorName: true, invitationReason: true,
        expertRespondedAt: true, expertStatus: true,
        user: { select: { phone: true, expertProfile: { select: { title: true, employer: true, phone: true } } } },
      },
    });
    // 邀请轨迹（按行聚合，时间正序）：面板行内可查 通知→自答→代变更→递补→替换 全程
    const trailByExpert = new Map<string, unknown[]>();
    const notifiedByExpert = new Set<string>();
    {
      const logs = await this.prisma.expertInvitationLog.findMany({
        where: { bidExpertId: { in: records.map(r => r.id) } },
        orderBy: { createdAt: 'asc' },
      });
      for (const l of logs) {
        if (l.action === 'NOTIFIED') notifiedByExpert.add(l.bidExpertId); // 2026-10-27：发送留痕=已通知真值
        const arr = (trailByExpert.get(l.bidExpertId) ?? []) as unknown[];
        arr.push({
          action: l.action, actorType: l.actorType, actorName: l.actorName,
          fromStatus: l.fromStatus, toStatus: l.toStatus, fromRole: l.fromRole, toRole: l.toRole,
          reason: l.reason, createdAt: l.createdAt.toISOString(),
        });
        trailByExpert.set(l.bidExpertId, arr);
      }
    }
    const confirmed = records.filter(r => r.invitationStatus === 'confirmed').length;
    const declined = records.filter(r => r.invitationStatus === 'declined').length;
    const pending = records.filter(r => r.invitationStatus === 'pending').length;
    const candidates = records.filter(r => r.expertRole === '候补' && r.invitationStatus === 'pending');
    return {
      // 抽取通知/RSVP 跟进明文出口（2026-10-12 用户裁定）：主持人逐一致电确认到场，掩码+逐行点击揭示不便；存储仍密封
      experts: records.map(r => ({
        ...r,
        title: r.user?.expertProfile?.title ?? null,
        employer: r.user?.expertProfile?.employer ?? null,
        phone: openPiiForMask(r.user?.expertProfile?.phone ?? r.user?.phone ?? null),
        rsvpNo: r.id.slice(-8).toUpperCase(),
        notified: notifiedByExpert.has(r.id), // 2026-10-27：NOTIFIED 留痕派生——刷新后按钮态/兜底还原/落步共用
        // 作答方口径（null=存量已答行，展示层按专家自答兜底）
        invitationActorType: (r.invitationActorType as string | null) ?? (r.rsvpRespondedAt ? 'EXPERT' : null),
        invitationTrail: trailByExpert.get(r.id) ?? [],
      })),
      summary: {
        total: records.length,
        confirmed,
        declined,
        pending,
        availableCandidates: candidates.length,
        allDeclined: records.filter(r => r.expertRole === '正选').every(r => r.invitationStatus !== 'pending')
          && records.filter(r => r.expertRole === '候补').every(r => r.invitationStatus !== 'pending'),
      },
    };
  }

  /**
   * 导出专家抽取情况（Word 证明材料，2026-10-22）：抽取过程细节（方式/轮次/操作人/池规模/
   * 命中序列——来自 EXPERT_EXTRACTION_CONFIRMED 审计快照）+ 正选/候补专家详情表（含确认
   * 状态与作答留痕）。联系电话走 openPiiForMask 明文口径（2026-10-12 裁定：staff 视野
   * 证明材料需要逐一致电核实，掩码无意义）。
   */
  async buildExtractionExport(projectId: string): Promise<{ buffer: Buffer; filename: string }> {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: {
        name: true, projectCode: true, procurementMethod: true, openTime: true, stage: true,
        projectManagementItemId: true,
      },
    });
    if (!project) throw new NotFoundException('项目不存在');
    let projectCode = project.projectCode;
    if (project.projectManagementItemId) {
      const pm = await this.prisma.projectManagementItem.findUnique({ where: { id: project.projectManagementItemId }, select: { projectCode: true } });
      if (pm?.projectCode) projectCode = pm.projectCode;
    }

    // 抽取配置快照与 AI 辅助环节留痕（2026-10-22 补齐：preview 调用 body 带完整配额、
    // ai-leader/analyze-project 调用与 AI 通知文案均在操作日志）——按 projectId 从 body 反查
    const extractOpLogs = await this.prisma.operationLog.findMany({
      where: {
        method: 'POST',
        path: {
          in: [
            '/api/expert-admin/extract',
            '/api/expert-admin/extract/ai-leader',
            '/api/expert-admin/extract/analyze-project',
            '/api/expert-admin/extract/notify',
          ],
        },
        body: { path: ['projectId'], equals: projectId },
      },
      orderBy: { createdAt: 'asc' },
      select: { path: true, body: true, createdAt: true, username: true },
    }).catch(() => [] as { path: string; body: unknown; createdAt: Date; username: string | null }[]);

    // 配置快照：preview 调用按内容去重（同一配置多次预览只列一次）
    const rawConfigs = extractOpLogs.filter(l => l.path === '/api/expert-admin/extract') as Array<{ body: any; createdAt: Date; username: string | null }>;
    const configSnapshots: Array<{ key: string; letter: string; at: Date; body: any; username: string | null }> = [];
    for (const l of rawConfigs) {
      const key = JSON.stringify({ m: l.body?.extractMode, t: l.body?.totalNeeded, a: l.body?.alternatives, q: l.body?.manualQuotas, e: l.body?.excludedUserIds, em: l.body?.employer });
      if (configSnapshots.some(c => c.key === key)) continue;
      configSnapshots.push({ key, letter: String.fromCharCode(65 + configSnapshots.length), at: l.createdAt, body: l.body ?? {}, username: l.username ?? null });
    }
    // 配额里公司 id → 名称；预排除专家 id → 姓名
    const quotaCompanyIds = [...new Set(configSnapshots.flatMap(c => (c.body?.manualQuotas ?? []).flatMap((q: any) => q?.companyIds ?? []).filter(Boolean) as string[]))];
    const excludedIds = [...new Set(configSnapshots.flatMap(c => (c.body?.excludedUserIds ?? []) as string[]))];
    const [quotaCompanies, excludedUsers] = await Promise.all([
      quotaCompanyIds.length > 0
        ? this.prisma.company.findMany({ where: { id: { in: quotaCompanyIds } }, select: { id: true, name: true } }).catch(() => [] as { id: string; name: string }[])
        : Promise.resolve([] as { id: string; name: string }[]),
      excludedIds.length > 0
        ? this.prisma.user.findMany({ where: { id: { in: excludedIds } }, select: { id: true, displayName: true } }).catch(() => [] as { id: string; displayName: string }[])
        : Promise.resolve([] as { id: string; displayName: string }[]),
    ]);
    const companyNameById = new Map(quotaCompanies.map(c => [c.id, c.name]));
    const excludedNameById = new Map(excludedUsers.map(u => [u.id, u.displayName]));

    // 抽取事件（含补选轮次）：审计快照带 extractMode/池/命中序列
    const extractionEvents = await this.prisma.auditLog.findMany({
      where: { action: 'EXPERT_EXTRACTION_CONFIRMED', resourceId: projectId },
      orderBy: { createdAt: 'asc' },
      select: { details: true, createdAt: true, user: { select: { displayName: true } } },
    });

    // 当前名册（正选+候补）+ 详情 + 邀请留痕
    const roster = await this.prisma.bidExpert.findMany({
      where: { projectId },
      orderBy: [{ expertRole: 'desc' }, { createdAt: 'asc' }],
      include: { user: { select: { displayName: true, department: { select: { name: true } }, expertProfile: { select: { title: true, employer: true, phone: true } } } } },
    });
    // 邀请轨迹按行挂载 + 确认方式/时间三级推导（2026-10-23 用户实录：存量行经旧确认
    // 端点只写状态不写时间且无轨迹，列全显「—」）——优先轨迹终笔，次行字段
    // （rsvpRespondedAt/invitationActorType），存量兜底：confirmed 无痕=工作人员确认、
    // 时间取行更新时刻（该路径确认后无其他写点，updatedAt≈确认时刻）
    const rosterLogs = roster.length > 0
      ? await this.prisma.expertInvitationLog.findMany({
          where: { bidExpertId: { in: roster.map(r => r.id) } },
          orderBy: { createdAt: 'asc' },
        }).catch(() => [] as Array<{ bidExpertId: string; action: string; actorType: string; toStatus: string | null; createdAt: Date }>)
      : [];
    const trailByBeId = new Map<string, typeof rosterLogs>();
    for (const l of rosterLogs) {
      const arr = trailByBeId.get(l.bidExpertId) ?? [];
      arr.push(l);
      trailByBeId.set(l.bidExpertId, arr);
    }
    const confirmOf = (r: (typeof roster)[number]) => {
      const trail = (trailByBeId.get(r.id) ?? []).filter(t =>
        ['RESPONDED', 'STAFF_MARKED', 'AUTO_DECLINED', 'PROMOTED', 'SWAP_IN'].includes(t.action));
      const last = trail.length > 0 ? trail[trail.length - 1] : null;
      if (r.invitationStatus === 'pending') return { actor: null as string | null, time: null as Date | null };
      const actor = r.invitationActorType ?? last?.actorType ?? (r.rsvpRespondedAt ? 'EXPERT' : 'STAFF');
      const time = r.rsvpRespondedAt ?? last?.createdAt ?? r.updatedAt;
      return { actor: actor as string | null, time };
    };

    // 轮次人员姓名/状态兜底（2026-10-22 重写：审计快照 poolUserIds 实为 dto.candidates
    // =本轮选定的候补专家，此前误当候选池规模展示）；已删行人员经 user 表反查姓名
    const roundUserIds = [...new Set(extractionEvents.flatMap(ev => {
      const d = (ev.details ?? {}) as any;
      return [...((d.drawnUserIds ?? []) as string[]), ...((d.poolUserIds ?? []) as string[])];
    }))].filter(id => !roster.some(r => r.userId === id));
    const extraUsers = roundUserIds.length > 0
      ? await this.prisma.user.findMany({ where: { id: { in: roundUserIds } }, select: { id: true, displayName: true } }).catch(() => [] as { id: string; displayName: string }[])
      : [];
    const nameByUserId = new Map<string, string>([
      ...roster.map(r => [r.userId, r.expertName] as [string, string]),
      ...extraUsers.map(u => [u.id, u.displayName] as [string, string]),
    ]);
    const rowByUserId = new Map(roster.map(r => [r.userId, r] as [string, typeof r]));
    // 第 i 轮配置：该轮确认时刻窗口内（上一轮确认之后～本轮确认之前）最近的配置快照；
    // 初次轮放宽为「首次确认前最近一次」
    const roundCfg = (i: number) => {
      const ev = extractionEvents[i];
      const prevAt = i > 0 ? extractionEvents[i - 1].createdAt.getTime() : Number.NEGATIVE_INFINITY;
      const inWindow = configSnapshots.filter(cs => cs.at.getTime() > prevAt && cs.at.getTime() <= ev.createdAt.getTime());
      if (inWindow.length > 0) return inWindow[inWindow.length - 1];
      if (i === 0) {
        const before = configSnapshots.filter(cs => cs.at.getTime() <= ev.createdAt.getTime());
        return before.length > 0 ? before[before.length - 1] : null;
      }
      return null;
    };

    const MODE_LABELS: Record<string, string> = {
      specialty_match: '专业匹配（按专业配额在候选池中匹配择定）',
      random: '随机抽取（系统在符合条件的候选池中随机抽出）',
      merit_best: '综合择优（按履职评价/偏离度/负荷等综合评分排序择定）',
      manual: '专家选取（工作人员按需求手动选定）',
    };
    const stCn = (s: string) => (s === 'confirmed' ? '已确认参加' : s === 'declined' ? '已婉拒' : '待回复');
    const actorCn = (a: string | null) => (a === 'EXPERT' ? '专家本人回复' : a === 'STAFF' ? '工作人员代回应' : a === 'SYSTEM' ? '系统（超时/递补）' : '—');

    const fmt = (d: Date | null | undefined) => (d ? new Date(d).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
    const cell = (text: string, opts?: { bold?: boolean }) =>
      new TableCell({
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: text || '—', bold: opts?.bold, size: 18 })] })],
      });
    const headerRow = (labels: string[]) => new TableRow({
      tableHeader: true,
      children: labels.map(l => cell(l, { bold: true })),
    });
    const tableBorders = {
      top: { style: BorderStyle.SINGLE, size: 4 }, bottom: { style: BorderStyle.SINGLE, size: 4 },
      left: { style: BorderStyle.SINGLE, size: 4 }, right: { style: BorderStyle.SINGLE, size: 4 },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2 }, insideVertical: { style: BorderStyle.SINGLE, size: 2 },
    };

    const regulars = roster.filter(r => r.expertRole === '正选');
    const alternates = roster.filter(r => r.expertRole === '候补');

    const doc = new Document({
      styles: { default: { document: { run: { font: 'SimSun', size: 21 } } } },
      sections: [{
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, heading: HeadingLevel.TITLE, children: [new TextRun({ text: '专家抽取情况说明', bold: true, size: 36 })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '（证明材料 · 系统自动生成）', color: '666666', size: 18 })] }),
          new Paragraph({ text: '' }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: '一、项目基本信息', bold: true, size: 24 })] }),
          ...([
            ['项目名称', project.name],
            ['项目编号', projectCode],
            ['采购方式', project.procurementMethod || '—'],
            ['开标时间', fmt(project.openTime)],
            ['材料导出时间', fmt(new Date())],
          ] as [string, string][]).map(([k, v]) =>
            new Paragraph({ children: [new TextRun({ text: `${k}：`, bold: true, size: 21 }), new TextRun({ text: v, size: 21 })] }),
          ),
          new Paragraph({ text: '' }),

          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: '二、AI 辅助环节', bold: true, size: 24 })] }),
          ...(() => {
            const aiSpec = extractOpLogs.filter(l => l.path === '/api/expert-admin/extract/analyze-project') as Array<{ createdAt: Date }>;
            const aiLeader = extractOpLogs.filter(l => l.path === '/api/expert-admin/extract/ai-leader') as Array<{ createdAt: Date }>;
            const leadName = roster.find(r => r.isLead)?.expertName;
            const modeUsed = roundCfg(0)?.body?.extractMode ?? (extractionEvents[0]?.details as any)?.extractMode;
            const lines: Paragraph[] = [
              // AI 抽取逻辑（2026-10-23 用户口径：展示抽取逻辑而非调用流水）
              new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: '· AI 抽取逻辑：', bold: true, size: 21 }), new TextRun({ text: '先构建候选池——在库内可用专家中按各配额的公司、部门、专业、库内等级、行政区域条件过滤，并剔除与投标供应商存在关联（回避）、跨项目评标窗口冲突及被预排除的专家；再按抽取方式择定——专业匹配/综合择优模式对候选按专业匹配度、职称、历史参评项目数、履职评价等级、评分偏离度、当前负荷等维度加权评分排序取优，随机抽取模式在候选池中系统随机抽出，候补按同口径另行抽定。', size: 21 })] }),
              // 组长推荐逻辑（与 aiSelectLeader 实现同口径：LLM 按职称/学历/专业/资历推荐，规则兜底按职称等级）
              new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: '· 组长推荐逻辑：', bold: true, size: 21 }), new TextRun({ text: `在已确认参加的正选专家中，AI（大模型）按职称、学历、评审专业、工作单位等维度综合评估资历，推荐最合适的评审组长人选并给出推荐理由${leadName ? `（本次评审组长：${leadName}）` : ''}；AI 不可用时按职称等级规则兜底（正高/研究员 ＞ 高级/副高 ＞ 中级）。推荐结果仅供参考，组长最终由工作人员确认。`, size: 21 })] }),
            ];
            if (aiSpec.length > 0) lines.push(new Paragraph({ children: [new TextRun({ text: `· AI 专业配额建议：调用 ${aiSpec.length} 次（${aiSpec.map(l => fmt(l.createdAt)).join('、')}）——系统按项目概况 AI 分析建议专业配额，最终配额以人工确认为准。`, size: 21 })] }));
            if (aiLeader.length > 0) lines.push(new Paragraph({ children: [new TextRun({ text: `· 组长推荐调用留痕：${aiLeader.length} 次（${aiLeader.map(l => fmt(l.createdAt)).join('、')}）。`, size: 21 })] }));
            return lines;
          })(),
          new Paragraph({ children: [new TextRun({ text: 'AI 环节仅作辅助建议：专业配额、专家人选与组长最终均由工作人员确认，确认动作与审计日志同事务留痕。', size: 18, color: '666666' })] }),
          new Paragraph({ text: '' }),

          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: '三、抽取过程与补选记录', bold: true, size: 24 })] }),
          ...(extractionEvents.length === 0
            ? [new Paragraph({ children: [new TextRun({ text: '未找到抽取确认审计记录（存量项目或未走抽取向导确认步骤），最终名单以系统当前名册为准。', size: 21 })] })]
            : extractionEvents.flatMap((ev, i) => {
                const d = (ev.details ?? {}) as any;
                const mode = MODE_LABELS[d.extractMode] ?? (d.extractMode ? `其他方式（${d.extractMode}）` : '（快照未载明，以名单为准）');
                const drawn = (d.drawnUserIds ?? []) as string[];   // 本轮选定正选
                const alts = (d.poolUserIds ?? []) as string[];     // 快照字段名 poolUserIds 实为本轮选定候补（dto.candidates）
                const drawnNames = (d.experts ?? []).length > 0
                  ? (d.experts as any[]).map(e => e.name + (e.isLead ? '（组长）' : ''))
                  : drawn.map(id => nameByUserId.get(id) ?? id);
                const altNames = alts.map(id => nameByUserId.get(id) ?? id);
                const cfg = roundCfg(i);
                const blocks: Array<Paragraph | Table> = [];

                // 轮次分类（2026-10-22 用户口径）：初次抽取（正选）→ 步骤6 候补抽取
                // （drawn 空且选定候补非空）→ 补选轮（补正选空缺，不抽候补——
                // 预览 body 的 alternatives 为残留状态值，补选轮不展示）
                const isAltRound = i > 0 && drawn.length === 0 && alts.length > 0;

                if (i === 0) {
                  // 初次抽取（正选）：配置与结果融合为第一轮（2026-10-23 用户口径：
                  // 原独立「抽取配置」节与此重复）——候补数仅在 >0 时显示
                  blocks.push(new Paragraph({
                    spacing: { after: 60 },
                    children: [
                      new TextRun({ text: `第 1 轮（初次抽取·正选）：`, bold: true, size: 21 }),
                      new TextRun({ text: `于 ${fmt(ev.createdAt)} 由 ${ev.user?.displayName ?? '工作人员'} 确认，抽取方式为${mode}${cfg ? `；配置：拟抽正选 ${cfg.body?.totalNeeded ?? '—'} 名${(cfg.body?.alternatives ?? 0) > 0 ? `、拟抽候补 ${cfg.body.alternatives} 名` : ''}${cfg.body?.employer ? `，整体限定公司：${cfg.body.employer}` : ''}${((cfg.body?.excludedUserIds ?? []) as string[]).length > 0 ? `，预排除专家：${((cfg.body?.excludedUserIds ?? []) as string[]).map(id => excludedNameById.get(id) ?? id).filter(Boolean).join('、')}` : ''}` : '（配置未留痕）'}。`, size: 21 }),
                    ],
                  }));
                  if (cfg) {
                    const q = (cfg.body?.manualQuotas ?? []) as any[];
                    if (q.length > 0) {
                      blocks.push(new Table({
                        width: { size: 100, type: WidthType.PERCENTAGE },
                        borders: tableBorders,
                        rows: [
                          headerRow(['专业要求', '人数', '公司限定', '部门限定', '库内等级', '区域', '备注']),
                          ...q.map((row: any) => new TableRow({
                            children: [
                              cell((row.specialties?.length ? row.specialties.join('、') : row.specialty) || '不限专业'),
                              cell(String(row.count ?? '—')),
                              cell((row.companyIds?.length ? row.companyIds.map((id: string) => companyNameById.get(id) ?? id).join('、') : row.employer) || '不限'),
                              cell(row.department || '—'),
                              cell(row.expertLevel || '—'),
                              cell(row.regionCode || '—'),
                              cell(row.reason || '—'),
                            ],
                          })),
                        ],
                      }));
                    }
                  }
                  blocks.push(new Paragraph({
                    spacing: { before: 60, after: 120 },
                    children: [
                      new TextRun({ text: `本轮结果：确定正选 ${drawnNames.length} 名${drawnNames.length > 0 ? `（${drawnNames.join('、')}）` : ''}。`, size: 21 }),
                    ],
                  }));
                } else if (isAltRound) {
                  // 候补抽取（初次流程·步骤6）：候补名单在此环节抽取
                  blocks.push(new Paragraph({
                    spacing: { before: 120, after: 120 },
                    children: [
                      new TextRun({ text: `候补抽取（初次流程·第 ${i + 1} 轮记录）：`, bold: true, size: 21 }),
                      new TextRun({ text: `于 ${fmt(ev.createdAt)} 由 ${ev.user?.displayName ?? '工作人员'} 确认${cfg && (cfg.body?.alternatives ?? 0) > 0 ? `，拟抽候补 ${cfg.body.alternatives} 名` : ''}；实际选定候补 ${altNames.length} 名（${altNames.join('、')}），候补当前状态见「六、候补专家名单」。`, size: 21 }),
                    ],
                  }));
                } else {
                  // 补选轮：补正选空缺——本轮配置（仅正选数与配额，不含候补）+ 本轮人员与当前确认状态
                  blocks.push(new Paragraph({
                    spacing: { before: 120, after: 60 },
                    children: [
                      new TextRun({ text: `第 ${i + 1} 轮（补选·正选）：`, bold: true, size: 21 }),
                      new TextRun({ text: `于 ${fmt(ev.createdAt)} 由 ${ev.user?.displayName ?? '工作人员'} 确认，抽取方式为${mode}${cfg ? `；本轮配置：拟抽正选 ${cfg.body?.totalNeeded ?? '—'} 名${((cfg.body?.manualQuotas ?? []) as any[]).length > 0 ? `（${((cfg.body?.manualQuotas ?? []) as any[]).map((row: any) => `${(row.specialties?.length ? row.specialties.join('、') : row.specialty) || '不限专业'}×${row.count ?? '—'}`).join('、')}）` : ''}` : '（本轮配置未单独留痕，沿用初次配置口径）'}。`, size: 21 }),
                    ],
                  }));
                  const roundPeople = [
                    ...drawn.map(id => ({ id, role: '正选' })),
                    ...alts.map(id => ({ id, role: '候补' })),
                  ];
                  if (roundPeople.length > 0) {
                    blocks.push(new Table({
                      width: { size: 100, type: WidthType.PERCENTAGE },
                      borders: tableBorders,
                      rows: [
                        headerRow(['姓名', '本轮角色', '当前状态', '确认方式', '回执时间']),
                        ...roundPeople.map(rp => {
                          const row = rowByUserId.get(rp.id);
                          return new TableRow({
                            children: [
                              cell(nameByUserId.get(rp.id) ?? rp.id),
                              cell(rp.role),
                              cell(row ? stCn(row.invitationStatus) : '已移出名册'),
                              cell(row ? actorCn(confirmOf(row).actor) : '—'),
                              cell(row ? fmt(confirmOf(row).time) : '—'),
                            ],
                          });
                        }),
                      ],
                    }));
                  }
                }
                return blocks;
              })),
          new Paragraph({ children: [new TextRun({ text: '补选轮人员表中的「当前状态」为导出时刻的最新邀请状态（已确认/已婉拒/待回复/已移出名册），流转轨迹见系统专家详情页。', size: 18, color: '666666' })] }),
          new Paragraph({ text: '' }),

          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: `四、最终评审专家名单（已确认正选 ${regulars.filter(r => r.invitationStatus === 'confirmed').length} 名）`, bold: true, size: 24 })] }),
          ...(regulars.filter(r => r.invitationStatus === 'confirmed').length === 0
            ? [new Paragraph({ children: [new TextRun({ text: '暂无已确认参加的正选专家（以现场签到与后续补选为准）。', size: 21 })] })]
            : [new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                borders: tableBorders,
                rows: [
                  headerRow(['序号', '姓名', '评审专业', '职称', '工作单位', '联系电话', '角色', '确认方式', '回执时间']),
                  ...regulars.filter(r => r.invitationStatus === 'confirmed').map((r, i) => new TableRow({
                    children: [
                      cell(String(i + 1)),
                      cell(r.expertName),
                      cell(r.major),
                      cell(r.user?.expertProfile?.title ?? ''),
                      cell(r.user?.expertProfile?.employer ?? ''),
                      cell(openPiiForMask(r.user?.expertProfile?.phone) ?? ''),
                      cell(r.isPurchaserRepresentative ? '采购人代表' : r.isLead ? '组长' : '正选'),
                      cell(actorCn(confirmOf(r).actor)),
                      cell(fmt(confirmOf(r).time)),
                    ],
                  })),
                ],
              })]),

          ...(() => {
            const activeAlts = alternates.filter(r => r.invitationStatus !== 'declined');
            if (activeAlts.length === 0) return [];
            return [
              new Paragraph({ text: '' }),
              new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: `五、候补专家名单（${activeAlts.length} 名）`, bold: true, size: 24 })] }),
              new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                borders: tableBorders,
                rows: [
                  headerRow(['序号', '姓名', '评审专业', '职称', '工作单位', '联系电话', '确认状态', '确认方式', '回执时间']),
                  ...activeAlts.map((r, i) => new TableRow({
                    children: [
                      cell(String(i + 1)),
                      cell(r.expertName),
                      cell(r.major),
                      cell(r.user?.expertProfile?.title ?? ''),
                      cell(r.user?.expertProfile?.employer ?? ''),
                      cell(openPiiForMask(r.user?.expertProfile?.phone) ?? ''),
                      cell(stCn(r.invitationStatus)),
                      cell(actorCn(confirmOf(r).actor)),
                      cell(fmt(confirmOf(r).time)),
                    ],
                  })),
                ],
              }),
            ];
          })(),
          new Paragraph({ text: '' }),
          new Paragraph({ children: [new TextRun({ text: '说明：本材料由蜀水云采·智慧水发系统根据专家抽取审计日志与邀请回执留痕自动生成；确认方式含专家本人回复、工作人员代回应（附理由留痕）与系统超时/递补三类；专家历次邀请流转轨迹可在系统专家详情页逐条查证。', size: 18, color: '666666' })] }),
        ],
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = `专家抽取情况_${project.name}_${new Date().toISOString().slice(0, 10)}.docx`;
    return { buffer, filename };
  }

  /** 自动递补：从待确认候补中按综合评分（extendedRuleScore）择优转正，而非简单按创建时间。
   *  递补发生在抽取之后，期间专家状态可能变化，故此处先做与 confirmExtraction 同标准的资格复核
   *  （剔除已停用/退库/供应商关联/跨项目开窗候补），再基于最新履职数据（含偏离度与当前负荷）重新评分。
   *  I3（2026-09-24 全链审计）：组长残留检测前置（早退也清残留）+ 跨项目开窗过滤 +
   *  全项目行锁事务内重断言（并发双婉拒防，与 swapExpertRole 同域串行化）。 */
  async autoPromoteCandidate(projectId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      include: { suppliers: { include: { supplier: { select: { name: true } } } } },
    });
    // 回避口径与 preview/confirm 同步——已投递 ∪ 开标后终局态（旧 CONFIRMED 口径开标前恒空集）
    const supplierNames = new Set(
      (project?.suppliers ?? [])
        .filter(s => s.submitStatus === '已提交' || s.confirmStatus === 'CONFIRMED' || s.confirmStatus === 'EXCEPTION')
        .map(s => s.supplier?.name || s.supplierName)
        .filter(Boolean) as string[],
    );

    // I3（2026-09-24 全链审计）：组长残留检测前置——零候选/零合格早退也须清残留，
    // 否则组长婉拒且无候补时仍产出 isLead 残留（清扫脚本要修的病）。
    // fix-later② 语义：三条触发路径（RSVP 婉拒/过期/admin 婉拒）都把原正选置 declined，
    // isLead 残留在 declined 行 = 组长席实际空缺，须转移，否则末签/异议/表决链死锁。
    const leadOnDeclined = await this.prisma.bidExpert.findFirst({
      where: { projectId, isLead: true, invitationStatus: 'declined' },
      select: { id: true },
    });
    const clearStaleLead = async () => {
      if (leadOnDeclined) {
        await this.prisma.bidExpert.update({ where: { id: leadOnDeclined.id }, data: { isLead: false } });
      }
    };

    // 候补候选：已确认(confirmed)与待确认(pending)都纳入，优先从已确认者中递补（他们已同意参加）
    const candidates = await this.prisma.bidExpert.findMany({
      where: { projectId, expertRole: '候补', invitationStatus: { in: ['confirmed', 'pending'] } },
      include: {
        user: {
          include: {
            expertProfile: true,
            _count: { select: { bidExperts: true } },
            expertEvaluations: { orderBy: { createdAt: 'desc' }, take: 1 },
            bidExperts: { where: { progress: { lt: 100 } }, select: { id: true } },
          },
        },
      },
    });
    if (candidates.length === 0) {
      await clearStaleLead();
      return null;
    }

    // I3：跨项目开窗预过滤（findOpenEvaluationWindows 为 async——先建排除集，保持下方 filter 同步）。
    // 与 swap P2-4/signIn 硬闸同口径：开窗候补递补后 signIn 必撞闸，提前剔除免递补空转。
    const windowExcluded = new Set<string>();
    for (const c of candidates) {
      const wins = await findOpenEvaluationWindows(this.prisma, c.userId, projectId);
      if (wins.length > 0) windowExcluded.add(c.userId);
    }

    // 资格复核：与 confirmExtraction 同标准，避免把抽取后被停用/退库/关联供应商的候补提为正选
    const eligible = candidates.filter(c => {
      if (windowExcluded.has(c.userId)) return false;
      const u = c.user;
      if (!u.isActive || u.expertProfile?.availability !== '可用' || u.expertProfile?.entryStatus !== 'ACTIVE') return false;
      const emp = u.expertProfile?.employer?.trim();
      if (emp) {
        for (const sn of supplierNames) {
          if (sn && (emp.includes(sn) || sn.includes(emp))) return false;
        }
      }
      return true;
    });
    if (eligible.length === 0) {
      await clearStaleLead();
      return null;
    }

    // 与抽取同口径补齐偏离度与历史均分（原实现缺这两维，择优比抽取时更粗糙）
    const userIds = eligible.map(c => c.userId);
    const [scoreRecords] = await Promise.all([
      this.prisma.bidScoreRecord.findMany({
        where: { expert: { userId: { in: userIds } } },
        select: { score: true, scoreItemId: true, supplierId: true, expert: { select: { userId: true } } },
      }),
    ]);
    const deviations = computeExpertMeanDeviations(
      scoreRecords.map(r => ({ expertId: r.expert.userId, scoreItemId: r.scoreItemId, supplierId: r.supplierId, score: Number(r.score) })),
    );
    const devMap = new Map(deviations.map(d => [d.expertId, Math.round(d.meanDeviation * 10) / 10]));

    const scored = eligible.map(c => {
      const latest = c.user.expertEvaluations[0];
      const load = c.user.bidExperts.length;
      return {
        c,
        score: this.extraction.extendedRuleScore({
          specialty: c.user.expertProfile?.specialty || '综合',
          title: c.user.expertProfile?.title ?? undefined,
          pastProjects: c.user._count.bidExperts,
          evaluationLevel: latest?.overallGrade,
          attendanceGrade: latest?.attendanceGrade,
          qualityGrade: latest?.qualityGrade,
          disciplineGrade: latest?.disciplineGrade,
          scoreDeviation: devMap.get(c.userId),
          currentLoad: load,
          currentLoadStatus: load === 0 ? '空闲' : load <= 2 ? '正常' : '繁忙',
        }),
      };
    });
    // 排序：已确认参加的候补优先（无需再等回复），其次按择优评分
    scored.sort((a, b) => {
      const ac = a.c.invitationStatus === 'confirmed' ? 1 : 0;
      const bc = b.c.invitationStatus === 'confirmed' ? 1 : 0;
      if (ac !== bc) return bc - ac;
      return b.score - a.score;
    });
    // fix-later②（2026-09-24）：与 swapExpertRole 同口径——递补即确认（startEvaluation 委员会校验只数
    // confirmed 正选，不落 confirmed 则递补后确认数悄悄跌破法定下限）。
    let best = scored[0].c;
    // P1-7：采购人代表不得任组长——组长席空缺时在非代表候选中按原排序择优；全为代表则组长留空（待 setLeader）
    if (leadOnDeclined) {
      const nonRep = scored.find(s => !s.c.isPurchaserRepresentative);
      if (nonRep) best = nonRep.c;
    }
    const promotedAsLead = !!leadOnDeclined && !best.isPurchaserRepresentative;

    // I3：并发双婉拒防——锁全项目 BidExpert 行（与 swap 的两行锁同域串行化），
    // 锁内重断言 best 仍是候补且未婉拒；并发递补后到者见先到者已改角色 → 放弃或顺延。
    const promoted = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "BidExpert" WHERE "projectId" = ${projectId} FOR UPDATE`;
      if (leadOnDeclined) {
        await tx.bidExpert.update({ where: { id: leadOnDeclined.id }, data: { isLead: false } });
      }
      const freshBest = await tx.bidExpert.findUnique({ where: { id: best.id }, select: { expertRole: true, invitationStatus: true } });
      if (!freshBest || freshBest.expertRole !== '候补' || freshBest.invitationStatus === 'declined') {
        return null; // 并发已被递补/已婉拒——本次放弃（调用方 promoted=null 语义已存在）
      }
      const promotedRow = await tx.bidExpert.update({
        where: { id: best.id },
        data: {
          expertRole: '正选', invitationStatus: 'confirmed',
          ...(promotedAsLead ? { isLead: true } : {}),
          invitationActorType: 'SYSTEM', invitationReason: null,
        },
      });
      // 递补转正轨迹（2026-10-21 留痕适配）：角色流转与状态变更一并落账（自答快照不触碰——递补非自答）
      await writeInvitationLog(tx, {
        bidExpertId: best.id, projectId, userId: best.userId,
        action: 'PROMOTED', actorType: 'SYSTEM',
        fromStatus: freshBest.invitationStatus, toStatus: 'confirmed', fromRole: '候补', toRole: '正选',
        reason: '正选婉拒/超时弃权，按综合评分自动递补转正',
      });
      return promotedRow;
    });
    if (!promoted) return null;

    // F4 同口径：递补零通知=被「拉壮丁」无感知——站内信 best-effort，失败不阻塞
    try {
      await this.notification.sendToUser(best.userId, ['in_app'], {
        type: 'EXPERT_AUTO_PROMOTED',
        title: `您已递补为项目【${project?.name ?? ''}】的正选评标专家`,
        content: `因原正选专家婉拒或超时未回复，您已递补为正选评审专家${promotedAsLead ? '并接任评审组长' : ''}，请按时到场完成签到并参与评审。`,
      });
    } catch { /* 通知失败不阻塞递补 */ }

    // FE-3（2026-09-24 全链审计）：递补也是委员会角色变更——广播 role_changed，
    // :3005 已开面板刷新委员会名单/专家签到态（与 swap 互换同款里程碑）
    this.gateway?.notifyExpertPresence(projectId, {
      expertId: best.id, expertName: best.expertName, milestone: 'role_changed', progressPercent: best.progress ?? 0,
    });

    return { userId: best.userId, expertName: best.expertName, major: best.major, ...(leadOnDeclined ? { promotedAsLead } : {}) };
  }

  /** I2（2026-09-24 全链审计）：阶段感知递补——仅评标启动前（DOWNLOAD/SUBMIT/OPENING）自动递补；
   *  EVALUATING 中婉拒允许（写 declined）但抑制递补（改变委员会组成须走异议裁决/补选，spec R5 口径）；
   *  终态（ARCHIVED/ABORTED）直接拒绝操作。（public：expert.controller 的 RSVP verify/respond 两路径直调） */
  async maybeAutoPromote(projectId: string) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { stage: true } });
    if (!project) return null;
    if (project.stage === 'ARCHIVED' || project.stage === 'ABORTED') {
      throw new ConflictException({ error: '项目已结束，无法操作邀请', code: 'PROJECT_CLOSED' });
    }
    if (project.stage === 'EVALUATING') return null; // 婉拒照写，递补抑制
    return this.autoPromoteCandidate(projectId);
  }

  /** 邀请操作阶段门控：已归档/已废标项目禁止确认/拒绝（防脏数据 + 误递补） */
  private async assertInvitationActionable(projectId: string) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { stage: true } });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.stage === 'ARCHIVED' || project.stage === 'ABORTED') {
      throw new ConflictException({ error: '项目已结束，无法操作邀请', code: 'PROJECT_CLOSED' });
    }
  }

  /** 标记专家已拒绝参与评审，并自动递补候补（幂等 + 阶段门控）。
   *  专家自助路径（登录端婉拒）：落自答快照 + EXPERT 作答方 + 轨迹（2026-10-21 留痕适配） */
  async declineInvitation(projectId: string, userId: string) {
    await this.assertInvitationActionable(projectId);
    const record = await this.prisma.bidExpert.findFirst({ where: { projectId, userId } });
    if (!record) throw new NotFoundException('未找到该项目的邀请记录');
    if (record.invitationStatus === 'declined') return { success: true, status: 'declined', promoted: null }; // 幂等：重复婉拒直接成功
    if (record.invitationStatus === 'confirmed') {
      throw new ConflictException({ error: '您已确认参加，如需变更请联系采购方', code: 'ALREADY_CONFIRMED' });
    }
    // 守卫式更新防并发双写轨迹；自答快照一并落（代变更永不触碰）
    const guard = await this.prisma.bidExpert.updateMany({
      where: { id: record.id, invitationStatus: 'pending' },
      data: {
        invitationStatus: 'declined', rsvpRespondedAt: new Date(),
        invitationActorType: 'EXPERT', invitationActorName: record.expertName,
        expertRespondedAt: new Date(), expertStatus: 'declined',
      },
    });
    if (guard.count > 0) {
      await writeInvitationLog(this.prisma, {
        bidExpertId: record.id, projectId, userId,
        action: 'RESPONDED', actorType: 'EXPERT', actorName: record.expertName,
        fromStatus: 'pending', toStatus: 'declined', reason: '专家登录端婉拒',
      });
      // 连拒预警（2026-10-21）：自答婉拒入账后计算连拒段
      await this.maybeAlertExpertDeclineStreak(userId, record.expertName);
    }
    // 婉拒 → 自动递补候补（与 RSVP 链接路径一致）；仅正选婉拒才递补——候补婉拒不产生正选空缺，
    // 无条件递补会把另一候补超编转正并徒耗候补席位（D7 审查）；递补失败静默，不影响婉拒结果。
    // I2：递补经 maybeAutoPromote 阶段感知——EVALUATING 婉拒照写但抑制递补（上面已先行拒绝终态）
    const promoted = record.expertRole === '正选'
      ? await this.maybeAutoPromote(projectId).catch(() => null)
      : null;

    return { success: true, status: 'declined', promoted };
  }
  async generateNotificationAi(params: {
    projectName: string; expertName: string; isLead: boolean;
    totalExperts: number; extractMode: string; openTime: string;
    projectId?: string;
  }) {
    // 查项目概况（scope + qualification + riskNote），注入通知
    let projectScope = '';
    if (params.projectId) {
      const p = await this.prisma.bidProject.findUnique({ where: { id: params.projectId }, select: { scope: true, qualification: true, riskNote: true } });
      if (p) projectScope = [p.scope, p.qualification, p.riskNote].filter(Boolean).join('；').slice(0, 500);
    }
    const text = await this.extractionAi.generateNotification({ ...params, projectScope });
    if (text) return { success: true, generated: true, content: text };
    return { success: true, generated: false, content: null };
  }

  /** 专家登录端自助确认（幂等 + 阶段门控）：落 EXPERT 作答方 + 自答快照 + 轨迹（2026-10-21 留痕适配） */
  async selfConfirmInvitation(projectId: string, userId: string) {
    await this.assertInvitationActionable(projectId);
    const record = await this.prisma.bidExpert.findFirst({ where: { projectId, userId } });
    if (!record) throw new NotFoundException('未找到该项目的邀请记录');
    if (record.invitationStatus === 'confirmed') return { success: true, status: 'confirmed' }; // 幂等：重复确认直接成功
    if (record.invitationStatus === 'declined') {
      throw new ConflictException({ error: '您已婉拒该邀请，如需参加请联系采购方', code: 'ALREADY_DECLINED' });
    }
    const guard = await this.prisma.bidExpert.updateMany({
      where: { id: record.id, invitationStatus: 'pending' },
      data: {
        invitationStatus: 'confirmed', rsvpRespondedAt: new Date(),
        invitationActorType: 'EXPERT', invitationActorName: record.expertName,
        expertRespondedAt: new Date(), expertStatus: 'confirmed',
      },
    });
    if (guard.count > 0) {
      await writeInvitationLog(this.prisma, {
        bidExpertId: record.id, projectId, userId,
        action: 'RESPONDED', actorType: 'EXPERT', actorName: record.expertName,
        fromStatus: 'pending', toStatus: 'confirmed', reason: '专家登录端确认',
      });
    }
    return { success: true, status: 'confirmed' };
  }

  /**
   * 连续拒绝预警（2026-10-21 用户口径，与供应商 maybeAlertDeclineStreak 同构）：
   * 该专家全部确认/拒绝事件按时间正序，从最新往前数连续 declined（自答婉拒/超时弃权/
   * 代婉拒均计，任一 confirmed 即断段）。恰在跨过阈值（=3）那一次发 leader+staff
   * 站内信；同段后续不重复；恢复确认即重置。失败不阻断主流程。
   */
  async maybeAlertExpertDeclineStreak(userId: string, expertName: string): Promise<number> {
    try {
      const events = await this.prisma.expertInvitationLog.findMany({
        where: {
          userId,
          action: { in: ['RESPONDED', 'STAFF_MARKED', 'AUTO_DECLINED'] },
          toStatus: { in: ['confirmed', 'declined'] },
        },
        select: { toStatus: true },
        orderBy: { createdAt: 'asc' },
      });
      let streak = 0;
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].toStatus !== 'declined') break;
        streak++;
      }
      if (streak === DECLINE_STREAK_ALERT_THRESHOLD) {
        const payload = {
          type: 'EXPERT_DECLINE_STREAK',
          title: '专家连续婉拒预警',
          content: `专家「${expertName}」已连续 ${streak} 次拒绝评审邀请（含婉拒/超时弃权/代婉拒），请复核其参评意愿与库内状态。`,
          link: '/expert/repository',
        };
        await Promise.all(['leader', 'staff'].map(r => this.notification.sendToRole(r, payload)));
      }
      return streak;
    } catch (err: any) {
      Logger.warn(`专家连拒预警计算失败 user=${userId}: ${err?.message ?? err}`, 'ExpertAdminService');
      return 0;
    }
  }

  /**
   * 工作人员代回应/代变更（2026-10-21 代为变更设计适配专家域）：
   * - 专家未回链接（电话核实）→ 代确认/代婉拒；专家已确认但需调整 → 代为变更；
   * - 理由必填（≥5 字）落 invitationReason 展示；每次变更落 ExpertInvitationLog 轨迹；
   * - 「确认 → 婉拒」联动站内信通知专家本人（EXPERT_INVITATION_OVERRIDDEN）并触发递补；
   * - 「婉拒 → 确认」恢复仅限：非 EVALUATING（评标中改委员会组成须走异议裁决/补选）且
   *   无其他已确认正选（防递补后恢复造成正选超编）；
   * - 【不变量】expertRespondedAt/expertStatus（自答快照）绝不覆盖——原回执一并记录。
   */
  async proxyMarkInvitation(params: {
    projectId: string; userId: string; status: 'confirmed' | 'declined'; actorId: string; reason: string;
  }) {
    const { projectId, userId, status } = params;
    const reason = (params.reason ?? '').trim().slice(0, 500);
    if (reason.length < 5) {
      throw new BadRequestException({ error: '请填写代回应理由（至少 5 个字），理由将展示在专家确认面板', code: 'REASON_REQUIRED' });
    }
    await this.assertInvitationActionable(projectId);
    const actor = await this.prisma.user.findUnique({ where: { id: params.actorId }, select: { displayName: true } });
    if (!actor) throw new NotFoundException({ error: '操作人账号不存在', code: 'ACTOR_NOT_FOUND' });
    const actorName = actor.displayName || '工作人员';

    const record = await this.prisma.bidExpert.findFirst({ where: { projectId, userId } });
    if (!record) throw new NotFoundException('未找到该项目的邀请记录');
    if (record.signedIn && status === 'declined') {
      throw new ConflictException({ error: '该专家已签到，不可代为婉拒（如需调整走替换/裁决渠道）', code: 'EXPERT_SIGNED_IN' });
    }
    // 同态幂等：不产生新轨迹不刷通知
    if (record.invitationStatus === status) {
      return { success: true, status, changed: false, promoted: null };
    }
    const from = record.invitationStatus;

    // 婉拒→确认恢复：评标中禁改委员会组成 + 防递补后恢复超编正选
    if (from === 'declined' && status === 'confirmed') {
      const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { stage: true } });
      if (project?.stage === 'EVALUATING') {
        throw new ConflictException({ error: '评标进行中不可恢复专家确认（改变委员会组成须走异议裁决/补选）', code: 'EVALUATING_LOCKED' });
      }
      if (record.expertRole === '正选') {
        // 席位占用检测（深检修正 2026-10-21）：多席位委员会（5 专家）下「存在其他已确认正选」
        // 恒真——其余 4 位正常确认也会误杀一切恢复。改为时间序检测：本行 declined 之后若发生过
        // PROMOTED 递补，说明该席位已被转正候补占用，恢复会造成正选超编。
        // 无 declined 轨迹的存量行视为未占用（不误杀；超编风险仅限无轨迹的存量数据）。
        const declineLog = await this.prisma.expertInvitationLog.findFirst({
          where: { bidExpertId: record.id, toStatus: 'declined' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });
        const refillAfterDecline = declineLog
          ? await this.prisma.expertInvitationLog.findFirst({
              where: { projectId, action: 'PROMOTED', createdAt: { gt: declineLog.createdAt } },
              select: { id: true },
            })
          : null;
        if (refillAfterDecline) {
          throw new ConflictException({ error: '该席位已被递补候补占用，不可直接恢复——请走替换流程或重新抽取', code: 'SEAT_TAKEN' });
        }
      }
    }

    await this.prisma.bidExpert.update({
      where: { id: record.id },
      data: {
        invitationStatus: status, rsvpRespondedAt: new Date(),
        invitationActorType: 'STAFF', invitationActorName: actorName, invitationReason: reason,
      },
    });
    await writeInvitationLog(this.prisma, {
      bidExpertId: record.id, projectId, userId,
      action: 'STAFF_MARKED', actorType: 'STAFF', actorId: params.actorId, actorName,
      fromStatus: from, toStatus: status, reason,
    });

    // 确认→婉拒：通知本人（失败不阻断）+ 正选婉拒触发递补（maybeAutoPromote 阶段感知）
    let promoted: { userId: string; expertName: string } | null = null;
    if (from === 'confirmed' && status === 'declined') {
      try {
        const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { name: true } });
        await this.notification.sendToUser(userId, ['in_app'], {
          type: 'EXPERT_INVITATION_OVERRIDDEN',
          title: '专家邀请状态变更通知',
          content: `您对项目【${project?.name ?? ''}】评审邀请的确认已被采购方变更：确认参加 → 婉拒。理由：${reason}（操作人：${actorName}）。如有疑问请联系采购中心。`,
        });
      } catch { /* 通知失败不阻断 */ }
    }
    if (status === 'declined' && record.expertRole === '正选') {
      promoted = await this.maybeAutoPromote(projectId).catch(() => null);
    }
    // 连拒预警（2026-10-21）：代婉拒入账后计算连拒段
    if (status === 'declined') {
      await this.maybeAlertExpertDeclineStreak(userId, record.expertName);
    }
    return { success: true, status, changed: true, promoted };
  }

  /** 撤销专家报告确认 — 允许专家在确认后修改评分并重新确认 */
  async unconfirmReport(projectId: string, expertId: string, reason: string, actorId: string) {
    // 门控：项目必须仍在 EVALUATING 阶段（已归档不可撤销）——事务外快速失败
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true },
    });
    if (!project || project.stage !== 'EVALUATING') {
      throw new BadRequestException({ error: '项目不在评标阶段，无法撤销', code: 'PROJECT_NOT_EVALUATING' });
    }

    const expert = await this.prisma.bidExpert.findFirst({
      where: { id: expertId, projectId },
    });
    if (!expert) throw new NotFoundException({ error: '专家不存在', code: 'NOT_FOUND' });
    if (!expert.reportConfirmed) {
      throw new BadRequestException({ error: '该专家尚未确认报告', code: 'NOT_CONFIRMED' });
    }

    // 事务内重读 stage 与 leaderCoSigned，消除与 archiveAll、leaderCoSign 的 TOCTOU 竞态。
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.bidProject.findUnique({
        where: { id: projectId },
        select: { stage: true, leaderCoSigned: true, procurementMethod: true },
      });
      if (!locked || locked.stage !== 'EVALUATING') {
        throw new BadRequestException({ error: '项目不在评标阶段，无法撤销', code: 'PROJECT_NOT_EVALUATING' });
      }

      // E6 反向闸门：谈判采购创建报价轮后评标结论已冻结（先评标→再报价），禁止撤销报告确认
      if (locked.procurementMethod === '谈判采购') {
        const roundCount = await tx.bidRound.count({ where: { projectId } });
        if (roundCount > 0) {
          throw new ConflictException({
            error: '本项目已进入多轮报价阶段（报价轮次已创建），评标结论已冻结，不可撤销报告确认',
            code: 'ROUNDS_STARTED_LOCKED',
          });
        }
      }

      // 如果项目已末签，撤销末签状态（不再满足"所有专家已确认"的前置条件）
      if (locked.leaderCoSigned) {
        await tx.bidProject.update({
          where: { id: projectId },
          data: { leaderCoSigned: false, leaderCoSignedAt: null },
        });
      }

      await tx.bidExpert.update({
        where: { id: expertId },
        data: { reportConfirmed: false, reportConfirmedAt: null },
      });

      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '管理员',
          target: expert.expertName,
          action: '撤销报告确认',
          result: `原因：${reason}`,
          riskFlag: '高',
        },
      });

      if (actorId) {
        await tx.auditLog.create({
          data: {
            userId: actorId, action: 'EXPERT_REPORT_UNCONFIRMED',
            resourceType: `BidExpert:${expertId}`,
            details: { projectId, reason },
          },
        });
      }
    });

    return { success: true };
  }

  /** 抽取确认后发送通知（逐专家逐渠道投递） */
  /** 预生成 RSVP 确认链接（进入通知页时调用，写入通知模板）。
   *  已存在未过期 token 的专家直接复用，不对全部记录重新生成——避免步骤 3→6 切换时，
   *  补选刷新覆盖已发给正选专家的有效链接，导致旧链接失效。 */
  async prersvpLinks(projectId: string, headers?: PortalLinkHeaders, force = false) {
    // 三态自适应（2026-10-27 与供应商邀请 RSVP 同设计）：域名访问→恒根域 ssyc.scsfjt.com、IP:端口→同 IP 换 :3006、localhost→本机 LAN IP
    const expertPortalUrl = resolveRsvpLinkOrigin('expert', headers, process.env.EXPERT_PORTAL_URL || process.env.PUBLIC_PORTAL_URL);
    const now = new Date();
    const bes = await this.prisma.bidExpert.findMany({
      where: { projectId },
      select: { id: true, userId: true, rsvpToken: true, rsvpExpiresAt: true, invitationStatus: true, invitationActorType: true },
    });
    const links: Record<string, string> = {};
    for (const be of bes) {
      // 人工回复（EXPERT 自答/STAFF 代答）→ 恒复用既有 token（其回执凭证不因刷新失效）；
      // SYSTEM=超时自动弃权——不算已回复，可强制换发重新邀（2026-10-27 实录：五专家全被 15 分钟扫成 declined，刷新必须能救回）
      const humanResponded = be.invitationActorType === 'EXPERT' || be.invitationActorType === 'STAFF';
      // 强制换发（2026-10-27「刷新须有实质作用」）：非人工回复行无视未过期复用，换新 token 重置有效期
      const reuse = humanResponded || (!force && be.rsvpToken && be.rsvpExpiresAt && new Date(be.rsvpExpiresAt) > now);
      if (reuse) {
        if (be.rsvpToken) links[be.userId] = `${expertPortalUrl}/rsvp?t=${be.rsvpToken}`;
        continue;
      }
      const token = randomBytes(9).toString('base64url').slice(0, 12);
      await this.prisma.bidExpert.update({
        where: { id: be.id },
        // 换发即重邀：状态回 pending、清作答痕迹（仅非人工回复行走至此，人工婉拒/确认不受影响）
        data: { rsvpToken: token, rsvpExpiresAt: new Date(now.getTime() + this.rsvpTtlMs), invitationStatus: 'pending', rsvpRespondedAt: null, invitationActorType: null },
      });
      links[be.userId] = `${expertPortalUrl}/rsvp?t=${token}`;
    }
    return { links };
  }

  async sendExtractionNotify(
    projectId: string,
    expertIds: string[],
    channels: string[],
    message?: string,
    headers?: PortalLinkHeaders,
    noRsvpLink = false,
  ) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { name: true, projectCode: true },
    });
    if (!project) throw new NotFoundException('项目不存在');

    const experts = await this.prisma.user.findMany({
      where: { id: { in: expertIds }, role: 'bid_expert' },
      select: { id: true, displayName: true, expertProfile: { select: { phone: true } } },
    });

    const expertPortalUrl = resolveRsvpLinkOrigin('expert', headers, process.env.EXPERT_PORTAL_URL || process.env.PUBLIC_PORTAL_URL);
    const body = message || `您已被选为「${project.name}（${project.projectCode}）」评审专家。`;
    const expiresAt = new Date(Date.now() + this.rsvpTtlMs);

    // 发送时刷新 RSVP 过期时间（token 已在预生成时创建，这里不重新生成）
    const results = await Promise.all(
      experts.map(async expert => {
        const be = await this.prisma.bidExpert.findFirst({
          where: { projectId, userId: expert.id },
          select: { id: true, rsvpToken: true },
        });
        // 发送留痕（2026-10-27）：NOTIFIED 日志=服务端「已通知」真值
        const logNotified = this.prisma.expertInvitationLog.create({
          data: { bidExpertId: be?.id ?? '', projectId, userId: expert.id, action: 'NOTIFIED', actorType: 'SYSTEM', reason: noRsvpLink ? '发送候补专家通知（无确认链接）' : '发送评审邀请通知' },
        }).catch(() => {});
        // 候补文案（noRsvpLink，2026-10-27）：正文原样直发——不刷过期、不追加链接
        if (noRsvpLink) {
          const r = await this.notification.sendToUser(expert.id, channels, {
            type: 'EXPERT_ASSIGNED',
            title: `评审任务通知 - ${project.name}`,
            content: body,
          });
          await logNotified;
          return r;
        }
        let rsvpLink = `${expertPortalUrl}/invitation/${projectId}`;
        if (be?.rsvpToken) {
          // 刷新过期时间（从发送时刻重新计时 RSVP TTL——EXPERT_RSVP_TTL_HOURS，默认 0.25 小时=15 分钟）
          await this.prisma.bidExpert.update({
            where: { id: be.id },
            data: { rsvpExpiresAt: expiresAt },
          });
          rsvpLink = `${expertPortalUrl}/rsvp?t=${be.rsvpToken}`;
        }
        // 替换模板中的 {RSVP_LINK} 占位符；正文已内嵌确认链接（固定语句拼装，2026-10-27）则原样直发——
        // 不再追加「确认链接（…内有效）」尾段（实录：同链双发，短信冗余且多计费段）
        const contentWithLink = body.includes('{RSVP_LINK}')
          ? body.replace(/\{RSVP_LINK\}/g, rsvpLink)
          : /\/rsvp\?t=/.test(body)
            ? body
            : `${body}\n确认链接（${rsvpTtlLabel()}内有效）：${rsvpLink}`;
        const sent = await this.notification.sendToUser(expert.id, channels, {
          type: 'EXPERT_ASSIGNED',
          title: `评审任务通知 - ${project.name}`,
          content: contentWithLink,
          link: rsvpLink,
        });
        await logNotified;
        return sent;
      }),
    );

    return {
      projectId,
      projectName: project.name,
      results,
    };
  }

  /** 查询项目的抽取历史（从审计日志中提取） */
  async getExtractionHistory(projectId?: string, page = 1, pageSize = 20) {
    const where: any = { action: 'EXPERT_EXTRACTION_CONFIRMED' };
    if (projectId) where.resourceId = projectId;

    const [total, items] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          userId: true,
          action: true,
          resourceId: true,
          details: true,
          createdAt: true,
          user: { select: { displayName: true } },
        },
      }),
    ]);

    return { total, page, pageSize, items };
  }

  /* 大屏聚合统计（公开，无需登录） */

  async getBigscreenStats() {
    const [total, availGroups, disabledRetired, specGroups, titleGroups, evals, scoreRecords] = await Promise.all([
      this.prisma.user.count({ where: { role: 'bid_expert' } }),
      // 2026-10-28 口径收口：可用/占用限库内 ACTIVE+账号在编（与 getStatistics/抽取池同口径）
      this.prisma.expertProfile.groupBy({
        by: ['availability'],
        where: { entryStatus: 'ACTIVE', user: { role: 'bid_expert', isActive: true } },
        _count: true,
      }),
      // 已停用=退库专家（entryStatus 为准，availability 镜像可能失真）
      this.prisma.expertProfile.count({ where: { entryStatus: 'RETIRED', user: { role: 'bid_expert' } } }),
      this.prisma.expertProfile.groupBy({
        by: ['specialty'],
        where: { user: { role: 'bid_expert', isActive: true } },
        _count: true,
        orderBy: { _count: { specialty: 'desc' } },
        take: 4,
      }),
      this.prisma.expertProfile.groupBy({
        by: ['title'],
        where: { user: { role: 'bid_expert', isActive: true } },
        _count: true,
        orderBy: { _count: { title: 'desc' } },
      }),
      // 统计闸：大屏聚合按槽位去重（方案B 多次评价不放大单人票权）
      this.prisma.expertEvaluation.findMany({
        select: { overallGrade: true, expertUserId: true, createdAt: true, evaluatorId: true, projectId: true, updatedAt: true },
      }).then(latestExpertEvals),
      this.prisma.bidScoreRecord.findMany({
        select: {
          score: true, scoreItemId: true, supplierId: true,
          expert: { select: { userId: true } },
        },
      }),
    ]);

    // 可用状态
    const amap: Record<string, number> = {};
    for (const g of availGroups) amap[g.availability] = g._count;
    const avail = amap['可用'] ?? 0;
    const occupied = amap['占用'] ?? 0;
    const disabled = disabledRetired;

    // 专业分布（最大值为 100% 基准）
    const maxSpec = specGroups[0]?._count ?? 1;
    const specialties = specGroups.map(g => ({
      name: g.specialty,
      count: g._count,
      pct: Math.round((g._count / maxSpec) * 100),
    }));

    // 履职评价等级分布
    const levelCounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    for (const e of evals) levelCounts[e.overallGrade] = (levelCounts[e.overallGrade] ?? 0) + 1;
    const evalTotal = evals.length;
    const excellentRatio = evalTotal > 0
      ? Math.round(((levelCounts['A'] + levelCounts['B']) / evalTotal) * 1000) / 10
      : 0;

    // 评分偏离度
    const deviations = computeExpertMeanDeviations(
      scoreRecords.map(r => ({
        expertId: r.expert.userId,
        scoreItemId: r.scoreItemId,
        supplierId: r.supplierId,
        score: Number(r.score),
      })),
    );
    const avgDeviation = deviations.length > 0
      ? Math.round(deviations.reduce((s, d) => s + d.meanDeviation, 0) / deviations.length * 10) / 10
      : 0;

    // 职称归类
    const titleBuckets: Record<string, number> = {};
    for (const t of titleGroups) {
      const raw = (t.title ?? '').trim();
      let cat: string;
      if (!raw) cat = '未填写';
      else if (raw.includes('教授') || raw.includes('正高')) cat = '教授级高工';
      else if (raw.includes('高工') || raw.includes('高级')) cat = '高级工程师';
      else if (raw.includes('工程师') || raw.includes('中级')) cat = '工程师';
      else cat = '其他';
      titleBuckets[cat] = (titleBuckets[cat] ?? 0) + t._count;
    }
    const titles = Object.entries(titleBuckets)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return {
      total,
      availability: {
        available: avail,
        occupied,
        disabled,
        availableRate: total > 0 ? Math.round((avail / total) * 1000) / 10 : 0,
      },
      specialties,
      evaluation: { levelCounts, excellentRatio, total: evalTotal, avgScoreDeviation: avgDeviation },
      titles,
    };
  }

  /* 专家评价 */

  /** AI 辅助评价建议：LLM 综合历史评价 / 评分偏离度 / 违规 / 当前负荷给出三维建议分数，
   *  LLM 不可用时走规则兜底（历史均分 ± 偏离度/违规罚分），engine 字段标识来源，前端据实展示。 */
  async aiSuggestEvaluation(expertUserId: string, actor?: AuthenticatedUser) {
    if (actor) await this.assertExpertInScope(expertUserId, actor);
    const user = await this.prisma.user.findFirst({
      where: { id: expertUserId, role: 'bid_expert' },
      select: { id: true, displayName: true, expertProfile: { select: { specialty: true, title: true } } },
    });
    if (!user) throw new NotFoundException('专家不存在');

    const [evals, scoreRecords, violations, activeAssigns] = await Promise.all([
      this.prisma.expertEvaluation.findMany({
        where: { expertUserId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { attendanceGrade: true, qualityGrade: true, disciplineGrade: true, overallGrade: true },
      }),
      this.prisma.bidScoreRecord.findMany({
        where: { expert: { userId: expertUserId } },
        select: { score: true, scoreItemId: true, supplierId: true },
      }),
      this.prisma.auditLog.findMany({
        where: { action: 'EXPERT_VIOLATION_RECORDED', resourceId: expertUserId },
        select: { id: true },
      }),
      this.prisma.bidExpert.findMany({
        where: { userId: expertUserId, project: { stage: { not: 'ARCHIVED' } } },
        select: { id: true },
      }),
    ]);

    const deviations = computeExpertMeanDeviations(
      scoreRecords.map(r => ({ expertId: expertUserId, scoreItemId: r.scoreItemId, supplierId: r.supplierId, score: Number(r.score) })),
    );
    const meanDeviation = deviations.length > 0 ? Math.round(deviations[0].meanDeviation * 10) / 10 : null;

    // 规则兜底：历史最常见等级 ± 违规影响（LLM 不可用时使用）
    const mostCommonGrade = (grades: ExpertLevel[]): ExpertLevel => {
      const cnt: Record<string, number> = {};
      for (const g of grades) cnt[g] = (cnt[g] ?? 0) + 1;
      let best = 'C', bestN = 0;
      for (const [g, n] of Object.entries(cnt)) { if (n > bestN) { best = g; bestN = n; } }
      return best as ExpertLevel;
    };
    const penalty = violations.length > 0 ? 1 : 0; // 有违规最多降一级
    const downgrade = (g: ExpertLevel): ExpertLevel => {
      if (penalty === 0) return g;
      const downgraded = GRADE_SCORE[g] - penalty;
      return SCORE_GRADE[Math.max(1, downgraded)]!;
    };
    const ruleFallback = () => {
      const attGrade = downgrade(mostCommonGrade(evals.map(e => e.attendanceGrade)));
      const qualGrade = downgrade(mostCommonGrade(evals.map(e => e.qualityGrade)));
      const discGrade = downgrade(mostCommonGrade(evals.map(e => e.disciplineGrade)));
      return {
        attendanceGrade: attGrade,
        qualityGrade: qualGrade,
        disciplineGrade: discGrade,
        analysis: `规则分析建议：基于近 ${evals.length} 次评价最高频等级${
          meanDeviation != null ? `、评分偏离度 ${meanDeviation}` : ''
        }${violations.length > 0 ? `、${violations.length} 条违规记录` : ''}综合得出。AI 暂不可用，建议人工复核后调整。`,
        engine: 'rules' as const,
      };
    };

    try {
      const recentLevels = evals.slice(0, 5).map(e => e.overallGrade).join('、') || '无';
      const raw = await this.llm.chat(
        '你是评审专家履职评价助手。根据专家历史履职数据，给出本次评价的三维建议等级（A=优秀/B=良好/C=合格/D=待改进/E=不合格）与简明分析（150字内，说明依据与关注点）。客观中立，等级须与历史表现匹配，不得无依据拔高或打压。',
        `专家：${user.displayName}（${user.expertProfile?.specialty ?? '专业未填写'} / ${user.expertProfile?.title ?? '职称未填写'}）。
近 ${evals.length} 次履职评价：综合等级序列 ${recentLevels}。
评分偏离度（与评审共识的偏差）：${meanDeviation ?? '无数据'}。
违规记录：${violations.length} 条。
当前负荷：${activeAssigns.length} 个未归档项目。

请严格以 JSON 格式返回（不要markdown包裹，直接输出纯JSON对象）：
{"attendanceGrade":"A|B|C|D|E","qualityGrade":"A|B|C|D|E","disciplineGrade":"A|B|C|D|E","analysis":"分析文字"}`,
        0.3,
      );
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return ruleFallback();
      const parsed = JSON.parse(jsonMatch[0]);
      const validGrades = new Set(['A', 'B', 'C', 'D', 'E']);
      const valid = (g: string): ExpertLevel =>
        validGrades.has(g) ? (g as ExpertLevel) : 'C';
      return {
        attendanceGrade: valid(parsed.attendanceGrade),
        qualityGrade: valid(parsed.qualityGrade),
        disciplineGrade: valid(parsed.disciplineGrade),
        analysis: (parsed.analysis ?? '').slice(0, 300),
        engine: 'ai' as const,
      };
    } catch (err) {
      new Logger(ExpertAdminService.name).warn(`评价 AI 建议降级（LLM 不可用），返回规则兜底: ${(err as Error)?.message ?? err}`);
      return ruleFallback();
    }
  }

  async createEvaluation(evaluatorId: string, dto: CreateExpertEvaluationDto, actor?: AuthenticatedUser) {
    if (actor) await this.assertExpertInScope(dto.expertUserId, actor);
    const expert = await this.prisma.user.findFirst({ where: { id: dto.expertUserId, role: 'bid_expert' } });
    if (!expert) throw new NotFoundException('专家不存在');

    // projectId 非空时校验项目真实存在、且该专家确实在该项目担任评审，
    // 防止给虚构项目或专家从未参与的项目写评价，污染排名/画像/统计等全部下游。
    if (dto.projectId) {
      const project = await this.prisma.bidProject.findUnique({ where: { id: dto.projectId }, select: { id: true } });
      if (!project) throw new BadRequestException({ error: '评价关联的项目不存在', code: 'PROJECT_NOT_FOUND' });
      const assignment = await this.prisma.bidExpert.findFirst({ where: { projectId: dto.projectId, userId: dto.expertUserId }, select: { id: true } });
      if (!assignment) throw new BadRequestException({ error: '该专家未参与此项目，不能对其发起项目履职评价', code: 'EXPERT_NOT_ON_PROJECT' });
    }

    const overallGrade = computeOverallGrade(
      dto.qualityGrade,
      dto.disciplineGrade,
      dto.attendanceGrade,
    );

    const data = {
      attendanceGrade: dto.attendanceGrade,
      qualityGrade: dto.qualityGrade,
      disciplineGrade: dto.disciplineGrade,
      overallGrade,
      comment: dto.comment,
      // 三维评价依据：前端文本域内容原样持久化（可空）。只保留三键白名单，滤掉任意负载。
      evidence: dto.evidence && Object.keys(dto.evidence).length > 0
        ? {
            attendanceGrade: dto.evidence.attendanceGrade ?? null,
            qualityGrade: dto.evidence.qualityGrade ?? null,
            disciplineGrade: dto.evidence.disciplineGrade ?? null,
          }
        : undefined,
    };

    // 方案B（2026-10-21 用户裁定：工作人员可多次评价）——提交闸+频次闸替代原「终身一条 upsert」：
    // ①提交闸：同评价人×同专家×同项目 7 天内已评价 → 覆盖更新（视为修改，不增条目）
    // ②频次闸：7 天内对该专家已有其他评价 → 须 leader/admin 或填「复评事由」
    // ③统计闸见 latestExpertEvals——排名/画像/退库预警按槽位取最新，单人刷多条只算一票
    const recent = await this.prisma.expertEvaluation.findMany({
      where: { expertUserId: dto.expertUserId, evaluatorId, createdAt: { gte: new Date(Date.now() - EVALUATION_COOLDOWN_MS) } },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    const sameSlot = recent.find((e) => (e.projectId ?? null) === (dto.projectId ?? null));
    if (!sameSlot && recent.length > 0 && !reevalAllowed(actor?.role, dto.reviewReason)) {
      throw new BadRequestException({
        error: '7 天内已评价过该专家，再次评价须填写复评事由（或由 leader/admin 发起）',
        code: 'EVALUATION_TOO_FREQUENT',
      });
    }
    if (sameSlot) {
      return this.prisma.expertEvaluation.update({
        where: { id: sameSlot.id },
        data: { ...data, reviewReason: dto.reviewReason?.trim() || undefined },
        include: { evaluator: { select: { id: true, displayName: true } } },
      });
    }

    const created = await this.prisma.expertEvaluation.create({
      data: { expertUserId: dto.expertUserId, projectId: dto.projectId ?? null, evaluatorId, ...data, reviewReason: dto.reviewReason?.trim() || undefined },
      include: { evaluator: { select: { id: true, displayName: true } } },
    });

    // 决策 #3：不自动停用。连续 E 级由 reviewRetirementCandidates()（cron + 人工）产出预警，
    // 实际退库须经 admin 调 confirmRetire() 确认。此处仅返回评价结果。
    // 审计留痕：评价（含更新）记一条，整体等级 + 关联项目入 details，评价人=操作人（evaluatorId）
    await this.auditExpert(evaluatorId, 'EXPERT_EVALUATE', dto.expertUserId, {
      expertName: expert.displayName, overallGrade, projectId: dto.projectId ?? null, updated: !!sameSlot,
    });
    return created;
  }

  async getEvaluationStats(user?: AuthenticatedUser) {
    const scope = await this.companyScope.resolveScope(user);
    const f = this.companyScope.filter(scope);
    const [evaluations, allDeviations] = await Promise.all([
      // 统计闸：槽位去重后算等级分布/优良率（方案B 多次评价不放大单人票权）
      this.prisma.expertEvaluation.findMany({
        where: { expertUser: f },
        select: { overallGrade: true, expertUserId: true, createdAt: true, evaluatorId: true, projectId: true, updatedAt: true },
      }).then(latestExpertEvals),
      // P2：偏离度计算下推到 Postgres 窗口函数，仅返回按专家聚合的结果，避免全表 BidScoreRecord 加载入内存
      // 语义等价 computeExpertMeanDeviations：按 (scoreItemId,supplierId) 分组、组内 ≥2 人、每位专家平均绝对偏离
      this.prisma.$queryRaw<{ expertId: string; meanDeviation: string | number; sampleCount: number }[]>`
        WITH scored AS (
          SELECT e."userId" AS "expertId", r."scoreItemId", r."supplierId", r.score,
                 COUNT(*) OVER (PARTITION BY r."scoreItemId", r."supplierId") AS grp_count,
                 AVG(r.score) OVER (PARTITION BY r."scoreItemId", r."supplierId") AS grp_mean
          FROM "BidScoreRecord" r
          JOIN "BidExpert" e ON e.id = r."expertId"
        )
        SELECT "expertId",
               ROUND(AVG(ABS(score - grp_mean))::numeric, 1) AS "meanDeviation",
               COUNT(*)::int AS "sampleCount"
        FROM scored
        WHERE grp_count >= 2
        GROUP BY "expertId"
      `,
    ]);

    // 既有：等级分布 + 优良率
    const levelCounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    for (const e of evaluations) levelCounts[e.overallGrade] = (levelCounts[e.overallGrade] ?? 0) + 1;
    const excellentRatio = evaluations.length > 0
      ? Math.round(((levelCounts['A'] + levelCounts['B']) / evaluations.length) * 1000) / 10
      : 0;

    // 偏离度 SQL 走窗口函数无法带关系过滤 → 按隔离集专家 id 后过滤（专家库规模小，代价可忽略）
    let deviations = allDeviations;
    if (!scope.all) {
      const scopedIds = new Set(
        (await this.prisma.user.findMany({ where: { role: 'bid_expert', ...f }, select: { id: true } })).map(u => u.id),
      );
      deviations = allDeviations.filter(d => scopedIds.has(d.expertId));
    }

    // 评分偏离度（已由 DB 窗口函数计算，仅取回按专家聚合的结果）
    const devMap = new Map(deviations.map(d => [d.expertId, Number(d.meanDeviation)]));
    const avgScoreDeviation = deviations.length > 0
      ? Math.round(deviations.reduce((s, d) => s + Number(d.meanDeviation), 0) / deviations.length * 10) / 10
      : 0;

    // 关联分析：每位专家最新履职等级 → 按等级汇总其偏离度均分
    const latestLevel = new Map<string, string>();
    for (const e of [...evaluations].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      latestLevel.set(e.expertUserId, e.overallGrade); // 时间升序遍历，最终保留最新
    }
    const byLevel: Record<string, number[]> = { A: [], B: [], C: [], D: [], E: [] };
    for (const [expertId, level] of latestLevel) {
      const dev = devMap.get(expertId);
      if (dev != null && level in byLevel) byLevel[level].push(dev);
    }

    return {
      levelCounts,
      excellentRatio,
      total: evaluations.length,
      avgScoreDeviation,
      deviationByLevel: {
        A: meanOrNull(byLevel.A),
        B: meanOrNull(byLevel.B),
        C: meanOrNull(byLevel.C),
        D: meanOrNull(byLevel.D),
        E: meanOrNull(byLevel.E),
      },
      expertsWithDeviation: deviations.length,
    };
  }

  /** 三维等级分布（公司隔离） */
  async getEvaluationDimensionStats(user?: AuthenticatedUser) {
    const f = await this.expertScopeFilter(user);
    const evals = await this.prisma.expertEvaluation.findMany({
      where: { expertUser: f },
      select: { attendanceGrade: true, qualityGrade: true, disciplineGrade: true },
    });
    const zero = (): Record<string, number> => ({ A: 0, B: 0, C: 0, D: 0, E: 0 });
    const attendance = zero(), quality = zero(), discipline = zero();
    for (const e of evals) {
      attendance[e.attendanceGrade] = (attendance[e.attendanceGrade] ?? 0) + 1;
      quality[e.qualityGrade] = (quality[e.qualityGrade] ?? 0) + 1;
      discipline[e.disciplineGrade] = (discipline[e.disciplineGrade] ?? 0) + 1;
    }
    return { attendance, quality, discipline, total: evals.length };
  }

  /* ── 专家画像（Track D §3.4） ── */

  /** 单专家画像：参与/完成率/均分/偏离度/评价趋势/常委标记。（公司隔离） */
  async getExpertPortrait(userId: string, actor?: AuthenticatedUser) {
    if (actor) await this.assertExpertInScope(userId, actor);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, displayName: true, role: true },
    });
    if (!user || user.role !== 'bid_expert') throw new NotFoundException('专家不存在');

    const [assignments, scoreRecords, evals] = await Promise.all([
      this.prisma.bidExpert.findMany({
        where: { userId },
        select: { progress: true, totalScore: true },
      }),
      this.prisma.bidScoreRecord.findMany({
        where: { expert: { userId } },
        select: { score: true, scoreItemId: true, supplierId: true, expert: { select: { userId: true } } },
      }),
      // 统计闸：画像等级分布按槽位去重（方案B 多次评价不放大单人票权）；R6-7③：全量真实分布
      this.prisma.expertEvaluation.findMany({
        where: { expertUserId: userId },
        orderBy: { createdAt: 'desc' },
        select: { expertUserId: true, overallGrade: true, createdAt: true, evaluatorId: true, projectId: true, updatedAt: true },
      }).then(latestExpertEvals),
    ]);

    const deviations = computeExpertMeanDeviations(
      scoreRecords.map(r => ({
        expertId: r.expert.userId,
        scoreItemId: r.scoreItemId,
        supplierId: r.supplierId,
        score: Number(r.score),
      })),
    );
    const myDeviation = deviations.find(d => d.expertId === userId) ?? null;

    return buildExpertPortrait({
      userId,
      displayName: user.displayName,
      assignments: assignments.map(a => ({ progress: a.progress, totalScore: Number(a.totalScore) })),
      deviation: myDeviation,
      recentEvals: evals.map(e => ({ level: e.overallGrade, overallGrade: e.overallGrade, createdAt: e.createdAt })),
    });
  }

  /* ── 退库预警 + 人工确认（决策 #3：只预警，不自动改状态） ── */

  /** 扫描退库候选（连续 E 级 或 近 12 个月无分配），跳过最近 90 天内被标记忽略的专家；不修改 availability。 */
  async reviewRetirementCandidates(user?: AuthenticatedUser) {
    const ignoreCutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000);
    const f = await this.expertScopeFilter(user);
    const experts = await this.prisma.user.findMany({
      where: {
        role: 'bid_expert', isActive: true,
        ...f,
        expertProfile: {
          availability: { not: '停用' },
          // 2026-10-28：待审核(PENDING)专家尚未入库，不应进「长期无分配」退库候选（新录入必然 12 个月无分配）
          entryStatus: { in: ['ACTIVE', 'SUSPENDED'] },
          OR: [
            { retireIgnoredAt: null },
            { retireIgnoredAt: { lt: ignoreCutoff } },
          ],
        },
      },
      include: { expertProfile: { select: { specialty: true } } },
    });

    const cutoff = new Date(Date.now() - 365 * 24 * 3600 * 1000);
    const expertIds = experts.map(e => e.id);

    // Batch queries instead of N+1 per-expert queries
    const [allEvals, allRecentAssigns] = await Promise.all([
      // All recent evaluations for all experts (up to 2 per expert)
      // 统计闸：退库预警「连续低等级」按槽位去重判定（方案B 多次评价——单人刷 D/E 不再触发误退库）
      this.prisma.expertEvaluation.findMany({
        where: { expertUserId: { in: expertIds } },
        orderBy: { createdAt: 'desc' },
        select: { expertUserId: true, overallGrade: true, createdAt: true, evaluatorId: true, projectId: true, updatedAt: true },
      }).then(latestExpertEvals),
      // All recent assignments in last 12 months
      this.prisma.bidExpert.findMany({
        where: { userId: { in: expertIds }, createdAt: { gte: cutoff } },
        select: { userId: true, id: true },
      }),
    ]);

    // Index: expertUserId → recent evaluations (up to 2 most recent)
    const evalsByExpert = new Map<string, { level: string }[]>();
    for (const ev of allEvals) {
      if (!evalsByExpert.has(ev.expertUserId)) evalsByExpert.set(ev.expertUserId, []);
      const arr = evalsByExpert.get(ev.expertUserId)!;
      if (arr.length < 2) arr.push({ level: ev.overallGrade });
    }
    // Index: userId → true if has recent assignment
    const hasRecentAssign = new Set(allRecentAssigns.map(a => a.userId));

    const candidates: Array<{ userId: string; displayName: string; specialty?: string; reason: string }> = [];

    for (const e of experts) {
      const recent = evalsByExpert.get(e.id) || [];
      let reason: string | null = null;
      if (shouldDeactivateExpert(recent)) {
        reason = '最近 2 次履职评价均为 E 级';
      } else if (!hasRecentAssign.has(e.id)) {
        reason = '近 12 个月无评标分配';
      }
      if (reason) {
        candidates.push({ userId: e.id, displayName: e.displayName, specialty: e.expertProfile?.specialty, reason });
      }
    }

    if (candidates.length > 0) {
      // 新批取代旧批（2026-10-22）：本扫描被 /expert/retirement 页面每次打开与 cron 双路
      // 调用，旧批报留待办无限累积（leader/staff 曾积 42 条）。发新批前消解全部旧未消解，
      // 各收件人恒只保留最新一批；真值在退库复核页实时计算。
      await this.prisma.notification.updateMany({
        where: { type: 'EXPERT_RETIRE_CANDIDATE', resolvedAt: null },
        data: { resolvedAt: new Date() },
      }).catch(() => {});
      const names = candidates.map(c => `${c.displayName}（${c.reason}）`).join('；');
      const payload = {
        type: 'EXPERT_RETIRE_CANDIDATE',
        title: '专家退库预警',
        content: `${candidates.length} 名专家进入退库候选，请人工复核：${names}`,
        link: '/expert/retirement',
      };
      // 2026-09-26 场内矩阵：退库预警是专家库管理事件（:3005），不进 bid_host（场内角色）；
      // 收件人=leader+staff（expert-admin 类级 @Roles 已允许复核），link 指向 :3005 退库复核页
      await Promise.all([
        this.notification.sendToRole('leader', payload),
        this.notification.sendToRole('staff', payload),
      ]);
    }

    return candidates;
  }

  /** 忽略本轮退库预警：标记 retireIgnoredAt，90 天内 reviewRetirementCandidates 跳过此专家（公司隔离） */
  async ignoreRetirementWarning(userId: string, operatorId?: string, actor?: AuthenticatedUser) {
    if (actor) await this.assertExpertInScope(userId, actor);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'bid_expert') throw new NotFoundException('专家不存在');
    await this.prisma.expertProfile.update({ where: { userId }, data: { retireIgnoredAt: new Date() } });
    await this.auditExpert(operatorId, 'EXPERT_RETIRE_IGNORE', userId, { expertName: user.displayName });
    return { success: true };
  }

  /** 人工确认退库：写入停用 + retiredAt + retireReason，同步禁用登录（同一事务，避免半退库态）。 */
  async confirmRetire(userId: string, reason: string, operatorId?: string, actor?: AuthenticatedUser) {
    if (actor) await this.assertExpertInScope(userId, actor);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    // 仅限专家角色，防止越权停用任意账户
    if (!user || user.role !== 'bid_expert') throw new NotFoundException('专家不存在');
    await this.prisma.$transaction([
      this.prisma.expertProfile.updateMany({
        where: { userId },
        // entryStatus 同步 RETIRED：与状态机端点（updateProfileStatus）收敛为单一语义，避免两路径状态分叉
        data: { availability: '停用', retiredAt: new Date(), retireReason: reason, entryStatus: 'RETIRED' },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { isActive: false },
      }),
    ]);
    await this.auditExpert(operatorId, 'EXPERT_RETIRE', userId, { expertName: user.displayName, reason });
    return { success: true };
  }

  /** CTS A-218/222 专家库状态机：PENDING→ACTIVE 记审核留痕；RETIRED 联动账号停用（对齐 confirmRetire）。公司隔离。 */
  async updateProfileStatus(userId: string, dto: UpdateExpertStatusDto, actor?: AuthenticatedUser) {
    if (actor) await this.assertExpertInScope(userId, actor);
    if (!actor || !['admin', 'leader'].includes(actor.role)) {
      throw new ForbiddenException({ error: '仅领导或管理员可变更专家库状态', code: 'EXPERT_STATUS_ROLE_FORBIDDEN' });
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
    if (!user || user.role !== 'bid_expert') throw new NotFoundException('专家不存在');
    const profile = await this.prisma.expertProfile.findUnique({
      where: { userId },
      select: { entryStatus: true, retiredAt: true }, // retiredAt 为准判退库恢复：兼容历史路径（曾漏写 entryStatus）
    });
    if (!profile) throw new NotFoundException('专家档案不存在');
    if (dto.status === 'RETIRED' && !dto.reason?.trim()) {
      throw new BadRequestException({ error: '退库必须填写事由', code: 'REASON_REQUIRED' });
    }
    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.expertProfile.updateMany({
        where: { userId },
        data: {
          entryStatus: dto.status,
          statusNote: dto.reason?.trim() ?? null,
          ...(dto.status === 'ACTIVE'
            ? {
                verifiedById: actor.sub ?? null,
                verifiedAt: new Date(),
                retiredAt: null,
                retireReason: null,
                // 退库路径曾置 availability='停用'——恢复在库须一并还原，否则抽取（要求可用）仍排除该专家
                ...(profile.retiredAt !== null ? { availability: '可用' } : {}),
              }
            : {}),
          ...(dto.status === 'RETIRED' ? { retiredAt: new Date(), retireReason: dto.reason!.trim(), availability: '停用' } : {}), // R6-7 三分叉：退库须落停用，否则统计"可用"虚高（confirmRetire 同款已置）
        },
      }),
    ];
    if (dto.status === 'RETIRED') {
      ops.push(this.prisma.user.update({ where: { id: userId }, data: { isActive: false } }));
    }
    if (dto.status === 'ACTIVE' && (profile.entryStatus === 'RETIRED' || profile.retiredAt !== null)) {
      // 退库恢复：账号随档案一并重新激活（retiredAt 兜底：兼容历史路径漏写 entryStatus 的存量）
      ops.push(this.prisma.user.update({ where: { id: userId }, data: { isActive: true } }));
    }
    await this.prisma.$transaction(ops);
    // 审计留痕：按状态迁移归类动作（审核入库 / 暂停 / 退库 / 恢复），退库事由入 details
    const prevStatus = profile.entryStatus ?? (profile.retiredAt ? 'RETIRED' : 'ACTIVE');
    const auditAction =
      dto.status === 'ACTIVE'
        ? (prevStatus === 'PENDING' ? 'EXPERT_APPROVE' : 'EXPERT_RESUME')
        : dto.status === 'SUSPENDED' ? 'EXPERT_SUSPEND'
        : 'EXPERT_RETIRE';
    const displayName = (await this.prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } }))?.displayName;
    await this.auditExpert(actor.sub, auditAction, userId, {
      expertName: displayName,
      from: prevStatus, to: dto.status,
      ...(dto.status === 'RETIRED' ? { reason: dto.reason!.trim() } : {}),
    });
    return this.prisma.expertProfile.findUnique({
      where: { userId },
      select: { userId: true, entryStatus: true, statusNote: true, verifiedById: true, verifiedAt: true, retiredAt: true },
    });
  }

  /* ── 统计 / 排名 / 负荷 ── */

  /** 专家库整体态势统计（web 统计页） */
  async getStatistics(user?: AuthenticatedUser, companyId?: string) {
    const cutoff7d = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const cutoff30d = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const f = await this.expertScopeFilter(user, companyId); // 统计在隔离集上算，不是全量算完再减

    const [totalExperts, availGroups, disabledRetired, specGroups, titleGroups, evals, recentAssigns7d, recentExtractions30d] = await Promise.all([
      this.prisma.user.count({ where: { role: 'bid_expert', ...f } }),
      // 可用/占用（2026-10-28 口径收口）：库内 ACTIVE+账号在编——「可用」与可抽取池三元组同口径
      // （录入/导入即 PENDING+可用，裸 availability 会把待审核专家虚增进「可参与抽取」）
      this.prisma.expertProfile.groupBy({ by: ['availability'], where: { entryStatus: 'ACTIVE', user: { role: 'bid_expert', isActive: true, ...f } }, _count: true }),
      // 已停用=退库专家：以 entryStatus 为准（availability='停用' 是 RETIRED 的镜像且历史档案可能失真）
      this.prisma.expertProfile.count({ where: { entryStatus: 'RETIRED', user: { role: 'bid_expert', ...f } } }),
      this.prisma.expertProfile.groupBy({
        by: ['specialty'], where: { user: { role: 'bid_expert', isActive: true, ...f } },
        _count: true, orderBy: { _count: { specialty: 'desc' } },
      }),
      this.prisma.expertProfile.groupBy({
        by: ['title'], where: { user: { role: 'bid_expert', isActive: true, ...f } },
        _count: true, orderBy: { _count: { title: 'desc' } },
      }),
      // 统计闸（2026-10-21 裁定）：统计面按槽位（专家,项目,评价人）取最新去重——本端点此前为唯一漏网
      this.prisma.expertEvaluation.findMany({
        where: { expertUser: f },
        select: { overallGrade: true, createdAt: true, updatedAt: true, expertUserId: true, evaluatorId: true, projectId: true, expertUser: { select: { displayName: true } } },
        orderBy: { createdAt: 'desc' },
      }).then(latestExpertEvals),
      this.prisma.bidExpert.count({ where: { createdAt: { gte: cutoff7d }, user: { role: 'bid_expert', ...f } } }),
      this.prisma.auditLog.count({ where: { action: 'EXPERT_EXTRACTION_CONFIRMED', createdAt: { gte: cutoff30d }, user: f } }),
    ]);

    const amap: Record<string, number> = {};
    for (const g of availGroups) amap[g.availability] = g._count;

    const levelCounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    for (const e of evals) levelCounts[e.overallGrade] = (levelCounts[e.overallGrade] ?? 0) + 1;
    const evalTotal = evals.length;
    const excellentRatio = evalTotal > 0
      ? Math.round(((levelCounts['A'] + levelCounts['B']) / evalTotal) * 1000) / 10
      : 0;

    // 月度评价趋势（近 12 月）
    const now = new Date();
    const labels: string[] = [];
    const counts: number[] = new Array(12).fill(0);
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      labels.push(`${d.getMonth() + 1}月`);
    }
    for (const e of evals) {
      const idx = (now.getFullYear() - e.createdAt.getFullYear()) * 12 + (now.getMonth() - e.createdAt.getMonth());
      const slot = 11 - idx;
      if (slot >= 0 && slot < 12) counts[slot]++;
    }

    return {
      totalExperts,
      available: amap['可用'] ?? 0,
      occupied: amap['占用'] ?? 0,
      disabled: disabledRetired,
      specialtyDistribution: specGroups.map(g => ({ name: g.specialty, count: g._count })),
      titleDistribution: titleGroups.map(g => ({ name: g.title || '未填写', count: g._count })),
      evaluationStats: { levelCounts, excellentRatio, total: evalTotal },
      recentEvals: evals.slice(0, 8).map(e => ({
        expert: e.expertUser?.displayName ?? '—',
        expertUserId: e.expertUserId,
        level: e.overallGrade,
        time: e.createdAt.toISOString(),
      })),
      recentAssigns7d,
      recentExtractions30d,
      monthlyEvalTrend: { labels, counts },
    };
  }

  /** 专家排名（综合加权得分 = A×5+B×4+C×3+D×2+E×1 / 总次数 × 置信度因子） */
  async getRanking(period: 'month' | 'quarter' | 'all' = 'month', user?: AuthenticatedUser, companyId?: string) {
    const cutoff = period === 'month'
      ? new Date(Date.now() - 30 * 24 * 3600 * 1000)
      : period === 'quarter'
        ? new Date(Date.now() - 90 * 24 * 3600 * 1000)
        : new Date(0);
    const f = await this.expertScopeFilter(user, companyId);

    // 统计闸：槽位去重（方案B 多次评价——单人同对象同项目只算最新一票），排名票数=去重后条数
    const evals = latestExpertEvals(await this.prisma.expertEvaluation.findMany({
      where: { createdAt: { gte: cutoff }, expertUser: f },
      select: {
        expertUserId: true, overallGrade: true, evaluatorId: true, projectId: true, createdAt: true, updatedAt: true,
        expertUser: { select: { displayName: true, expertProfile: { select: { specialty: true } } } },
      },
    }));

    const GRADE_SCORE: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, E: 1 };
    const byExpert = new Map<string, { displayName: string; specialty: string; evalCount: number; aCount: number; bCount: number; gradeCounts: Record<string, number> }>();
    for (const e of evals) {
      let rec = byExpert.get(e.expertUserId);
      if (!rec) {
        rec = { displayName: e.expertUser?.displayName ?? '—', specialty: e.expertUser?.expertProfile?.specialty ?? '', evalCount: 0, aCount: 0, bCount: 0, gradeCounts: { A: 0, B: 0, C: 0, D: 0, E: 0 } };
        byExpert.set(e.expertUserId, rec);
      }
      rec.evalCount++;
      rec.gradeCounts[e.overallGrade] = (rec.gradeCounts[e.overallGrade] ?? 0) + 1;
      if (e.overallGrade === 'A') rec.aCount++;
      if (e.overallGrade === 'B') rec.bCount++;
    }

    const rows = [...byExpert.entries()].map(([expertUserId, r]) => {
      // 综合得分 = 加权均分 × 置信度因子（evalCount ≥5 时满 1.0，1 次时 0.5）
      const rawAvg = Object.entries(r.gradeCounts).reduce((s, [g, c]) => s + (GRADE_SCORE[g] ?? 3) * c, 0) / r.evalCount;
      const confidence = Math.min(1, 0.5 + r.evalCount / 10);
      const weightedScore = Math.round(rawAvg * confidence * 100) / 100;
      return { expertUserId, displayName: r.displayName, specialty: r.specialty, evalCount: r.evalCount, aCount: r.aCount, bCount: r.bCount, gradeCounts: r.gradeCounts, avgScore: Math.round(rawAvg * 100) / 100, weightedScore };
    });
    // 按加权得分降序，得分相同按评价次数降序
    rows.sort((a, b) => b.weightedScore - a.weightedScore || b.evalCount - a.evalCount);

    let lastRank = 0;
    let lastScore = -1;
    return rows.map((r, i) => {
      if (r.weightedScore !== lastScore) { lastRank = i + 1; lastScore = r.weightedScore; }
      return { ...r, rank: lastRank };
    });
  }

  /** 专家负荷分布（按活跃评审项目数；公司隔离） */
  async getLoadDistribution(user?: AuthenticatedUser, companyId?: string) {
    const f = await this.expertScopeFilter(user, companyId);
    const [totalActiveExperts, activeAssigns] = await Promise.all([
      // 2026-10-28 口径收口：负荷分母限库内 ACTIVE（PENDING/SUSPENDED 不算「活跃专家/空闲」）
      this.prisma.user.count({ where: { role: 'bid_expert', isActive: true, ...f, expertProfile: { entryStatus: 'ACTIVE' } } }),
      this.prisma.bidExpert.findMany({
        where: { project: { stage: { not: 'ARCHIVED' } }, user: { role: 'bid_expert', isActive: true, ...f, expertProfile: { entryStatus: 'ACTIVE' } } },
        select: { userId: true, user: { select: { displayName: true } } },
      }),
    ]);

    const byExpert = new Map<string, { displayName: string; count: number }>();
    for (const a of activeAssigns) {
      const rec = byExpert.get(a.userId) ?? { displayName: a.user.displayName, count: 0 };
      rec.count++;
      byExpert.set(a.userId, rec);
    }

    const loadDistribution: Record<string, number> = { 空闲: 0, 正常: 0, 繁忙: 0, 过载: 0 };
    const busyExperts: Array<{ userId: string; displayName: string; level: string; activeProjects: number }> = [];
    for (const [userId, r] of byExpert) {
      if (r.count >= 4) loadDistribution['过载']++;
      else if (r.count >= 3) loadDistribution['繁忙']++;
      else loadDistribution['正常']++;
      if (r.count >= 3) busyExperts.push({ userId, displayName: r.displayName, level: r.count >= 4 ? '过载' : '繁忙', activeProjects: r.count });
    }
    loadDistribution['空闲'] = Math.max(0, totalActiveExperts - byExpert.size);

    return { totalActiveExperts, loadDistribution, busyExperts: busyExperts.sort((a, b) => b.activeProjects - a.activeProjects) };
  }

  /* ── 批量操作 / 导入 / 导出 ── */

  /** 批量启用/停用专家（公司隔离：where 注入，他人公司 id 静默不命中） */
  async batchOperation(dto: { action: 'enable' | 'disable'; ids: string[]; reason?: string }, operatorId?: string, actor?: AuthenticatedUser) {
    if (!dto.ids?.length) throw new BadRequestException('未选择专家');
    const available = dto.action === 'enable';
    const f = await this.expertScopeFilter(actor);
    // 先把 id 集收窄到隔离集：两条 updateMany 共用，杜绝 user 侧被 where 护住、profile 侧裸 in 越权命中的分叉
    const ids = (await this.prisma.user.findMany({ where: { id: { in: dto.ids }, role: 'bid_expert', ...f }, select: { id: true } })).map(u => u.id);
    const result = await this.prisma.$transaction([
      this.prisma.user.updateMany({
        where: { id: { in: ids } },
        data: { isActive: available },
      }),
      this.prisma.expertProfile.updateMany({
        where: { userId: { in: ids } },
        data: { availability: available ? '可用' : '停用' },
      }),
    ]);
    // 批量动作单独记账（一条记录，不逐专家刷屏）
    await this.auditExpert(operatorId, available ? 'EXPERT_BATCH_ENABLE' : 'EXPERT_BATCH_DISABLE', 'batch', {
      count: result[0].count, ids: dto.ids, ...(dto.reason?.trim() ? { reason: dto.reason.trim() } : {}),
    });
    return { success: true, count: result[0].count };
  }

  /** 导出专家库（扁平结构，前端拼 CSV；公司隔离——只导出可见专家） */
  async exportExperts(ids?: string[], actor?: AuthenticatedUser) {
    const f = await this.expertScopeFilter(actor);
    const users = await this.prisma.user.findMany({
      where: { role: 'bid_expert', ...f, ...(ids?.length && { id: { in: ids } }) },
      include: { expertProfile: true, department: { select: { name: true } } },
      orderBy: { displayName: 'asc' },
    });
    return users.map(u => ({
      姓名: u.displayName,
      登录账号: u.username,
      专业: u.expertProfile?.specialty ?? '',
      职称: u.expertProfile?.title ?? '',
      工作单位: u.expertProfile?.employer ?? '',
      所属公司: u.company ?? '',
      部门: u.department?.name ?? '',
      手机号: maskPhone(openPiiForMask(u.expertProfile?.phone ?? null)) ?? '', // 导出脱敏（等保+密评）
      身份证号: maskIdNumber(openPiiForMask(u.expertProfile?.idNumber ?? null)) ?? '',
      邮箱: maskEmail(openPiiForMask(u.email)) ?? '',
      状态: u.isActive ? '可用' : '已停用',
      入库时间: u.createdAt.toISOString().slice(0, 10),
    }));
  }

  /** CSV 批量导入（表头灵活匹配） */
  async importCsv(rows: Array<Record<string, string>>, operatorId?: string) {
    const pick = (row: Record<string, string>, keys: string[]): string => {
      for (const k of Object.keys(row)) {
        const norm = k.trim();
        for (const target of keys) {
          if (norm === target || norm.includes(target)) return (row[k] ?? '').trim();
        }
      }
      return '';
    };

    const results: Array<{ 姓名: string; 状态: '成功' | '跳过' | '失败'; 原因?: string }> = [];
    let imported = 0, skipped = 0, failed = 0;

    for (const row of rows) {
      const displayName = pick(row, ['姓名', '名称']);
      const username = pick(row, ['登录账号', '账号', '用户名']) || displayName;
      const specialty = pick(row, ['专业领域', '专业']);
      if (!displayName || !username || !specialty) {
        results.push({ 姓名: displayName || '(空)', 状态: '跳过', 原因: '缺少姓名/账号/专业' });
        skipped++; continue;
      }
      const dup = await this.prisma.user.findFirst({ where: { username, role: 'bid_expert' } });
      if (dup) { results.push({ 姓名: displayName, 状态: '跳过', 原因: '账号已存在' }); skipped++; continue; }
      try {
        await this.createExpert({
          username, displayName,
          password: pick(row, ['密码', '初始密码']) || 'expert@2026',
          specialty,
          title: pick(row, ['职称']) || undefined,
          employer: pick(row, ['工作单位', '单位']) || undefined,
          phone: pick(row, ['手机号', '手机', '电话']) || undefined,
          idNumber: pick(row, ['身份证号', '身份证']) || undefined,
          ethnicity: pick(row, ['民族']) || undefined,
          education: pick(row, ['学历']) || undefined,
          licenseNo: pick(row, ['证书编号', '证书号', '资格证']) || undefined,
          email: pick(row, ['邮箱', 'email', '电子邮箱']) || undefined,
          notes: pick(row, ['备注']) || undefined,
        }, operatorId);
        results.push({ 姓名: displayName, 状态: '成功' });
        imported++;
      } catch (e: any) {
        results.push({ 姓名: displayName, 状态: '失败', 原因: e?.message ?? '录入异常' });
        failed++;
      }
    }
    if (imported > 0) {
      await this.auditExpert(operatorId, 'EXPERT_IMPORT', 'batch', { imported, skipped, failed, total: rows.length });
    }
    return { total: rows.length, imported, skipped, failed, results };
  }

  /* ── 违规记录（AuditLog）── */

  async getViolations(expertId?: string, user?: AuthenticatedUser) {
    const where: any = { action: 'EXPERT_VIOLATION_RECORDED' };
    if (expertId && user) await this.assertExpertInScope(expertId, user);
    if (!expertId && user) {
      // 全量违规列表：resourceId 收窄到隔离集内的专家
      const scope = await this.companyScope.resolveScope(user);
      if (!scope.all) {
        const ids = (await this.prisma.user.findMany({ where: { role: 'bid_expert', companyId: { in: scope.companyIds } }, select: { id: true } })).map(u => u.id);
        where.resourceId = { in: ids };
      }
    }
    return this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: { id: true, details: true, createdAt: true, user: { select: { displayName: true } } },
    });
  }

  async recordViolation(expertId: string, dto: { type: string; detail: string; severity: 'warning' | 'danger' }, operatorId: string, actor?: AuthenticatedUser) {
    if (actor) await this.assertExpertInScope(expertId, actor);
    const expert = await this.prisma.user.findFirst({ where: { id: expertId, role: 'bid_expert' } });
    if (!expert) throw new NotFoundException('专家不存在');
    if (!operatorId) throw new BadRequestException({ error: '缺少操作人，无法记录违规留痕', code: 'NO_OPERATOR' });
    await this.prisma.auditLog.create({
      data: {
        userId: operatorId,
        action: 'EXPERT_VIOLATION_RECORDED',
        resourceType: 'User',
        resourceId: expertId,
        details: { type: dto.type, detail: dto.detail, severity: dto.severity, expertName: expert.displayName },
      },
    });
    return { success: true };
  }

  /* ── 评价历史 / AI 采纳率 ── */

  /** 单个专家的履职评价记录（公司隔离） */
  async getExpertEvaluations(userId: string, actor?: AuthenticatedUser) {
    if (actor) await this.assertExpertInScope(userId, actor);
    return this.prisma.expertEvaluation.findMany({
      where: { expertUserId: userId },
      include: { evaluator: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /* ── 履职评价·关联项目（真实参评）与 AI 行为分析 ── */

  /**
   * 专家真实参评项目列表（BidExpert 分配实数据 + 评标结果有无；公司隔离）。
   * 履职评价弹窗「关联项目」下拉数据源——保证只列出该专家真实被分配/参评的项目。
   */
  async listEvaluationProjects(expertUserId: string, actor?: AuthenticatedUser) {
    if (actor) await this.assertExpertInScope(expertUserId, actor);
    const assignments = await this.prisma.bidExpert.findMany({
      where: { userId: expertUserId },
      orderBy: { createdAt: 'desc' },
      select: {
        projectId: true, expertRole: true, invitationStatus: true, signedIn: true, isLead: true,
        progress: true, reportConfirmed: true, reviewGroup: true, dutyRole: true,
        project: { select: { id: true, name: true, stage: true, procurementMethod: true, openTime: true } },
        _count: { select: { scoreRecords: true, expertMemos: true } },
      },
    });
    const projectIds = [...new Set(assignments.map(a => a.projectId))];
    const generated = new Set(
      projectIds.length > 0
        ? (await this.prisma.bidEvaluationResult.groupBy({ by: ['projectId'], where: { projectId: { in: projectIds } } })).map(g => g.projectId)
        : [],
    );
    return assignments.map(a => ({
      projectId: a.projectId,
      project: a.project,
      expertRole: a.expertRole,
      invitationStatus: a.invitationStatus,
      signedIn: a.signedIn,
      isLead: a.isLead,
      progress: a.progress,
      reportConfirmed: a.reportConfirmed,
      reviewGroup: a.reviewGroup,
      dutyRole: a.dutyRole,
      scoreCount: a._count.scoreRecords,
      memoCount: a._count.expertMemos,
      resultsGenerated: generated.has(a.projectId),
    }));
  }

  /**
   * 关联项目评标结果与该专家评分对照（履职评价弹窗「评标结果」窗口数据；公司隔离）。
   * 行集 = 官方评标结果 ∪ 该专家已评分供应商（评标中未生成结果也能对照委员会均分）；
   * 委员会口径与 generateEvaluationResults 同源：正选专家。
   */
  async getEvaluationProjectDetail(expertUserId: string, projectId: string, actor?: AuthenticatedUser) {
    if (actor) await this.assertExpertInScope(expertUserId, actor);
    const assignment = await this.prisma.bidExpert.findFirst({
      where: { userId: expertUserId, projectId },
      select: {
        id: true, expertName: true, major: true, expertRole: true, invitationStatus: true,
        signedIn: true, identityVerified: true, avoidanceConfirmed: true, confidentialityAgreed: true,
        disciplineAgreed: true, roomVerifiedAt: true, progress: true, totalScore: true,
        reportConfirmed: true, reportConfirmedAt: true, signStatus: true,
        dissentingOpinion: true, isLead: true, reviewGroup: true, dutyRole: true, createdAt: true,
        project: { select: { id: true, name: true, stage: true, procurementMethod: true, openTime: true, deadline: true, evaluationDeadline: true } },
      },
    });
    if (!assignment) throw new NotFoundException({ error: '该专家未参与此项目', code: 'EXPERT_NOT_ON_PROJECT' });
    const { project, ...assign } = assignment;

    const [committee, records, results, editCount] = await Promise.all([
      this.prisma.bidExpert.findMany({ where: { projectId, expertRole: '正选' }, select: { id: true, signedIn: true } }),
      this.prisma.bidScoreRecord.findMany({
        where: { expert: { projectId, expertRole: '正选' } },
        select: { expertId: true, supplierId: true, scoreItemId: true, score: true, createdAt: true, updatedAt: true },
      }),
      this.prisma.bidEvaluationResult.findMany({ where: { projectId }, orderBy: { rank: 'asc' } }),
      this.prisma.bidScoreRecordHistory.count({ where: { expertId: assignment.id, action: 'update' } }),
    ]);

    // 每位专家 × 供应商总分（该专家对该供应商全部评分项之和）
    const sumsByExpert = new Map<string, Map<string, number>>();
    for (const r of records) {
      const m = sumsByExpert.get(r.expertId) ?? new Map<string, number>();
      m.set(r.supplierId, (m.get(r.supplierId) ?? 0) + Number(r.score));
      sumsByExpert.set(r.expertId, m);
    }
    const expertSums = sumsByExpert.get(assignment.id) ?? new Map<string, number>();
    const supplierIds = new Set<string>([...expertSums.keys(), ...results.map(r => r.supplierId)]);
    for (const m of sumsByExpert.values()) for (const sid of m.keys()) supplierIds.add(sid);

    let extremeSupplierCount = 0;
    const committeeMean = new Map<string, number>();
    for (const sid of supplierIds) {
      const vals: number[] = [];
      for (const m of sumsByExpert.values()) {
        const v = m.get(sid);
        if (v != null) vals.push(v);
      }
      if (vals.length === 0) continue;
      committeeMean.set(sid, Math.round((vals.reduce((s, x) => s + x, 0) / vals.length) * 10) / 10);
      const mine = expertSums.get(sid);
      if (mine == null || vals.length < 2) continue;
      // 唯一极值才算（并列最高/最低属正常趋同，不计）
      const mx = Math.max(...vals), mn = Math.min(...vals);
      if ((mine === mx && vals.filter(v => v === mx).length === 1) || (mine === mn && vals.filter(v => v === mn).length === 1)) {
        extremeSupplierCount += 1;
      }
    }

    // 供应商名称：结果行自带；其余（评标中、结果未生成）回查 BidSupplier
    const nameById = new Map(results.map(r => [r.supplierId, r.supplierName]));
    const missing = [...supplierIds].filter(sid => !nameById.has(sid));
    if (missing.length > 0) {
      const suppliers = await this.prisma.bidSupplier.findMany({ where: { id: { in: missing } }, select: { id: true, supplierName: true } });
      for (const s of suppliers) nameById.set(s.id, s.supplierName);
    }

    const resultBySupplier = new Map(results.map(r => [r.supplierId, r]));
    const orderedIds = [...results.map(r => r.supplierId), ...[...supplierIds].filter(sid => !resultBySupplier.has(sid))];
    const rows = orderedIds.map(sid => {
      const official = resultBySupplier.get(sid);
      const expertScore = expertSums.has(sid) ? Math.round(expertSums.get(sid)! * 10) / 10 : null;
      // 偏差基准：官方评标均分优先（已生成结果），否则委员会实时均分
      const base = official ? Number(official.averageScore) : committeeMean.get(sid) ?? null;
      return {
        supplierId: sid,
        supplierName: nameById.get(sid) ?? sid,
        rank: official?.rank ?? null,
        expertScore,
        committeeMean: committeeMean.get(sid) ?? null,
        deviation: expertScore != null && base != null ? Math.round((expertScore - base) * 10) / 10 : null,
        officialTotal: official ? Number(official.totalScore) : null,
        officialAverage: official ? Number(official.averageScore) : null,
        recommended: official?.recommended ?? null,
        disqualified: official?.disqualified ?? null,
        bidPrice: official?.bidPrice != null ? Number(official.bidPrice) : null,
      };
    });

    // 项目内逐评分项平均绝对偏离（与画像/风险简报同 util 口径：同组 ≥2 人）
    const deviations = computeExpertMeanDeviations(
      records.map(r => ({ expertId: r.expertId, scoreItemId: r.scoreItemId, supplierId: r.supplierId, score: Number(r.score) })),
    );
    const mineDeviation = deviations.find(d => d.expertId === assignment.id);
    const expertRecords = records.filter(r => r.expertId === assignment.id);

    return {
      project,
      assignment: { ...assign, totalScore: Number(assign.totalScore) },
      committee: {
        size: committee.length,
        signedIn: committee.filter(c => c.signedIn).length,
        scored: sumsByExpert.size,
      },
      resultsGenerated: results.length > 0,
      generatedAt: results.length > 0 ? results[0].generatedAt : null,
      rows,
      scoreStats: {
        itemCount: expertRecords.length,
        supplierCount: expertSums.size,
        meanItemDeviation: mineDeviation?.meanDeviation ?? null,
        deviationSamples: mineDeviation?.sampleCount ?? 0,
        extremeSupplierCount,
        editCount,
        firstScoredAt: expertRecords.length > 0
          ? expertRecords.reduce((min, r) => (r.createdAt < min ? r.createdAt : min), expertRecords[0].createdAt)
          : null,
        lastScoredAt: expertRecords.length > 0
          ? expertRecords.reduce((max, r) => (r.updatedAt > max ? r.updatedAt : max), expertRecords[0].updatedAt)
          : null,
      },
    };
  }

  /**
   * AI 专家行为分析（公司隔离）：该项目打分偏离/极值倾向/修改记录/流程合规/不同意见 + 历史履职，
   * LLM 输出结构化结论，不可用时按阈值规则兜底（engine 标识）。只读无副作用，不入审计。
   */
  async analyzeExpertBehavior(expertUserId: string, projectId: string, actor?: AuthenticatedUser) {
    if (actor) await this.assertExpertInScope(expertUserId, actor);
    // scope 已验，内层不重复传 actor
    const detail = await this.getEvaluationProjectDetail(expertUserId, projectId);
    const user = await this.prisma.user.findUnique({ where: { id: expertUserId }, select: { displayName: true } });
    const [recentEvals, violationCount] = await Promise.all([
      this.prisma.expertEvaluation.findMany({
        where: { expertUserId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { overallGrade: true },
      }),
      this.prisma.auditLog.count({ where: { action: 'EXPERT_VIOLATION_RECORDED', resourceId: expertUserId } }),
    ]);
    const { assignment, project, scoreStats: s, committee, rows } = detail;
    const scoredRows = rows.filter(r => r.expertScore != null);
    const scoreLines = scoredRows.length > 0
      ? scoredRows.map(r => `${r.supplierName}：该专家 ${r.expertScore} 分 / 委员会均分 ${r.committeeMean ?? '—'}（偏离 ${r.deviation != null ? (r.deviation > 0 ? '+' : '') + r.deviation : '—'}）${r.disqualified ? '【废标】' : r.rank ? `【第${r.rank}名】` : ''}`).join('；')
      : '该项目暂无该专家的评分记录';

    // 规则兜底：阈值化事实发现（LLM 不可用时使用，与 aiSuggestEvaluation 同模式）
    const ruleFallback = () => {
      const findings: string[] = [];
      if (!assignment.signedIn) findings.push('签到记录缺失');
      if (assignment.invitationStatus === 'declined') findings.push('曾拒绝参评邀请');
      if (s.meanItemDeviation != null && s.meanItemDeviation >= 10) findings.push(`逐项评分平均偏离 ${s.meanItemDeviation} 分（显著高于评审共识）`);
      else if (s.meanItemDeviation != null && s.meanItemDeviation >= 5) findings.push(`逐项评分平均偏离 ${s.meanItemDeviation} 分，存在一定个人倾向`);
      if (s.extremeSupplierCount >= 2) findings.push(`对 ${s.extremeSupplierCount} 家供应商打出委员会唯一最高/最低分`);
      if (s.editCount >= 10) findings.push(`评分修改 ${s.editCount} 次，高于常规修订频次`);
      if (assignment.dissentingOpinion) findings.push('对评标结论提交了书面不同意见');
      if (s.itemCount > 0 && !assignment.reportConfirmed) findings.push('评分已提交但评标报告尚未确认');
      if (violationCount > 0) findings.push(`历史违规记录 ${violationCount} 条`);
      const riskLevel =
        (s.meanItemDeviation != null && s.meanItemDeviation >= 10) || s.extremeSupplierCount >= 2
          ? '预警'
          : findings.length > 0 ? '关注' : '正常';
      return {
        engine: 'rules' as const,
        riskLevel,
        findings: findings.length > 0 ? findings : ['评分行为与评审共识一致，流程合规记录完整'],
        analysis: `规则简报：${assignment.signedIn ? '已签到' : '未签到'}，${s.itemCount > 0 ? `完成 ${s.itemCount} 项评分` : '无评分记录'}${s.meanItemDeviation != null ? `，逐项平均偏离 ${s.meanItemDeviation} 分` : ''}${s.editCount > 0 ? `，修改 ${s.editCount} 次` : ''}${assignment.reportConfirmed ? '，报告已确认' : ''}。AI 暂不可用，以上为阈值规则结论，建议人工复核。`,
        suggestion: riskLevel === '预警'
          ? '建议核对其评分依据与客观分差距，必要时开展约谈并留存记录'
          : riskLevel === '关注'
            ? '建议留存本次评分留痕，持续观察后续项目表现'
            : '可正常参与后续评标项目',
      };
    };

    try {
      const raw = await this.llm.chat(
        '你是评标专家行为审计助手。根据该专家在指定项目的评标行为数据（评分偏离、极值倾向、修改记录、流程合规、不同意见）与历史履职情况输出行为分析。客观中立、只依据给定数据、不臆测动机；有积极表现也应指出。',
        `专家：${user?.displayName ?? expertUserId}（${assignment.major || '专业未填写'}${assignment.isLead ? '，评标组长' : ''}）。\n项目：${project.name}（${project.procurementMethod}，当前阶段 ${project.stage}）。\n委员会：正选 ${committee.size} 人、已签到 ${committee.signedIn} 人、已提交评分 ${committee.scored} 人。\n该专家参与情况：邀请${assignment.invitationStatus === 'confirmed' ? '已确认' : assignment.invitationStatus}、${assignment.signedIn ? '已签到' : '未签到'}、回避确认${assignment.avoidanceConfirmed ? '√' : '×'}、保密承诺${assignment.confidentialityAgreed ? '√' : '×'}、纪律确认${assignment.disciplineAgreed ? '√' : '×'}、报告确认${assignment.reportConfirmed ? '√' : '×'}${assignment.dissentingOpinion ? '、提交书面不同意见' : ''}。\n打分统计：${s.itemCount} 项评分（${s.supplierCount} 家供应商），逐项平均绝对偏离 ${s.meanItemDeviation ?? '无共识组数据'} 分（同组≥2人项），唯一极值供应商 ${s.extremeSupplierCount} 家，评分修改 ${s.editCount} 次。\n分供应商对照：${scoreLines}。\n历史履职：近 ${recentEvals.length} 次综合等级 ${recentEvals.map(e => e.overallGrade).join('、') || '无'}；违规记录 ${violationCount} 条。\n\n请严格以 JSON 格式返回（不要markdown包裹，直接输出纯JSON对象）：\n{"riskLevel":"正常|关注|预警","findings":["事实性发现，逐条"],"analysis":"综合行为分析（200字内）","suggestion":"管理建议（80字内）"}`,
        0.3,
      );
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return ruleFallback();
      const parsed = JSON.parse(jsonMatch[0]);
      const levels = new Set(['正常', '关注', '预警']);
      const findings = Array.isArray(parsed.findings)
        ? parsed.findings.filter((f: unknown) => typeof f === 'string').slice(0, 8)
        : [];
      return {
        engine: 'ai' as const,
        riskLevel: levels.has(parsed.riskLevel) ? parsed.riskLevel : '关注',
        findings: findings.length > 0 ? findings : ['未返回结构化发现，请阅读综合分析'],
        analysis: ((parsed.analysis as string) ?? '').slice(0, 500) || 'AI 未返回分析文字',
        suggestion: ((parsed.suggestion as string) ?? '').slice(0, 200) || '—',
      };
    } catch (err) {
      new Logger(ExpertAdminService.name).warn(`专家行为分析降级（LLM 不可用），返回规则兜底: ${(err as Error)?.message ?? err}`);
      return ruleFallback();
    }
  }

  /** AI 采纳率（基于 BidScoreDelta：专家分 vs AI 建议分；公司隔离） */
  async getAiAdoptionRate(expertId?: string, user?: AuthenticatedUser) {
    const f = await this.expertScopeFilter(user);
    if (expertId && user) await this.assertExpertInScope(expertId, user);
    // BidScoreDelta.expertId 指向 BidExpert.id，需映射到 userId 供前端按专家过滤
    // 公司过滤须挂在 user 关系上（BidExpert 无 companyId 直列）
    const assignments = await this.prisma.bidExpert.findMany({
      where: expertId ? { userId: expertId } : { user: { role: 'bid_expert', ...f } },
      select: { id: true, userId: true },
    });
    const expertIdToUser = new Map(assignments.map(a => [a.id, a.userId]));

    const deltas = await this.prisma.bidScoreDelta.findMany({
      where: assignments.length > 0 ? { expertId: { in: assignments.map(a => a.id) } } : undefined,
      select: { expertId: true, delta: true, accepted: true },
    });

    const total = deltas.length;
    const accepted = deltas.filter(d => d.accepted).length;

    const byUser = new Map<string, number[]>();
    for (const d of deltas) {
      const uid = expertIdToUser.get(d.expertId);
      if (!uid) continue;
      const arr = byUser.get(uid) ?? [];
      arr.push(Math.abs(Number(d.delta)));
      byUser.set(uid, arr);
    }
    const byExpert = [...byUser.entries()].map(([id, vals]) => ({
      expertId: id,
      avgAbsDelta: vals.length > 0 ? Math.round(vals.reduce((s, x) => s + x, 0) / vals.length) : 0,
    }));

    return {
      overall: {
        total,
        accepted,
        adoptionRate: total > 0 ? Math.round((accepted / total) * 100) : 0,
      },
      byExpert,
      // 可观测：LLM 调用/错误/降级计数与最近耗时（供前端评估 AI 健康度）
      llm: this.extractionAi.getMetrics(),
    };
  }

  /* AI 深化能力（OCR 录入 / 风险预警 / 抽取复盘，均带规则兜底降级） */

  /** 资质 OCR 自动录入：识别证书/证件图片 → LLM 结构化 → 返回表单字段供前端回填。
   *  OCR 服务不可用时抛 503 友好提示；LLM 不可用时返回原始识别文本（降级）。 */
  async ocrIntake(imageBase64: string, mimeType = 'image/jpeg', filename = 'cert.jpg') {
    if (!imageBase64) throw new BadRequestException({ error: '请提供证件图片', code: 'NO_IMAGE' });
    if (!(await this.ocr.isAvailable())) {
      throw new ServiceUnavailableException({ error: 'OCR 服务不可用，请启动 OCR 微服务（pnpm dev:ocr）或手动填写', code: 'OCR_UNAVAILABLE' });
    }
    const buffer = Buffer.from(imageBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    let text = '';
    try {
      const r = await this.ocr.ocrImage(buffer, mimeType, filename);
      text = r.text ?? '';
    } catch (err) {
      new Logger(ExpertAdminService.name).warn(`OCR 识别失败: ${(err as Error)?.message ?? err}`);
      throw new BadRequestException({ error: '证件识别失败，请确认图片清晰、完整且为 JPG/PNG 格式', code: 'OCR_FAILED' });
    }
    if (!text || text.trim().length < 2) throw new BadRequestException({ error: '未识别到文字，请确认图片清晰且为证件照', code: 'OCR_EMPTY' });

    let fields: Record<string, string> = {};
    try {
      fields = await this.llm.chatJson<Record<string, string>>(
        '你是证件证书信息抽取助手。从 OCR 文本中抽取字段并以 JSON 返回；无法确定的字段返回空字符串，绝不编造。',
        '请从以下证件 OCR 文本抽取专家信息，返回 JSON：{"displayName":"姓名","gender":"性别","ethnicity":"民族","birthYear":"出生年份","education":"学历","title":"职称","specialty":"专业领域","employer":"工作单位","idNumber":"身份证号","phone":"手机号","licenseNo":"证书编号"}。\nOCR 文本：\n' + text.slice(0, 4000),
        0,
      ) ?? {};
    } catch (err) {
      new Logger(ExpertAdminService.name).warn(`OCR 结构化降级（LLM 不可用），返回原始文本: ${(err as Error)?.message ?? err}`);
    }
    return { rawText: text.slice(0, 2000), fields };
  }

  /* 自定义抽取：文件分析 + 影子项目 */

  /** 读取已上传文件 → 文本（含 OCR），供 AI 推断项目需求。
   *  访问控制：仅允许读取操作者本人上传的文件，避免越权读取开标前投标文件/资质 PII 并外发 LLM。 */
  private async readAssetText(assetId: string, operatorId: string): Promise<string> {
    const asset = await this.prisma.fileAsset.findUnique({ where: { id: assetId } });
    if (!asset) throw new BadRequestException({ error: `文件不存在：${assetId}`, code: 'FILE_NOT_FOUND' });
    if (asset.uploaderId !== operatorId) {
      throw new ForbiddenException({ error: '无权分析该文件（仅限本人上传的文件）', code: 'FILE_FORBIDDEN' });
    }
    const stream = await minioClient.getObject(MINIO_BUCKET, asset.key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const buffer = Buffer.concat(chunks);
    const processed = await processFile(this.ocr, buffer, asset.originalName);
    return processed.text ?? '';
  }

  /** 已有项目 AI 推断专业配额（仅分析不抽取，用于步骤1预填配额） */
  async analyzeProjectSpecialties(projectId: string) {
    // AI 配额：读取项目关联的项目管理项（采购需求/立项/采购文件阶段录入的真实字段）+ 阶段备注与采购文件附件
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: {
        name: true, procurementMethod: true, scope: true, budget: true,
        qualification: true, qualityRequirement: true, riskNote: true,
        projectManagementItem: {
          select: {
            // 项目管理表单实际录入字段（详见 CreateProjectFromInitiationDto / 项目详情面板）
            title: true, procurementCategory: true,
            projectReason: true, supplierRequirements: true,
            // AI 抽取填入的概述、所属项目（update-extracted-info，详情面板展示）
            projectOverview: true, demandProject: true,
            stages: {
              select: { stageKey: true, note: true, attachments: { select: { fileName: true } } },
              orderBy: { stageOrder: 'asc' },
            },
          },
        },
      },
    });
    if (!project) throw new NotFoundException('项目不存在');

    const pm = project.projectManagementItem;
    const stageNote = (key: string) => pm?.stages.find(s => s.stageKey === key)?.note;
    const tenderFiles = (pm?.stages.find(s => s.stageKey === 'TENDER_DOCUMENT')?.attachments ?? []).map(a => a.fileName).filter(Boolean);

    const context = [
      // 开评标项目主体
      project.name && `项目名称：${project.name}`,
      project.procurementMethod && `采购方式：${project.procurementMethod}`,
      project.scope && `招标范围：${project.scope}`,
      project.qualification && `资质要求：${project.qualification}`,
      project.qualityRequirement && `质量目标：${project.qualityRequirement}`,
      project.riskNote && `风控备注：${project.riskNote}`,
      project.budget && `预算金额：${Number(project.budget).toLocaleString('zh-CN')} 元`,
      // 项目管理录入字段（采购需求/立项表单 + AI 抽取）
      pm?.title && pm.title !== project.name && `立项名称：${pm.title}`,
      pm?.procurementCategory && `采购类别：${pm.procurementCategory}`,
      pm?.demandProject && `所属项目：${pm.demandProject}`,
      pm?.projectOverview && `项目概述：${pm.projectOverview}`,
      pm?.projectReason && `立项事由：${pm.projectReason}`,
      pm?.supplierRequirements && `对供方的主要要求：${pm.supplierRequirements}`,
      // 阶段备注
      stageNote('PROCUREMENT_DEMAND') && `采购需求阶段备注：${stageNote('PROCUREMENT_DEMAND')}`,
      stageNote('INITIATION') && `采购立项阶段备注：${stageNote('INITIATION')}`,
      stageNote('TENDER_DOCUMENT') && `采购文件阶段备注：${stageNote('TENDER_DOCUMENT')}`,
      // 采购文件附件文件名（内容未解析，仅列出供 AI 参考）
      tenderFiles.length > 0 && `采购文件附件：${tenderFiles.join('、')}`,
    ].filter(Boolean).join('\n');

    if (!context || context.length < 20) {
      // 项目信息太少，不给 AI 推断，返回空配额让用户手动配置
      return { requiredSpecialties: [], totalExperts: 0, analysis: '项目信息不足，请手动添加专业配额', engine: 'rules' as const };
    }

    // 取专家库内实际存在的专业，AI 必须从中选择（避免生成库内没有的专业，且更贴合实际）；
    // 顺带取各专业的归属公司（换血后 8 公司直挂，同一专业可能只在别家公司），
    // 供配额行附挂 companyIds——否则配额公司默认本公司，跨公司专业 0 候选
    const poolSpecsRows = await this.prisma.expertProfile.findMany({
      where: { user: { isActive: true } },
      select: { specialty: true, availability: true, entryStatus: true, user: { select: { companyId: true } } },
    });
    const poolSpecs = Array.from(new Set(poolSpecsRows.map(r => r.specialty).filter(Boolean)));
    const companiesBySpec = this.companiesBySpecOf(poolSpecsRows);
    /** 每席位组附挂持有该组专业的公司并集（跨公司抽取白名单直连；空组跳过） */
    const attachCompanies = (rows: { specialty: string; specialties: string[]; count: number; reason: string }[]) =>
      this.attachHolderCompanies(rows, companiesBySpec);
    const poolHint = poolSpecs.length > 0
      ? `\n\n【专家库现有专业】（specialty 字段必须严格从这里选，用词完全一致，不得生造或同义词替换）：\n${poolSpecs.join('、')}`
      : '';

    const fallback = () => ({
      requiredSpecialties: [{ specialty: poolSpecs[0] || '水利工程', specialties: [poolSpecs[0] || '水利工程'], count: 2, reason: 'AI 不可用，给出通用默认，请手动调整' }],
      totalExperts: 3,
      analysis: 'AI 暂不可用，已给出默认专业与人数，请手动调整后再抽取。',
      engine: 'rules' as const,
    });

    try {
      const raw = await this.llm.chat(
        '你是招标采购评审专家抽取助手。判断评审所需专业时：首先抓住"采购标的的技术学科归属"定核心技术专业，然后判断是否涉及设备/机械（需要设备或机电专业评估），最后补充造价、法律等辅助专业。每个项目至少应包含核心技术专业，设备类采购还需包含设备/机械类专业，不可偏废。每个席位组建议 1-2 人（不超过 2，即使席位多也不堆给一个组）。相近专业（同一技术学科、评审可互替）必须合并为一个席位组：写入该组 specialties 数组（1-4 个，主专业放首位），不得拆成多行。',
        `请阅读以下项目信息，推断评审专家抽取需求。严格以 JSON 返回（不要 markdown 包裹，直接输出纯 JSON 对象）：
{"requiredSpecialties":[{"specialty":"主专业名","specialties":["主专业名","相近专业1","相近专业2"],"count":建议人数,"reason":"为何需要该席位组(30字内，须点明采购标的与该专业的对应关系)"}],"totalExperts":评审专家总数,"analysis":"推断依据说明(100字内)"}

要求：
1. 必须包含采购标的的核心技术学科专业（如钻机/岩心→地质，水泵/闸门→水利工程）；
2. 设备/机械类采购还需包含设备/机械相关专业；
3. 每席位组 count 建议 1-2 人（严禁超过 2）；
4. totalExperts 等于各席位组 count 之和；
5. specialties 数组内每个专业（含 specialty）必须使用【专家库现有专业】里的原词，不得自创；相近专业（学科相同/相近、评审可互替，如"水利工程"与"水利水电工程"）合并进同一组的 specialties，互不相近的专业不得混入同一组。
项目信息：
${context}${poolHint}`,
        0.3,
      );
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        const fb = fallback();
        return { ...fb, requiredSpecialties: attachCompanies(fb.requiredSpecialties) };
      }
      const parsed = JSON.parse(jsonMatch[0]);
      // 行内专业逐项对专家库白名单纠偏（原词→词缀包含），对不上的丢弃；整行无有效专业时弃行
      const matchPool = (sp: string): string => {
        const t = sp.trim();
        if (!t) return '';
        if (poolSpecs.includes(t)) return t;
        return poolSpecs.find(x => x.includes(t) || t.includes(x)) || '';
      };
      const specialties: { specialty: string; specialties: string[]; count: number; reason: string }[] = Array.isArray(parsed.requiredSpecialties) && parsed.requiredSpecialties.length
        ? parsed.requiredSpecialties
            .map((s: any) => {
              const primary = matchPool(String(s.specialty || ''));
              const list = [...new Set((Array.isArray(s.specialties) ? s.specialties : []).map((x: any) => matchPool(String(x || ''))).filter(Boolean))];
              const finalSpecs = [...new Set(primary ? [primary, ...list] : list)];
              return {
                specialty: finalSpecs[0] || '',
                specialties: finalSpecs,
                count: Math.max(1, Math.min(10, Number(s.count) || 1)),
                reason: String(s.reason || ''),
              };
            })
            .filter((s: { specialty: string }) => s.specialty)
        : fallback().requiredSpecialties;
      const totalExperts = Math.max(1, Math.min(20, Number(parsed.totalExperts) || specialties.reduce((a: number, s: any) => a + s.count, 0) || 3));
      return {
        requiredSpecialties: attachCompanies(specialties),
        totalExperts,
        analysis: String(parsed.analysis || '').slice(0, 500),
        engine: 'ai' as const,
      };
    } catch (err) {
      new Logger(ExpertAdminService.name).warn(`已有项目专业分析降级（LLM 不可用）: ${(err as Error)?.message ?? err}`);
      const fb = fallback();
      return { ...fb, requiredSpecialties: attachCompanies(fb.requiredSpecialties) };
    }
  }

  /** 自定义抽取：分析上传文件，AI 从项目背景推断所需专业/人数（文件未必含现成字段，靠 AI 理解推理） */
  async analyzeExtractionFiles(fileIds: string[], operatorId: string) {
    if (!fileIds?.length) throw new BadRequestException({ error: '请先上传文件', code: 'NO_FILES' });
    if (!operatorId) throw new BadRequestException({ error: '缺少操作人身份', code: 'NO_OPERATOR' });

    const texts: string[] = [];
    for (const id of fileIds.slice(0, 10)) {
      try {
        const t = await this.readAssetText(id, operatorId);
        // 每文件先截断，避免首个大文件占满上下文导致其余文件对 LLM 不可见
        if (t?.trim()) texts.push(t.trim().slice(0, 2500));
      } catch (err) {
        // 越权访问不静默吞掉，直接抛出；其余识别失败 per-file 跳过
        if (err instanceof ForbiddenException) throw err;
        new Logger(ExpertAdminService.name).warn(`文件 ${id} 读取/识别失败: ${(err as Error)?.message ?? err}`);
      }
    }
    const combined = texts.join('\n\n---\n\n').slice(0, 15000);
    if (!combined || combined.trim().length < 10) {
      throw new BadRequestException({ error: '未能从上传文件中识别到有效内容，请确认文件清晰（支持 PDF/Word/扫描件图片）', code: 'NO_TEXT' });
    }

    const fallback = () => ({
      suggestedName: '自定义抽取项目',
      projectBackground: combined.slice(0, 300),
      procurementType: '公开招标',
      requiredSpecialties: [{ specialty: '水利工程', specialties: ['水利工程'], count: 2, reason: '未能从文件明确推断，给出通用默认，请手动调整' }],
      totalExperts: 3,
      analysis: 'AI 暂不可用，已给出默认专业与人数，请手动调整后再抽取。',
      engine: 'rules' as const,
    });

    // 专业→持有公司（配额行 companyIds 附挂；try 外声明——LLM 前置失败时 catch 兜底也能用）
    let companiesBySpec = new Map<string, Set<string>>();
    try {
      const raw = await this.llm.chat(
        '你是招标采购评审专家抽取助手。用户会提供一份或多份项目相关文件（可能是招标公告、采购需求、项目背景等）。你需要【理解项目背景与采购内容】，推断该项目评审需要哪些专业的专家、各专业建议人数，以及评审专家总数。文件里未必直接写明专业和人数，你要根据项目性质、采购内容、技术要求自行推理。专业请用水发/水利采购常见表述（如水利工程、机电设备及安装、造价咨询、工程造价、信息技术、法律、财务等）。相近专业（同一技术学科、评审可互替）必须合并为一个席位组：写入该组 specialties 数组（1-4 个，主专业放首位），不得拆成多行。',
        `请阅读以下项目文件内容，推断评审专家抽取需求。严格以 JSON 返回（不要 markdown 包裹，直接输出纯 JSON 对象）：
{"suggestedName":"建议的项目名称(简短)","projectBackground":"项目背景与采购内容概述(100字内)","procurementType":"推断的采购方式(如公开招标/邀请招标/竞争性谈判等)","requiredSpecialties":[{"specialty":"主专业名","specialties":["主专业名","相近专业1","相近专业2"],"count":建议人数,"reason":"为何需要该席位组(30字内)"}],"totalExperts":评审专家总数,"analysis":"推断依据说明(100字内)"}

要求：互不相近的专业不得混入同一 specialties 组。
文件内容：
${combined}`,
        0.2,
      );
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      companiesBySpec = await this.companiesBySpecialty();
      if (!jsonMatch) {
        const fb = fallback();
        return { ...fb, requiredSpecialties: this.attachHolderCompanies(fb.requiredSpecialties, companiesBySpec) };
      }
      const parsed = JSON.parse(jsonMatch[0]);
      const specialties = Array.isArray(parsed.requiredSpecialties) && parsed.requiredSpecialties.length
        ? parsed.requiredSpecialties
            .map((s: any) => {
              const primary = String(s.specialty || '').trim();
              const list = [...new Set((Array.isArray(s.specialties) ? s.specialties : []).map((x: any) => String(x || '').trim()).filter(Boolean))];
              const finalSpecs = [...new Set(primary ? [primary, ...list.filter(x => x !== primary)] : list)];
              return {
                specialty: finalSpecs[0] || '水利工程',
                specialties: finalSpecs,
                count: Math.max(1, Math.min(10, Number(s.count) || 1)),
                reason: String(s.reason || ''),
              };
            })
            .filter((s: { specialty: string }) => s.specialty)
        : fallback().requiredSpecialties;
      const totalExperts = Math.max(1, Math.min(20, Number(parsed.totalExperts) || specialties.reduce((a: number, s: any) => a + s.count, 0) || 3));
      return {
        suggestedName: String(parsed.suggestedName || '自定义抽取项目').slice(0, 60),
        projectBackground: String(parsed.projectBackground || '').slice(0, 500),
        procurementType: String(parsed.procurementType || '公开招标').slice(0, 30),
        requiredSpecialties: this.attachHolderCompanies(specialties, companiesBySpec),
        totalExperts,
        analysis: String(parsed.analysis || '').slice(0, 500),
        engine: 'ai' as const,
      };
    } catch (err) {
      new Logger(ExpertAdminService.name).warn(`自定义抽取文件分析降级（LLM 不可用）: ${(err as Error)?.message ?? err}`);
      const fb = fallback();
      return { ...fb, requiredSpecialties: this.attachHolderCompanies(fb.requiredSpecialties, companiesBySpec) };
    }
  }

  /** 专业→持有公司并集映射（入参=expertProfile 含 user.companyId 的行；配额行 companyIds 附挂用）。
   *  行带 availability/entryStatus 字段时按可抽取资格过滤（与 listPoolCompanies 同口径）——
   *  只挂「不可用/非 ACTIVE 专家」的公司会让配额行 chip 查不到名称回落显 ID 且抽取 0 候选。 */
  private companiesBySpecOf(rows: { specialty: string | null; availability?: string | null; entryStatus?: string | null; user?: { companyId: string | null } | null }[]): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    for (const r of rows) {
      const cid = r.user?.companyId;
      if (!cid || !r.specialty?.trim()) continue;
      if (r.availability != null || r.entryStatus != null) {
        if (r.availability !== '可用' || r.entryStatus !== 'ACTIVE') continue;
      }
      const set = map.get(r.specialty) ?? new Set<string>();
      set.add(cid);
      map.set(r.specialty, set);
    }
    return map;
  }

  /** 全库查一次专业→持有公司映射（自定义抽取文件流用——项目流复用池查询行不另查） */
  private async companiesBySpecialty(): Promise<Map<string, Set<string>>> {
    const rows = await this.prisma.expertProfile.findMany({
      where: { user: { isActive: true } },
      select: { specialty: true, availability: true, entryStatus: true, user: { select: { companyId: true } } },
    });
    return this.companiesBySpecOf(rows);
  }

  /** 每席位组附挂持有该组专业的公司并集（跨公司抽取白名单直连——专家库换血后专业分散 8 公司，
   *  配额公司默认本公司会把跨公司专业饿成 0 候选；库内无此专业则空数组=沿用前端默认） */
  private attachHolderCompanies<T extends { specialty: string; specialties?: string[] }>(rows: T[], companiesBySpec: Map<string, Set<string>>): (T & { companyIds: string[] })[] {
    return rows.map(r => ({
      ...r,
      companyIds: [...new Set((r.specialties?.length ? r.specialties : [r.specialty]).flatMap(s => [...(companiesBySpec.get(s) ?? [])]))],
    }));
  }

  /** 操作人所在公司（归属写时快照用，口径同 CompanyScopeService.stampFor；User 表公司名字段为 company） */
  private async operatorCompanyOf(operatorId: string): Promise<{ companyId: string | null; companyName: string | null }> {
    const me = await this.prisma.user.findUnique({
      where: { id: operatorId },
      select: { companyId: true, company: true },
    });
    return { companyId: me?.companyId ?? null, companyName: me?.company ?? null };
  }

  /** 自定义抽取：创建影子项目（isExtractionOnly=true，仅承载抽取/通知/确认，不进项目管理列表） */
  async createCustomExtractionProject(dto: { name: string; procurementMethod?: string; background?: string; openTime?: string; deadline?: string }, operatorId?: string) {
    if (!dto.name?.trim()) throw new BadRequestException({ error: '请填写项目名称', code: 'NO_NAME' });
    const now = Date.now();
    const openTime = dto.openTime ? new Date(dto.openTime) : new Date(now + 14 * 24 * 3600 * 1000);
    const deadline = dto.deadline ? new Date(dto.deadline) : new Date(now + 7 * 24 * 3600 * 1000);
    if (deadline.getTime() >= openTime.getTime()) {
      throw new BadRequestException({ error: '投标截止时间须早于开标时间', code: 'INVALID_TIME_RANGE' });
    }
    // 48 位随机十六进制 + 时间戳，practically 杜绝 projectCode 唯一约束冲突
    const projectCode = `CUS-${now.toString(36)}-${randomBytes(6).toString('hex')}`;
    const project = await this.prisma.bidProject.create({
      data: {
        projectCode,
        name: dto.name.trim(),
        procurementMethod: dto.procurementMethod?.trim() || '公开招标',
        openTime,
        deadline,
        scope: dto.background?.trim() || null,
        isExtractionOnly: true,
        // 公司归属快照自操作人（BidCompanyScopeGuard：非_admin 内部角色仅本公司项目可见）
        ...(operatorId ? await this.operatorCompanyOf(operatorId) : {}),
      },
      select: { id: true, projectCode: true, name: true, openTime: true },
    });
    // 审计留痕：自定义抽取创建影子项目（与抽取链路其它操作一致，可溯源）
    if (operatorId) {
      await this.prisma.auditLog.create({
        data: {
          userId: operatorId,
          action: 'CUSTOM_EXTRACTION_PROJECT_CREATED',
          resourceType: 'BidProject',
          resourceId: project.id,
          details: { projectName: project.name, projectCode: project.projectCode, isExtractionOnly: true },
        },
      }).catch((err: any) => new Logger(ExpertAdminService.name).warn(`影子项目审计写入失败: ${err?.message ?? err}`));
    }
    return { projectId: project.id, projectCode: project.projectCode, name: project.name, openTime: project.openTime.toISOString() };
  }

  /** 评标风险预警：融合评分偏离度 + 履职评价 + 违规记录，生成专家级风险简报（规则简报为底，LLM 增强）。公司隔离。 */
  async getRiskBrief(userId: string, actor?: AuthenticatedUser) {
    if (actor) await this.assertExpertInScope(userId, actor);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { expertProfile: true } });
    if (!user || user.role !== 'bid_expert') throw new NotFoundException('专家不存在');

    const [scoreRecords, evals, violations] = await Promise.all([
      this.prisma.bidScoreRecord.findMany({ where: { expert: { userId } }, select: { score: true, scoreItemId: true, supplierId: true } }),
      this.prisma.expertEvaluation.findMany({ where: { expertUserId: userId }, orderBy: { createdAt: 'desc' }, take: 10, select: { overallGrade: true } }),
      this.prisma.auditLog.findMany({ where: { action: 'EXPERT_VIOLATION_RECORDED', resourceId: userId }, select: { id: true } }),
    ]);

    const deviations = computeExpertMeanDeviations(
      scoreRecords.map(r => ({ expertId: userId, scoreItemId: r.scoreItemId, supplierId: r.supplierId, score: Number(r.score) })),
    );
    const meanDeviation = deviations.length > 0 ? Math.round(deviations[0].meanDeviation * 10) / 10 : null;
    const recentECount = evals.filter(e => e.overallGrade === 'E').length;
    const gradeDistribution = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    for (const e of evals) gradeDistribution[e.overallGrade] = (gradeDistribution[e.overallGrade] ?? 0) + 1;
    const signals = {
      meanDeviation,
      deviationRisk: meanDeviation != null && Math.abs(meanDeviation) > 10 ? 'high' : meanDeviation != null && Math.abs(meanDeviation) > 6 ? 'medium' : 'low',
      recentECount,
      violationCount: violations.length,
      gradeDistribution,
    };
    const ruleBrief = this.buildRuleRiskBrief(signals, user.displayName);

    let aiBrief: string | null = null;
    try {
      aiBrief = await this.llm.chat(
        '你是评标监督风险分析助手。根据专家履职数据给出简明中文风险简报（150字内），点明风险与处置建议，客观中立，不加格式符号。',
        `专家：${user.displayName}。评分偏离度 ${signals.meanDeviation ?? '无数据'}（风险等级 ${signals.deviationRisk}）；近 ${evals.length} 次履职评价中 E 级 ${recentECount} 次、D 级 ${gradeDistribution.D} 次；违规记录 ${signals.violationCount} 条。`,
        0.3,
      );
    } catch (err) {
      // 记录日志，避免 AI 失效时永久静默走规则而无人知晓
      new Logger(ExpertAdminService.name).warn(`风险简报 AI 增强降级（LLM 不可用），返回规则简报: ${(err as Error)?.message ?? err}`);
      aiBrief = null;
    }
    return { expertId: userId, displayName: user.displayName, signals, ruleBrief, aiBrief };
  }

  private buildRuleRiskBrief(s: { meanDeviation: number | null; deviationRisk: string; recentECount: number; violationCount: number; gradeDistribution?: Record<string, number> }, name: string): string {
    const parts: string[] = [];
    if (s.deviationRisk === 'high') parts.push(`评分偏离较大（${s.meanDeviation}），与评审共识存在偏差，建议重点关注或调整`);
    else if (s.deviationRisk === 'medium') parts.push(`评分偏离略大（${s.meanDeviation}），建议关注`);
    else parts.push(`评分偏离正常（${s.meanDeviation ?? '暂无数据'}）`);
    if (s.recentECount > 0) parts.push(`近期出现 ${s.recentECount} 次 E 级（不合格）履职评价，建议按退库规则研判`);
    if (s.violationCount > 0) parts.push(`累计 ${s.violationCount} 条违规记录`);
    return `${name}：${parts.join('；')}。`;
  }

  /** 抽取质量复盘：回顾某项目"最终专家组构成 vs 履职/进度表现"，LLM 生成复盘总结（失败给规则汇总）。 */
  async retrospectExtraction(projectId: string) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
    if (!project) throw new NotFoundException('项目不存在');
    const experts = await this.prisma.bidExpert.findMany({
      where: { projectId },
      select: {
        expertName: true, expertRole: true, isLead: true, major: true, progress: true, invitationStatus: true,
        user: { select: { expertEvaluations: { orderBy: { createdAt: 'desc' }, take: 1, select: { overallGrade: true } } } },
      },
    });
    const summary = {
      projectName: project.name,
      total: experts.length,
      regular: experts.filter(e => e.expertRole === '正选').length,
      alternative: experts.filter(e => e.expertRole === '候补').length,
      declined: experts.filter(e => e.invitationStatus === 'declined').length,
      avgProgress: experts.length > 0 ? Math.round(experts.reduce((s, e) => s + (e.progress ?? 0), 0) / experts.length) : 0,
    };
    const rows = experts.map(e => ({
      name: e.expertName, role: e.expertRole, isLead: e.isLead, major: e.major,
      progress: e.progress ?? 0, status: e.invitationStatus, latestEvalLevel: e.user?.expertEvaluations[0]?.overallGrade ?? null,
    }));

    let aiSummary: string | null = null;
    try {
      aiSummary = await this.llm.chat(
        '你是专家抽取复盘分析助手。根据某项目专家组构成与履职数据，给出简明中文复盘（150字内）：评价本次抽取的合理性，并提出改进建议，不加格式符号。',
        `项目「${project.name}」：专家 ${summary.total} 名（正选 ${summary.regular}、候补 ${summary.alternative}），拒绝 ${summary.declined} 名，平均进度 ${summary.avgProgress}%。成员：${rows.map(r => `${r.name}(${r.role}/${r.major},进度${r.progress}%,近期等级${r.latestEvalLevel ?? '无'})`).join('、')}`,
        0.3,
      );
    } catch (err) {
      new Logger(ExpertAdminService.name).warn(`抽取复盘 AI 总结降级（LLM 不可用），返回规则汇总: ${(err as Error)?.message ?? err}`);
      aiSummary = null;
    }
    return { summary, experts: rows, aiSummary };
  }

  /* ── 通知偏好（UserSettings.notificationPrefs）── */

  async getNotifyPrefs(userId: string, actor?: AuthenticatedUser) {
    if (actor) await this.assertExpertInScope(userId, actor);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user || user.role !== 'bid_expert') throw new NotFoundException('专家不存在');
    const settings = await this.prisma.userSettings.findUnique({ where: { userId } });
    const prefs = (settings?.notificationPrefs as Record<string, boolean> | null) ?? {};
    return { inApp: prefs.inApp ?? true, sms: prefs.sms ?? false, phone: prefs.phone ?? false };
  }

  async updateNotifyPrefs(userId: string, dto: { inApp?: boolean; sms?: boolean; phone?: boolean }, actor?: AuthenticatedUser) {
    if (actor) await this.assertExpertInScope(userId, actor);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user || user.role !== 'bid_expert') throw new NotFoundException('专家不存在');
    const existing = await this.prisma.userSettings.findUnique({ where: { userId } });
    const current = (existing?.notificationPrefs as Record<string, boolean> | null) ?? {};
    const merged = { ...current, ...dto };
    await this.prisma.userSettings.upsert({
      where: { userId },
      update: { notificationPrefs: merged },
      create: { userId, notificationPrefs: merged },
    });
    return { success: true };
  }

  /** 专家通知发送历史（最近 50 条），供详情页查看（公司隔离） */
  async getNotifyHistory(userId: string, actor?: AuthenticatedUser) {
    if (actor) await this.assertExpertInScope(userId, actor);
    const logs = await this.prisma.notificationDeliveryLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { channel: true, status: true, error: true, createdAt: true },
    });
    return logs.map(l => ({
      channel: l.channel,
      status: l.status,
      error: l.error,
      time: l.createdAt.toISOString(),
    }));
  }

  /* 操作历史（审计，只读） */

  /** 专家管理操作历史：仅白名单动作，附操作人/时间/事由，供审计追溯（无改删端点，不可篡改）。 */
  async getExpertOperationHistory(params: { expertId?: string; action?: string; startDate?: string; endDate?: string; page?: number; pageSize?: number }) {
    const page = params.page && params.page > 0 ? params.page : 1;
    const pageSize = Math.min(params.pageSize && params.pageSize > 0 ? params.pageSize : 20, 100);

    const where: Prisma.AuditLogWhereInput = {
      action: { in: [...EXPERT_AUDIT_ACTIONS] },
    };
    if (params.expertId) where.resourceId = params.expertId;
    if (params.action) where.action = params.action;
    // 日期检索（以天为单位）：startDate ≤ createdAt < endDate 次日，均按 YYYY-MM-DD
    if (params.startDate || params.endDate) {
      const range: { gte?: Date; lt?: Date } = {};
      if (params.startDate) range.gte = new Date(`${params.startDate}T00:00:00.000Z`);
      if (params.endDate) {
        const end = new Date(`${params.endDate}T00:00:00.000Z`);
        end.setUTCDate(end.getUTCDate() + 1); // 含当天 → 次日零点之前
        range.lt = end;
      }
      where.createdAt = range;
    }

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, action: true, resourceId: true, details: true, createdAt: true,
          user: { select: { id: true, displayName: true, username: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { total, page, pageSize, items };
  }

  /* ── PII 明文揭示（等保+密评：管理端默认掩码，明文走此处并留痕）── */

  private static readonly REVEALABLE_EXPERT_FIELDS = ['idNumber', 'phone', 'licenseNo', 'email'] as const;

  /**
   * 揭示专家 PII 明文（admin/leader/staff，controller 方法级 @Roles 收窄）。
   * 公司隔离同详情端点；每次揭示写 SensitiveAccessLog（append-only 审计）。
   */
  async revealExpertField(
    userId: string,
    field: string,
    actor: AuthenticatedUser | undefined,
    ip?: string,
  ): Promise<{ field: string; value: string | null }> {
    if (!(ExpertAdminService.REVEALABLE_EXPERT_FIELDS as readonly string[]).includes(field)) {
      throw new BadRequestException({ error: '该字段不允许揭示', code: 'FIELD_NOT_REVEALABLE' });
    }
    await this.assertExpertInScope(userId, actor);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, role: true, companyId: true, phone: true, email: true,
        expertProfile: { select: { phone: true, idNumber: true, licenseNo: true } },
      },
    });
    if (!user || user.role !== 'bid_expert') throw new NotFoundException('专家不存在');
    // 密文列拆封：phone 走 档案优先→账号回退；email 取 User 列
    const raw = field === 'phone'
      ? (user.expertProfile?.phone ?? user.phone)
      : field === 'email'
        ? user.email
        : (user.expertProfile?.[field as 'idNumber' | 'licenseNo'] ?? null);
    const value = openPii(raw);
    await logSensitiveAccess(this.prisma, actor, 'ExpertProfile', userId, field, ip);
    return { field, value };
  }
}
