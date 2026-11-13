/** 开标锁触发时机判定（spec 2026-11-13）：只有真正启动开标（开标确认面板点「按时开标」→
 *  BidProject→OPENING）才落锁——到达开标确认页（阶段行 IN_PROGRESS）或延时开标（仅改
 *  openTime）不锁。口径对齐后端四道闸（reopenStage / change.service / ADDENDUM_BID_STARTED /
 *  mine 过滤，全部锚定 BidProject 实际阶段）。参数用结构类型：不 import api 模块，
 *  node:test 直测无副作用链；round null/undefined 归一为 1（与组件 (s.round ?? 1) 同式）。 */

const OPENED_STAGES = ['OPENING', 'EVALUATING', 'ARCHIVED'] as const;

type BpLike = { round?: number | null; stage: string };

/** 该轮 bp 是否已启动开标——对齐后端 reopenStage 开标锁（同轮 bp；ABORTED=流标不锁，穿闸可重开） */
export function roundBidOpened(bpRefs: ReadonlyArray<BpLike>, round: number): boolean {
  const bp = bpRefs.find((r) => (r.round ?? 1) === round);
  return !!bp && (OPENED_STAGES as readonly string[]).includes(bp.stage);
}

/** 最新非流标 bp 是否已启动开标——对齐后端 change.service bidOpened（变更弹窗/基本信息闸口径） */
export function latestBidOpened(bpRefs: ReadonlyArray<BpLike>): boolean {
  const latest = bpRefs
    .filter((r) => r.stage !== 'ABORTED')
    .reduce<BpLike | null>((acc, r) => (!acc || (r.round ?? 1) > (acc.round ?? 1) ? r : acc), null);
  return !!latest && (OPENED_STAGES as readonly string[]).includes(latest.stage);
}
