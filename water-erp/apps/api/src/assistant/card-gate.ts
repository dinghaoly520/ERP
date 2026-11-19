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

/* ── 相关性闸（2026-11-19 用户裁定：问节资率不出采购方式图表——回答跟随提问的
 *  第二道确定性规则，无 LLM 步骤）── 维度词组：同组词视为同题（问「成交额」命中
 *  「采购方式成交分布」的「成交」）；问题与卡片标题按组共享→同题保留。 */
const TERM_GROUPS: readonly (readonly string[])[] = [
  ['节资率', '节资', '节约资金', '节约'],
  ['成交额', '成交总额', '成交'],
  ['预算'],
  ['待处理'],
  ['已取消', '取消', '终止', '异常'],
  ['轮次'],
  ['采购方式', '方式'],
  ['阶段'],
  ['供应商'],
  ['公司'],
  ['专家'],
  ['公告'],
  ['合同'],
  ['趋势'],
  ['构成', '分布'],
  ['结果'],
  ['排行'],
  ['资质'],
  ['负荷'],
];

function hitGroups(text: string): Set<number> {
  const hits = new Set<number>();
  TERM_GROUPS.forEach((g, i) => {
    if (g.some((t) => text.includes(t))) hits.add(i);
  });
  return hits;
}

/** 卡片相关性闸：问题命中词组且（本批∪已挂）存在同题表卡时，剪除非同题表卡
 *  （metric/chart 等非表卡不受限；已挂卡只参与同题判定、永不被剪——跨工具批次）；
 *  问题无命中或无任何同题表卡→不过滤（宁可多显不可全丢）。 */
export function applyCardRelevance(
  cards: Array<Record<string, unknown>>,
  question: string,
  existing: Array<Record<string, unknown>> = [],
): Array<Record<string, unknown>> {
  const qGroups = hitGroups(question);
  if (qGroups.size === 0) return cards;
  const tableCards = cards.filter((c) => c.type === 'table');
  if (tableCards.length === 0) return cards;
  const pool = [...existing.filter((c) => c.type === 'table'), ...tableCards];
  const onTopic = pool.filter((c) => {
    const g = hitGroups(String(c.title ?? ''));
    for (const q of qGroups) if (g.has(q)) return true;
    return false;
  });
  if (onTopic.length === 0) return cards;
  const keepTitles = new Set(onTopic.map((c) => String(c.title ?? '')));
  return cards.filter((c) => c.type !== 'table' || keepTitles.has(String(c.title ?? '')));
}
