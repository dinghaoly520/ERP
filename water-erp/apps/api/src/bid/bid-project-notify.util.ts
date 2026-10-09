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
 */
export async function resolveProjectCreatorId(
  prisma: Pick<PrismaService, 'projectManagementItem'>,
  projectManagementItemId: string | null | undefined,
): Promise<string | null> {
  if (!projectManagementItemId) return null;
  const host = await prisma.projectManagementItem.findUnique({
    where: { id: projectManagementItemId },
    select: { createdById: true },
  });
  return host?.createdById ?? null;
}
