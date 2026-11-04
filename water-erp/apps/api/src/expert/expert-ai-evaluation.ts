import type { PrismaClient } from '@prisma/client';
import type { LlmService } from '../local-ai/llm.service';

/**
 * 专家 AI 综合评价（2026-11-04）：详情页「履职备注」区块改为 AI 综合评价——
 * 聚合档案与履职数据（参评项目/履职评价等级/邀请婉拒）由 LLM 生成一段评语，
 * Scheduler 每月 1 日 00:00 全量刷新（controller 另有 admin 手动触发端点）。
 *
 *  - 无任何履职数据的专家不调 LLM、不写值（aiEvaluation 恒 null，前端显示
 *    「暂无评审记录」占位）——防无据编造
 *  - LLM 失败/空输出跳过该专家、保留旧值（宁缺毋错）
 *  - notes 字段保留为人工备注/回避事项通道，与本字段互不覆盖
 *
 * 纯函数文件（仿 stale-sweep.ts）：不依赖 Nest DI，Scheduler 与 controller
 * 各自走薄壳调用，测试可直调。
 */

type EvalPrisma = Pick<PrismaClient, 'expertProfile' | 'bidExpert' | 'expertEvaluation' | 'expertInvitationLog' | 'user'>;

export type ExpertEvaluationFacts = {
  name: string;
  specialty: string;
  title: string | null;
  education: string | null;
  availability: string;
  expertLevel: string | null;
  /** 参评项目（倒序）：名称、角色（正选/候补）、是否组长、邀请结果、是否签到 */
  projects: { name: string; role: string; isLead: boolean; invitationStatus: string; signedIn: boolean; at: Date }[];
  /** 履职评价：综合等级 A–E 分布 + 最近一条评语 */
  gradeCounts: Record<string, number>;
  latestComment: { grade: string; comment: string | null; at: Date } | null;
  /** 邀请婉拒/超时弃权次数 */
  declineCount: number;
};

/** 采集单个专家的履职事实。returns null = 档案缺失。 */
export async function collectExpertFacts(prisma: EvalPrisma, userId: string): Promise<ExpertEvaluationFacts | null> {
  const [user, memberships, evaluations, invitationLogs] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        displayName: true,
        expertProfile: { select: { specialty: true, title: true, education: true, availability: true, expertLevel: true } },
      },
    }),
    prisma.bidExpert.findMany({
      where: { userId },
      select: {
        isLead: true,
        expertRole: true,
        invitationStatus: true,
        signedIn: true,
        createdAt: true,
        project: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.expertEvaluation.findMany({
      where: { expertUserId: userId },
      select: { overallGrade: true, comment: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.expertInvitationLog.findMany({
      where: { userId },
      select: { action: true, toStatus: true },
    }),
  ]);
  const p = user?.expertProfile;
  if (!user || !p) return null;

  const gradeCounts: Record<string, number> = {};
  for (const e of evaluations) gradeCounts[e.overallGrade] = (gradeCounts[e.overallGrade] ?? 0) + 1;
  const latest = evaluations[0]
    ? { grade: evaluations[0].overallGrade, comment: evaluations[0].comment, at: evaluations[0].createdAt }
    : null;
  const declineCount = invitationLogs.filter(l => l.action === 'AUTO_DECLINED' || l.toStatus === 'declined').length;

  return {
    name: user.displayName,
    specialty: p.specialty,
    title: p.title,
    education: p.education,
    availability: p.availability,
    expertLevel: p.expertLevel,
    projects: memberships.map(m => ({
      name: m.project.name,
      role: m.expertRole,
      isLead: m.isLead,
      invitationStatus: m.invitationStatus,
      signedIn: m.signedIn,
      at: m.createdAt,
    })),
    gradeCounts,
    latestComment: latest,
    declineCount,
  };
}

export function hasServiceRecord(f: ExpertEvaluationFacts): boolean {
  return f.projects.length > 0 || Object.keys(f.gradeCounts).length > 0 || f.declineCount > 0;
}

/** 事实清单 → prompt。平实档案批注口径：禁套话、禁编造、一段式直陈。 */
export function buildEvaluationPrompt(f: ExpertEvaluationFacts): { system: string; user: string } {
  const lines: string[] = [];
  lines.push(`【专家档案】${f.name}｜专业：${f.specialty}｜职称：${f.title ?? '未填'}｜学历：${f.education ?? '未填'}｜库内等级：${f.expertLevel ?? '未定'}｜当前状态：${f.availability}`);
  lines.push(`【参评记录】共 ${f.projects.length} 次`);
  for (const m of f.projects.slice(0, 6)) {
    const lead = m.isLead ? '，担任组长' : '';
    const confirm = m.invitationStatus === 'confirmed' ? '已确认参评' : m.invitationStatus === 'declined' ? '婉拒' : '待确认';
    lines.push(`- ${m.name}（${m.role}${lead}，${confirm}${m.signedIn ? '，已签到' : ''}）`);
  }
  const evalTotal = Object.values(f.gradeCounts).reduce((s, n) => s + n, 0);
  if (evalTotal > 0) {
    const dist = Object.entries(f.gradeCounts).map(([g, n]) => `${g}×${n}`).join('、');
    lines.push(`【履职评价】共 ${evalTotal} 条，综合等级分布：${dist}（A 最好，E 最差）`);
    if (f.latestComment) {
      lines.push(`最近一条（${f.latestComment.grade} 级）评语：${f.latestComment.comment ?? '（无评语）'}`);
    }
  } else {
    lines.push(`【履职评价】暂无`);
  }
  if (f.declineCount > 0) lines.push(`【邀请回应】邀请流转中累计 ${f.declineCount} 次婉拒或超时未响应（含同一项目的多次邀请流转，与参评记录的最终回应为不同口径）`);

  return {
    system:
      '你是采购评审专家库的档案管理员。根据给定的履职数据为一位评审专家写综合评价，供采购管理人员快速了解其履职情况。要求：'
      + '只依据给定数据陈述，不得编造数据之外的事实，不得推断未给出的结论；'
      + '120~180 字，一段式，直接陈述；'
      + '聚焦履职表现（参评情况、回应态度、评价等级、担任角色），不要复述专业/职称/学历等档案字段——页面上已单独展示；'
      + '数据中标注了口径说明的（如邀请回应），按给定口径直述，不比较口径差异、不质疑数据一致性；'
      + '不用"综合来看""总体而言""值得关注"等套话，不分点，不写改进建议，结尾不喊口号；'
      + '语气平实，像管理员的档案批注。只输出评价正文，不要任何前缀和标题。',
    user: lines.join('\n'),
  };
}

export type RefreshStats = { total: number; generated: number; skipped: number };

/** 全量刷新：遍历全部在库专家（entryStatus ≠ RETIRED 也可刷新——退库专家详情仍可看）。 */
export async function refreshAllExpertAiEvaluations(
  prisma: EvalPrisma,
  llm: Pick<LlmService, 'chat'>,
  onProgress?: (msg: string) => void,
): Promise<RefreshStats> {
  const experts = await prisma.user.findMany({
    where: { role: 'bid_expert' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  let generated = 0;
  let skipped = 0;
  for (const e of experts) {
    const facts = await collectExpertFacts(prisma, e.id);
    if (!facts || !hasServiceRecord(facts)) {
      skipped++;
      continue;
    }
    try {
      const { system, user } = buildEvaluationPrompt(facts);
      const text = (await llm.chat(system, user, 0.4)).trim();
      if (!text || text.length > 600) {
        skipped++;
        onProgress?.(`专家 ${facts.name} 生成结果异常（${text.length} 字），跳过`);
        continue;
      }
      await prisma.expertProfile.update({
        where: { userId: e.id },
        data: { aiEvaluation: text, aiEvaluatedAt: new Date() },
      });
      generated++;
    } catch (err) {
      skipped++;
      onProgress?.(`专家 ${facts.name} 生成失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { total: experts.length, generated, skipped };
}
