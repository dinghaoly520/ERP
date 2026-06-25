import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { hashSync } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { ExpertExtractionAiService } from './expert-extraction-ai.service';
import type { LlmSpecialtyQuota } from './expert-extraction-ai.service';
import type { CreateExpertDto } from './dto/create-expert.dto';
import type { ExtractPreviewDto } from './dto/extract-preview.dto';
import type { ConfirmExtractionDto } from './dto/confirm-extraction.dto';
import type { CreateExpertEvaluationDto } from './dto/create-expert-evaluation.dto';
import { computeExpertMeanDeviations, meanOrNull, shouldDeactivateExpert } from './expert-deviation';
import { buildExpertPortrait } from './expert-portrait.util';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class ExpertAdminService {
  constructor(
    private prisma: PrismaService,
    private extractionAi: ExpertExtractionAiService,
    private notification: NotificationService,
  ) {}

  /* ── 专家库 ── */

  /** 专家库列表（含 ExpertProfile，可按专业筛选） */
  async listExperts(search?: string, specialty?: string) {
    return this.prisma.user.findMany({
      where: {
        role: 'bid_expert',
        ...(search && { displayName: { contains: search, mode: 'insensitive' } }),
        ...(specialty && { expertProfile: { specialty } }),
      },
      select: {
        id: true,
        displayName: true,
        email: true,
        isActive: true,
        department: { select: { id: true, name: true } },
        expertProfile: true,
        bidExperts: {
          select: { id: true, expertName: true, major: true, progress: true, signedIn: true, avoidanceConfirmed: true, totalScore: true, project: { select: { id: true, name: true, stage: true } } },
          orderBy: { createdAt: 'desc' },
        },
        _count: { select: { expertEvaluations: true } },
      },
      orderBy: { displayName: 'asc' },
    });
  }

  /** 全部专业（去重） */
  async listSpecialties() {
    const rows = await this.prisma.expertProfile.findMany({
      where: { user: { isActive: true } },
      select: { specialty: true },
      distinct: ['specialty'],
      orderBy: { specialty: 'asc' },
    });
    return rows.map(r => r.specialty);
  }

  /** 专家详情 */
  async getExpert(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, displayName: true, email: true, role: true, isActive: true, department: { select: { id: true, name: true } }, createdAt: true, expertProfile: true },
    });
    if (!user) throw new NotFoundException('用户不存在');

    const assignments = await this.prisma.bidExpert.findMany({
      where: { userId },
      include: { project: { select: { id: true, projectCode: true, name: true, stage: true, procurementMethod: true, openTime: true } }, scoreRecords: { include: { scoreItem: { select: { name: true, category: true, maxScore: true } } } } },
      orderBy: { createdAt: 'desc' },
    });

    const evaluations = await this.prisma.expertEvaluation.findMany({
      where: { expertUserId: userId },
      include: { evaluator: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const totalProjects = assignments.length;
    const completedProjects = assignments.filter(a => a.progress >= 100).length;
    const signedInProjects = assignments.filter(a => a.signedIn).length;
    const evalAvg = evaluations.length > 0 ? evaluations.reduce((s, e) => s + e.overallScore, 0) / evaluations.length : 0;

    return { ...user, assignments, evaluations, statistics: { totalProjects, completedProjects, signedInProjects, evalAvg: Math.round(evalAvg * 10) / 10, evalCount: evaluations.length } };
  }

  /** 专家参与的评审项目列表 */
  async listExpertProjects(userId: string) {
    return this.prisma.bidExpert.findMany({
      where: { userId },
      include: { project: { select: { id: true, projectCode: true, name: true, stage: true, procurementMethod: true, openTime: true, deadline: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /* ── 专家录入 ── */

  async createExpert(dto: CreateExpertDto) {
    const normalizedName = dto.displayName.trim();
    if (await this.prisma.user.findFirst({ where: { username: dto.username, role: 'bid_expert' } })) {
      throw new BadRequestException({ error: '账号已存在', code: 'DUPLICATE_USERNAME' });
    }
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: dto.username,
          displayName: normalizedName,
          email: dto.email,
          passwordHash: hashSync(dto.password, 10),
          role: 'bid_expert',
          isActive: true,
          expertProfile: {
            create: {
              specialty: dto.specialty,
              title: dto.title,
              employer: dto.employer,
              phone: dto.phone,
              idNumber: dto.idNumber,
              availability: '可用',
              notes: dto.notes,
            },
          },
        },
        include: { expertProfile: true },
      });
      return user;
    });
  }

  /** 启用/停用专家（停用 = isActive=false + availability 停用） */
  async setAvailability(userId: string, available: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('专家不存在');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { isActive: available } }),
      this.prisma.expertProfile.updateMany({ where: { userId }, data: { availability: available ? '可用' : '停用' } }),
    ]);
    return { success: true };
  }

  /** 更新专家资料 */
  async updateProfile(userId: string, dto: Partial<CreateExpertDto>) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('专家不存在');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { ...(dto.displayName && { displayName: dto.displayName }), ...(dto.email !== undefined && { email: dto.email }) } }),
      this.prisma.expertProfile.upsert({
        where: { userId },
        update: {
          ...(dto.specialty && { specialty: dto.specialty }),
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.employer !== undefined && { employer: dto.employer }),
          ...(dto.phone !== undefined && { phone: dto.phone }),
          ...(dto.idNumber !== undefined && { idNumber: dto.idNumber }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
        },
        create: { userId, specialty: dto.specialty || '综合', title: dto.title, employer: dto.employer, phone: dto.phone, idNumber: dto.idNumber, notes: dto.notes },
      }),
    ]);
    return { success: true };
  }

  /* ── 专家智能抽取 ── */

  /** 预览抽取：AI 分析 + 合规过滤 + 随机抽取（不落库） */
  async previewExtraction(projectId: string, dto: ExtractPreviewDto) {
    const totalNeeded = Math.min(Math.max(dto.totalNeeded ?? 5, 1), 9);
    const alternatives = Math.min(Math.max(dto.alternatives ?? 2, 0), 5);
    const mode: 'weighted' | 'fair' = dto.mode === 'fair' ? 'fair' : 'weighted';

    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      include: { suppliers: { include: { supplier: { select: { name: true } } } } },
    });
    if (!project) throw new NotFoundException('项目不存在');

    // 供应商名集合（回避校验）
    const supplierNames = new Set(
      project.suppliers.map(s => s.supplier?.name || s.supplierName).filter(Boolean) as string[],
    );

    // 合规候选：bid_expert + 可用 + 未分配本项目 + 工作单位不在参与供应商中
    const experts = await this.prisma.user.findMany({
      where: { role: 'bid_expert', isActive: true, expertProfile: { availability: '可用' } },
      include: {
        expertProfile: true,
        bidExperts: { where: { projectId }, select: { id: true } },
        _count: { select: { bidExperts: true } },
      },
    });
    const eligible = experts.filter((u) => {
      if (u.bidExperts.length > 0) return false; // 已分配
      const emp = u.expertProfile?.employer?.trim();
      if (emp) {
        for (const sn of supplierNames) {
          if (sn && (emp.includes(sn) || sn.includes(emp))) return false; // 供应商回避
        }
      }
      return true;
    });

    // 历史履职均分
    const evalAgg = await this.prisma.expertEvaluation.groupBy({
      by: ['expertUserId'],
      where: { expertUserId: { in: eligible.map(e => e.id) } },
      _avg: { overallScore: true },
    });
    const evalAvgMap = new Map(evalAgg.map(a => [a.expertUserId, a._avg.overallScore ?? 0]));

    const candidates = eligible.map(u => ({
      id: u.id,
      displayName: u.displayName,
      specialty: u.expertProfile?.specialty || '综合',
      title: u.expertProfile?.title ?? undefined,
      employer: u.expertProfile?.employer ?? undefined,
      pastProjects: u._count.bidExperts,
      pastAvgScore: Math.round((evalAvgMap.get(u.id) ?? 0) * 10) / 10,
    }));

    // AI 分析
    const llm = await this.extractionAi.analyzeAndScore(
      { name: project.name, procurementMethod: project.procurementMethod, scope: project.riskNote || project.name, budget: undefined },
      candidates,
      totalNeeded,
    );

    let analysis: string;
    let requiredSpecialties: LlmSpecialtyQuota[];
    let engine: 'deepseek' | 'rules';
    const scoreMap = new Map<string, { matchScore: number; fitSpecialty: string; reason: string }>();

    if (llm && (llm.scoredExperts.length > 0 || llm.requiredSpecialties.length > 0)) {
      engine = 'deepseek';
      analysis = llm.analysis;
      requiredSpecialties = dto.manualQuotas?.length
        ? dto.manualQuotas.map(q => ({ specialty: q.specialty, count: q.count, reason: q.reason ?? '' }))
        : llm.requiredSpecialties;
      for (const s of llm.scoredExperts) scoreMap.set(s.id, { matchScore: s.matchScore, fitSpecialty: s.fitSpecialty, reason: s.reason });
      // 降级：LLM 未覆盖的候选人由规则评分兜底（避免 UI 显示「0 较低」）
      for (const c of candidates) {
        if (!scoreMap.has(c.id)) {
          scoreMap.set(c.id, {
            matchScore: this.ruleScore(c),
            fitSpecialty: c.specialty,
            reason: `专业「${c.specialty}」${c.title ? '、' + c.title : ''}，历史项目 ${c.pastProjects} 个。`,
          });
        }
      }
    } else {
      engine = 'rules';
      analysis = `基于专业匹配与历史履职的规则评分（共 ${eligible.length} 名合规专家）。`;
      requiredSpecialties = dto.manualQuotas?.length
        ? dto.manualQuotas.map(q => ({ specialty: q.specialty, count: q.count, reason: q.reason ?? '' }))
        : this.ruleComposition(candidates, totalNeeded);
      for (const c of candidates) {
        scoreMap.set(c.id, { matchScore: this.ruleScore(c), fitSpecialty: c.specialty, reason: `专业「${c.specialty}」${c.title ? '、' + c.title : ''}，历史项目 ${c.pastProjects} 个。` });
      }
    }

    // 归一化配额到 totalNeeded
    const quotas = this.normalizeQuotas(requiredSpecialties, totalNeeded);

    // 按专业分组（每位专家分到其最契合专业组，避免重复）
    const groups = new Map<string, typeof candidates>();
    for (const c of candidates) {
      const fit = scoreMap.get(c.id)?.fitSpecialty || c.specialty;
      const key = this.matchGroupKey(fit, quotas);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c);
    }

    // 抽取：每组内按模式抽样
    const selected: any[] = [];
    const shortages: { specialty: string; needed: number; available: number }[] = [];
    const usedIds = new Set<string>();
    for (const q of quotas) {
      const group = (groups.get(q.specialty) || []).filter(c => !usedIds.has(c.id));
      if (group.length === 0) {
        // 该专业无匹配专家：放宽到全部合规候选
        const fallback = candidates.filter(c => !usedIds.has(c.id));
        shortages.push({ specialty: q.specialty, needed: q.count, available: 0 });
        const drawn = this.draw(fallback, Math.min(q.count, fallback.length), mode, scoreMap);
        for (const c of drawn) { usedIds.add(c.id); selected.push(this.toSelection(c, q.specialty, '正选', scoreMap)); }
        continue;
      }
      if (group.length < q.count) shortages.push({ specialty: q.specialty, needed: q.count, available: group.length });
      const drawn = this.draw(group, Math.min(q.count, group.length), mode, scoreMap);
      for (const c of drawn) { usedIds.add(c.id); selected.push(this.toSelection(c, q.specialty, '正选', scoreMap)); }
    }

    // 候补：从未中选者按匹配度取 top N
    const remaining = candidates.filter(c => !usedIds.has(c.id)).sort((a, b) => (scoreMap.get(b.id)?.matchScore ?? 0) - (scoreMap.get(a.id)?.matchScore ?? 0));
    const altDrawn = mode === 'fair'
      ? this.fairShuffle(remaining).slice(0, alternatives)
      : remaining.slice(0, alternatives);
    const alternativeList = altDrawn.map(c => this.toSelection(c, scoreMap.get(c.id)?.fitSpecialty || c.specialty, '候补', scoreMap));

    return {
      engine,
      model: engine === 'deepseek' ? process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash' : 'WaterERP Rules Engine',
      analysis,
      requiredSpecialties: quotas,
      eligiblePool: eligible.length,
      selected,
      alternatives: alternativeList,
      shortages,
      generatedAt: new Date().toISOString(),
    };
  }

  /** 确认抽取：为选中的专家创建 BidExpert 记录 */
  async confirmExtraction(projectId: string, dto: ConfirmExtractionDto) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    if (!dto.experts?.length) throw new BadRequestException({ error: '请选择专家', code: 'NO_EXPERTS' });

    const created = await this.prisma.$transaction(
      dto.experts.map(e =>
        this.prisma.bidExpert.upsert({
          where: { projectId_userId: { projectId, userId: e.userId } },
          update: { expertName: e.expertName, major: e.major },
          create: { projectId, userId: e.userId, expertName: e.expertName, major: e.major },
        }),
      ),
    );
    return { success: true, count: created.length };
  }

  /* ── 大屏聚合统计（公开，无需登录）── */

  async getBigscreenStats() {
    const [total, availGroups, specGroups, titleGroups, evals, scoreRecords] = await Promise.all([
      this.prisma.user.count({ where: { role: 'bid_expert' } }),
      this.prisma.expertProfile.groupBy({
        by: ['availability'],
        where: { user: { role: 'bid_expert' } },
        _count: true,
      }),
      this.prisma.expertProfile.groupBy({
        by: ['specialty'],
        where: { user: { role: 'bid_expert', isActive: true } },
        _count: true,
        orderBy: { _count: { specialty: 'desc' } },
        take: 8,
      }),
      this.prisma.expertProfile.groupBy({
        by: ['title'],
        where: { user: { role: 'bid_expert', isActive: true } },
        _count: true,
        orderBy: { _count: { title: 'desc' } },
      }),
      this.prisma.expertEvaluation.findMany({
        select: { level: true, overallScore: true, expertUserId: true, createdAt: true },
      }),
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
    const disabled = amap['停用'] ?? 0;

    // 专业分布（最大值为 100% 基准）
    const maxSpec = specGroups[0]?._count ?? 1;
    const specialties = specGroups.map(g => ({
      name: g.specialty,
      count: g._count,
      pct: Math.round((g._count / maxSpec) * 100),
    }));

    // 履职评价等级分布
    const levelCounts = { A: 0, B: 0, C: 0, D: 0 };
    for (const e of evals) levelCounts[e.level] = (levelCounts[e.level] ?? 0) + 1;
    const evalTotal = evals.length;
    const avgScore = evalTotal > 0
      ? Math.round(evals.reduce((s, e) => s + e.overallScore, 0) / evalTotal * 10) / 10
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
      evaluation: { levelCounts, avgScore, total: evalTotal, avgScoreDeviation: avgDeviation },
      titles,
    };
  }

  /* ── 专家评价 ── */

  async createEvaluation(evaluatorId: string, dto: CreateExpertEvaluationDto) {
    const expert = await this.prisma.user.findFirst({ where: { id: dto.expertUserId, role: 'bid_expert' } });
    if (!expert) throw new NotFoundException('专家不存在');

    const overall = Math.round((dto.attendanceScore + dto.qualityScore + dto.disciplineScore) / 3);
    const level = overall >= 90 ? 'A' : overall >= 80 ? 'B' : overall >= 60 ? 'C' : 'D';

    const created = await this.prisma.expertEvaluation.create({
      data: {
        expertUserId: dto.expertUserId,
        projectId: dto.projectId,
        evaluatorId,
        attendanceScore: dto.attendanceScore,
        qualityScore: dto.qualityScore,
        disciplineScore: dto.disciplineScore,
        overallScore: overall,
        level,
        comment: dto.comment,
      },
      include: { evaluator: { select: { id: true, displayName: true } } },
    });

    // 决策 #3：不自动停用。连续 D 级由 reviewRetirementCandidates()（cron + 人工）产出预警，
    // 实际退库须经 admin 调 confirmRetire() 确认。此处仅返回评价结果。
    return created;
  }

  async getEvaluationStats() {
    const [evaluations, scoreRecords] = await Promise.all([
      this.prisma.expertEvaluation.findMany({
        select: { level: true, overallScore: true, expertUserId: true, createdAt: true },
      }),
      this.prisma.bidScoreRecord.findMany({
        select: {
          score: true, scoreItemId: true, supplierId: true,
          expert: { select: { userId: true } },
        },
      }),
    ]);

    // 既有：等级分布 + 综合均分
    const levelCounts = { A: 0, B: 0, C: 0, D: 0 };
    for (const e of evaluations) levelCounts[e.level]++;
    const avgScore = evaluations.length > 0
      ? evaluations.reduce((s, e) => s + e.overallScore, 0) / evaluations.length
      : 0;

    // 评分偏离度（专家以 userId 归属，可跨项目/跨评价关联到履职等级）
    const deviations = computeExpertMeanDeviations(
      scoreRecords.map(r => ({
        expertId: r.expert.userId,
        scoreItemId: r.scoreItemId,
        supplierId: r.supplierId,
        score: Number(r.score),
      })),
    );
    const devMap = new Map(deviations.map(d => [d.expertId, d.meanDeviation]));
    const avgScoreDeviation = deviations.length > 0
      ? Math.round(deviations.reduce((s, d) => s + d.meanDeviation, 0) / deviations.length * 10) / 10
      : 0;

    // 关联分析：每位专家最新履职等级 → 按等级汇总其偏离度均分
    const latestLevel = new Map<string, string>();
    for (const e of [...evaluations].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      latestLevel.set(e.expertUserId, e.level); // 时间升序遍历，最终保留最新
    }
    const byLevel: Record<'A' | 'B' | 'C' | 'D', number[]> = { A: [], B: [], C: [], D: [] };
    for (const [expertId, level] of latestLevel) {
      const dev = devMap.get(expertId);
      if (dev != null && level in byLevel) byLevel[level as 'A' | 'B' | 'C' | 'D'].push(dev);
    }

    return {
      levelCounts,
      avgScore: Math.round(avgScore * 10) / 10,
      total: evaluations.length,
      avgScoreDeviation,
      deviationByLevel: {
        A: meanOrNull(byLevel.A),
        B: meanOrNull(byLevel.B),
        C: meanOrNull(byLevel.C),
        D: meanOrNull(byLevel.D),
      },
      expertsWithDeviation: deviations.length,
    };
  }

  /* ── 专家画像（Track D §3.4） ── */

  /** 单专家画像：参与/完成率/均分/偏离度/评价趋势/常委标记。 */
  async getExpertPortrait(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, displayName: true },
    });
    if (!user) throw new NotFoundException('专家不存在');

    const [assignments, scoreRecords, evals] = await Promise.all([
      this.prisma.bidExpert.findMany({
        where: { userId },
        select: { progress: true, totalScore: true },
      }),
      this.prisma.bidScoreRecord.findMany({
        where: { expert: { userId } },
        select: { score: true, scoreItemId: true, supplierId: true, expert: { select: { userId: true } } },
      }),
      this.prisma.expertEvaluation.findMany({
        where: { expertUserId: userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { level: true, overallScore: true, createdAt: true },
      }),
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
      recentEvals: evals,
    });
  }

  /* ── 退库预警 + 人工确认（决策 #3：只预警，不自动改状态） ── */

  /** 扫描退库候选（连续 D 级 或 近 12 个月无分配），通知管理员；不修改 availability。 */
  async reviewRetirementCandidates() {
    const experts = await this.prisma.user.findMany({
      where: { role: 'bid_expert', isActive: true, expertProfile: { availability: { not: '停用' } } },
      include: { expertProfile: { select: { specialty: true } } },
    });

    const cutoff = new Date(Date.now() - 365 * 24 * 3600 * 1000);
    const expertIds = experts.map(e => e.id);

    // P2: Batch queries instead of N+1 per-expert queries
    const [allEvals, allRecentAssigns] = await Promise.all([
      // All recent evaluations for all experts (up to 2 per expert)
      this.prisma.expertEvaluation.findMany({
        where: { expertUserId: { in: expertIds } },
        orderBy: { createdAt: 'desc' },
        select: { expertUserId: true, level: true, createdAt: true },
      }),
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
      if (arr.length < 2) arr.push({ level: ev.level });
    }
    // Index: userId → true if has recent assignment
    const hasRecentAssign = new Set(allRecentAssigns.map(a => a.userId));

    const candidates: Array<{ userId: string; displayName: string; specialty?: string; reason: string }> = [];

    for (const e of experts) {
      const recent = evalsByExpert.get(e.id) || [];
      let reason: string | null = null;
      if (shouldDeactivateExpert(recent)) {
        reason = '最近 2 次履职评价均为 D 级';
      } else if (!hasRecentAssign.has(e.id)) {
        reason = '近 12 个月无评标分配';
      }
      if (reason) {
        candidates.push({ userId: e.id, displayName: e.displayName, specialty: e.expertProfile?.specialty, reason });
      }
    }

    if (candidates.length > 0) {
      const names = candidates.map(c => `${c.displayName}（${c.reason}）`).join('；');
      const payload = {
        type: 'EXPERT_RETIRE_CANDIDATE',
        title: '专家退库预警',
        content: `${candidates.length} 名专家进入退库候选，请人工复核：${names}`,
        link: '/expert-admin',
      };
      await Promise.all([
        this.notification.sendToRole('admin', payload),
        this.notification.sendToRole('bid_host', payload),
      ]);
    }

    return candidates;
  }

  /** 人工确认退库：写入停用 + retiredAt + retireReason，同步禁用登录。 */
  async confirmRetire(userId: string, reason: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('专家不存在');
    await Promise.all([
      this.prisma.expertProfile.updateMany({
        where: { userId },
        data: { availability: '停用', retiredAt: new Date(), retireReason: reason },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { isActive: false },
      }),
    ]);
    return { success: true };
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
    return partial ? partial.specialty : (quotas[0]?.specialty || fitSpecialty);
  }

  private draw(group: any[], n: number, mode: 'weighted' | 'fair', scoreMap: Map<string, { matchScore: number }>) {
    if (mode === 'fair') return this.fairShuffle(group).slice(0, n);
    // 加权随机无放回
    const pool = group.map(c => ({ c, w: Math.max(1, scoreMap.get(c.id)?.matchScore ?? 50) }));
    const chosen: any[] = [];
    for (let i = 0; i < n && pool.length > 0; i++) {
      const total = pool.reduce((s, x) => s + x.w, 0);
      let r = (Math.random() * total) || 0;
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

  private ruleScore(c: { specialty: string; title?: string; pastProjects: number; pastAvgScore: number }): number {
    let s = 60;
    if (c.title?.includes('教授') || c.title?.includes('正高')) s += 12;
    else if (c.title?.includes('高工') || c.title?.includes('高级')) s += 8;
    s += Math.min(15, c.pastProjects * 3);
    s += Math.min(15, c.pastAvgScore * 0.15);
    return Math.max(0, Math.min(100, Math.round(s)));
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
