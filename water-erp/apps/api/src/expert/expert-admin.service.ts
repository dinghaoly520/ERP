import { Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashSync } from 'bcryptjs';
import { Prisma, ExpertLevel } from '@prisma/client';
import { portalOrigin } from '@water-erp/config';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EmbeddingService } from '../local-ai/embedding.service';
import { LlmService } from '../local-ai/llm.service';
import { OcrService } from '../local-ai/ocr.service';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';
import { processFile } from '../ai-bid-analysis/utils/file-processor';
import { ExpertExtractionAiService, rsvpTtlHours } from './expert-extraction-ai.service';
import { ExpertCrossConflictService } from './expert-cross-conflict.service';
import { ExpertExtractionService } from './expert-extraction.service';
import type { CreateExpertDto } from './dto/create-expert.dto';
import { UpdateExpertStatusDto } from './dto/update-expert-status.dto';
import type { CreateExpertEvaluationDto } from './dto/create-expert-evaluation.dto';
import type { UpdateExpertProfileDto } from './dto/expert-admin-misc.dto';
import type { CommitteeAssignmentDto } from '../bid/dto/committee-assignment.dto';
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
    private readonly extraction: ExpertExtractionService,
  ) {}

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

  /** 专家库列表（含 ExpertProfile，可按姓名或专业模糊搜索，服务端分页） */
  async listExperts(search?: string, specialty?: string, employer?: string, page = 1, pageSize = 20) {
    const where = {
      role: 'bid_expert' as const,
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
              entryStatus: 'PENDING', // CTS A-218 录入后待审核，admin「审核入库」留痕 verifiedBy/At
              notes: dto.notes,
            },
          },
        },
        include: { expertProfile: true, department: { select: { id: true, name: true } } },
      });
      // 剥离密码哈希，避免敏感字段外泄
      const { passwordHash, ...safeUser } = user;
      // 审计留痕：单条录入（CSV 导入与种子导入不在此列，各自单独记账）
      await this.auditExpert(operatorId, 'EXPERT_CREATE', user.id, {
        expertName: normalizedName, specialty: dto.specialty, employer: dto.employer ?? null,
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

  /** 启用/停用专家（停用 = isActive=false + availability 停用） */
  async setAvailability(userId: string, available: boolean, operatorId?: string) {
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

  /** 更新专家资料 */
  async updateProfile(userId: string, dto: UpdateExpertProfileDto, operatorId?: string) {
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
          ...(dto.regionCode !== undefined && { regionCode: dto.regionCode }),
          ...(dto.expertLevel !== undefined && { expertLevel: dto.expertLevel }),
        },
        create: { userId, specialty: dto.specialty || '综合', title: dto.title, employer: dto.employer, phone: dto.phone, idNumber: dto.idNumber, ethnicity: dto.ethnicity, education: dto.education, licenseNo: dto.licenseNo, availability: dto.availability ?? '可用', notes: dto.notes, regionCode: dto.regionCode, expertLevel: dto.expertLevel },
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
        reviewGroup: true, dutyRole: true,
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
      if (!u.isActive || u.expertProfile?.availability !== '可用' || u.expertProfile?.entryStatus !== 'ACTIVE') return false;
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
      // 三维评价依据：前端文本域内容原样持久化（可空）。只保留三键白名单，滤掉任意负载。
      evidence: dto.evidence && Object.keys(dto.evidence).length > 0
        ? {
            attendanceGrade: dto.evidence.attendanceGrade ?? null,
            qualityGrade: dto.evidence.qualityGrade ?? null,
            disciplineGrade: dto.evidence.disciplineGrade ?? null,
          }
        : undefined,
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
    // 审计留痕：评价（含更新）记一条，整体等级 + 关联项目入 details，评价人=操作人（evaluatorId）
    await this.auditExpert(evaluatorId, 'EXPERT_EVALUATE', dto.expertUserId, {
      expertName: expert.displayName, overallGrade, projectId: dto.projectId ?? null, updated: !!existing,
    });
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
  async ignoreRetirementWarning(userId: string, operatorId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'bid_expert') throw new NotFoundException('专家不存在');
    await this.prisma.expertProfile.update({ where: { userId }, data: { retireIgnoredAt: new Date() } });
    await this.auditExpert(operatorId, 'EXPERT_RETIRE_IGNORE', userId, { expertName: user.displayName });
    return { success: true };
  }

  /** 人工确认退库：写入停用 + retiredAt + retireReason，同步禁用登录（同一事务，避免半退库态）。 */
  async confirmRetire(userId: string, reason: string, operatorId?: string) {
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

  /** CTS A-218/222 专家库状态机：PENDING→ACTIVE 记审核留痕；RETIRED 联动账号停用（对齐 confirmRetire） */
  async updateProfileStatus(userId: string, dto: UpdateExpertStatusDto, actor?: AuthenticatedUser) {
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
          ...(dto.status === 'RETIRED' ? { retiredAt: new Date(), retireReason: dto.reason!.trim() } : {}),
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
        select: { overallGrade: true, createdAt: true, expertUserId: true, expertUser: { select: { displayName: true } } },
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
  async batchOperation(dto: { action: 'enable' | 'disable'; ids: string[]; reason?: string }, operatorId?: string) {
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
    // 批量动作单独记账（一条记录，不逐专家刷屏）
    await this.auditExpert(operatorId, available ? 'EXPERT_BATCH_ENABLE' : 'EXPERT_BATCH_DISABLE', 'batch', {
      count: result[0].count, ids: dto.ids, ...(dto.reason?.trim() ? { reason: dto.reason.trim() } : {}),
    });
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
        });
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

  /* ── 操作历史（审计，只读）── */

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
}
