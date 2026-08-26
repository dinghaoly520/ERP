/**
 * B4（GB/T 43711 附录 D）：框架协议采购共享常量与校验。
 */

export const FA_ENTRY_MODE_LABELS = {
  closed: '封闭式竞争入围',
  open: '开放式资格审查',
} as const;

/** D.2.2 第一阶段约定要素分类（表 D.1） */
export const FA_VARIANT_LABELS = {
  supplier_only: '定商',
  supplier_price: '定商定价',
  supplier_price_qty: '定商定价定量',
} as const;

export const FA_STATUS_LABELS = {
  drafting: '草拟',
  entry: '入围登记中',
  active: '生效中',
  expired: '已到期',
  terminated: '已终止',
} as const;

/**
 * D.2.6 淘汰比例校验（规范性）：
 * 一次价格竞争：淘汰参与供应商数宜 ≥50%；
 * 两次价格竞争：每次淘汰宜 ≥30%。
 * 框架协议不适用价格竞争（开放式资格审查）时跳过。
 */
export function checkEliminationRatio(input: {
  entryMode: string;
  rounds: number; // 价格竞争轮数（0=无价格竞争，开放式）
  participants: number[]; // 各轮参与供应商数
  entered: number; // 最终入围数
}): { passed: boolean; detail: string; ratios: number[] } {
  const { entryMode, rounds, participants, entered } = input;
  if (entryMode === 'open' || rounds <= 0) {
    return { passed: true, detail: '开放式资格审查/无价格竞争，不适用淘汰比例', ratios: [] };
  }
  const ratios = participants.map(p => (p > 0 ? (p - (entered > p ? p : entered)) / p : 0));
  // 逐轮近似：以各轮参与数与最终入围数计算累计淘汰率
  const total = participants[0] ?? 0;
  if (total <= 0) return { passed: false, detail: '参与供应商数不合法', ratios: [] };
  const eliminated = Math.max(0, total - entered);
  const ratio = eliminated / total;
  const min = rounds >= 2 ? 0.3 : 0.5;
  const passed = ratio >= min;
  return {
    passed,
    detail: passed
      ? `${rounds} 轮价格竞争：参与 ${total} 家、入围 ${entered} 家，淘汰 ${Math.round(ratio * 100)}%（要求 ≥${min * 100}%）`
      : `${rounds} 轮价格竞争：参与 ${total} 家、入围 ${entered} 家，淘汰 ${Math.round(ratio * 100)}% 低于 ${min * 100}%（D.2.6${rounds >= 2 ? '：两次竞争每次宜≥30%' : '：一次竞争宜≥50%'}）`,
    ratios: [ratio],
  };
}
