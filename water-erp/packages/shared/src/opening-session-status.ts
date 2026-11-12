/**
 * 开标会话展示状态派生（L6，2026-08-28）。
 * BidOpeningSession.status 列建档时写「待开标」、完成开标移交时写「开标完成」，开标
 * 过程（进行中/暂停/恢复/窗口开闭）无流转写点——此前 :3007 开标大厅与 :3005 开标
 * 进度块直显该列，开标进行中/暂停/窗口关闭恒显「待开标」误导现场。本函数为两端
 * 共用的单一派生源；status 列保留为建档/完成标记。
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

/**
 * 开标步进条步序派生（#79，2026-11-12）——与 deriveOpeningSessionStatus 同源单一口径。
 * 步序口径（:3007 大厅 STAGES）：0=投递中 1=解密中 2=确认中 3=已完成。
 * 映射：无会话/待开标→0；开标中/已暂停→1；窗口已关闭→2；已结束→3。
 *
 * 待开标落 0 而非 1（对 v2 原案的修正）：窗口未开供应商尚不能解密，高亮「解密中」
 * 属提前高亮——与旧 stageStep「会话组建即高亮确认中」同类病灶，票面投诉本体。
 * 旧实现按 stage+会话存在性判定（OPENING+session→确认中），与状态胶囊（本文件
 * 时刻判定）两套口径；本函数为唯一派生源，胶囊与步进条共用。
 */
export function deriveOpeningStageStep(
  stage: string | null | undefined,
  session: Pick<OpeningSessionStatusInput, 'pausedAt' | 'handoverAt' | 'decryptWindowStart' | 'decryptWindowEnd'> | null | undefined,
  now?: number,
): 0 | 1 | 2 | 3 {
  if (!session) return 0;
  switch (deriveOpeningSessionStatus({ stage, ...session, now })) {
    case '已结束':
      return 3;
    case '窗口已关闭':
      return 2;
    case '待开标':
      return 0;
    default:
      return 1; // 开标中 / 已暂停（暂停隐含窗口已开）
  }
}
