/**
 * 开标会话展示状态派生（L6，2026-08-28）。
 * BidOpeningSession.status 列仅在建档时写「待开标」，后端无流转事件——此前 :3007
 * 开标大厅与 :3005 开标进度块直显该列，开标进行中/暂停/窗口关闭/结束都恒显
 * 「待开标」误导现场。本函数为两端共用的单一派生源；status 列保留为建档标记。
 *
 * 派生优先级：已暂停 > 已结束（已移交或阶段已离开开标）> 窗口已关闭 > 待开标（窗口未开）> 开标中。
 */

export type OpeningSessionDisplayStatus = '待开标' | '开标中' | '已暂停' | '窗口已关闭' | '已结束';

export interface OpeningSessionStatusInput {
  /** 项目阶段（BidProject.stage）；非 OPENING 即开标活动终止 */
  stage: string | null | undefined;
  pausedAt?: string | Date | null;
  handoverAt?: string | Date | null;
  decryptWindowStart?: string | Date | null;
  decryptWindowEnd?: string | Date | null;
  /** 参考时刻（毫秒）；缺省取客户端时钟。:3007 大厅应传 serverTimeOffset 校正后的值 */
  now?: number;
}

export function deriveOpeningSessionStatus(input: OpeningSessionStatusInput): OpeningSessionDisplayStatus {
  const { stage, pausedAt, handoverAt, decryptWindowStart, decryptWindowEnd } = input;
  if (pausedAt) return '已暂停';
  if (handoverAt) return '已结束';
  if (stage && stage !== 'OPENING' && stage !== 'DOWNLOAD' && stage !== 'SUBMIT') return '已结束';
  const now = input.now ?? Date.now();
  const end = decryptWindowEnd ? new Date(decryptWindowEnd).getTime() : null;
  if (end !== null && Number.isFinite(end) && now > end) return '窗口已关闭';
  const start = decryptWindowStart ? new Date(decryptWindowStart).getTime() : null;
  if (start !== null && Number.isFinite(start) && now < start) return '待开标';
  return '开标中';
}
