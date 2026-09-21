import { randomInt } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * 评标窗口 + 评标室口令共享工具（2026-09-20 spec：docs/superpowers/specs/2026-09-20-expert-room-code-window-isolation-design.md）
 *
 * 评标窗口 = 签到起 → 本人确认报告止（不以 ARCHIVED 为界——完整归档是 :3005 文书收尾会滞后，
 * 以它为界会误杀同日第二标）。窗口开 ⇔ signedIn && !reportConfirmed && project ∈ {OPENING, EVALUATING}。
 * 同一定义被四处复用：抽取候选排除（闸1）/ signIn·启动评标拦截（闸2）/ 登录工位锁定（闸4）/ 告警。
 */

export const ACTIVE_EVALUATION_STAGES = ['OPENING', 'EVALUATING'] as const;

/** 该用户在其他项目是否存在未闭合评标窗口（excludeProjectId 用于跨项目检查） */
export async function findOpenEvaluationWindows(
  prisma: Pick<PrismaService, 'bidExpert'>,
  userId: string,
  excludeProjectId?: string,
) {
  return prisma.bidExpert.findMany({
    where: {
      userId,
      signedIn: true,
      reportConfirmed: false,
      ...(excludeProjectId ? { projectId: { not: excludeProjectId } } : {}),
      project: { stage: { in: [...ACTIVE_EVALUATION_STAGES] } },
    },
    select: { projectId: true, project: { select: { id: true, projectCode: true, name: true } } },
  });
}

/** 本项目正选专家中存在「跨项目未闭合窗口」的名单（启动评标/按时开标检查用）。
 *  注意：窗口在对方项目的 BidExpert 行上（该行 signedIn && !reportConfirmed）——
 *  本项目成员行自身的签到态无关（启动评标时他们尚未签到）。 */
export async function findCrossWindowExperts(
  prisma: Pick<PrismaService, 'bidExpert'>,
  projectId: string,
) {
  const members = await prisma.bidExpert.findMany({
    where: { projectId, expertRole: '正选' },
    select: { id: true, expertName: true, userId: true },
  });
  const conflicts: Array<{ expertId: string; expertName: string; userId: string; windows: Array<{ projectCode: string; name: string }> }> = [];
  for (const m of members) {
    const wins = await findOpenEvaluationWindows(prisma, m.userId, projectId);
    if (wins.length > 0) conflicts.push({ expertId: m.id, expertName: m.expertName, userId: m.userId, windows: wins.map(w => ({ projectCode: w.project.projectCode, name: w.project.name })) });
  }
  return conflicts;
}

/** 评标室口令：8 位随机，去混淆字符集（无 0/O/1/I） */
const ROOM_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += ROOM_CODE_CHARSET[randomInt(ROOM_CODE_CHARSET.length)];
  return code;
}

/** 口令爆破阈值（2026-09-20 用户裁定：3 次锁 10 分钟） */
export const ROOM_CODE_MAX_ATTEMPTS = 3;
export const ROOM_CODE_LOCK_MINUTES = 10;

/**
 * 口令已验判定（P3-3 2026-09-21 审查加固口径）：roomVerifiedAt 存在且
 * （roomCodeAt 为空——手工改库/漂移，正式写点均成对写——或晚于口令轮换时间）。
 * assertRoomUnlocked（闸门）与 getProject 的 roomCodeVerified（前端派生）共用，
 * 防两处手抄谓词漂移（UI 说已验而 API 403，或反之）。
 */
export function isRoomVerified(
  project: { roomCode: string | null; roomCodeAt: Date | null },
  expert: { roomVerifiedAt: Date | null } | null | undefined,
): boolean {
  return !!expert?.roomVerifiedAt && (!project.roomCodeAt || expert.roomVerifiedAt >= project.roomCodeAt);
}

/**
 * 评标室口令闸（2026-09-20 spec §4；2026-09-21 P0-2 移入共享工具供 memo 等独立 service 复用）：
 * roomCode 非空且阶段 EVALUATING 且本人未验（roomVerifiedAt >= roomCodeAt）→ 403 ROOM_CODE_REQUIRED。
 * roomCode 为空（存量/未启用）恒放行——闸门 opt-in，启用权在主持人（:3007 矩阵生成/轮换）。
 */
export async function assertRoomUnlocked(
  prisma: Pick<PrismaService, 'bidProject' | 'bidExpert'>,
  projectId: string,
  userId: string,
) {
  const [project, expert] = await Promise.all([
    prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, roomCode: true, roomCodeAt: true },
    }),
    prisma.bidExpert.findFirst({ where: { userId, projectId }, select: { roomVerifiedAt: true } }),
  ]);
  // P2-6（2026-09-21）：ABORTED（流标）同样保持闸门——评标终止后物料不裸奔；
  // 已验专家仍可访问，未验者走 verifyRoomCode（阶段含 ABORTED）。
  if (!project?.roomCode || (project.stage !== 'EVALUATING' && project.stage !== 'ABORTED')) return;
  if (isRoomVerified(project, expert)) return;
  throw new ForbiddenException({ error: '请先输入评标室口令进入评标室', code: 'ROOM_CODE_REQUIRED' });
}

/** 通知全部 admin（与 :3005 security-feedback 同模式：逐 userId create 站内信） */
export async function notifyAdmins(
  prisma: Pick<PrismaService, 'user'>,
  notificationService: { create(dto: { userId: string; type: string; title: string; content: string; link?: string }): Promise<unknown> } | undefined,
  payload: { type: string; title: string; content: string; link?: string },
) {
  if (!notificationService) return;
  const admins = await prisma.user.findMany({ where: { role: 'admin', isActive: true }, select: { id: true } });
  await Promise.all(admins.map(a => notificationService.create({ userId: a.id, ...payload }).catch(() => {})));
}
