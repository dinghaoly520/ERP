/**
 * 评价多开·方案B（2026-10-21 用户裁定：工作人员可多次评价）——共用闸与统计去重口径。
 *
 * 提交闸/频次闸在两域 createEvaluation 内实现；本文件提供：
 *  - EVALUATION_COOLDOWN_MS：同评价人对同一对象的提交/频次闸窗口（7 天）——
 *    同槽位 7 天内已评价 → 覆盖更新（视为修改）；7 天内另有评价记录 → 须 leader/admin
 *    或填「复评事由」（reviewReason，审计留痕）。
 *  - latestExpertEvals / latestSupplierEvals：统计闸——统计面（排名/画像/统计/淘汰·退库预警）
 *    按「槽位（对象, 项目, 来源?, 评价人）取最新一条」去重，单人刷多条只算一票；
 *    多评价人/多项目/多阶段各自计票。展示面（评价历史/时间线）保留全量流水，不去重。
 */

export const EVALUATION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** 频次闸放行判定：leader/admin 或已填复评事由 */
export function reevalAllowed(role: string | undefined | null, reviewReason: string | null | undefined): boolean {
  return ['leader', 'admin'].includes(role ?? '') || !!reviewReason?.trim();
}

/** 时间戳取值（undefined/null 容错——测试 mock 与历史形状可能缺列，按 0 参与比较） */
const ts = (d?: Date | string | null) => (d ? new Date(d).getTime() : 0);

const newer = (a: { updatedAt?: Date | string | null; createdAt?: Date | string | null }, b: { updatedAt?: Date | string | null; createdAt?: Date | string | null }) =>
  ts(a.updatedAt) > ts(b.updatedAt) || (ts(a.updatedAt) === ts(b.updatedAt) && ts(a.createdAt) > ts(b.createdAt));

/** 专家评价统计去重：槽位=(专家, 项目, 评价人) 取最新 */
export function latestExpertEvals<T extends { expertUserId: string; evaluatorId: string; projectId: string | null; updatedAt: Date; createdAt: Date }>(evals: T[]): T[] {
  const best = new Map<string, T>();
  for (const e of evals) {
    const k = `${e.expertUserId}|${e.projectId ?? ''}|${e.evaluatorId}`;
    const cur = best.get(k);
    if (!cur || newer(e, cur)) best.set(k, e);
  }
  return [...best.values()];
}

/** 供应商评价统计去重：槽位=(供应商, 项目, 来源, 评价人) 取最新 */
export function latestSupplierEvals<T extends { supplierId: string; evaluatorId: string; projectId: string | null; evaluationSource?: string | null; updatedAt: Date; createdAt: Date }>(evals: T[]): T[] {
  const best = new Map<string, T>();
  for (const e of evals) {
    const k = `${e.supplierId}|${e.projectId ?? ''}|${e.evaluationSource ?? 'procurement'}|${e.evaluatorId}`;
    const cur = best.get(k);
    if (!cur || newer(e, cur)) best.set(k, e);
  }
  return [...best.values()];
}
