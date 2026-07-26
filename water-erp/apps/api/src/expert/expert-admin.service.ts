import { Injectable, NotFoundException, BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashSync } from 'bcryptjs';
import { Prisma, ExpertLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from '../local-ai/embedding.service';
import { LlmService } from '../local-ai/llm.service';
import { OcrService } from '../local-ai/ocr.service';
import { ExpertExtractionAiService } from './expert-extraction-ai.service';
import type { LlmSpecialtyQuota, ExpertExtractionLlmResult, ExtractMode } from './expert-extraction-ai.service';
import type { CreateExpertDto } from './dto/create-expert.dto';
import type { ExtractPreviewDto } from './dto/extract-preview.dto';
import type { ConfirmExtractionDto } from './dto/confirm-extraction.dto';
import type { CreateExpertEvaluationDto } from './dto/create-expert-evaluation.dto';
import type { UpdateExpertProfileDto } from './dto/expert-admin-misc.dto';
import { computeExpertMeanDeviations, meanOrNull, shouldDeactivateExpert } from './expert-deviation';
import { buildExpertPortrait } from './expert-portrait.util';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class ExpertAdminService {
  constructor(
    private prisma: PrismaService,
    private extractionAi: ExpertExtractionAiService,
    private notification: NotificationService,
    private embedding: EmbeddingService,
    private llm: LlmService,
    private ocr: OcrService,
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
    if (!user || user.role !== 'bid_expert') throw new NotFoundException('专家不存在');

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
    try {
      return await this.prisma.$transaction(async (tx) => {
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
              ethnicity: dto.ethnicity,
              education: dto.education,
              licenseNo: dto.licenseNo,
              availability: '可用',
              notes: dto.notes,
            },
          },
        },
        include: { expertProfile: true },
      });
      // 剥离密码哈希，避免敏感字段外泄
      const { passwordHash, ...safeUser } = user;
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
    return { success: true };
  }

  /** 更新专家资料 */
  async updateProfile(userId: string, dto: UpdateExpertProfileDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    // 仅限专家角色，防止给非专家用户 upsert 出 ExpertProfile
    if (!user || user.role !== 'bid_expert') throw new NotFoundException('专家不存在');
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
          ...(dto.ethnicity !== undefined && { ethnicity: dto.ethnicity }),
          ...(dto.education !== undefined && { education: dto.education }),
          ...(dto.licenseNo !== undefined && { licenseNo: dto.licenseNo }),
          ...(dto.availability !== undefined && { availability: dto.availability }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
        },
        create: { userId, specialty: dto.specialty || '综合', title: dto.title, employer: dto.employer, phone: dto.phone, idNumber: dto.idNumber, ethnicity: dto.ethnicity, education: dto.education, licenseNo: dto.licenseNo, availability: dto.availability ?? '可用', notes: dto.notes },
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
    const excludedIds = new Set(dto.excludedUserIds ?? []);
    const eligible = experts.filter((u) => {
      if (excludedIds.has(u.id)) return false;
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
    if (eligible.length === 0) {
      // 结构化错误：前端按 code 给针对性提示，而非笼统"自动抽取失败"
      throw new BadRequestException({ error: '专家库暂无可用候选人，请先在专家管理维护可用专家', code: 'NO_ELIGIBLE_EXPERTS' });
    }
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
      );
      analysis = llm.analysis;
      requiredSpecialties = dto.manualQuotas?.length
        ? dto.manualQuotas.map(q => ({ specialty: q.specialty, count: q.count, reason: q.reason ?? '' }))
        : llm.requiredSpecialties;
      for (const s of llm.scoredExperts) scoreMap.set(s.id, { matchScore: s.matchScore, fitSpecialty: s.fitSpecialty, reason: s.reason });
    } catch (err) {
      // 规则降级：AI 不可用（缺 key / 超时 / 解析失败）时启用本地规则引擎兜底，保证抽取核心功能始终可用
      engine = 'rules';
      this.extractionAi.recordFallback();
      new Logger(ExpertAdminService.name).warn(`抽取 AI 不可用，已降级规则引擎: ${(err as Error)?.message ?? err}`);
      analysis = '（AI 分析暂不可用，已按候选库专业分布与履职数据由规则引擎自动组建专家组）';
      requiredSpecialties = dto.manualQuotas?.length
        ? dto.manualQuotas.map(q => ({ specialty: q.specialty, count: q.count, reason: q.reason ?? '' }))
        : this.ruleComposition(candidates, totalNeeded);
      for (const c of candidates) {
        scoreMap.set(c.id, {
          matchScore: this.extendedRuleScore(c),
          fitSpecialty: c.specialty,
          reason: `规则评分：专业「${c.specialty}」${c.title ? '、' + c.title : ''}，履职等级 ${c.evaluationLevel ?? '—'}，历史项目 ${c.pastProjects} 个。`,
        });
      }
    }

    for (const c of candidates) {
      if (!scoreMap.has(c.id)) {
        scoreMap.set(c.id, {
          matchScore: 50,
          fitSpecialty: c.specialty,
          reason: `专业「${c.specialty}」${c.title ? '、' + c.title : ''}，历史项目 ${c.pastProjects} 个。`,
        });
      }
    }

    // 白名单纠偏：把 AI 推荐的专业构成映射到专家库中真实有候选的专业，避免推荐无候选专业
    requiredSpecialties = this.reconcileSpecialties(requiredSpecialties, candidates);
    // 语义召回：项目需求 vs 专家专长向量相似度，对候选匹配分做微调（失败不阻断，优雅降级）
    await this.applySemanticBoost(scoreMap, candidates, scopeText, extractMode);

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

  /** 确认抽取：资格复核 + 创建 BidExpert + 写入审计日志，全部在同一事务内（消除复核-提交窗口的 TOCTOU）。 */
  async confirmExtraction(projectId: string, dto: ConfirmExtractionDto, operatorId?: string) {
    // 审计是采购法高风险环节的唯一追溯凭证：缺操作人即拒绝，绝不静默跳过审计后照常完成抽取
    if (!operatorId) throw new BadRequestException({ error: '缺少操作人，无法完成抽取留痕', code: 'NO_OPERATOR' });

    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      include: { suppliers: { include: { supplier: { select: { name: true } } } } },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (!dto.experts?.length) throw new BadRequestException({ error: '请选择专家', code: 'NO_EXPERTS' });

    // 供应商名集合（回避校验）
    const supplierNames = new Set(
      project.suppliers.map(s => s.supplier?.name || s.supplierName).filter(Boolean) as string[],
    );

    await this.prisma.$transaction(async (tx) => {
      // 资格复核放在事务内重查：与 previewExtraction 同款合规过滤，并杜绝复核后、提交前被并发停用/退库的专家混入
      const users = await tx.user.findMany({
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

      // 正选专家创建为 expertRole=正选
      for (const e of dto.experts) {
        await tx.bidExpert.upsert({
          where: { projectId_userId: { projectId, userId: e.userId } },
          update: { expertName: e.expertName, major: e.major, isLead: e.isLead ?? false, expertRole: '正选', invitationStatus: 'pending' },
          create: { projectId, userId: e.userId, expertName: e.expertName, major: e.major, isLead: e.isLead ?? false, expertRole: '正选', invitationStatus: 'pending' },
        });
      }
      // 候补专家创建为 expertRole=候补
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
            expertCount: dto.experts.length,
            experts: dto.experts.map(e => ({ userId: e.userId, name: e.expertName, major: e.major, isLead: e.isLead ?? false })),
          },
        },
      });
    });

    return { success: true, count: dto.experts.length + (dto.candidates?.length ?? 0), expertIds: dto.experts.map(e => e.userId) };
  }

  /** 查询项目专家邀请状态（正选+候补） */
  async getProjectInvitations(projectId: string) {
    const records = await this.prisma.bidExpert.findMany({
      where: { projectId },
      orderBy: [{ expertRole: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, userId: true, expertName: true, major: true,
        isLead: true, expertRole: true, invitationStatus: true,
      },
    });
    const confirmed = records.filter(r => r.invitationStatus === 'confirmed').length;
    const declined = records.filter(r => r.invitationStatus === 'declined').length;
    const pending = records.filter(r => r.invitationStatus === 'pending').length;
    const candidates = records.filter(r => r.expertRole === '候补' && r.invitationStatus === 'pending');
    return {
      experts: records,
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

  /** 自动递补：从待确认候补中按综合评分（extendedRuleScore）择优转正，而非简单按创建时间。
   *  递补发生在抽取之后，期间专家状态可能变化，故此处先做与 confirmExtraction 同标准的资格复核
   *  （剔除已停用/退库/供应商关联候补），再基于最新履职数据（含偏离度与当前负荷）重新评分。 */
  async autoPromoteCandidate(projectId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      include: { suppliers: { include: { supplier: { select: { name: true } } } } },
    });
    const supplierNames = new Set(
      (project?.suppliers ?? []).map(s => s.supplier?.name || s.supplierName).filter(Boolean) as string[],
    );

    const candidates = await this.prisma.bidExpert.findMany({
      where: { projectId, expertRole: '候补', invitationStatus: 'pending' },
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
    if (candidates.length === 0) return null;

    // 资格复核：与 confirmExtraction 同标准，避免把抽取后被停用/退库/关联供应商的候补提为正选
    const eligible = candidates.filter(c => {
      const u = c.user;
      if (!u.isActive || u.expertProfile?.availability !== '可用') return false;
      const emp = u.expertProfile?.employer?.trim();
      if (emp) {
        for (const sn of supplierNames) {
          if (sn && (emp.includes(sn) || sn.includes(emp))) return false;
        }
      }
      return true;
    });
    if (eligible.length === 0) return null;

    // 与抽取同口径补齐偏离度与历史均分（原实现缺这两维，择优比抽取时更粗糙）
    const userIds = eligible.map(c => c.userId);
    const [scoreRecords, evalAgg] = await Promise.all([
      this.prisma.bidScoreRecord.findMany({
        where: { expert: { userId: { in: userIds } } },
        select: { score: true, scoreItemId: true, supplierId: true, expert: { select: { userId: true } } },
      }),
      this.prisma.expertEvaluation.groupBy({
        by: ['expertUserId'],
        where: { expertUserId: { in: userIds } },
        _avg: { overallScore: true },
      }),
    ]);
    const deviations = computeExpertMeanDeviations(
      scoreRecords.map(r => ({ expertId: r.expert.userId, scoreItemId: r.scoreItemId, supplierId: r.supplierId, score: Number(r.score) })),
    );
    const devMap = new Map(deviations.map(d => [d.expertId, Math.round(d.meanDeviation * 10) / 10]));
    const avgMap = new Map(evalAgg.map(a => [a.expertUserId, a._avg.overallScore ?? 0]));

    const scored = eligible.map(c => {
      const latest = c.user.expertEvaluations[0];
      const load = c.user.bidExperts.length;
      return {
        c,
        score: this.extendedRuleScore({
          specialty: c.user.expertProfile?.specialty || '综合',
          title: c.user.expertProfile?.title ?? undefined,
          pastProjects: c.user._count.bidExperts,
          pastAvgScore: Math.round((avgMap.get(c.userId) ?? latest?.overallScore ?? 0) * 10) / 10,
          evaluationLevel: latest?.level,
          attendanceScore: latest?.attendanceScore,
          qualityScore: latest?.qualityScore,
          disciplineScore: latest?.disciplineScore,
          scoreDeviation: devMap.get(c.userId),
          currentLoad: load,
          currentLoadStatus: load === 0 ? '空闲' : load <= 2 ? '正常' : '繁忙',
        }),
      };
    });
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0].c;

    await this.prisma.bidExpert.update({
      where: { id: best.id },
      data: { expertRole: '正选' },
    });
    return { userId: best.userId, expertName: best.expertName, major: best.major };
  }

  /** 标记专家已拒绝参与评审，并自动递补候补 */
  async declineInvitation(projectId: string, userId: string) {
    const result = await this.prisma.bidExpert.updateMany({
      where: { projectId, userId, invitationStatus: 'pending' },
      data: { invitationStatus: 'declined' },
    });
    if (result.count === 0) throw new NotFoundException('未找到该项目的待确认邀请记录');

    // 检查是否是正选拒绝，如果是则自动递补候补
    const declinedExpert = await this.prisma.bidExpert.findFirst({
      where: { projectId, userId },
    });
    let promoted: { userId: string; expertName: string; major: string } | null = null;
    if (declinedExpert?.expertRole === '正选') {
      promoted = await this.autoPromoteCandidate(projectId);
    }

    return { success: true, status: 'declined', promoted };
  }
  async generateNotificationAi(params: {
    projectName: string; expertName: string; isLead: boolean;
    totalExperts: number; extractMode: string; openTime: string;
  }) {
    const text = await this.extractionAi.generateNotification(params);
    if (text) return { success: true, generated: true, content: text };
    return { success: true, generated: false, content: null };
  }

  /** 标记专家已确认参与评审（管理员手动确认或回调触发） */
  async confirmInvitation(projectId: string, userId: string) {
    const result = await this.prisma.bidExpert.updateMany({
      where: { projectId, userId, invitationStatus: 'pending' },
      data: { invitationStatus: 'confirmed' },
    });
    if (result.count === 0) throw new NotFoundException('未找到该项目的待确认邀请记录');
    return { success: true, status: 'confirmed' };
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

  /** AI 辅助评价建议：LLM 综合历史评价 / 评分偏离度 / 违规 / 当前负荷给出三维建议分数，
   *  LLM 不可用时走规则兜底（历史均分 ± 偏离度/违规罚分），engine 字段标识来源，前端据实展示。 */
  async aiSuggestEvaluation(expertUserId: string) {
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
        select: { attendanceScore: true, qualityScore: true, disciplineScore: true, overallScore: true, level: true },
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

    // 规则兜底：历史均分 ± 偏离度/违规罚分（LLM 不可用时使用）
    const ruleFallback = () => {
      const attAvg = evals.length > 0 ? Math.round(evals.reduce((s, e) => s + e.attendanceScore, 0) / evals.length) : 85;
      const qualAvg = evals.length > 0 ? Math.round(evals.reduce((s, e) => s + e.qualityScore, 0) / evals.length) : 85;
      const discAvg = evals.length > 0 ? Math.round(evals.reduce((s, e) => s + e.disciplineScore, 0) / evals.length) : 90;
      const penalty = (meanDeviation != null && Math.abs(meanDeviation) > 10 ? 4 : 0) + (violations.length > 0 ? 6 : 0);
      const clamp = (n: number) => Math.max(50, Math.min(100, n));
      return {
        attendanceScore: clamp(attAvg - penalty),
        qualityScore: clamp(qualAvg - penalty),
        disciplineScore: clamp(discAvg - penalty),
        analysis: `规则兜底建议：基于近 ${evals.length} 次评价均分（出勤 ${attAvg}/质量 ${qualAvg}/廉洁 ${discAvg}）${
          meanDeviation != null ? `、评分偏离度 ${meanDeviation}` : ''
        }${violations.length > 0 ? `、${violations.length} 条违规记录` : ''}综合得出。AI 暂不可用，建议人工复核后调整。`,
        engine: 'rules' as const,
      };
    };

    try {
      const recentLevels = evals.slice(0, 5).map(e => e.level).join('、') || '无';
      const recentAvg = evals.length > 0 ? Math.round(evals.reduce((s, e) => s + e.overallScore, 0) / evals.length) : null;
      const suggestion = await this.llm.chatJson<{
        attendanceScore: number; qualityScore: number; disciplineScore: number; analysis: string;
      }>(
        '你是评审专家履职评价助手。根据专家历史履职数据，给出本次评价的三维建议分数（0-100 整数）与简明分析（150字内，说明依据与关注点）。客观中立，分数须与历史表现匹配，不得无依据拔高或打压。',
        `专家：${user.displayName}（${user.expertProfile?.specialty ?? '专业未填写'} / ${user.expertProfile?.title ?? '职称未填写'}）。
近 ${evals.length} 次履职评价：等级序列 ${recentLevels}；综合均分 ${recentAvg ?? '无数据'}。
评分偏离度（与评审共识的偏差）：${meanDeviation ?? '无数据'}。
违规记录：${violations.length} 条。
当前负荷：${activeAssigns.length} 个未归档项目。
请综合以上数据给出建议分数与分析，以 JSON 返回：{"attendanceScore":number,"qualityScore":number,"disciplineScore":number,"analysis":"string"}`,
        0.3,
      );
      if (!suggestion) return ruleFallback();
      const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
      return {
        attendanceScore: clamp(suggestion.attendanceScore),
        qualityScore: clamp(suggestion.qualityScore),
        disciplineScore: clamp(suggestion.disciplineScore),
        analysis: (suggestion.analysis ?? '').slice(0, 300),
        engine: 'ai' as const,
      };
    } catch (err) {
      new Logger(ExpertAdminService.name).warn(`评价 AI 建议降级（LLM 不可用），返回规则兜底: ${(err as Error)?.message ?? err}`);
      return ruleFallback();
    }
  }

  async createEvaluation(evaluatorId: string, dto: CreateExpertEvaluationDto) {
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

    const overall = Math.round((dto.attendanceScore + dto.qualityScore + dto.disciplineScore) / 3);
    const level: ExpertLevel = overall >= 90 ? 'A' : overall >= 80 ? 'B' : overall >= 60 ? 'C' : 'D';

    const data = {
      attendanceScore: dto.attendanceScore,
      qualityScore: dto.qualityScore,
      disciplineScore: dto.disciplineScore,
      overallScore: overall,
      level,
      comment: dto.comment,
    };

    // 去重/防刷（P2 幂等）：同一评价者对同一专家在同一项目仅保留一条评价（可改不可刷）。
    // 否则可对目标专家无限刷 D 级评价，配合退库预警造成错误退库。
    // （DB 唯一约束与种子数据冲突，故用服务层 find-then-upsert）
    const existing = await this.prisma.expertEvaluation.findFirst({
      where: { expertUserId: dto.expertUserId, evaluatorId, projectId: dto.projectId ?? null },
    });
    if (existing) {
      return this.prisma.expertEvaluation.update({
        where: { id: existing.id },
        data,
        include: { evaluator: { select: { id: true, displayName: true } } },
      });
    }

    const created = await this.prisma.expertEvaluation.create({
      data: { expertUserId: dto.expertUserId, projectId: dto.projectId ?? null, evaluatorId, ...data },
      include: { evaluator: { select: { id: true, displayName: true } } },
    });

    // 决策 #3：不自动停用。连续 D 级由 reviewRetirementCandidates()（cron + 人工）产出预警，
    // 实际退库须经 admin 调 confirmRetire() 确认。此处仅返回评价结果。
    return created;
  }

  async getEvaluationStats() {
    const [evaluations, deviations] = await Promise.all([
      this.prisma.expertEvaluation.findMany({
        select: { level: true, overallScore: true, expertUserId: true, createdAt: true },
      }),
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

    // 既有：等级分布 + 综合均分
    const levelCounts = { A: 0, B: 0, C: 0, D: 0 };
    for (const e of evaluations) levelCounts[e.level]++;
    const avgScore = evaluations.length > 0
      ? evaluations.reduce((s, e) => s + e.overallScore, 0) / evaluations.length
      : 0;

    // 评分偏离度（已由 DB 窗口函数计算，仅取回按专家聚合的结果）
    const devMap = new Map(deviations.map(d => [d.expertId, Number(d.meanDeviation)]));
    const avgScoreDeviation = deviations.length > 0
      ? Math.round(deviations.reduce((s, d) => s + Number(d.meanDeviation), 0) / deviations.length * 10) / 10
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

  /** 人工确认退库：写入停用 + retiredAt + retireReason，同步禁用登录（同一事务，避免半退库态）。 */
  async confirmRetire(userId: string, reason: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    // 仅限专家角色，防止越权停用任意账户
    if (!user || user.role !== 'bid_expert') throw new NotFoundException('专家不存在');
    await this.prisma.$transaction([
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

    const rows = [...byExpert.entries()].map(([expertUserId, r]) => ({
      expertUserId,
      displayName: r.displayName,
      specialty: r.specialty,
      avgScore: r.scores.length > 0 ? Math.round(r.scores.reduce((s, x) => s + x, 0) / r.scores.length) : 0,
      evalCount: r.evalCount,
      aCount: r.aCount,
    }));
    rows.sort((a, b) => b.avgScore - a.avgScore || b.aCount - a.aCount || b.evalCount - a.evalCount);

    // 竞赛排名：完全并列（均分/A级数/评价数相同）共享同一名次（1,2,2,4），避免并列项名次随机
    let lastRank = 0;
    let lastKey = '';
    return rows.map((r, i) => {
      const key = `${r.avgScore}|${r.aCount}|${r.evalCount}`;
      if (key !== lastKey) { lastRank = i + 1; lastKey = key; }
      return { ...r, rank: lastRank };
    });
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
          ethnicity: pick(row, ['民族']) || undefined,
          education: pick(row, ['学历']) || undefined,
          licenseNo: pick(row, ['证书编号', '证书号', '资格证']) || undefined,
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
      // 可观测：LLM 调用/错误/降级计数与最近耗时（供前端评估 AI 健康度）
      llm: this.extractionAi.getMetrics(),
    };
  }

  /* ── AI 深化能力（OCR 录入 / 风险预警 / 抽取复盘，均带规则兜底降级）── */

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

  /** 评标风险预警：融合评分偏离度 + 履职评价 + 违规记录，生成专家级风险简报（规则简报为底，LLM 增强）。 */
  async getRiskBrief(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { expertProfile: true } });
    if (!user || user.role !== 'bid_expert') throw new NotFoundException('专家不存在');

    const [scoreRecords, evals, violations] = await Promise.all([
      this.prisma.bidScoreRecord.findMany({ where: { expert: { userId } }, select: { score: true, scoreItemId: true, supplierId: true } }),
      this.prisma.expertEvaluation.findMany({ where: { expertUserId: userId }, orderBy: { createdAt: 'desc' }, take: 10, select: { level: true, overallScore: true } }),
      this.prisma.auditLog.findMany({ where: { action: 'EXPERT_VIOLATION_RECORDED', resourceId: userId }, select: { id: true } }),
    ]);

    const deviations = computeExpertMeanDeviations(
      scoreRecords.map(r => ({ expertId: userId, scoreItemId: r.scoreItemId, supplierId: r.supplierId, score: Number(r.score) })),
    );
    const meanDeviation = deviations.length > 0 ? Math.round(deviations[0].meanDeviation * 10) / 10 : null;
    const recentDCount = evals.filter(e => e.level === 'D').length;
    const signals = {
      meanDeviation,
      deviationRisk: meanDeviation != null && Math.abs(meanDeviation) > 10 ? 'high' : meanDeviation != null && Math.abs(meanDeviation) > 6 ? 'medium' : 'low',
      recentDCount,
      violationCount: violations.length,
      recentEvalAvg: evals.length > 0 ? Math.round(evals.reduce((s, e) => s + e.overallScore, 0) / evals.length) : null,
    };
    const ruleBrief = this.buildRuleRiskBrief(signals, user.displayName);

    let aiBrief: string | null = null;
    try {
      aiBrief = await this.llm.chat(
        '你是评标监督风险分析助手。根据专家履职数据给出简明中文风险简报（150字内），点明风险与处置建议，客观中立，不加格式符号。',
        `专家：${user.displayName}。评分偏离度 ${signals.meanDeviation ?? '无数据'}（风险等级 ${signals.deviationRisk}）；近 ${evals.length} 次履职评价中 D 级 ${recentDCount} 次；违规记录 ${signals.violationCount} 条；近期评价均分 ${signals.recentEvalAvg ?? '无数据'}。`,
        0.3,
      );
    } catch (err) {
      // 记录日志，避免 AI 失效时永久静默走规则而无人知晓
      new Logger(ExpertAdminService.name).warn(`风险简报 AI 增强降级（LLM 不可用），返回规则简报: ${(err as Error)?.message ?? err}`);
      aiBrief = null;
    }
    return { expertId: userId, displayName: user.displayName, signals, ruleBrief, aiBrief };
  }

  private buildRuleRiskBrief(s: { meanDeviation: number | null; deviationRisk: string; recentDCount: number; violationCount: number; recentEvalAvg: number | null }, name: string): string {
    const parts: string[] = [];
    if (s.deviationRisk === 'high') parts.push(`评分偏离较大（${s.meanDeviation}），与评审共识存在偏差，建议重点关注或调整`);
    else if (s.deviationRisk === 'medium') parts.push(`评分偏离略大（${s.meanDeviation}），建议关注`);
    else parts.push(`评分偏离正常（${s.meanDeviation ?? '暂无数据'}）`);
    if (s.recentDCount > 0) parts.push(`近期出现 ${s.recentDCount} 次 D 级履职评价，建议按退库规则研判`);
    if (s.violationCount > 0) parts.push(`累计 ${s.violationCount} 条违规记录`);
    if (s.recentEvalAvg != null) parts.push(`近期评价均分 ${s.recentEvalAvg}`);
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
        user: { select: { expertEvaluations: { orderBy: { createdAt: 'desc' }, take: 1, select: { level: true, overallScore: true } } } },
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
      progress: e.progress ?? 0, status: e.invitationStatus, latestEvalLevel: e.user?.expertEvaluations[0]?.level ?? null,
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

  async getNotifyPrefs(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user || user.role !== 'bid_expert') throw new NotFoundException('专家不存在');
    const settings = await this.prisma.userSettings.findUnique({ where: { userId } });
    const prefs = (settings?.notificationPrefs as Record<string, boolean> | null) ?? {};
    return { inApp: prefs.inApp ?? true, sms: prefs.sms ?? false, phone: prefs.phone ?? false };
  }

  async updateNotifyPrefs(userId: string, dto: { inApp?: boolean; sms?: boolean; phone?: boolean }) {
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
    let dropped = 0;
    const droppedNames: string[] = [];
    for (const q of quotas) {
      const name = (q.specialty || '').trim();
      if (!name) { dropped += q.count; continue; }
      const nq = this.normalizeSpecialty(name);
      const hit = normAvailable.find(a => a.norm === nq) ?? normAvailable.find(a => a.norm.includes(nq) || nq.includes(a.norm));
      if (!hit) { dropped += q.count; droppedNames.push(name); continue; }
      const ex = merged.get(hit.raw);
      if (ex) ex.count += q.count;
      else merged.set(hit.raw, { ...q, specialty: hit.raw });
    }
    if (droppedNames.length > 0) {
      new Logger(ExpertAdminService.name).warn(`专业纠偏：以下推荐专业在候选库无匹配，配额已并入其它专业：${droppedNames.join('、')}`);
    }
    const list = [...merged.values()];
    if (dropped > 0 && list.length > 0) list[0].count += dropped;
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
      new Logger(ExpertAdminService.name).warn(`语义召回降级（embedding 不可用）: ${(err as Error)?.message ?? err}`);
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
