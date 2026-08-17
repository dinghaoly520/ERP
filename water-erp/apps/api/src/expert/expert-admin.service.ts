import { Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomInt, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashSync } from 'bcryptjs';
import { Prisma, ExpertLevel } from '@prisma/client';
import { portalOrigin } from '@water-erp/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from '../local-ai/embedding.service';
import { LlmService } from '../local-ai/llm.service';
import { OcrService } from '../local-ai/ocr.service';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';
import { processFile } from '../ai-bid-analysis/utils/file-processor';
import { ExpertExtractionAiService, rsvpTtlHours } from './expert-extraction-ai.service';
import { ExpertCrossConflictService } from './expert-cross-conflict.service';
import type { LlmSpecialtyQuota, ExpertExtractionLlmResult, ExtractMode } from './expert-extraction-ai.service';
import type { CreateExpertDto } from './dto/create-expert.dto';
import type { ExtractPreviewDto } from './dto/extract-preview.dto';
import type { ConfirmExtractionDto } from './dto/confirm-extraction.dto';
import type { CreateExpertEvaluationDto } from './dto/create-expert-evaluation.dto';
import type { UpdateExpertProfileDto } from './dto/expert-admin-misc.dto';
import { computeExpertMeanDeviations, meanOrNull, shouldDeactivateExpert } from '../common/scoring/expert-deviation';
import { buildExpertPortrait } from './expert-portrait.util';
import { NotificationService } from '../notification/notification.service';

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

@Injectable()
export class ExpertAdminService {
  // N6 收尾：TTL 真单源——毫秒值复用 rsvpTtlHours()（含 "abc"/"0" 等非法值回退 2），
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
  ) {}

  /* ── 专家库 ── */

  /** 专家库列表（含 ExpertProfile，可按姓名或专业模糊搜索，服务端分页） */
  async listExperts(search?: string, specialty?: string, page = 1, pageSize = 20) {
    const where = {
      role: 'bid_expert' as const,
      ...(search ? {
        OR: [
          { displayName: { contains: search, mode: 'insensitive' as const } },
          { expertProfile: { specialty: { contains: search, mode: 'insensitive' as const } } },
          { expertProfile: { employer: { contains: search, mode: 'insensitive' as const } } },
          { department: { name: { contains: search, mode: 'insensitive' as const } } },
        ],
      } : {}),
      ...(specialty && { expertProfile: { specialty } }),
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

    // 补最新一次评价（A-E 等级制）
    const userIds = users.map(u => u.id);
    const latestEvals = await this.prisma.expertEvaluation.findMany({
      where: { expertUserId: { in: userIds } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, expertUserId: true, overallGrade: true, createdAt: true },
    });
    const latestMap = new Map<string, any>();
    for (const e of latestEvals) {
      if (!latestMap.has(e.expertUserId)) latestMap.set(e.expertUserId, e);
    }
    for (const u of users as any[]) {
      const le = latestMap.get(u.id);
      u.latestEval = le ? { level: le.overallGrade, createdAt: le.createdAt } : null;
    }

    // 补平均等级（最常见等级，众数）
    const allEvals = await this.prisma.expertEvaluation.findMany({
      where: { expertUserId: { in: userIds } },
      select: { expertUserId: true, overallGrade: true },
    });
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

    return { total, page, pageSize, items: users };
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
    const gradeCounts = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    for (const e of evaluations) gradeCounts[e.overallGrade] = (gradeCounts[e.overallGrade] ?? 0) + 1;

    return { ...user, assignments, evaluations, statistics: { totalProjects, completedProjects, signedInProjects, evalCount: evaluations.length, gradeCounts } };
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
      return await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: dto.username,
          displayName: normalizedName,
          email: dto.email,
          passwordHash: hashSync(dto.password, 10),
          role: 'bid_expert',
          isActive: true,
          departmentId,
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
        include: { expertProfile: true, department: { select: { id: true, name: true } } },
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
    if (!user || user.role !== 'bid_expert') throw new NotFoundException('专家不存在');

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
          ...(dto.email !== undefined && { email: dto.email }),
          ...(departmentId !== undefined && { departmentId }),
        },
      }),
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
    const alternatives = Math.min(Math.max(dto.alternatives ?? 2, 0), 9);
    const extractMode: 'specialty_match' | 'random' | 'merit_best' =
      dto.extractMode ?? (dto.mode === 'fair' ? 'random' : 'specialty_match');

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

    // 合规候选：bid_expert + 可用 + 未分配本项目 + 工作单位不在参与供应商中
    // 重新抽取时不排除本项目已分配的专家（确认时会先清空旧记录），只排除其他项目的占用
    const experts = await this.prisma.user.findMany({
      where: { role: 'bid_expert', isActive: true, expertProfile: { availability: '可用' } },
      include: {
        expertProfile: true,
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
        ? dto.manualQuotas.map(q => ({ specialty: q.specialty, count: q.count, reason: q.reason ?? '', employer: q.employer }))
        : llm.requiredSpecialties;
      for (const s of llm.scoredExperts) scoreMap.set(s.id, { matchScore: s.matchScore, fitSpecialty: s.fitSpecialty, reason: s.reason });
    } catch (err) {
      // 规则降级：AI 不可用时如实告知原因，用规则引擎兜底
      engine = 'rules';
      this.extractionAi.recordFallback();
      const errMsg = (err as Error)?.message ?? String(err);
      new Logger(ExpertAdminService.name).warn(`抽取 AI 降级规则引擎: ${errMsg}`);
      requiredSpecialties = dto.manualQuotas?.length
        ? dto.manualQuotas.map(q => ({ specialty: q.specialty, count: q.count, reason: q.reason ?? '', employer: q.employer }))
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
      const pool = drawPool.filter(c => {
        if (usedIds.has(c.id)) return false;
        const ce = (c.employer || '').trim();
        if (!ce || !(ce === emp || ce.includes(emp) || emp.includes(ce))) return false;
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
      include: { suppliers: { include: { supplier: { select: { name: true } } } } },
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
        if (u.role !== 'bid_expert' || !u.isActive || u.expertProfile?.availability !== '可用') {
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
          },
        },
      });
    });

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
          const warnLogger = new Logger(ExpertAdminService.name);
          warnLogger.warn(`[CrossConflict] 项目 ${projectId} 发现 ${crossConflicts.length} 条专家交叉冲突`);
        }
      } catch (e) {
        const errLogger = new Logger(ExpertAdminService.name);
        errLogger.error('交叉回避检查失败（不阻塞抽取）', e instanceof Error ? e.message : String(e));
      }
    }

    return { success: true, count: (dto.experts?.length ?? 0) + (dto.candidates?.length ?? 0), expertIds: (dto.experts ?? []).map(e => e.userId) };
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
      const raw = await this.llm.chat(system, userPrompt, 0.2, undefined, undefined, { timeoutMs: 15_000, retries: 1 });
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

  /** 查询项目专家邀请状态（正选+候补） */
  async getProjectInvitations(projectId: string) {
    // 先清理超时未回复的 pending 邀请——与 RSVP verify 行为一致（TTL 过期自动弃权并递补）
    const expiredPending = await this.prisma.bidExpert.findMany({
      where: { projectId, invitationStatus: 'pending', rsvpExpiresAt: { lt: new Date() } },
      select: { id: true, expertRole: true },
    });
    if (expiredPending.length > 0) {
      await this.prisma.bidExpert.updateMany({
        where: { id: { in: expiredPending.map(e => e.id) } },
        data: { invitationStatus: 'declined', rsvpRespondedAt: new Date() },
      });
      // 仅正选过期才递补（候补过期不占正选席位）；失败静默，不阻塞列表返回
      if (expiredPending.some(e => e.expertRole === '正选')) {
        await this.autoPromoteCandidate(projectId).catch(() => null); // 与 RSVP 链接婉拒路径同款递补
      }
    }

    const records = await this.prisma.bidExpert.findMany({
      where: { projectId },
      orderBy: [{ expertRole: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true, userId: true, expertName: true, major: true,
        isLead: true, expertRole: true, invitationStatus: true,
        rsvpToken: true, rsvpRespondedAt: true, rsvpExpiresAt: true,
        user: { select: { expertProfile: { select: { title: true, employer: true } } } },
      },
    });
    const confirmed = records.filter(r => r.invitationStatus === 'confirmed').length;
    const declined = records.filter(r => r.invitationStatus === 'declined').length;
    const pending = records.filter(r => r.invitationStatus === 'pending').length;
    const candidates = records.filter(r => r.expertRole === '候补' && r.invitationStatus === 'pending');
    return {
      experts: records.map(r => ({ ...r, title: r.user?.expertProfile?.title ?? null, employer: r.user?.expertProfile?.employer ?? null, rsvpNo: r.id.slice(-8).toUpperCase() })),
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
    // P1-5：回避口径与 preview/confirm 同步——已投递 ∪ 开标后终局态（旧 CONFIRMED 口径开标前恒空集）
    const supplierNames = new Set(
      (project?.suppliers ?? [])
        .filter(s => s.submitStatus === '已提交' || s.confirmStatus === 'CONFIRMED' || s.confirmStatus === 'EXCEPTION')
        .map(s => s.supplier?.name || s.supplierName)
        .filter(Boolean) as string[],
    );

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
        score: this.extendedRuleScore({
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
    const best = scored[0].c;

    await this.prisma.bidExpert.update({
      where: { id: best.id },
      data: { expertRole: '正选' },
    });
    return { userId: best.userId, expertName: best.expertName, major: best.major };
  }

  /** 邀请操作阶段门控：已归档/已废标项目禁止确认/拒绝（防脏数据 + 误递补） */
  private async assertInvitationActionable(projectId: string) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { stage: true } });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.stage === 'ARCHIVED' || project.stage === 'ABORTED') {
      throw new ConflictException({ error: '项目已结束，无法操作邀请', code: 'PROJECT_CLOSED' });
    }
  }

  /** 标记专家已拒绝参与评审，并自动递补候补（幂等 + 阶段门控） */
  async declineInvitation(projectId: string, userId: string) {
    await this.assertInvitationActionable(projectId);
    const record = await this.prisma.bidExpert.findFirst({ where: { projectId, userId } });
    if (!record) throw new NotFoundException('未找到该项目的邀请记录');
    if (record.invitationStatus === 'declined') return { success: true, status: 'declined', promoted: null }; // 幂等：重复婉拒直接成功
    if (record.invitationStatus === 'confirmed') {
      throw new ConflictException({ error: '您已确认参加，如需变更请联系采购方', code: 'ALREADY_CONFIRMED' });
    }
    await this.prisma.bidExpert.update({ where: { id: record.id }, data: { invitationStatus: 'declined' } });
    // 婉拒 → 自动递补候补（与 RSVP 链接路径一致）；仅正选婉拒才递补——候补婉拒不产生正选空缺，
    // 无条件递补会把另一候补超编转正并徒耗候补席位（D7 审查）；递补失败静默，不影响婉拒结果
    const promoted = record.expertRole === '正选'
      ? await this.autoPromoteCandidate(projectId).catch(() => null)
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

  /** 标记专家已确认参与评审（管理员手动确认或专家点链接自助确认；幂等 + 阶段门控） */
  async confirmInvitation(projectId: string, userId: string) {
    await this.assertInvitationActionable(projectId);
    const record = await this.prisma.bidExpert.findFirst({ where: { projectId, userId } });
    if (!record) throw new NotFoundException('未找到该项目的邀请记录');
    if (record.invitationStatus === 'confirmed') return { success: true, status: 'confirmed' }; // 幂等：重复确认直接成功
    if (record.invitationStatus === 'declined') {
      throw new ConflictException({ error: '您已婉拒该邀请，如需参加请联系采购方', code: 'ALREADY_DECLINED' });
    }
    await this.prisma.bidExpert.update({ where: { id: record.id }, data: { invitationStatus: 'confirmed' } });
    return { success: true, status: 'confirmed' };
  }

  /** P0-4: 撤销专家报告确认 — 允许专家在确认后修改评分并重新确认 */
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

    // P0-4/R2: 事务内重读 stage + leaderCoSigned，消除与 archiveAll / leaderCoSign 的 TOCTOU
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
  async prersvpLinks(projectId: string) {
    const expertPortalUrl = portalOrigin('expert', process.env.EXPERT_PORTAL_URL);
    const now = new Date();
    const bes = await this.prisma.bidExpert.findMany({
      where: { projectId },
      select: { id: true, userId: true, rsvpToken: true, rsvpExpiresAt: true },
    });
    const links: Record<string, string> = {};
    for (const be of bes) {
      // 已有未过期 token → 直接复用，避免覆盖已分享给专家的有效链接
      if (be.rsvpToken && be.rsvpExpiresAt && new Date(be.rsvpExpiresAt) > now) {
        links[be.userId] = `${expertPortalUrl}/rsvp?t=${be.rsvpToken}`;
        continue;
      }
      const token = randomBytes(9).toString('base64url').slice(0, 12);
      await this.prisma.bidExpert.update({
        where: { id: be.id },
        data: { rsvpToken: token, rsvpExpiresAt: new Date(now.getTime() + this.rsvpTtlMs) },
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

    const expertPortalUrl = portalOrigin('expert', process.env.EXPERT_PORTAL_URL);
    const body = message || `您已被选为「${project.name}（${project.projectCode}）」评审专家。`;
    const expiresAt = new Date(Date.now() + this.rsvpTtlMs);

    // 发送时刷新 RSVP 过期时间（token 已在预生成时创建，这里不重新生成）
    const results = await Promise.all(
      experts.map(async expert => {
        const be = await this.prisma.bidExpert.findFirst({
          where: { projectId, userId: expert.id },
          select: { id: true, rsvpToken: true },
        });
        let rsvpLink = `${expertPortalUrl}/invitation/${projectId}`;
        if (be?.rsvpToken) {
          // 刷新过期时间（从发送时刻重新计时 RSVP TTL——EXPERT_RSVP_TTL_HOURS 小时，默认 2）
          await this.prisma.bidExpert.update({
            where: { id: be.id },
            data: { rsvpExpiresAt: expiresAt },
          });
          rsvpLink = `${expertPortalUrl}/rsvp?t=${be.rsvpToken}`;
        }
        // 替换模板中的 {RSVP_LINK} 占位符；无占位符时追加链接
        const contentWithLink = body.includes('{RSVP_LINK}')
          ? body.replace(/\{RSVP_LINK\}/g, rsvpLink)
          : `${body}\n确认链接（${rsvpTtlHours()}小时内有效）：${rsvpLink}`;
        return this.notification.sendToUser(expert.id, channels, {
          type: 'EXPERT_ASSIGNED',
          title: `评审任务通知 - ${project.name}`,
          content: contentWithLink,
          link: rsvpLink,
        });
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
        select: { overallGrade: true, expertUserId: true, createdAt: true },
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
        analysis: `规则兜底建议：基于近 ${evals.length} 次评价最高频等级${
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

    // 决策 #3：不自动停用。连续 E 级由 reviewRetirementCandidates()（cron + 人工）产出预警，
    // 实际退库须经 admin 调 confirmRetire() 确认。此处仅返回评价结果。
    return created;
  }

  async getEvaluationStats() {
    const [evaluations, deviations] = await Promise.all([
      this.prisma.expertEvaluation.findMany({
        select: { overallGrade: true, expertUserId: true, createdAt: true },
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

    // 既有：等级分布 + 优良率
    const levelCounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    for (const e of evaluations) levelCounts[e.overallGrade] = (levelCounts[e.overallGrade] ?? 0) + 1;
    const excellentRatio = evaluations.length > 0
      ? Math.round(((levelCounts['A'] + levelCounts['B']) / evaluations.length) * 1000) / 10
      : 0;

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

  /** 三维等级分布 */
  async getEvaluationDimensionStats() {
    const evals = await this.prisma.expertEvaluation.findMany({
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
        select: { overallGrade: true, createdAt: true },
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
      recentEvals: evals.map(e => ({ level: e.overallGrade, overallGrade: e.overallGrade, createdAt: e.createdAt })),
    });
  }

  /* ── 退库预警 + 人工确认（决策 #3：只预警，不自动改状态） ── */

  /** 扫描退库候选（连续 E 级 或 近 12 个月无分配），跳过最近 90 天内被标记忽略的专家；不修改 availability。 */
  async reviewRetirementCandidates() {
    const ignoreCutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000);
    const experts = await this.prisma.user.findMany({
      where: {
        role: 'bid_expert', isActive: true,
        expertProfile: {
          availability: { not: '停用' },
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

    // P2: Batch queries instead of N+1 per-expert queries
    const [allEvals, allRecentAssigns] = await Promise.all([
      // All recent evaluations for all experts (up to 2 per expert)
      this.prisma.expertEvaluation.findMany({
        where: { expertUserId: { in: expertIds } },
        orderBy: { createdAt: 'desc' },
        select: { expertUserId: true, overallGrade: true, createdAt: true },
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

  /** 忽略本轮退库预警：标记 retireIgnoredAt，90 天内 reviewRetirementCandidates 跳过此专家 */
  async ignoreRetirementWarning(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'bid_expert') throw new NotFoundException('专家不存在');
    await this.prisma.expertProfile.update({ where: { userId }, data: { retireIgnoredAt: new Date() } });
    return { success: true };
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
        select: { overallGrade: true, createdAt: true, expertUser: { select: { displayName: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.bidExpert.count({ where: { createdAt: { gte: cutoff7d } } }),
      this.prisma.auditLog.count({ where: { action: 'EXPERT_EXTRACTION_CONFIRMED', createdAt: { gte: cutoff30d } } }),
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
      disabled: amap['停用'] ?? 0,
      specialtyDistribution: specGroups.map(g => ({ name: g.specialty, count: g._count })),
      titleDistribution: titleGroups.map(g => ({ name: g.title || '未填写', count: g._count })),
      evaluationStats: { levelCounts, excellentRatio, total: evalTotal },
      recentEvals: evals.slice(0, 8).map(e => ({
        expert: e.expertUser?.displayName ?? '—',
        level: e.overallGrade,
        time: e.createdAt.toISOString(),
      })),
      recentAssigns7d,
      recentExtractions30d,
      monthlyEvalTrend: { labels, counts },
    };
  }

  /** 专家排名（综合加权得分 = A×5+B×4+C×3+D×2+E×1 / 总次数 × 置信度因子） */
  async getRanking(period: 'month' | 'quarter' | 'all' = 'month') {
    const cutoff = period === 'month'
      ? new Date(Date.now() - 30 * 24 * 3600 * 1000)
      : period === 'quarter'
        ? new Date(Date.now() - 90 * 24 * 3600 * 1000)
        : new Date(0);

    const evals = await this.prisma.expertEvaluation.findMany({
      where: { createdAt: { gte: cutoff } },
      select: {
        expertUserId: true, overallGrade: true,
        expertUser: { select: { displayName: true, expertProfile: { select: { specialty: true } } } },
      },
    });

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

  /* ── 自定义抽取：文件分析 + 影子项目 ── */

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

    // 取专家库内实际存在的专业，AI 必须从中选择（避免生成库内没有的专业，且更贴合实际）
    const poolSpecsRows = await this.prisma.expertProfile.findMany({
      where: { user: { isActive: true } },
      select: { specialty: true },
      distinct: ['specialty'],
    });
    const poolSpecs = Array.from(new Set(poolSpecsRows.map(r => r.specialty).filter(Boolean)));
    const poolHint = poolSpecs.length > 0
      ? `\n\n【专家库现有专业】（specialty 字段必须严格从这里选，用词完全一致，不得生造或同义词替换）：\n${poolSpecs.join('、')}`
      : '';

    const fallback = () => ({
      requiredSpecialties: [{ specialty: poolSpecs[0] || '水利工程', count: 2, reason: 'AI 不可用，给出通用默认，请手动调整' }],
      totalExperts: 3,
      analysis: 'AI 暂不可用，已给出默认专业与人数，请手动调整后再抽取。',
      engine: 'rules' as const,
    });

    try {
      const raw = await this.llm.chat(
        '你是招标采购评审专家抽取助手。判断评审所需专业时：首先抓住"采购标的的技术学科归属"定核心技术专业，然后判断是否涉及设备/机械（需要设备或机电专业评估），最后补充造价、法律等辅助专业。每个项目至少应包含核心技术专业，设备类采购还需包含设备/机械类专业，不可偏废。每专业建议人数 1-2 人（不超过 2，即使席位多也不堆给一个专业）。',
        `请阅读以下项目信息，推断评审专家抽取需求。严格以 JSON 返回（不要 markdown 包裹，直接输出纯 JSON 对象）：
{"requiredSpecialties":[{"specialty":"专业名","count":建议人数,"reason":"为何需要该专业(30字内，须点明采购标的与该专业的对应关系)"}],"totalExperts":评审专家总数,"analysis":"推断依据说明(100字内)"}

要求：
1. 必须包含采购标的的核心技术学科专业（如钻机/岩心→地质，水泵/闸门→水利工程）；
2. 设备/机械类采购还需包含设备/机械相关专业；
3. 每专业 count 建议 1-2 人（严禁超过 2）；
4. totalExperts 等于各专业 count 之和；
5. specialty 必须使用【专家库现有专业】里的原词，不得自创。
项目信息：
${context}${poolHint}`,
        0.3,
      );
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return fallback();
      const parsed = JSON.parse(jsonMatch[0]);
      const specialties: { specialty: string; count: number; reason: string }[] = Array.isArray(parsed.requiredSpecialties) && parsed.requiredSpecialties.length
        ? parsed.requiredSpecialties.map((s: any) => ({
            specialty: String(s.specialty || '水利工程'),
            count: Math.max(1, Math.min(10, Number(s.count) || 1)),
            reason: String(s.reason || ''),
          }))
        : fallback().requiredSpecialties;
      const totalExperts = Math.max(1, Math.min(20, Number(parsed.totalExperts) || specialties.reduce((a: number, s: any) => a + s.count, 0) || 3));
      return {
        requiredSpecialties: specialties,
        totalExperts,
        analysis: String(parsed.analysis || '').slice(0, 500),
        engine: 'ai' as const,
      };
    } catch (err) {
      new Logger(ExpertAdminService.name).warn(`已有项目专业分析降级（LLM 不可用）: ${(err as Error)?.message ?? err}`);
      return fallback();
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
      requiredSpecialties: [{ specialty: '水利工程', count: 2, reason: '未能从文件明确推断，给出通用默认，请手动调整' }],
      totalExperts: 3,
      analysis: 'AI 暂不可用，已给出默认专业与人数，请手动调整后再抽取。',
      engine: 'rules' as const,
    });

    try {
      const raw = await this.llm.chat(
        '你是招标采购评审专家抽取助手。用户会提供一份或多份项目相关文件（可能是招标公告、采购需求、项目背景等）。你需要【理解项目背景与采购内容】，推断该项目评审需要哪些专业的专家、各专业建议人数，以及评审专家总数。文件里未必直接写明专业和人数，你要根据项目性质、采购内容、技术要求自行推理。专业请用水发/水利采购常见表述（如水利工程、机电设备及安装、造价咨询、工程造价、信息技术、法律、财务等）。',
        `请阅读以下项目文件内容，推断评审专家抽取需求。严格以 JSON 返回（不要 markdown 包裹，直接输出纯 JSON 对象）：
{"suggestedName":"建议的项目名称(简短)","projectBackground":"项目背景与采购内容概述(100字内)","procurementType":"推断的采购方式(如公开招标/邀请招标/竞争性谈判等)","requiredSpecialties":[{"specialty":"专业名","count":建议人数,"reason":"为何需要该专业(30字内)"}],"totalExperts":评审专家总数,"analysis":"推断依据说明(100字内)"}

文件内容：
${combined}`,
        0.2,
      );
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return fallback();
      const parsed = JSON.parse(jsonMatch[0]);
      const specialties = Array.isArray(parsed.requiredSpecialties) && parsed.requiredSpecialties.length
        ? parsed.requiredSpecialties.map((s: any) => ({
            specialty: String(s.specialty || '水利工程'),
            count: Math.max(1, Math.min(10, Number(s.count) || 1)),
            reason: String(s.reason || ''),
          }))
        : fallback().requiredSpecialties;
      const totalExperts = Math.max(1, Math.min(20, Number(parsed.totalExperts) || specialties.reduce((a: number, s: any) => a + s.count, 0) || 3));
      return {
        suggestedName: String(parsed.suggestedName || '自定义抽取项目').slice(0, 60),
        projectBackground: String(parsed.projectBackground || '').slice(0, 500),
        procurementType: String(parsed.procurementType || '公开招标').slice(0, 30),
        requiredSpecialties: specialties,
        totalExperts,
        analysis: String(parsed.analysis || '').slice(0, 500),
        engine: 'ai' as const,
      };
    } catch (err) {
      new Logger(ExpertAdminService.name).warn(`自定义抽取文件分析降级（LLM 不可用）: ${(err as Error)?.message ?? err}`);
      return fallback();
    }
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

  /** 评标风险预警：融合评分偏离度 + 履职评价 + 违规记录，生成专家级风险简报（规则简报为底，LLM 增强）。 */
  async getRiskBrief(userId: string) {
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

  /** 专家通知发送历史（最近 50 条），供详情页查看 */
  async getNotifyHistory(userId: string) {
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
  private extendedRuleScore(c: {
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
