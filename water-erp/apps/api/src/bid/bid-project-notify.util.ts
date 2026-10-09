import type { PrismaService } from '../prisma/prisma.service';

/**
 * 项目相关通知收件人解析（2026-10-09 串号修复）。
 *
 * 背景：NotificationService.sendToRole 按角色全平台广播（无公司过滤），建设/投资公司
 * 账号上线后，设计公司创建的项目通知串到了别公司账号（BID_OPENING_HANDED_OVER 实录）。
 * 且 :3005 /projects 本就是个人隔离（非创建人打不开通知深链），广播口径与数据隔离脱节。
 *
 * 口径（2026-10-09 用户裁定）：项目相关通知只发项目创建人；解析失败（无宿主 PMI /
 * 宿主无 createdById）不发送——宁可不发，不再回退任何角色广播。
 *
 * isActive 闸（同日复核补）：sendToRole 原按 isActive=true 过滤收件人，定向路径须同口径——
 * 停用账号不投递。否则死信落库无意义；且 BOND_REFUND_DUE 通道 sendToUser 对停用创建人
 * 会成功返回 → marker 被写入，法定 5 日退还提醒（实施条例 57 条）就此空耗无人收。
 */
export async function resolveProjectCreatorId(
  prisma: Pick<PrismaService, 'projectManagementItem'>,
  projectManagementItemId: string | null | undefined,
): Promise<string | null> {
  if (!projectManagementItemId) return null;
  const host = await prisma.projectManagementItem.findUnique({
    where: { id: projectManagementItemId },
    select: { createdById: true, createdBy: { select: { isActive: true } } },
  });
  // 停用/已删号的创建人不投递（宁可不发）
  if (!host?.createdById || !host.createdBy?.isActive) return null;
  return host.createdById;
}

/** 定向收件人 isActive 闸（指派主持人等直存 userId 的场景）：
 *  停用账号返回 null → 调用方跳过发送，与 resolveProjectCreatorId 同口径。 */
export async function resolveActiveUserId(
  prisma: Pick<PrismaService, 'user'>,
  userId: string | null | undefined,
): Promise<string | null> {
  if (!userId) return null;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true },
  });
  return u?.isActive ? userId : null;
}
