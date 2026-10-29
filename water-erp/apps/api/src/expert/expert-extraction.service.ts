/** 专家抽取引擎（F2）——自 expert-admin.service.ts 迁出（P1 审查 F 簇拆分，纯移动）。索引：previewExtraction / confirmExtraction（+12 算法族；extendedRuleScore 供 autoPromoteCandidate 跨实例调用转 public） */

import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { ExpertLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { openPiiForMask } from '../common/crypto/sm-field-crypto';
import { EmbeddingService } from '../local-ai/embedding.service';
import { computeExpertMeanDeviations } from '../common/scoring/expert-deviation';
import { ExpertExtractionAiService } from './expert-extraction-ai.service';
import { ExpertCrossConflictService } from './expert-cross-conflict.service';
import { CompanyScopeService } from '../company/company-scope';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { LlmSpecialtyQuota, ExtractMode } from './expert-extraction-ai.service';
import type { ExtractPreviewDto } from './dto/extract-preview.dto';
import type { ConfirmExtractionDto } from './dto/confirm-extraction.dto';

@Injectable()
export class ExpertExtractionService {
  constructor(
    private prisma: PrismaService,
    private extractionAi: ExpertExtractionAiService,
    private embedding: EmbeddingService,
    private crossConflict: ExpertCrossConflictService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  /* ── 专家智能抽取 ── */

  /**
   * 预览抽取：AI 分析 + 合规过滤 + 模式驱动抽取（不落库）。
   * 三种模式：specialty_match（专业匹配）/ random（随机抽取）/ merit_best（综合择优）
   */
  async previewExtraction(projectId: string, dto: ExtractPreviewDto, operator?: AuthenticatedUser) {
    // 公司口径（2026-10-29 用户裁定）：配额「不限公司」=全库；2026-09-24「默认收窄到操作人视野」
    // 的旧口径已废——同日 scope 仍解析，供配额声明公司时的池扩围与 confirm 白名单闸使用。
    // 抽取配置「公司」下拉显式选了公司时按所选公司取池（默认本公司，用户拍板可跨公司选其他公司专家）
    const scope = await this.companyScope.resolveScope(operator);
    // 多选配额归一化（2026-10-13）：specialties/companyIds 数组优先，旧单值 specialty/companyId
    // 包成单元素数组；specialties 空=「不选择」（不限专业桶），companyIds 空=按池 scope 不限定。
    // 归一化后 specialty/companyId 仅作首位镜像（展示/employer 行兼容），流程一律读数组。
    const normList = (arr: string[] | undefined, single: string | undefined): string[] => {
      const l = (arr ?? []).map(s => (s || '').trim()).filter(Boolean);
      if (l.length) return [...new Set(l)];
      const s = (single ?? '').trim();
      return s ? [s] : [];
    };
    const quotaRows: LlmSpecialtyQuota[] = (dto.manualQuotas ?? []).map(q => {
      const specs = normList(q.specialties, q.specialty);
      const cids = normList(q.companyIds, q.companyId);
      return { ...q, specialty: specs[0] ?? '', specialties: specs, companyId: cids[0] ?? '', companyIds: cids, reason: q.reason ?? '' };
    });
    const quotaCompanyIds = [...new Set(quotaRows.flatMap(q => q.companyIds))];
    // 公司口径（2026-10-29 用户裁定，推翻 2026-09-24「空=登录人公司收窄」）：配额「不限公司」
    // （companyIds 空）= 全库所有专家；显式选了公司才按所选公司白名单取池。专家库列表/档案
    // 端点的公司隔离不受影响（同 2026-09-24 需求方代表目录先例——工作集跨公司、全量档案隔离）。
    const companyFilter = quotaCompanyIds.length
      ? { companyId: { in: quotaCompanyIds } }
      : {};
    const totalNeeded = Math.min(Math.max(dto.totalNeeded ?? 5, 1), 9);
    const alternatives = Math.min(Math.max(dto.alternatives ?? 2, 0), 9);
    const extractMode: 'specialty_match' | 'random' | 'merit_best' =
      dto.extractMode ?? 'random'; // 默认随机抽取（条例第46条基线）；加权模式仅显式指定时使用

    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      include: { suppliers: { include: { supplier: { select: { name: true } } } } },
    });
    if (!project) throw new NotFoundException('项目不存在');

    // 供应商名集合（回避校验）——回避口径=实际参与投标的供应商全集（已投递或开标后到终局态）。
    // 旧口径 confirmStatus==='CONFIRMED' 在开标前抽取时恒为空集，抽取期单位回避形同虚设。
    const supplierNames = new Set(
      project.suppliers
        .filter(s => s.submitStatus === '已提交' || s.confirmStatus === 'CONFIRMED' || s.confirmStatus === 'EXCEPTION')
        .map(s => s.supplier?.name || s.supplierName)
        .filter(Boolean) as string[],
    );

    // A-129：配额区域/等级可选过滤——未填不过滤；候选池为全配额共享，多配额不同值取并集
    // （交集会把只满足某一配额的专家整体饿死），并集语义在返回 quotaFiltersApplied 中说明
    // quotaRows 已在入口归一化（多选数组），此处仅消费
    const regionCodes = [...new Set(quotaRows.map(q => q.regionCode?.trim()).filter((v): v is string => !!v))];
    const expertLevels = [...new Set(
      quotaRows.flatMap(q => (q.expertLevel ?? '').split(',').map(s => s.trim()).filter(v => /^[A-E]$/.test(v))),
    )];
    const levelUnionWidened = new Set(quotaRows.map(q => q.expertLevel?.trim()).filter((v): v is string => !!v)).size > 1;

    // 合规候选：bid_expert + 可用 + 未分配本项目 + 工作单位不在参与供应商中
    // 重新抽取时不排除本项目已分配的专家（确认时会先清空旧记录），只排除其他项目的占用
    // 闸1（2026-09-20 spec）：排除「评标窗口未闭合」的专家（签到起→报告确认止）——
    // 同时段双活跃从源头杜绝；同日不同时段合法（开窗以签到/报告确认为界，不以日历日）。
    const baseWhere: import('@prisma/client').Prisma.UserWhereInput = {
      role: 'bid_expert',
      isActive: true,
      expertProfile: {
        availability: '可用',
        entryStatus: 'ACTIVE',
        ...(dto.employer?.trim() ? { employer: dto.employer.trim() } : {}),
        ...(regionCodes.length === 1
          ? { regionCode: regionCodes[0] }
          : regionCodes.length > 1 ? { regionCode: { in: regionCodes } } : {}),
        ...(expertLevels.length ? { expertLevel: { in: expertLevels } } : {}),
      },
      bidExperts: {
        none: {
          signedIn: true,
          reportConfirmed: false,
          project: { stage: { in: ['OPENING', 'EVALUATING'] } },
        },
      },
    };
    const experts = await this.prisma.user.findMany({
      where: {
        ...baseWhere,
        ...companyFilter,
      },
      include: {
        expertProfile: true,
        department: { select: { name: true } },
        // 同日预告（信息级）：其他在途项目的开标时间，供候选标注 sameDayConflict——
        // 合规允许同日双标（不同时段），只提示主持人注意时段安排，不排除
        bidExperts: {
          where: { project: { stage: { in: ['OPENING', 'EVALUATING', 'SUBMIT', 'DOWNLOAD'] } } },
          select: { project: { select: { openTime: true, projectCode: true } } },
        },
        _count: { select: { bidExperts: true } },
      },
    });
    // 池扩围候选预取（2026-10-20 等额保底）：配额声明了公司时，候选集在查询层已被
    // companyId in 截断，draw 层放不开——按登录视野再取一份不限配额公司的候选合并去重，
    // 供 draw 层同公司相关专业不足时放开公司、仍限本行专业补位（实录：3 席只出 1 人）。
    // 非 admin 视野=本公司，合并后不越出「视野 ∪ 配额声明公司」白名单。
    let expertUniverse = experts;
    if (quotaCompanyIds.length) {
      const scopeRows = await this.prisma.user.findMany({
        where: { ...baseWhere, ...this.companyScope.filter(scope) },
        include: { expertProfile: true, department: { select: { name: true } }, bidExperts: { where: { project: { stage: { in: ['OPENING', 'EVALUATING', 'SUBMIT', 'DOWNLOAD'] } } }, select: { project: { select: { openTime: true, projectCode: true } } } }, _count: { select: { bidExperts: true } } },
      });
      const seen = new Set(experts.map((e) => e.id));
      expertUniverse = [...experts, ...scopeRows.filter((e) => !seen.has(e.id))];
    }
    const excludedIds = new Set(dto.excludedUserIds ?? []);
    const eligible = expertUniverse.filter((u) => {
      if (excludedIds.has(u.id)) return false;
      const emp = u.expertProfile?.employer?.trim();
      if (emp) {
        for (const sn of supplierNames) {
          if (sn && (emp.includes(sn) || sn.includes(emp))) return false;
        }
      }
      return true;
    });

    const eligibleIds = eligible.map(e => e.id);
    if (eligible.length === 0) {
      // 结构化错误：前端按 code 给针对性提示，而非笼统"自动抽取失败"
      throw new BadRequestException({ error: '专家库暂无可用候选人，请先在专家管理维护可用专家', code: 'NO_ELIGIBLE_EXPERTS' });
    }
    const twelveMonthsAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000);

    // 批量拉取多维度数据
    const [allEvals, allActiveAssigns, allRecentAssigns, scoreRecords] = await Promise.all([
      // 每位专家的最新履职评价（用于等级/出勤/质量/廉洁）
      this.prisma.expertEvaluation.findMany({
        where: { expertUserId: { in: eligibleIds } },
        orderBy: { createdAt: 'desc' },
        select: { expertUserId: true, attendanceGrade: true, qualityGrade: true, disciplineGrade: true, overallGrade: true, createdAt: true },
      }),
      // 当前活跃负荷（progress < 100 的项目）
      this.prisma.bidExpert.findMany({
        where: { userId: { in: eligibleIds }, progress: { lt: 100 } },
        select: { userId: true },
      }),
      // 近12月项目数
      this.prisma.bidExpert.findMany({
        where: { userId: { in: eligibleIds }, createdAt: { gte: twelveMonthsAgo } },
        select: { userId: true },
      }),
      // 评分偏离度（通过 BidScoreRecord → expert.userId 关联）
      this.prisma.bidScoreRecord.findMany({
        where: { expert: { userId: { in: eligibleIds } } },
        select: { score: true, scoreItemId: true, supplierId: true, expert: { select: { userId: true } } },
      }),
    ]);

    // 最新评价 Map（按时间降序，取第一条）
    const latestEvalMap = new Map<string, { level: string; attendanceGrade: ExpertLevel; qualityGrade: ExpertLevel; disciplineGrade: ExpertLevel; overallGrade: ExpertLevel }>();
    for (const ev of allEvals) {
      if (!latestEvalMap.has(ev.expertUserId)) {
        latestEvalMap.set(ev.expertUserId, { level: ev.overallGrade, attendanceGrade: ev.attendanceGrade, qualityGrade: ev.qualityGrade, disciplineGrade: ev.disciplineGrade, overallGrade: ev.overallGrade });
      }
    }

    // 偏离度 Map（通过 computeExpertMeanDeviations，使用 User.id）
    const deviations = computeExpertMeanDeviations(
      scoreRecords.map(r => ({
        expertId: r.expert.userId,
        scoreItemId: r.scoreItemId,
        supplierId: r.supplierId,
        score: Number(r.score),
      })),
    );
    const deviationMap = new Map(deviations.map(d => [d.expertId, Math.round(d.meanDeviation * 10) / 10]));

    // 负荷 Map
    const loadMap = new Map<string, number>();
    for (const a of allActiveAssigns) loadMap.set(a.userId, (loadMap.get(a.userId) ?? 0) + 1);
    const recentMap = new Map<string, number>();
    for (const a of allRecentAssigns) recentMap.set(a.userId, (recentMap.get(a.userId) ?? 0) + 1);

    // 构建富化候选人
    const candidates = eligible.map(u => {
      const latest = latestEvalMap.get(u.id);
      const load = loadMap.get(u.id) ?? 0;
      // 同日预告（2026-09-20 spec 闸1）：候选已有其他在途项目与本项目同日开标——
      // 不排除（同日不同时段合法），标注供主持人在抽取结果中权衡时段安排
      const sameDayConflict = u.bidExperts.some(b => {
        const a = b.project?.openTime && new Date(b.project.openTime);
        return a && project.openTime
          && a.getFullYear() === project.openTime.getFullYear()
          && a.getMonth() === project.openTime.getMonth()
          && a.getDate() === project.openTime.getDate();
      });
      return {
        id: u.id,
        displayName: u.displayName,
        specialty: u.expertProfile?.specialty || '综合',
        title: u.expertProfile?.title ?? undefined,
        employer: u.expertProfile?.employer ?? undefined,
        companyId: u.companyId ?? undefined,
        regionCode: u.expertProfile?.regionCode ?? undefined,
        expertLevel: u.expertProfile?.expertLevel ?? undefined,
        department: u.department?.name ?? undefined,
        phone: openPiiForMask(u.expertProfile?.phone) ?? undefined, // 抽取候选池明文出口（2026-10-12 用户裁定）：主持人抽取/联系专家为操作场景，非浏览展示
        pastProjects: u._count.bidExperts,
        evaluationLevel: latest?.level,
        attendanceGrade: latest?.attendanceGrade,
        qualityGrade: latest?.qualityGrade,
        disciplineGrade: latest?.disciplineGrade,
        scoreDeviation: deviationMap.get(u.id),
        recentProjects12m: recentMap.get(u.id) ?? 0,
        sameDayConflict,
        currentLoad: load,
        currentLoadStatus: load === 0 ? '空闲' : load <= 2 ? '正常' : '繁忙',
      };
    });

    // 上下文增强：注入项目真实招标范围/资质要求/质量目标（而非仅 riskNote||name），提升专业匹配准确度
    const scopeParts = [project.scope, project.qualification, project.qualityRequirement, project.riskNote].filter(Boolean) as string[];
    const scopeText = scopeParts.length > 0 ? scopeParts.join('；') : project.name;

    let analysis: string;
    let requiredSpecialties: LlmSpecialtyQuota[];
    const scoreMap = new Map<string, { matchScore: number; fitSpecialty: string; reason: string }>();
    // LLM 逐人契合理由（2026-10-27 选用理由改版）：matchScore 恒 0，评分仍由规则引擎做，此处只收 reason
    const llmReasons = new Map<string, string>();
    let engine: 'deepseek' | 'rules' = 'deepseek';

    try {
      const llm = await this.extractionAi.analyzeAndScore(
        { name: project.name, procurementMethod: project.procurementMethod, scope: scopeText, budget: project.budget ? Number(project.budget) : undefined },
        candidates,
        totalNeeded,
        extractMode,
        quotaRows.length ? quotaRows.filter(q => !q.employer).map(q => `${q.specialties.join('、') || '不限专业'}×${q.count}`).join('、') : undefined,
      );
      analysis = llm.analysis;
      requiredSpecialties = quotaRows.length
        ? quotaRows.map(q => ({ ...q, reason: q.reason ?? '' }))
        : llm.requiredSpecialties;
      for (const s of llm.scoredExperts) llmReasons.set(s.id, s.reason);
    } catch (err) {
      // 规则降级：AI 不可用时如实告知原因，用规则引擎兜底
      engine = 'rules';
      this.extractionAi.recordFallback();
      const errMsg = (err as Error)?.message ?? String(err);
      new Logger(ExpertExtractionService.name).warn(`抽取 AI 降级规则引擎: ${errMsg}`);
      requiredSpecialties = quotaRows.length
        ? quotaRows.map(q => ({ ...q, reason: q.reason ?? '' }))
        : this.ruleComposition(candidates, totalNeeded);
      const isTimeout = errMsg.includes('超时') || errMsg.includes('timed out');
      const is503 = errMsg.includes('503') || errMsg.includes('Service Unavailable');
      analysis = `⚠ AI 服务暂不可用（${isTimeout ? '响应超时' : is503 ? '服务繁忙' : '连接异常'}），已使用规则引擎按履职等级、职称与负荷综合评分${extractMode === 'merit_best' ? '择优' : '随机'}组建。请稍后重试以获取 AI 分析。`;
      for (const c of candidates) {
        scoreMap.set(c.id, {
          matchScore: this.extendedRuleScore(c),
          fitSpecialty: c.specialty,
          reason: this.fitReason(extractMode),
        });
      }
    }

    for (const c of candidates) {
      if (!scoreMap.has(c.id)) {
        scoreMap.set(c.id, {
          matchScore: extractMode === 'merit_best' ? this.extendedRuleScore(c) : 50,
          fitSpecialty: c.specialty,
          reason: llmReasons.get(c.id) || this.fitReason(extractMode),
        });
      }
    }

    // 拆分部门限定配额（需求方代表「选择部门」，按 employer 过滤）与常规专业配额
    const employerQuotas = requiredSpecialties.filter(q => q.employer && q.employer.trim());
    // 空专业=「不选择」（2026-09-24）：不限专业桶，draw 阶段从全池抽，不再丢弃
    const normalReq = requiredSpecialties.filter(q => !(q.employer && q.employer.trim()));

    // 白名单纠偏：把 AI 推荐的专业构成映射到专家库中真实有候选的专业，避免推荐无候选专业
    const reconciled = this.reconcileSpecialties(normalReq, candidates);
    // 语义召回：项目需求 vs 专家专长向量相似度，对候选匹配分做微调（失败不阻断，优雅降级）
    await this.applySemanticBoost(scoreMap, candidates, scopeText, extractMode);

    // 归一化配额：手动配额按原 count 保留（sum 即目标），无手动配额时回退到 totalNeeded
    const normalSum = reconciled.reduce((s, q) => s + q.count, 0);
    const quotas = normalSum > 0 ? this.normalizeQuotas(reconciled, normalSum) : [];

    // 综合择优：D/E 级（待改进/不合格）不参与抽取，避免低质专家被选中
    const drawPool = extractMode === 'merit_best'
      ? candidates.filter(c => c.evaluationLevel !== 'D' && c.evaluationLevel !== 'E')
      : candidates;

    // 按专业分组：候选分给首个命中的配额组（精确→词缀包含；行内多专业=相近专业并桶，
    // 命中任一即入组）；未命中任何配额的候选不进专业组（仅「不限专业」行可抽到）
    const matchQuotaIdx = (fit: string, qs: LlmSpecialtyQuota[]): number => {
      const f = (fit || '').trim();
      if (!f) return -1;
      const exact = qs.findIndex(q => q.specialties.includes(f));
      if (exact >= 0) return exact;
      return qs.findIndex(q => q.specialties.some(sp => sp && (f.includes(sp) || sp.includes(f))));
    };
    const groups = new Map<number, typeof candidates>();
    for (const c of drawPool) {
      const fit = scoreMap.get(c.id)?.fitSpecialty || c.specialty;
      const gi = matchQuotaIdx(fit, quotas);
      if (gi >= 0) {
        if (!groups.has(gi)) groups.set(gi, []);
        groups.get(gi)!.push(c);
      }
    }

    // 模式驱动抽取
    const selected: any[] = [];
    const shortages: { specialty: string; needed: number; available: number }[] = [];
    const usedIds = new Set<string>();

    quotas.forEach((q, qi) => {
      const anySpecialty = q.specialties.length === 0; // 「不选择」=不限专业
      const qcIds = q.companyIds; // 抽取配置「公司」（可多选）：该配额仅从所选公司并集的库内抽
      const inCompany = (c: any) => qcIds.length === 0 || qcIds.includes(c.companyId ?? '');
      const quotaLabel = anySpecialty ? '不限专业' : q.specialties.join('、');
      const inBucket = (c: any) => {
        const fit = scoreMap.get(c.id)?.fitSpecialty || c.specialty;
        return matchQuotaIdx(fit, quotas) === qi;
      };
      // 分层补位（2026-10-20 用户裁定，优先级不得被随机打穿——逐层抽满等额）：
      // ①同公司·本行专业（A/B/C 池）②同公司·本行专业（全池含 D/E，凑人优先于等级门槛）
      // ③同公司·其他专业 ④其他公司·本行专业 ⑤迫不得已·其他公司·其他专业。
      // 需求方代表 employer 行不适用（公司/部门是其限定语义，另行抽取）。
      const taken = new Set<string>();
      const levels: (() => any[])[] = anySpecialty ? [
        () => drawPool.filter(c => !usedIds.has(c.id) && !taken.has(c.id) && inCompany(c)),
        () => candidates.filter(c => !usedIds.has(c.id) && !taken.has(c.id) && inCompany(c)),
        () => candidates.filter(c => !usedIds.has(c.id) && !taken.has(c.id)),
      ] : [
        () => (groups.get(qi) || []).filter(c => !usedIds.has(c.id) && !taken.has(c.id) && inCompany(c)),
        () => candidates.filter(c => !usedIds.has(c.id) && !taken.has(c.id) && inCompany(c) && inBucket(c)),
        () => candidates.filter(c => !usedIds.has(c.id) && !taken.has(c.id) && inCompany(c) && !inBucket(c)),
        () => candidates.filter(c => !usedIds.has(c.id) && !taken.has(c.id) && inBucket(c)),
        () => candidates.filter(c => !usedIds.has(c.id) && !taken.has(c.id)),
      ];
      let poolTotal = 0;
      let drawnCount = 0;
      for (const level of levels) {
        if (drawnCount >= q.count) break;
        const lv = level();
        poolTotal += lv.length;
        const drawn = this.drawByMode(lv, Math.min(q.count - drawnCount, lv.length), extractMode, scoreMap);
        for (const c of drawn) {
          usedIds.add(c.id); taken.add(c.id);
          selected.push(this.toSelection(c, anySpecialty ? (c.specialty || '不限专业') : quotaLabel, '正选', scoreMap));
        }
        drawnCount += drawn.length;
      }
      if (poolTotal === 0) shortages.push({ specialty: quotaLabel, needed: q.count, available: 0 });
      else if (drawnCount < q.count) shortages.push({ specialty: quotaLabel, needed: q.count, available: drawnCount });
    });

    // 部门限定配额抽取（需求方代表）：按工作单位匹配部门，专业可选作附加过滤
    // 记录每笔部门配额抽取出的专家实际专业，供 requiredSpecialties 显示「专业·需求方代表」
    const employerDrawnSpecs = new Map<string, string[]>();
    for (const q of employerQuotas) {
      const emp = q.employer!.trim();
      const specFilters = q.specialties; // 专业附加过滤（可多选）：命中任一即通过
      const specLabel = specFilters.join('、');
      const deptFilter = (q.department || '').trim(); // 真部门（Department.name）过滤，公司内进一步收窄
      const pool = drawPool.filter(c => {
        if (usedIds.has(c.id)) return false;
        const ce = (c.employer || '').trim();
        if (!ce || !(ce === emp || ce.includes(emp) || emp.includes(ce))) return false;
        if (deptFilter && (c.department || '').trim() !== deptFilter) return false;
        if (specFilters.length) {
          const cs = (c.specialty || '').trim();
          if (!specFilters.some(sf => cs === sf || cs.includes(sf) || sf.includes(cs))) return false;
        }
        return true;
      });
      const label = specLabel ? `${emp}·${specLabel}` : emp;
      if (pool.length === 0) shortages.push({ specialty: label, needed: q.count, available: 0 });
      else if (pool.length < q.count) shortages.push({ specialty: label, needed: q.count, available: pool.length });
      const drawn = this.drawByMode(pool, Math.min(q.count, pool.length), extractMode, scoreMap);
      const drawnSpecs = drawn.map(c => c.specialty);
      employerDrawnSpecs.set(emp, drawnSpecs);
      // 部门限定配额 = 需求方代表（采购人代表），选中结果打标供确认时持久化
      for (const c of drawn) {
        usedIds.add(c.id);
        const sel = this.toSelection(c, specLabel || c.specialty, '正选', scoreMap);
        (sel as any).isPurchaserRepresentative = true;
        selected.push(sel);
      }
    }

    // 候补：每个专业配额各抽 1 位候补（放宽到全部候选含 D/E，作后备用）
    const alternativeList: ReturnType<typeof this.toSelection>[] = [];
    quotas.forEach((q, qi) => {
      const quotaLabel = q.specialties.length === 0 ? '不限专业' : q.specialties.join('、');
      const group = candidates.filter(c => {
        if (usedIds.has(c.id)) return false;
        const fit = scoreMap.get(c.id)?.fitSpecialty || c.specialty;
        return matchQuotaIdx(fit, quotas) === qi;
      });
      if (group.length === 0) return;
      const alt = extractMode === 'random'
        ? this.fairShuffle(group).slice(0, 1)
        : this.drawByMode(group, 1, 'merit_best', scoreMap);
      for (const c of alt) { usedIds.add(c.id); alternativeList.push(this.toSelection(c, quotaLabel, '候补', scoreMap)); }
    });

    return {
      engine,
      model: engine === 'deepseek' ? process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash' : 'WaterERP Rules Engine',
      extractMode,
      analysis,
      requiredSpecialties: [
        ...quotas,
        ...employerQuotas.map(q => {
          const filterSpec = q.specialties.join('、');
          const drawnSpecs = employerDrawnSpecs.get(q.employer!.trim()) || [];
          const specLabel = filterSpec || (drawnSpecs.length > 0 ? [...new Set(drawnSpecs)].join('、') + '·需求方代表' : '需求方代表');
          return { ...q, specialty: specLabel, specialties: filterSpec ? q.specialties : [...new Set(drawnSpecs)], reason: q.reason || `需求方代表：从「${q.employer}」抽取` };
        }),
      ],
      eligiblePool: eligible.length,
      // A-129：候选行携带档案区域/等级，供前端展示与配额过滤核对
      ...(regionCodes.length || expertLevels.length ? {
        quotaFiltersApplied: {
          regionCode: regionCodes,
          expertLevel: expertLevels,
          ...(regionCodes.length > 1 || levelUnionWidened ? { note: '多配额区域/等级值不一致，候选池已按并集过滤' } : {}),
        },
      } : {}),
      candidatePool: candidates.map(c => ({
        userId: c.id,
        name: c.displayName,
        specialty: c.specialty,
        title: c.title,
        employer: c.employer,
        department: c.department,
        phone: c.phone,
        regionCode: c.regionCode,
        expertLevel: c.expertLevel,
        matchScore: scoreMap.get(c.id)?.matchScore ?? 0,
        evaluationLevel: c.evaluationLevel,
        currentLoadStatus: c.currentLoadStatus,
        // 2026-09-24 抽取结果全信息表：历史参评数（累计）与评分偏离度随池吐出
        pastProjects: c.pastProjects,
        scoreDeviation: c.scoreDeviation,
        reason: scoreMap.get(c.id)?.reason ?? '',
      })),
      selected,
      alternatives: alternativeList,
      shortages,
      // 自动推荐组长：从正选中按职称+等级+偏离度+经验+负荷综合打分，最高者
      suggestedLeaderId: (() => {
        const candMap = new Map(candidates.map(c => [c.id, c]));
        return selected
          .filter(s => s.role === '正选')
          .map(s => ({ userId: s.userId, score: this.leaderScore(candMap.get(s.userId)) }))
          .sort((a, b) => b.score - a.score)[0]?.userId ?? null;
      })(),
      generatedAt: new Date().toISOString(),
    };
  }

  /** 确认抽取：资格复核 + 创建 BidExpert + 写入审计日志，全部在同一事务内（消除复核-提交窗口的 TOCTOU）。 */
  async confirmExtraction(projectId: string, dto: ConfirmExtractionDto, operatorId?: string, operator?: AuthenticatedUser) {
    // 公司级数据隔离：复核段重查时校验专家归属——操作人本公司恒放行；
    // 抽取配置显式选了其他公司（companyIds 白名单，用户拍板可跨公司）的专家放行；未声明则仅本公司
    const scope = await this.companyScope.resolveScope(operator);
    const allowedCompanyIds = new Set((dto.companyIds ?? []).map(c => c.trim()).filter(Boolean));
    // 审计是采购法高风险环节的唯一追溯凭证：缺操作人即拒绝，绝不静默跳过审计后照常完成抽取
    if (!operatorId) throw new BadRequestException({ error: '缺少操作人，无法完成抽取留痕', code: 'NO_OPERATOR' });

    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: {
        id: true, name: true, stage: true, projectManagementItemId: true,
        suppliers: { include: { supplier: { select: { name: true } } } },
      },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (!dto.experts?.length && !dto.candidates?.length) throw new BadRequestException({ error: '请选择专家', code: 'NO_EXPERTS' });
    // P1-6：评标启动/归档后禁「先清空再写入」的整体重抽（评分进度与签字状态挂 BidExpert，
    // deleteMany 会连带摧毁）；追加补选仍允许。
    // I6：流标项目同样禁整体重抽——deleteMany 会抹掉已签到/评分证据行
    if (!dto.append && (project.stage === 'EVALUATING' || project.stage === 'ARCHIVED' || project.stage === 'ABORTED')) {
      throw new ConflictException({ error: '项目已进入评标/归档，禁止整体重抽专家；如需补人请使用追加模式', code: 'RE_EXTRACTION_LOCKED' });
    }
    // I6（2026-09-24 全链审计）：追加模式终态拒绝——终态项目上补选=铸新邀请行+通知，死项目不接收；
    // 评标中（EVALUATING）追加仍放行：C1 完成闸谓词（正选 && confirmed）下 pending 追加行不阻塞
    if (dto.append && (project.stage === 'ARCHIVED' || project.stage === 'ABORTED')) {
      throw new ConflictException({ error: '项目已结束，禁止追加抽取专家', code: 'PROJECT_CLOSED' });
    }

    // 供应商名集合（回避校验）——P1-5：回避口径=实际参与投标的供应商全集（已投递或开标后到终局态）。
    // 旧口径 confirmStatus==='CONFIRMED' 在开标前抽取时恒为空集（全员 PENDING），回避形同虚设。
    const supplierNames = new Set(
      project.suppliers
        .filter(s => s.submitStatus === '已提交' || s.confirmStatus === 'CONFIRMED' || s.confirmStatus === 'EXCEPTION')
        .map(s => s.supplier?.name || s.supplierName)
        .filter(Boolean) as string[],
    );

    await this.prisma.$transaction(async (tx) => {
      // 非追加模式（默认）：先清空旧 BidExpert 记录再写入（初次抽取替换专家组用）
      // 追加模式（补选）：保留已存在记录，仅追加新增专家
      if (!dto.append) {
        await tx.bidExpert.deleteMany({ where: { projectId } });
      } else if ((dto.experts ?? []).some(e => e.isLead)) {
        // I6（2026-09-24 全链审计）：追加 isLead 卫生——镜像 setLeader：追加带 isLead 的专家前
        // 先清现有组长，否则 upsert update 分支写 isLead 却不清旧值 → append 铸出双组长
        // （末签/表决按「唯一组长」口径会分裂）
        await tx.bidExpert.updateMany({ where: { projectId, isLead: true }, data: { isLead: false } });
      }

      // 资格复核放在事务内重查：与 previewExtraction 同款合规过滤，并杜绝复核后、提交前被并发停用/退库的专家混入
      const users = await tx.user.findMany({
        where: { id: { in: (dto.experts ?? []).map(e => e.userId) } },
        include: { expertProfile: true },
      });
      for (const e of (dto.experts ?? [])) {
        const u = users.find(x => x.id === e.userId);
        if (!u) throw new BadRequestException({ error: `专家 ${e.expertName} 不存在`, code: 'EXPERT_NOT_FOUND' });
        if (u.role !== 'bid_expert' || !u.isActive || u.expertProfile?.availability !== '可用' || u.expertProfile?.entryStatus !== 'ACTIVE') {
          throw new BadRequestException({ error: `专家 ${e.expertName} 不符合抽取资格（须为在用评标专家）`, code: 'EXPERT_INELIGIBLE' });
        }
        // 公司闸（2026-10-29 与 preview 同口径）：配额「不限公司」（companyIds 空）=全库语义，
        // 不再按登录人公司拦截——否则全库抽出的跨公司专家在确认时被误拒；
        // 显式声明了公司白名单时仍强制（声明集∪登录人视野）。
        if ((dto.companyIds ?? []).length > 0 && !scope.all && (u.companyId == null || !scope.companyIds.includes(u.companyId)) && !allowedCompanyIds.has(u.companyId ?? '')) {
          throw new ForbiddenException({ error: `专家 ${e.expertName} 不在抽取配置公司白名单及本公司范围内`, code: 'COMPANY_SCOPE_FORBIDDEN' });
        }
        const emp = u.expertProfile?.employer?.trim();
        if (emp) {
          for (const sn of supplierNames) {
            if (sn && (emp.includes(sn) || sn.includes(emp))) {
              throw new BadRequestException({ error: `专家 ${e.expertName} 工作单位与投标供应商关联（回避）`, code: 'EXPERT_CONFLICT' });
            }
          }
        }
      }

      // 正选专家创建为 expertRole=正选（isPurchaserRepresentative：采购人代表标识）
      for (const e of (dto.experts ?? [])) {
        await tx.bidExpert.upsert({
          where: { projectId_userId: { projectId, userId: e.userId } },
          update: { expertName: e.expertName, major: e.major, isLead: e.isLead ?? false, expertRole: '正选', invitationStatus: 'pending', isPurchaserRepresentative: e.isPurchaserRepresentative ?? false },
          create: { projectId, userId: e.userId, expertName: e.expertName, major: e.major, isLead: e.isLead ?? false, expertRole: '正选', invitationStatus: 'pending', isPurchaserRepresentative: e.isPurchaserRepresentative ?? false },
        });
      }
      // 候补专家：先清除旧候补记录（避免重复操作导致候补堆积），再写入新一批
      if (dto.candidates?.length) {
        await tx.bidExpert.deleteMany({ where: { projectId, expertRole: '候补' } });
      }
      for (const c of dto.candidates ?? []) {
        await tx.bidExpert.upsert({
          where: { projectId_userId: { projectId, userId: c.userId } },
          update: { expertName: c.expertName, major: c.major, expertRole: '候补', invitationStatus: 'pending' },
          create: { projectId, userId: c.userId, expertName: c.expertName, major: c.major, expertRole: '候补', invitationStatus: 'pending' },
        });
      }

      // 审计日志与抽取写入同事务：要么连同抽取一起成功，要么一起回滚，绝不静默丢审计
      await tx.auditLog.create({
        data: {
          userId: operatorId,
          action: 'EXPERT_EXTRACTION_CONFIRMED',
          resourceType: 'BidProject',
          resourceId: projectId,
          details: {
            projectName: project.name,
            expertCount: dto.experts?.length ?? 0,
            experts: (dto.experts ?? []).map(e => ({ userId: e.userId, name: e.expertName, major: e.major, isLead: e.isLead ?? false })),
            // 抽取快照留痕——候选池与命中序列（事后可复核随机性；模式由前端预览步骤决定，确认时以 DTO 载明为准）
            extractMode: (dto as any).extractMode ?? null,
            poolUserIds: (dto.candidates ?? []).map(c => c.userId),
            drawnUserIds: (dto.experts ?? []).map(e => e.userId),
          },
        },
      });
    });

    // 项目基本信息「专家信息」快照回写（此前从不写入 → 详情页专家评审恒"待补充"）：
    // 从 User/ExpertProfile 补部门与职称，格式 `姓名|部门|专业|职称|角色` 每行一人（parseExperts 同格式）。
    // 全量名册重建（2026-10-29 修复）：此前按「本次 dto」整体重写——候补/补选追加
    // （experts:[]）会把既有正选从快照抹掉（SWHI-JJ-2026102101 实录：库有正选、
    // 基本信息只剩候补）。改为从 BidExpert 全量名册重建，追加/整体替换两种路径均与
    // 库内真实组成恒一致；需求方代表/组长标记从持久化列推导（不再依赖瞬时 dto 标志）。
    try {
      const pmiId = project.projectManagementItemId;
      if (pmiId) {
        const roster = await this.prisma.bidExpert.findMany({
          where: { projectId },
          select: {
            expertName: true, major: true, expertRole: true, isLead: true, isPurchaserRepresentative: true,
            user: { select: { department: { select: { name: true } }, expertProfile: { select: { title: true } } } },
          },
        });
        if (roster.length > 0) {
          // 字段内换行净化（2026-10-29 实录：库内 major 存在「水利电力工程\n(…)」多行值）——
          // pipe 格式以换行分人，字段内换行会把一行拆成两行、角色列错位成姓名
          const flat = (v: string | null | undefined) => (v ?? '').replace(/[\r\n]+/g, ' ').trim();
          const lines = roster.map(e => [
            flat(e.expertName),
            flat(e.user?.department?.name),
            flat(e.major),
            flat(e.user?.expertProfile?.title),
            e.isPurchaserRepresentative ? '需求方代表' : e.expertRole === '候补' ? '候补' : e.isLead ? '正选·组长' : '正选',
          ].join('|'));
          await this.prisma.projectManagementItem.update({
            where: { id: pmiId },
            data: { expertInfo: lines.join('\n') },
          });
        }
      }
    } catch (err) {
      new Logger(ExpertExtractionService.name).warn(`expertInfo 快照回写失败（不阻塞抽取确认）: ${err instanceof Error ? err.message : err}`);
    }

    // 交叉回避检查：同单位专家告警（事务外：不阻塞抽取，仅告警留痕）
    const experts = dto.experts ?? [];
    if (experts.length > 0) {
      try {
        const selectedUserIds = experts.map(e => e.userId);
        const crossConflicts = await this.crossConflict.checkCrossConflicts(selectedUserIds);
        if (crossConflicts.length > 0) {
          await this.prisma.bidSupervisionLog.create({
            data: {
              projectId, time: new Date(), role: '系统', target: '专家抽取',
              action: '交叉回避告警',
              result: crossConflicts.map(c => `${c.expertName} - ${c.conflictDetail}（${c.conflictType}）`).join('；'),
              riskFlag: '中风险',
            },
          }).catch(() => {});
          const warnLogger = new Logger(ExpertExtractionService.name);
          warnLogger.warn(`[CrossConflict] 项目 ${projectId} 发现 ${crossConflicts.length} 条专家交叉冲突`);
        }
      } catch (e) {
        const errLogger = new Logger(ExpertExtractionService.name);
        errLogger.error('交叉回避检查失败（不阻塞抽取）', e instanceof Error ? e.message : String(e));
      }
    }

    // N16 直建衔接：公告直建 PMI 阶段 1-5 已补记 COMPLETED，第 6 步「专家抽取」在此补记——
    // 否则 PMI 阶段链断（6 NOT_STARTED 挡在 7/8 前），第 8 步定标（中标通知书上传）永不可达
    await this.backfillPmiExpertSelection(project.projectManagementItemId);

    return { success: true, count: (dto.experts?.length ?? 0) + (dto.candidates?.length ?? 0), expertIds: (dto.experts ?? []).map(e => e.userId) };
  }

  /** 专家抽取完成 → 补记关联 PMI 的 EXPERT_SELECTION 阶段 COMPLETED（幂等） */
  private async backfillPmiExpertSelection(pmiId: string | null | undefined): Promise<void> {
    if (!pmiId) return;
    try {
      const stage = await this.prisma.projectManagementStage.findFirst({
        where: { projectManagementItemId: pmiId, stageKey: 'EXPERT_SELECTION' },
      });
      if (stage && stage.status === 'NOT_STARTED') {
        await this.prisma.projectManagementStage.update({
          where: { id: stage.id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
        new Logger(ExpertExtractionService.name).log(`专家抽取完成，补记 PMI 阶段 EXPERT_SELECTION COMPLETED（${pmiId}）`);
      }
    } catch (e) {
      // 补记失败不阻塞抽取主流程
      new Logger(ExpertExtractionService.name).warn(`补记 PMI 专家抽取阶段失败: ${(e as Error).message}`);
    }
  }

  /* 抽取辅助 */

  private toSelection(c: any, specialty: string, role: string, scoreMap: Map<string, { matchScore: number; reason: string }>) {
    const s = scoreMap.get(c.id);
    return {
      userId: c.id,
      name: c.displayName,
      specialty,
      title: c.title,
      employer: c.employer,
      phone: c.phone, // 2026-10-27：正选/候补随行电话（明文出口口径同候选池——主持人通知场景）
      evaluationLevel: c.evaluationLevel || null,
      matchScore: s?.matchScore ?? 0,
      reason: s?.reason || '',
      role,
    };
  }

  /** 把 fitSpecialty 映射到配额中存在的专业组（模糊匹配） */
  /** 模式驱动抽样 */
  private drawByMode(
    group: any[],
    n: number,
    mode: 'specialty_match' | 'random' | 'merit_best',
    scoreMap: Map<string, { matchScore: number }>,
  ) {
    if (n <= 0 || group.length === 0) return [];
    if (mode === 'random') return this.fairShuffle(group).slice(0, n);

    // merit_best & specialty_match: 加权随机无放回（分数越高概率越大，但非必中，避免每次结果一致）
    const pool = group.map(c => ({ c, w: Math.max(1, scoreMap.get(c.id)?.matchScore ?? 50) }));
    const chosen: any[] = [];
    for (let i = 0; i < n && pool.length > 0; i++) {
      const total = pool.reduce((s, x) => s + x.w, 0);
      // 密码学安全随机（Math.random 为 xorshift128+ 可预测，影响抽取公平性；与 fairShuffle 同源）
      let r = total > 0 ? randomInt(0, Math.ceil(total * 1e6)) / 1e6 : 0;
      let idx = 0;
      for (; idx < pool.length; idx++) { r -= pool[idx].w; if (r <= 0) break; }
      if (idx >= pool.length) idx = pool.length - 1;
      chosen.push(pool.splice(idx, 1)[0].c);
    }
    return chosen;
  }

  /** Fisher–Yates 洗牌，用 crypto 随机数（公平模式） */
  private fairShuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = randomInt(0, i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** 规则兜底：专家组构成按专业频次 */
  private ruleComposition(candidates: { specialty: string }[], totalNeeded: number): LlmSpecialtyQuota[] {
    const counts = new Map<string, number>();
    for (const c of candidates) counts.set(c.specialty, (counts.get(c.specialty) ?? 0) + 1);
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const quotas: LlmSpecialtyQuota[] = [];
    let remaining = totalNeeded;
    for (const [specialty, n] of sorted) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Math.max(1, Math.round(totalNeeded * (n / candidates.length))));
      quotas.push({ specialty, specialties: [specialty], companyIds: [], count: Math.min(take, remaining), reason: `候选库中该专业人数较多（${n} 人）` });
      remaining -= take;
    }
    if (remaining > 0 && quotas.length) quotas[0].count += remaining;
    return quotas;
  }

  private ruleScore(c: { specialty: string; title?: string; pastProjects: number; evaluationLevel?: string }): number {
    let s = 60;
    if (c.title?.includes('教授') || c.title?.includes('正高')) s += 12;
    else if (c.title?.includes('高工') || c.title?.includes('高级')) s += 8;
    s += Math.min(15, c.pastProjects * 3);
    // 等级加分: A=15, B=10, C=5, D=0, E=-5
    const gradeBonus = { A: 15, B: 10, C: 5, D: 0, E: -5 }[c.evaluationLevel ?? 'C'] ?? 0;
    s += gradeBonus;
    return Math.max(0, Math.min(100, Math.round(s)));
  }

  /** 综合择优规则评分（AI 降级时使用）：纳入履职评价/偏离度/负荷等多维度数据 */
  public extendedRuleScore(c: {
    specialty: string; title?: string; pastProjects: number;
    evaluationLevel?: string; attendanceGrade?: ExpertLevel; qualityGrade?: ExpertLevel;
    disciplineGrade?: ExpertLevel; scoreDeviation?: number; currentLoad?: number; currentLoadStatus?: string;
  }): number {
    let s = 50;
    // 职称（15分）
    if (c.title?.includes('教授') || c.title?.includes('正高')) s += 15;
    else if (c.title?.includes('高工') || c.title?.includes('高级')) s += 10;
    else if (c.title?.includes('工程师') || c.title?.includes('中级')) s += 5;

    // 履职等级（30分）
    if (c.evaluationLevel === 'A') s += 30;
    else if (c.evaluationLevel === 'B') s += 22;
    else if (c.evaluationLevel === 'C') s += 12;
    else if (c.evaluationLevel === 'D') s -= 10;

    // 偏离度（15分）—— 越接近 0 越好
    if (c.scoreDeviation != null) {
      const absDev = Math.abs(c.scoreDeviation);
      if (absDev <= 3) s += 15;
      else if (absDev <= 6) s += 10;
      else if (absDev <= 10) s += 5;
      else s -= 5;
    }

    // 历史经验（15分）
    s += Math.min(15, c.pastProjects * 3);
    // 等级打分: E 级减分
    if (c.evaluationLevel === 'E') s -= 10;

    // 负荷均衡（10分）—— 空闲者加分
    if (c.currentLoadStatus === '空闲') s += 10;
    else if (c.currentLoadStatus === '正常') s += 5;
    // 繁忙不加分

    // 近期活跃（5分）—— 暂未实现该字段，跳过
    // if (c.recentProjects12m != null && c.recentProjects12m > 0) s += Math.min(5, c.recentProjects12m);

    return Math.max(0, Math.round(s));
  }

  /** 确定性选用理由（2026-10-27 选用理由改版二轮·LLM 不可用/漏配兜底）：只说明录取机制，
   *  不复述结果表已展示的属性值（专业/职称/履职/偏离/负荷/参评次数）；契合分析属语义判断，规则模式不编造。 */
  private fitReason(mode: 'specialty_match' | 'random' | 'merit_best'): string {
    if (mode === 'random') {
      return '随机抽定：专业配额池内等概率抽取，符合公平与回避要求。';
    }
    return 'AI 契合分析暂缺：按专业配额与综合评分规则（履职/偏离/经验/负荷加权）录取，待 AI 可用后可重抽获取契合说明。';
  }

  /** 组长推荐评分：职称(40)+履职等级(30)+偏离度(15)+经验(10)+负荷(5)，从正选中选最高分者 */
  private leaderScore(c?: { title?: string; evaluationLevel?: string; scoreDeviation?: number; pastProjects?: number; currentLoadStatus?: string }): number {
    if (!c) return 0;
    let s = 0;
    const t = (c.title || '');
    if (/正高|教授级/.test(t)) s += 40;
    else if (/高级|副高/.test(t)) s += 30;
    else if (/中级|工程师|经济师|会计师|政工师/.test(t)) s += 20;
    else s += 10;
    const lvl = c.evaluationLevel;
    if (lvl === 'A') s += 30; else if (lvl === 'B') s += 20; else if (lvl === 'C') s += 10; else if (lvl === 'D') s += 5;
    const dev = Math.abs(c.scoreDeviation ?? 99);
    if (dev <= 3) s += 15; else if (dev <= 6) s += 10; else if (dev <= 10) s += 5;
    s += Math.min(10, (c.pastProjects ?? 0) * 2);
    if (c.currentLoadStatus === '空闲') s += 5; else if (c.currentLoadStatus === '正常') s += 3;
    return s;
  }

  /** 专业名归一化：去空白、全角转半角、转小写，便于稳健匹配（避免大小写/全半角/空格差异误判为不同专业） */
  private normalizeSpecialty(s: string): string {
    return (s || '')
      .trim()
      .toLowerCase()
      .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/\s+/g, '');
  }

  /** 白名单纠偏：把 AI 推荐的专业归一化匹配到候选库中真实存在（有候选）的专业，丢弃无候选专业并将其配额并入首位 */
  private reconcileSpecialties(quotas: LlmSpecialtyQuota[], candidates: { specialty: string }[]): LlmSpecialtyQuota[] {
    const available = [...new Set(candidates.map(c => (c.specialty || '').trim()).filter(Boolean))];
    if (available.length === 0 || quotas.length === 0) return quotas;
    const normAvailable = available.map(a => ({ raw: a, norm: this.normalizeSpecialty(a) }));
    const matchOne = (sp: string): string => {
      const nq = this.normalizeSpecialty(sp);
      const hit = normAvailable.find(a => a.norm === nq) ?? normAvailable.find(a => a.norm.includes(nq) || nq.includes(a.norm));
      return hit ? hit.raw : sp; // 严格配额：候选库无此专业时保留原配额名，draw 阶段该组为空将报短缺
    };
    const merged = new Map<string, LlmSpecialtyQuota>();
    for (const q of quotas) {
      if (q.specialties.length === 0) { // 「不选择」=不限专业桶，直通保留（多条并入同一桶）
        const ex = merged.get('');
        if (ex) ex.count += q.count; else merged.set('', { ...q });
        continue;
      }
      // 行内逐专业白名单纠偏（能对上候选库的换成库内原词），相同专业集合的行并桶累加席数
      const specs = [...new Set(q.specialties.map(matchOne))];
      const key = specs.join('、');
      const ex = merged.get(key);
      if (ex) ex.count += q.count;
      else merged.set(key, { ...q, specialties: specs, specialty: specs[0] });
    }
    return [...merged.values()];
  }

  /** 语义召回：用「项目需求」与「专家专长(专业+职称+单位)」的向量相似度对匹配分微调（最高 +8）。
   *  random 模式不干预（保公平）；embedding 不可用/失败时静默跳过，不阻断抽取。 */
  private async applySemanticBoost(
    scoreMap: Map<string, { matchScore: number; fitSpecialty: string; reason: string }>,
    candidates: { id: string; specialty: string; title?: string; employer?: string }[],
    scopeText: string,
    mode: ExtractMode,
  ): Promise<void> {
    if (mode === 'random' || !scopeText || scopeText.trim().length < 4 || candidates.length === 0) return;
    try {
      const texts = [scopeText.slice(0, 1000), ...candidates.map(c => [c.specialty, c.title, c.employer].filter(Boolean).join(' '))];
      const vectors = await this.embedding.embed(texts);
      if (!Array.isArray(vectors) || vectors.length !== texts.length) return;
      const [scopeVec, ...candVecs] = vectors;
      candidates.forEach((c, i) => {
        const sim = this.cosine(scopeVec, candVecs[i]);
        if (sim <= 0) return;
        const rec = scoreMap.get(c.id);
        if (rec) rec.matchScore = Math.max(0, Math.min(100, rec.matchScore + Math.round(sim * 8)));
      });
    } catch (err) {
      new Logger(ExpertExtractionService.name).warn(`语义召回降级（embedding 不可用）: ${(err as Error)?.message ?? err}`);
    }
  }

  /** 余弦相似度 */
  private cosine(a: number[], b: number[]): number {
    if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    if (na === 0 || nb === 0) return 0;
    const sim = dot / (Math.sqrt(na) * Math.sqrt(nb));
    // 防御 NaN（异常向量）污染下游 matchScore，导致加权抽样退化为按位置选人
    return Number.isFinite(sim) ? sim : 0;
  }

  /** 归一化配额：使 count 之和 = totalNeeded */
  private normalizeQuotas(quotas: LlmSpecialtyQuota[], totalNeeded: number): LlmSpecialtyQuota[] {
    if (quotas.length === 0) return [{ specialty: '综合', specialties: ['综合'], companyIds: [], count: totalNeeded, reason: '未指定专业构成' }];
    const sum = quotas.reduce((s, q) => s + q.count, 0);
    if (sum === totalNeeded) return quotas;
    if (sum === 0) { quotas[0].count = totalNeeded; return quotas; }
    // 按比例缩放，余数补给第一项
    let acc = 0;
    const scaled = quotas.map((q, i) => {
      const raw = (q.count / sum) * totalNeeded;
      const count = i === quotas.length - 1 ? totalNeeded - acc : Math.max(1, Math.round(raw));
      acc += count;
      return { ...q, count };
    });
    return scaled;
  }
}
