import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  /** 专家库列表（含 ExpertProfile，可按姓名或专业模糊搜索） */
  async listExperts(search?: string, specialty?: string) {
    const users = await this.prisma.user.findMany({
      where: {
        role: 'bid_expert',
        ...(search ? {
          OR: [
            { displayName: { contains: search, mode: 'insensitive' } },
            { expertProfile: { specialty: { contains: search, mode: 'insensitive' } } },
            { expertProfile: { employer: { contains: search, mode: 'insensitive' } } },
            { department: { name: { contains: search, mode: 'insensitive' } } },
          ],
        } : {}),
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

    // 补平均评价分
    const userIds = users.map(u => u.id);
    if (userIds.length > 0) {
      const evalAggs = await this.prisma.expertEvaluation.groupBy({
        by: ['expertUserId'],
        where: { expertUserId: { in: userIds } },
        _avg: { overallScore: true },
      });
      const avgMap = new Map(evalAggs.map(a => [a.expertUserId, Math.round((a._avg.overallScore ?? 0) * 10) / 10]));
      for (const u of users as any[]) {
        u.avgEvalScore = avgMap.get(u.id) ?? null;
      }
    }

    // 补最新一次评价
    const latestEvals = await this.prisma.expertEvaluation.findMany({
      where: { expertUserId: { in: userIds } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, expertUserId: true, overallScore: true, level: true, createdAt: true },
    });
    const latestMap = new Map<string, any>();
    for (const e of latestEvals) {
      if (!latestMap.has(e.expertUserId)) latestMap.set(e.expertUserId, e);
    }
    for (const u of users as any[]) {
      const le = latestMap.get(u.id);
      u.latestEval = le ? { level: le.level, overallScore: le.overallScore, createdAt: le.createdAt } : null;
    }

    return users;
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

  /** 从种子数据批量导入专家（仅导入尚未存在于数据库中的专家） */
  async importFromSeed() {
    const logger = new Logger(ExpertAdminService.name);
    const seedDir = join(__dirname, '..', '..', '..', 'prisma', 'seed-data');
    const expertHash = hashSync('expert@2026', 10);

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

      try {
        await this.prisma.user.create({
          data: {
            username: targetUsername,
            displayName: targetUsername,
            passwordHash: expertHash,
            role: 'bid_expert',
            isActive: true,
            expertProfile: {
              create: {
                specialty: profile?.specialty ?? '未分类',
                title: profile?.title ?? '',
                employer: profile?.employer ?? '',
                phone: profile?.phone ?? '',
                idNumber: profile?.idNumber ?? null,
                availability: '可用',
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

  /**
   * 预览抽取：AI 分析 + 合规过滤 + 模式驱动抽取（不落库）。
   * 三种模式：specialty_match（专业匹配）/ random（随机抽取）/ merit_best（综合择优）
   */
  async previewExtraction(projectId: string, dto: ExtractPreviewDto) {
    const totalNeeded = Math.min(Math.max(dto.totalNeeded ?? 5, 1), 9);
    const alternatives = Math.min(Math.max(dto.alternatives ?? 2, 0), 5);
    // 新 extractMode 优先，兼容旧 mode 参数（weighted→specialty_match, fair→random）
    const extractMode: 'specialty_match' | 'random' | 'merit_best' =
      dto.extractMode ?? (dto.mode === 'fair' ? 'random' : 'specialty_match');

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
      if (u.bidExperts.length > 0) return false;
      const emp = u.expertProfile?.employer?.trim();
      if (emp) {
        for (const sn of supplierNames) {
          if (sn && (emp.includes(sn) || sn.includes(emp))) return false;
        }
      }
      return true;
    });

    const eligibleIds = eligible.map(e => e.id);
    const twelveMonthsAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000);

    // 批量拉取多维度数据
    const [evalAgg, allEvals, allActiveAssigns, allRecentAssigns, scoreRecords] = await Promise.all([
      // 历史履职均分
      this.prisma.expertEvaluation.groupBy({
        by: ['expertUserId'],
        where: { expertUserId: { in: eligibleIds } },
        _avg: { overallScore: true },
      }),
      // 每位专家的最新履职评价（用于等级/出勤/质量/廉洁）
      this.prisma.expertEvaluation.findMany({
        where: { expertUserId: { in: eligibleIds } },
        orderBy: { createdAt: 'desc' },
        select: { expertUserId: true, level: true, attendanceScore: true, qualityScore: true, disciplineScore: true, overallScore: true, createdAt: true },
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

    const evalAvgMap = new Map(evalAgg.map(a => [a.expertUserId, a._avg.overallScore ?? 0]));

    // 最新评价 Map（按时间降序，取第一条）
    const latestEvalMap = new Map<string, { level: string; attendanceScore: number; qualityScore: number; disciplineScore: number; overallScore: number }>();
    for (const ev of allEvals) {
      if (!latestEvalMap.has(ev.expertUserId)) {
        latestEvalMap.set(ev.expertUserId, { level: ev.level, attendanceScore: ev.attendanceScore, qualityScore: ev.qualityScore, disciplineScore: ev.disciplineScore, overallScore: ev.overallScore });
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
        pastProjects: u._count.bidExperts,
        pastAvgScore: Math.round((evalAvgMap.get(u.id) ?? 0) * 10) / 10,
        evaluationLevel: latest?.level,
        attendanceScore: latest?.attendanceScore,
        qualityScore: latest?.qualityScore,
        disciplineScore: latest?.disciplineScore,
        scoreDeviation: deviationMap.get(u.id),
        recentProjects12m: recentMap.get(u.id) ?? 0,
        currentLoad: load,
        currentLoadStatus: load === 0 ? '空闲' : load <= 2 ? '正常' : '繁忙',
      };
    });

    // AI 分析（带模式指令）
    const llm = await this.extractionAi.analyzeAndScore(
      { name: project.name, procurementMethod: project.procurementMethod, scope: project.riskNote || project.name, budget: undefined },
      candidates,
      totalNeeded,
      extractMode,
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
      for (const c of candidates) {
        if (!scoreMap.has(c.id)) {
          scoreMap.set(c.id, {
            matchScore: extractMode === 'merit_best' ? this.extendedRuleScore(c) : this.ruleScore(c),
            fitSpecialty: c.specialty,
            reason: `专业「${c.specialty}」${c.title ? '、' + c.title : ''}，历史项目 ${c.pastProjects} 个。`,
          });
        }
      }
    } else {
      engine = 'rules';
      const modeLabel = extractMode === 'specialty_match' ? '专业匹配' : extractMode === 'random' ? '随机抽取' : '综合择优';
      analysis = `基于${modeLabel}规则评分（共 ${eligible.length} 名合规专家）。`;
      requiredSpecialties = dto.manualQuotas?.length
        ? dto.manualQuotas.map(q => ({ specialty: q.specialty, count: q.count, reason: q.reason ?? '' }))
        : this.ruleComposition(candidates, totalNeeded);
      for (const c of candidates) {
        const score = extractMode === 'merit_best' ? this.extendedRuleScore(c) : this.ruleScore(c);
        scoreMap.set(c.id, { matchScore: score, fitSpecialty: c.specialty, reason: `专业「${c.specialty}」${c.title ? '、' + c.title : ''}，历史项目 ${c.pastProjects} 个。` });
      }
    }

    // 归一化配额
    const quotas = this.normalizeQuotas(requiredSpecialties, totalNeeded);

    // 按专业分组
    const groups = new Map<string, typeof candidates>();
    for (const c of candidates) {
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
      const group = (groups.get(q.specialty) || []).filter(c => !usedIds.has(c.id));
      const fallback = candidates.filter(c => !usedIds.has(c.id));
      const pool = group.length > 0 ? group : fallback;
      if (group.length === 0) shortages.push({ specialty: q.specialty, needed: q.count, available: 0 });
      else if (group.length < q.count) shortages.push({ specialty: q.specialty, needed: q.count, available: group.length });

      const drawn = this.drawByMode(pool, Math.min(q.count, pool.length), extractMode, scoreMap);
      for (const c of drawn) { usedIds.add(c.id); selected.push(this.toSelection(c, q.specialty, '正选', scoreMap)); }
    }

    // 候补
    const remaining = candidates.filter(c => !usedIds.has(c.id)).sort((a, b) => (scoreMap.get(b.id)?.matchScore ?? 0) - (scoreMap.get(a.id)?.matchScore ?? 0));
    const altDrawn = extractMode === 'random'
      ? this.fairShuffle(remaining).slice(0, alternatives)
      : remaining.slice(0, alternatives);
    const alternativeList = altDrawn.map(c => this.toSelection(c, scoreMap.get(c.id)?.fitSpecialty || c.specialty, '候补', scoreMap));

    return {
      engine,
      model: engine === 'deepseek' ? process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash' : 'WaterERP Rules Engine',
      extractMode,
      analysis,
      requiredSpecialties: quotas,
      eligiblePool: eligible.length,
      candidatePool: candidates.map(c => ({
        userId: c.id,
        name: c.displayName,
        specialty: c.specialty,
        title: c.title,
        employer: c.employer,
        matchScore: scoreMap.get(c.id)?.matchScore ?? 0,
        evaluationLevel: c.evaluationLevel,
        currentLoadStatus: c.currentLoadStatus,
        reason: scoreMap.get(c.id)?.reason ?? '',
      })),
      selected,
      alternatives: alternativeList,
      shortages,
      generatedAt: new Date().toISOString(),
    };
  }

  /** 确认抽取：创建 BidExpert + 写入审计日志 */
  async confirmExtraction(projectId: string, dto: ConfirmExtractionDto, operatorId?: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      include: { suppliers: { include: { supplier: { select: { name: true } } } } },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (!dto.experts?.length) throw new BadRequestException({ error: '请选择专家', code: 'NO_EXPERTS' });

    // 资格复核：与 previewExtraction 同款合规过滤，防止 confirm 绕过 preview 的合规校验
    // （曾可分配非专家角色/停用/已分配本项目/与投标供应商关联的专家）
    const supplierNames = new Set(
      project.suppliers.map(s => s.supplier?.name || s.supplierName).filter(Boolean) as string[],
    );
    const users = await this.prisma.user.findMany({
      where: { id: { in: dto.experts.map(e => e.userId) } },
      include: { expertProfile: true, bidExperts: { where: { projectId }, select: { id: true } } },
    });
    for (const e of dto.experts) {
      const u = users.find(x => x.id === e.userId);
      if (!u) throw new BadRequestException({ error: `专家 ${e.expertName} 不存在`, code: 'EXPERT_NOT_FOUND' });
      if (u.role !== 'bid_expert' || !u.isActive || u.expertProfile?.availability !== '可用') {
        throw new BadRequestException({ error: `专家 ${e.expertName} 不符合抽取资格（须为在用评标专家）`, code: 'EXPERT_INELIGIBLE' });
      }
      if (u.bidExperts.length > 0) {
        throw new BadRequestException({ error: `专家 ${e.expertName} 已分配本项目`, code: 'EXPERT_ALREADY_ASSIGNED' });
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

    const [created] = await Promise.all([
      this.prisma.$transaction(
        dto.experts.map(e =>
          this.prisma.bidExpert.upsert({
            where: { projectId_userId: { projectId, userId: e.userId } },
            update: { expertName: e.expertName, major: e.major, isLead: e.isLead ?? false },
            create: { projectId, userId: e.userId, expertName: e.expertName, major: e.major, isLead: e.isLead ?? false },
          }),
        ),
      ),
      // 审计日志（不阻断主流程）
      this.prisma.auditLog.create({
        data: {
          userId: operatorId ?? 'system',
          action: 'EXPERT_EXTRACTION_CONFIRMED',
          resourceType: 'BidProject',
          resourceId: projectId,
          details: {
            projectName: project.name,
            expertCount: dto.experts.length,
            experts: dto.experts.map(e => ({ userId: e.userId, name: e.expertName, major: e.major })),
          },
        },
      }).catch((err) => {
        // 审计日志失败不阻断主流程，但必须留痕（专家抽取是采购法高风险环节，审计是唯一追溯凭证）
        new Logger(ExpertAdminService.name).error('专家抽取审计日志写入失败', err);
      }),
    ]);

    return { success: true, count: created.length, expertIds: dto.experts.map(e => e.userId) };
  }

  /** 抽取确认后发送通知（逐专家逐渠道投递） */
  async sendExtractionNotify(
    projectId: string,
    expertIds: string[],
    channels: string[],
    message: string,
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

    const results = await Promise.all(
      experts.map(expert =>
        this.notification.sendToUser(expert.id, channels, {
          type: 'EXPERT_ASSIGNED',
          title: `评审任务通知 - ${project.name}`,
          content: message || `您已被选为「${project.name}（${project.projectCode}）」评审专家，请登录专家门户查看详情。`,
          link: '/',
        }),
      ),
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
        take: 4,
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

  /** 三维评分分布（全局均分） */
  async getEvaluationDimensionStats() {
    const evals = await this.prisma.expertEvaluation.findMany({
      select: { attendanceScore: true, qualityScore: true, disciplineScore: true },
    });
    if (evals.length === 0) {
      return { attendanceAvg: 0, qualityAvg: 0, disciplineAvg: 0, total: 0 };
    }
    let attSum = 0, qualSum = 0, discSum = 0;
    for (const e of evals) { attSum += e.attendanceScore; qualSum += e.qualityScore; discSum += e.disciplineScore; }
    const n = evals.length;
    return {
      attendanceAvg: Math.round((attSum / n) * 10) / 10,
      qualityAvg: Math.round((qualSum / n) * 10) / 10,
      disciplineAvg: Math.round((discSum / n) * 10) / 10,
      total: n,
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

  /* ── 统计 / 排名 / 负荷 ── */

  /** 专家库整体态势统计（web 统计页） */
  async getStatistics() {
    const cutoff7d = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const cutoff30d = new Date(Date.now() - 30 * 24 * 3600 * 1000);

    const [totalExperts, availGroups, specGroups, titleGroups, evals, recentAssigns7d, recentExtractions30d] = await Promise.all([
      this.prisma.user.count({ where: { role: 'bid_expert' } }),
      this.prisma.expertProfile.groupBy({ by: ['availability'], where: { user: { role: 'bid_expert' } }, _count: true }),
      this.prisma.expertProfile.groupBy({
        by: ['specialty'], where: { user: { role: 'bid_expert', isActive: true } },
        _count: true, orderBy: { _count: { specialty: 'desc' } },
      }),
      this.prisma.expertProfile.groupBy({
        by: ['title'], where: { user: { role: 'bid_expert', isActive: true } },
        _count: true, orderBy: { _count: { title: 'desc' } },
      }),
      this.prisma.expertEvaluation.findMany({
        select: { level: true, overallScore: true, createdAt: true, expertUser: { select: { displayName: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.bidExpert.count({ where: { createdAt: { gte: cutoff7d } } }),
      this.prisma.auditLog.count({ where: { action: 'EXPERT_EXTRACTION_CONFIRMED', createdAt: { gte: cutoff30d } } }),
    ]);

    const amap: Record<string, number> = {};
    for (const g of availGroups) amap[g.availability] = g._count;

    const levelCounts = { A: 0, B: 0, C: 0, D: 0 };
    for (const e of evals) levelCounts[e.level] = (levelCounts[e.level] ?? 0) + 1;
    const evalTotal = evals.length;
    const avgScore = evalTotal > 0 ? Math.round(evals.reduce((s, e) => s + e.overallScore, 0) / evalTotal * 10) / 10 : 0;

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
      disabled: amap['停用'] ?? 0,
      specialtyDistribution: specGroups.map(g => ({ name: g.specialty, count: g._count })),
      titleDistribution: titleGroups.map(g => ({ name: g.title || '未填写', count: g._count })),
      evaluationStats: { levelCounts, avgScore, total: evalTotal },
      recentEvals: evals.slice(0, 8).map(e => ({
        expert: e.expertUser?.displayName ?? '—',
        level: e.level,
        score: e.overallScore,
        time: e.createdAt.toISOString(),
      })),
      recentAssigns7d,
      recentExtractions30d,
      monthlyEvalTrend: { labels, counts },
    };
  }

  /** 专家排名（按履职评价均分） */
  async getRanking(period: 'month' | 'quarter' | 'all' = 'month') {
    const cutoff = period === 'month'
      ? new Date(Date.now() - 30 * 24 * 3600 * 1000)
      : period === 'quarter'
        ? new Date(Date.now() - 90 * 24 * 3600 * 1000)
        : new Date(0);

    const evals = await this.prisma.expertEvaluation.findMany({
      where: { createdAt: { gte: cutoff } },
      select: {
        expertUserId: true, overallScore: true, level: true,
        expertUser: { select: { displayName: true, expertProfile: { select: { specialty: true } } } },
      },
    });

    const byExpert = new Map<string, { displayName: string; specialty: string; scores: number[]; evalCount: number; aCount: number }>();
    for (const e of evals) {
      let rec = byExpert.get(e.expertUserId);
      if (!rec) {
        rec = { displayName: e.expertUser?.displayName ?? '—', specialty: e.expertUser?.expertProfile?.specialty ?? '', scores: [], evalCount: 0, aCount: 0 };
        byExpert.set(e.expertUserId, rec);
      }
      rec.scores.push(e.overallScore);
      rec.evalCount++;
      if (e.level === 'A') rec.aCount++;
    }

    const rows = [...byExpert.values()].map(r => ({
      displayName: r.displayName,
      specialty: r.specialty,
      avgScore: r.scores.length > 0 ? Math.round(r.scores.reduce((s, x) => s + x, 0) / r.scores.length) : 0,
      evalCount: r.evalCount,
      aCount: r.aCount,
    }));
    rows.sort((a, b) => b.avgScore - a.avgScore || b.aCount - a.aCount || b.evalCount - a.evalCount);

    const expertUserIds = [...byExpert.keys()];
    return rows.map((r, i) => ({ expertUserId: expertUserIds[i], ...r, rank: i + 1 }));
  }

  /** 专家负荷分布（按活跃评审项目数） */
  async getLoadDistribution() {
    const [totalActiveExperts, activeAssigns] = await Promise.all([
      this.prisma.user.count({ where: { role: 'bid_expert', isActive: true } }),
      this.prisma.bidExpert.findMany({
        where: { project: { stage: { not: 'ARCHIVED' } }, user: { role: 'bid_expert', isActive: true } },
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

  /** 批量启用/停用专家 */
  async batchOperation(dto: { action: 'enable' | 'disable'; ids: string[]; reason?: string }) {
    if (!dto.ids?.length) throw new BadRequestException('未选择专家');
    const available = dto.action === 'enable';
    const result = await this.prisma.$transaction([
      this.prisma.user.updateMany({
        where: { id: { in: dto.ids }, role: 'bid_expert' },
        data: { isActive: available },
      }),
      this.prisma.expertProfile.updateMany({
        where: { userId: { in: dto.ids } },
        data: { availability: available ? '可用' : '停用' },
      }),
    ]);
    return { success: true, count: result[0].count };
  }

  /** 导出专家库（扁平结构，前端拼 CSV） */
  async exportExperts(ids?: string[]) {
    const users = await this.prisma.user.findMany({
      where: { role: 'bid_expert', ...(ids?.length && { id: { in: ids } }) },
      include: { expertProfile: true },
      orderBy: { displayName: 'asc' },
    });
    return users.map(u => ({
      姓名: u.displayName,
      登录账号: u.username,
      专业: u.expertProfile?.specialty ?? '',
      职称: u.expertProfile?.title ?? '',
      工作单位: u.expertProfile?.employer ?? '',
      手机号: u.expertProfile?.phone ?? '',
      身份证号: u.expertProfile?.idNumber ?? '',
      邮箱: u.email ?? '',
      状态: u.isActive ? '可用' : '已停用',
      入库时间: u.createdAt.toISOString().slice(0, 10),
    }));
  }

  /** CSV 批量导入（表头灵活匹配） */
  async importCsv(rows: Array<Record<string, string>>) {
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
          email: pick(row, ['邮箱', 'email', '电子邮箱']) || undefined,
          notes: pick(row, ['备注']) || undefined,
        });
        results.push({ 姓名: displayName, 状态: '成功' });
        imported++;
      } catch (e: any) {
        results.push({ 姓名: displayName, 状态: '失败', 原因: e?.message ?? '录入异常' });
        failed++;
      }
    }
    return { total: rows.length, imported, skipped, failed, results };
  }

  /* ── 违规记录（AuditLog）── */

  async getViolations(expertId?: string) {
    const where: any = { action: 'EXPERT_VIOLATION_RECORDED' };
    if (expertId) where.resourceId = expertId;
    return this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: { id: true, details: true, createdAt: true, user: { select: { displayName: true } } },
    });
  }

  async recordViolation(expertId: string, dto: { type: string; detail: string; severity: 'warning' | 'danger' }, operatorId: string) {
    const expert = await this.prisma.user.findFirst({ where: { id: expertId, role: 'bid_expert' } });
    if (!expert) throw new NotFoundException('专家不存在');
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

  /** 单个专家的履职评价记录 */
  async getExpertEvaluations(userId: string) {
    return this.prisma.expertEvaluation.findMany({
      where: { expertUserId: userId },
      include: { evaluator: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** AI 采纳率（基于 BidScoreDelta：专家分 vs AI 建议分） */
  async getAiAdoptionRate(expertId?: string) {
    // BidScoreDelta.expertId 指向 BidExpert.id，需映射到 userId 供前端按专家过滤
    const assignments = await this.prisma.bidExpert.findMany({
      where: expertId ? { userId: expertId } : undefined,
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
    };
  }

  /* ── 通知偏好（UserSettings.notificationPrefs）── */

  async getNotifyPrefs(userId: string) {
    const settings = await this.prisma.userSettings.findUnique({ where: { userId } });
    const prefs = (settings?.notificationPrefs as Record<string, boolean> | null) ?? {};
    return { inApp: prefs.inApp ?? true, sms: prefs.sms ?? false, phone: prefs.phone ?? false };
  }

  async updateNotifyPrefs(userId: string, dto: { inApp?: boolean; sms?: boolean; phone?: boolean }) {
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

  /** 模式驱动抽样 */
  private drawByMode(
    group: any[],
    n: number,
    mode: 'specialty_match' | 'random' | 'merit_best',
    scoreMap: Map<string, { matchScore: number }>,
  ) {
    if (n <= 0 || group.length === 0) return [];
    if (mode === 'random') return this.fairShuffle(group).slice(0, n);

    // merit_best: 按得分降序取 top-N（择优），高位者优先中选
    if (mode === 'merit_best') {
      return [...group].sort((a, b) => (scoreMap.get(b.id)?.matchScore ?? 0) - (scoreMap.get(a.id)?.matchScore ?? 0)).slice(0, n);
    }

    // specialty_match（默认）: 加权随机无放回
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

  private ruleScore(c: { specialty: string; title?: string; pastProjects: number; pastAvgScore: number }): number {
    let s = 60;
    if (c.title?.includes('教授') || c.title?.includes('正高')) s += 12;
    else if (c.title?.includes('高工') || c.title?.includes('高级')) s += 8;
    s += Math.min(15, c.pastProjects * 3);
    s += Math.min(15, c.pastAvgScore * 0.15);
    return Math.max(0, Math.min(100, Math.round(s)));
  }

  /** 综合择优规则评分（AI 降级时使用）：纳入履职评价/偏离度/负荷等多维度数据 */
  private extendedRuleScore(c: {
    specialty: string; title?: string; pastProjects: number; pastAvgScore: number;
    evaluationLevel?: string; attendanceScore?: number; qualityScore?: number;
    disciplineScore?: number; scoreDeviation?: number; currentLoad?: number; currentLoadStatus?: string;
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
    s += Math.min(10, c.pastAvgScore * 0.1);

    // 负荷均衡（10分）—— 空闲者加分
    if (c.currentLoadStatus === '空闲') s += 10;
    else if (c.currentLoadStatus === '正常') s += 5;
    // 繁忙不加分

    // 近期活跃（5分）—— 暂未实现该字段，跳过
    // if (c.recentProjects12m != null && c.recentProjects12m > 0) s += Math.min(5, c.recentProjects12m);

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
