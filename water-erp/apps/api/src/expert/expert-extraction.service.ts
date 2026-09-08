/** 专家抽取引擎（F2）——自 expert-admin.service.ts 迁出（P1 审查 F 簇拆分，纯移动）。索引：previewExtraction / confirmExtraction（+12 算法族；extendedRuleScore 供 autoPromoteCandidate 跨实例调用转 public） */

import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { ExpertLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from '../local-ai/embedding.service';
import { computeExpertMeanDeviations } from '../common/scoring/expert-deviation';
import { ExpertExtractionAiService } from './expert-extraction-ai.service';
import { ExpertCrossConflictService } from './expert-cross-conflict.service';
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
  ) {}

  /* ── 专家智能抽取 ── */

  /**
   * 预览抽取：AI 分析 + 合规过滤 + 模式驱动抽取（不落库）。
   * 三种模式：specialty_match（专业匹配）/ random（随机抽取）/ merit_best（综合择优）
   */
  async previewExtraction(projectId: string, dto: ExtractPreviewDto) {
    const totalNeeded = Math.min(Math.max(dto.totalNeeded ?? 5, 1), 9);
    const alternatives = Math.min(Math.max(dto.alternatives ?? 2, 0), 9);
    const extractMode: 'specialty_match' | 'random' | 'merit_best' =
      dto.extractMode ?? 'random'; // P1-9：默认随机抽取（条例第46条基线）；加权模式仅显式指定时使用

    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      include: { suppliers: { include: { supplier: { select: { name: true } } } } },
    });
    if (!project) throw new NotFoundException('项目不存在');

    // 供应商名集合（回避校验）——P1-5：回避口径=实际参与投标的供应商全集（已投递或开标后到终局态）。
    // 旧口径 confirmStatus==='CONFIRMED' 在开标前抽取时恒为空集，抽取期单位回避形同虚设。
    const supplierNames = new Set(
      project.suppliers
        .filter(s => s.submitStatus === '已提交' || s.confirmStatus === 'CONFIRMED' || s.confirmStatus === 'EXCEPTION')
        .map(s => s.supplier?.name || s.supplierName)
        .filter(Boolean) as string[],
    );

    // A-129：配额区域/等级可选过滤——未填不过滤；候选池为全配额共享，多配额不同值取并集
    // （交集会把只满足某一配额的专家整体饿死），并集语义在返回 quotaFiltersApplied 中说明
    const quotaRows = dto.manualQuotas ?? [];
    const regionCodes = [...new Set(quotaRows.map(q => q.regionCode?.trim()).filter((v): v is string => !!v))];
    const expertLevels = [...new Set(
      quotaRows.flatMap(q => (q.expertLevel ?? '').split(',').map(s => s.trim()).filter(v => /^[A-E]$/.test(v))),
    )];
    const levelUnionWidened = new Set(quotaRows.map(q => q.expertLevel?.trim()).filter((v): v is string => !!v)).size > 1;

    // 合规候选：bid_expert + 可用 + 未分配本项目 + 工作单位不在参与供应商中
    // 重新抽取时不排除本项目已分配的专家（确认时会先清空旧记录），只排除其他项目的占用
    const experts = await this.prisma.user.findMany({
      where: {
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
      },
      include: {
        expertProfile: true,
        department: { select: { name: true } },
        bidExperts: { where: { projectId: { not: projectId } }, select: { id: true } },
        _count: { select: { bidExperts: true } },
      },
    });
    const excludedIds = new Set(dto.excludedUserIds ?? []);
    const eligible = experts.filter((u) => {
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
      return {
        id: u.id,
        displayName: u.displayName,
        specialty: u.expertProfile?.specialty || '综合',
        title: u.expertProfile?.title ?? undefined,
        employer: u.expertProfile?.employer ?? undefined,
        regionCode: u.expertProfile?.regionCode ?? undefined,
        expertLevel: u.expertProfile?.expertLevel ?? undefined,
        department: u.department?.name ?? undefined,
        pastProjects: u._count.bidExperts,
        evaluationLevel: latest?.level,
        attendanceGrade: latest?.attendanceGrade,
        qualityGrade: latest?.qualityGrade,
        disciplineGrade: latest?.disciplineGrade,
        scoreDeviation: deviationMap.get(u.id),
        recentProjects12m: recentMap.get(u.id) ?? 0,
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
    let engine: 'deepseek' | 'rules' = 'deepseek';

    try {
      const llm = await this.extractionAi.analyzeAndScore(
        { name: project.name, procurementMethod: project.procurementMethod, scope: scopeText, budget: project.budget ? Number(project.budget) : undefined },
        candidates,
        totalNeeded,
        extractMode,
        dto.manualQuotas?.length ? dto.manualQuotas.filter(q => !q.employer).map(q => `${q.specialty}×${q.count}`).join('、') : undefined,
      );
      analysis = llm.analysis;
      requiredSpecialties = dto.manualQuotas?.length
        ? dto.manualQuotas.map(q => ({ specialty: q.specialty, count: q.count, reason: q.reason ?? '', employer: q.employer, department: q.department, regionCode: q.regionCode, expertLevel: q.expertLevel }))
        : llm.requiredSpecialties;
      for (const s of llm.scoredExperts) scoreMap.set(s.id, { matchScore: s.matchScore, fitSpecialty: s.fitSpecialty, reason: s.reason });
    } catch (err) {
      // 规则降级：AI 不可用时如实告知原因，用规则引擎兜底
      engine = 'rules';
      this.extractionAi.recordFallback();
      const errMsg = (err as Error)?.message ?? String(err);
      new Logger(ExpertExtractionService.name).warn(`抽取 AI 降级规则引擎: ${errMsg}`);
      requiredSpecialties = dto.manualQuotas?.length
        ? dto.manualQuotas.map(q => ({ specialty: q.specialty, count: q.count, reason: q.reason ?? '', employer: q.employer, department: q.department, regionCode: q.regionCode, expertLevel: q.expertLevel }))
        : this.ruleComposition(candidates, totalNeeded);
      const isTimeout = errMsg.includes('超时') || errMsg.includes('timed out');
      const is503 = errMsg.includes('503') || errMsg.includes('Service Unavailable');
      analysis = `⚠ AI 服务暂不可用（${isTimeout ? '响应超时' : is503 ? '服务繁忙' : '连接异常'}），已使用规则引擎按履职等级、职称与负荷综合评分${extractMode === 'merit_best' ? '择优' : '随机'}组建。请稍后重试以获取 AI 分析。`;
      for (const c of candidates) {
        scoreMap.set(c.id, {
          matchScore: this.extendedRuleScore(c),
          fitSpecialty: c.specialty,
          reason: `${c.title || ''}，履职等级 ${c.evaluationLevel ?? '—'}、负荷 ${c.currentLoadStatus || '-'}。`,
        });
      }
    }

    for (const c of candidates) {
      if (!scoreMap.has(c.id)) {
        scoreMap.set(c.id, {
          matchScore: extractMode === 'merit_best' ? this.extendedRuleScore(c) : 50,
          fitSpecialty: c.specialty,
          reason: `${c.title || ''}，履职等级 ${c.evaluationLevel ?? '—'}、负荷 ${c.currentLoadStatus || '-'}。`,
        });
      }
    }

    // 拆分部门限定配额（需求方代表「选择部门」，按 employer 过滤）与常规专业配额
    const employerQuotas = requiredSpecialties.filter(q => q.employer && q.employer.trim());
    const normalReq = requiredSpecialties.filter(q => !(q.employer && q.employer.trim()) && (q.specialty || '').trim());

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

    // 按专业分组
    const groups = new Map<string, typeof candidates>();
    for (const c of drawPool) {
      const fit = scoreMap.get(c.id)?.fitSpecialty || c.specialty;
      const key = this.matchGroupKey(fit, quotas);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c);
    }

    // 模式驱动抽取
    const selected: any[] = [];
    const shortages: { specialty: string; needed: number; available: number }[] = [];
    const usedIds = new Set<string>();

    for (const q of quotas) {
      // 优先从 A/B/C 池（drawPool）抽；不够时从 D/E 补齐（凑人优先于等级门槛）
      const group = (groups.get(q.specialty) || []).filter(c => !usedIds.has(c.id));
      let pool = group;
      if (pool.length < q.count) {
        // 从全池（含 D/E）补齐同专业未被占用的候选
        const fallback = candidates.filter(c => {
          if (usedIds.has(c.id) || pool.some(p => p.id === c.id)) return false;
          const fit = scoreMap.get(c.id)?.fitSpecialty || c.specialty;
          return this.matchGroupKey(fit, quotas) === q.specialty;
        });
        pool = [...pool, ...fallback];
      }
      if (pool.length === 0) shortages.push({ specialty: q.specialty, needed: q.count, available: 0 });
      else if (pool.length < q.count) shortages.push({ specialty: q.specialty, needed: q.count, available: pool.length });

      const drawn = this.drawByMode(pool, Math.min(q.count, pool.length), extractMode, scoreMap);
      for (const c of drawn) { usedIds.add(c.id); selected.push(this.toSelection(c, q.specialty, '正选', scoreMap)); }
    }

    // 部门限定配额抽取（需求方代表）：按工作单位匹配部门，专业可选作附加过滤
    // 记录每笔部门配额抽取出的专家实际专业，供 requiredSpecialties 显示「专业·需求方代表」
    const employerDrawnSpecs = new Map<string, string[]>();
    for (const q of employerQuotas) {
      const emp = q.employer!.trim();
      const specFilter = (q.specialty || '').trim();
      const deptFilter = (q.department || '').trim(); // 真部门（Department.name）过滤，公司内进一步收窄
      const pool = drawPool.filter(c => {
        if (usedIds.has(c.id)) return false;
        const ce = (c.employer || '').trim();
        if (!ce || !(ce === emp || ce.includes(emp) || emp.includes(ce))) return false;
        if (deptFilter && (c.department || '').trim() !== deptFilter) return false;
        if (specFilter) {
          const cs = (c.specialty || '').trim();
          if (!(cs === specFilter || cs.includes(specFilter) || specFilter.includes(cs))) return false;
        }
        return true;
      });
      const label = specFilter ? `${emp}·${specFilter}` : emp;
      if (pool.length === 0) shortages.push({ specialty: label, needed: q.count, available: 0 });
      else if (pool.length < q.count) shortages.push({ specialty: label, needed: q.count, available: pool.length });
      const drawn = this.drawByMode(pool, Math.min(q.count, pool.length), extractMode, scoreMap);
      const drawnSpecs = drawn.map(c => c.specialty);
      employerDrawnSpecs.set(emp, drawnSpecs);
      // P1-7：部门限定配额 = 需求方代表（采购人代表），选中结果打标供确认时持久化
      for (const c of drawn) {
        usedIds.add(c.id);
        const sel = this.toSelection(c, specFilter || c.specialty, '正选', scoreMap);
        (sel as any).isPurchaserRepresentative = true;
        selected.push(sel);
      }
    }

    // 候补：每个专业配额各抽 1 位候补（放宽到全部候选含 D/E，作后备用）
    const alternativeList: ReturnType<typeof this.toSelection>[] = [];
    for (const q of quotas) {
      const group = candidates.filter(c => {
        if (usedIds.has(c.id)) return false;
        const fit = scoreMap.get(c.id)?.fitSpecialty || c.specialty;
        return this.matchGroupKey(fit, quotas) === q.specialty;
      });
      if (group.length === 0) continue;
      const alt = extractMode === 'random'
        ? this.fairShuffle(group).slice(0, 1)
        : this.drawByMode(group, 1, 'merit_best', scoreMap);
      for (const c of alt) { usedIds.add(c.id); alternativeList.push(this.toSelection(c, q.specialty, '候补', scoreMap)); }
    }

    return {
      engine,
      model: engine === 'deepseek' ? process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash' : 'WaterERP Rules Engine',
      extractMode,
      analysis,
      requiredSpecialties: [
        ...quotas,
        ...employerQuotas.map(q => {
          const filterSpec = (q.specialty || '').trim();
          const drawnSpecs = employerDrawnSpecs.get(q.employer!.trim()) || [];
          const specLabel = filterSpec || (drawnSpecs.length > 0 ? [...new Set(drawnSpecs)].join('、') + '·需求方代表' : '需求方代表');
          return { ...q, specialty: specLabel, reason: q.reason || `需求方代表：从「${q.employer}」抽取` };
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
        regionCode: c.regionCode,
        expertLevel: c.expertLevel,
        matchScore: scoreMap.get(c.id)?.matchScore ?? 0,
        evaluationLevel: c.evaluationLevel,
        currentLoadStatus: c.currentLoadStatus,
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
  async confirmExtraction(projectId: string, dto: ConfirmExtractionDto, operatorId?: string) {
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
    if (!dto.append && (project.stage === 'EVALUATING' || project.stage === 'ARCHIVED')) {
      throw new ConflictException({ error: '项目已进入评标/归档，禁止整体重抽专家；如需补人请使用追加模式', code: 'RE_EXTRACTION_LOCKED' });
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
        const emp = u.expertProfile?.employer?.trim();
        if (emp) {
          for (const sn of supplierNames) {
            if (sn && (emp.includes(sn) || sn.includes(emp))) {
              throw new BadRequestException({ error: `专家 ${e.expertName} 工作单位与投标供应商关联（回避）`, code: 'EXPERT_CONFLICT' });
            }
          }
        }
      }

      // P0-4 止血：验证码链路前端零接线（身份核验后期升级），抽取确认视为采购端已核验身份，
      // phoneVerified 置 true——否则新抽取专家 signIn 403 PHONE_NOT_VERIFIED 死锁（种子预置 true 掩盖了此问题）。
      // 正选专家创建为 expertRole=正选（isPurchaserRepresentative：P1-7 采购人代表标识）
      for (const e of (dto.experts ?? [])) {
        await tx.bidExpert.upsert({
          where: { projectId_userId: { projectId, userId: e.userId } },
          update: { expertName: e.expertName, major: e.major, isLead: e.isLead ?? false, expertRole: '正选', invitationStatus: 'pending', phoneVerified: true, isPurchaserRepresentative: e.isPurchaserRepresentative ?? false },
          create: { projectId, userId: e.userId, expertName: e.expertName, major: e.major, isLead: e.isLead ?? false, expertRole: '正选', invitationStatus: 'pending', phoneVerified: true, isPurchaserRepresentative: e.isPurchaserRepresentative ?? false },
        });
      }
      // 候补专家：先清除旧候补记录（避免重复操作导致候补堆积），再写入新一批
      if (dto.candidates?.length) {
        await tx.bidExpert.deleteMany({ where: { projectId, expertRole: '候补' } });
      }
      for (const c of dto.candidates ?? []) {
        await tx.bidExpert.upsert({
          where: { projectId_userId: { projectId, userId: c.userId } },
          update: { expertName: c.expertName, major: c.major, expertRole: '候补', invitationStatus: 'pending', phoneVerified: true },
          create: { projectId, userId: c.userId, expertName: c.expertName, major: c.major, expertRole: '候补', invitationStatus: 'pending', phoneVerified: true },
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
            // P1-9/P2-8：抽取快照留痕——候选池与命中序列（事后可复核随机性；模式由前端预览步骤决定，确认时以 DTO 载明为准）
            extractMode: (dto as any).extractMode ?? null,
            poolUserIds: (dto.candidates ?? []).map(c => c.userId),
            drawnUserIds: (dto.experts ?? []).map(e => e.userId),
          },
        },
      });
    });

    // 项目基本信息「专家信息」快照回写（此前从不写入 → 详情页专家评审恒"待补充"）：
    // 从 User/ExpertProfile 补部门与职称，格式 `姓名|部门|专业|职称|角色` 每行一人（parseExperts 同格式）
    try {
      const pmiId = project.projectManagementItemId;
      if (pmiId) {
        const all = [...(dto.experts ?? []).map(e => ({ ...e, role: (e as any).isPurchaserRepresentative ? '需求方代表' : '正选' })),
                    ...(dto.candidates ?? []).map(c => ({ ...c, role: '候补' }))];
        if (all.length > 0) {
          const userIds = all.map(e => e.userId);
          const profiles = await this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, department: { select: { name: true } }, expertProfile: { select: { title: true } } },
          });
          const infoById = new Map(profiles.map(u => [u.id, u]));
          const lines = all.map(e => {
            const u = infoById.get(e.userId);
            return [e.expertName, u?.department?.name ?? '', e.major ?? '', u?.expertProfile?.title ?? '', e.role ?? '正选'].join('|');
          });
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

  /* ── 抽取辅助 ── */

  private toSelection(c: any, specialty: string, role: string, scoreMap: Map<string, { matchScore: number; reason: string }>) {
    const s = scoreMap.get(c.id);
    return {
      userId: c.id,
      name: c.displayName,
      specialty,
      title: c.title,
      employer: c.employer,
      evaluationLevel: c.evaluationLevel || null,
      matchScore: s?.matchScore ?? 0,
      reason: s?.reason || '',
      role,
    };
  }

  /** 把 fitSpecialty 映射到配额中存在的专业组（模糊匹配） */
  private matchGroupKey(fitSpecialty: string, quotas: LlmSpecialtyQuota[]): string {
    const exact = quotas.find(q => q.specialty === fitSpecialty);
    if (exact) return exact.specialty;
    const partial = quotas.find(q => fitSpecialty.includes(q.specialty) || q.specialty.includes(fitSpecialty));
    return partial ? partial.specialty : fitSpecialty; // 无匹配时保留专家自身专业，不强行塞入第一个配额组
  }

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
      quotas.push({ specialty, count: Math.min(take, remaining), reason: `候选库中该专业人数较多（${n} 人）` });
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
    const merged = new Map<string, LlmSpecialtyQuota>();
    for (const q of quotas) {
      const name = (q.specialty || '').trim();
      if (!name) continue;
      const nq = this.normalizeSpecialty(name);
      const hit = normAvailable.find(a => a.norm === nq) ?? normAvailable.find(a => a.norm.includes(nq) || nq.includes(a.norm));
      if (!hit) {
        // 严格配额：候选库无此专业时保留原配额名，不合并、不重分配——draw 阶段该组为空将报短缺
        merged.set(name, { ...q });
        continue;
      }
      const ex = merged.get(hit.raw);
      if (ex) ex.count += q.count;
      else merged.set(hit.raw, { ...q, specialty: hit.raw });
    }
    const list = [...merged.values()];
    return list;
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
    if (quotas.length === 0) return [{ specialty: '综合', count: totalNeeded, reason: '未指定专业构成' }];
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
