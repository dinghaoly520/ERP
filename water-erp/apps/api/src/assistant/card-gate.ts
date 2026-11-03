/**
 * 卡片规则闸（2026-11-03 用户裁定：回答跟随提问——确定性规则，无 LLM 步骤）。
 * 挂载策略：
 *  - metric 卡保留（单值本就是为卡而生）
 *  - 带 viz 的表卡保留（分布/趋势/排名类问题，图就是答案的形状）
 *  - 无 viz 小表（数据行≤3 且数据键≤2，_total 行不计键数）→ 丢弃，
 *    rows 序列化为 droppedText 由正文承载（一句话可答的问题不拖表）
 *  - 其余无 viz 表卡保留（多行多列明细）
 * 闸只过滤呈现，不碰工具执行、权限与公司隔离。
 */
export function applyCardGate(card: Record<string, unknown>): { keep: boolean; droppedText?: string } {
  if (card.type !== 'table' || card.viz) return { keep: true };
  const rows = (card.rows as Array<Record<string, unknown>> | undefined) ?? [];
  if (rows.length === 0) return { keep: true }; // 空表交由前端空态
  const keys = Object.keys(rows[0]).filter((k) => k !== '_total');
  if (rows.length > 3 || keys.length > 2) return { keep: true };
  const droppedText =
    `${card.title ?? '数据'}：` +
    rows.map((r) => keys.map((k) => `${k}=${String(r[k] ?? '')}`).join('，')).join('；');
  return { keep: false, droppedText };
}
