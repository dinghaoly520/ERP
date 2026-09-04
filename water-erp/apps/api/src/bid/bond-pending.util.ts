import type { Prisma } from '@prisma/client';

/** A-105（终审 Critical#2）：保证金「尚未处置」判定——已提交 且 未退还 且 无不予退还终局理由。
 *  定标 hook（deliverAwardLetter）与每日调度提醒（remindBondReturns）共用，
 *  单一来源防三处口径漂移（不予退还=终局，不得再计 pending）。 */
export function pendingBondReturnWhere(extra: Record<string, unknown> = {}): Prisma.BidSupplierWhereInput {
  return { submitStatus: '已提交', bondReturnedAt: null, bondReturnReason: null, ...extra };
}
