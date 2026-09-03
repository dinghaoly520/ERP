import type { Prisma } from '@prisma/client';

/**
 * 评标签字闭环判定（共享 util，A-152 起双路调用）：
 * - 主持端登记 register()（含 REFUSED_DISSENT/DEEMED_AGREED 终态）
 * - 评委电子签名 esignReport()（本人 SM2 签名落 SIGNED）
 * 语义：全体正选专家离开 PENDING → 置位 BidSignPacket.closedAt/closedById + 监督日志。
 * 必须在签字包已生成的事务内调用（update where projectId 命中唯一行）。
 */
export interface CloseSignLoopOptions {
  /** 监督日志 target（项目名）；不传则回查 BidProject.name（回查失败退 projectId） */
  projectName?: string;
  /** 监督日志 operatorRole；主持端登记为 bid_host（默认，历史行为），评委电子签名为 bid_expert */
  operatorRole?: string;
}

/** @returns 是否本次触发闭环（false = 仍有 PENDING） */
export async function closeSignLoopIfDone(
  tx: Prisma.TransactionClient,
  projectId: string,
  closedById: string,
  opts: CloseSignLoopOptions = {},
): Promise<boolean> {
  const pendingCount = await tx.bidExpert.count({ where: { projectId, expertRole: '正选', signStatus: 'PENDING' } });
  if (pendingCount > 0) return false;

  await tx.bidSignPacket.update({ where: { projectId }, data: { closedAt: new Date(), closedById } });
  let target = opts.projectName;
  if (target == null) {
    const project = await tx.bidProject.findUnique({ where: { id: projectId }, select: { name: true } });
    target = project?.name ?? projectId;
  }
  await tx.bidSupervisionLog.create({
    data: {
      projectId, time: new Date(), role: '系统', target,
      action: '评标签字闭环', result: '全体正选专家签字登记完成，可生成评标回流包', riskFlag: '无',
      operatorId: closedById, operatorRole: opts.operatorRole ?? 'bid_host',
    },
  });
  return true;
}
