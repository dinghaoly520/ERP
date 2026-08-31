// apps/api/src/bid/aggregate-supplier-scores.ts
// F12（2026-08-28）：官方口径供应商聚合与排名——自 generateEvaluationResults 提取为纯函数，
// 与 GET /bid/projects/:id/live-official-scores（结果未生成时的排名预览）共用，单一事实源：
// 前端预览不再自行复刻口径（旧预览=正选百分制原始均分，与官方「跳过公式价格项打分 + 公式分
// 作常量 + ≥5 实际打分专家去 1 高 1 低 + 废标置后」双偏）。
// 语义与提取前逐行一致：expertTotals.length>=5 的 length 是**实际打分专家数**（非 panelSize）；
// formulaScore>0 才写 '__formula__' 单值（纯价格模式）；同分按供应商名确定性 tiebreaker。

export interface SupplierScoreRecordLite {
  expertId: string;
  scoreItemId: string;
  score: number | string | { toNumber?: () => number };
}

export interface ActiveSupplierLite {
  id: string;
  supplierName: string;
}

export interface AggregatedSupplierRank {
  supplierId: string;
  supplierName: string;
  totalScore: number;
  averageScore: number;
  disqualified: boolean;
  /** 实际参与聚合的「专家总分」个数（含 '__formula__' 纯价格单值） */
  expertCount: number;
  /** 去极值后参与均分的个数（<5 时 = expertCount） */
  trimmedCount: number;
}

export interface AggregateSupplierScoresInput {
  activeSuppliers: ActiveSupplierLite[];
  recordsBySupplier: Map<string, SupplierScoreRecordLite[]>;
  /** 公式引擎产出的价格分（supplierId → 分值）；空 Map = 公式未激活（专家 PRICE 打分正常计入） */
  formulaPriceScores: Map<string, number>;
  /** PRICE 类评分项 id 集——公式激活时跳过专家对这些项的打分 */
  priceItemIds: Set<string>;
  /** 通过性判废（超限价/不通过）；供应商 → true=废标置后 */
  passFailVerdicts: Map<string, boolean>;
  /** 唱标/最终轮报价（supplierId → 报价），谈判采购排序用 */
  bidPrices: Map<string, number>;
  /** 谈判采购：合格组按报价升序（最低价中标）；其余按均分降序 */
  isNegotiation: boolean;
}

export function aggregateSupplierScores(input: AggregateSupplierScoresInput): AggregatedSupplierRank[] {
  const { activeSuppliers, recordsBySupplier, formulaPriceScores, priceItemIds, passFailVerdicts, bidPrices, isNegotiation } = input;
  const ranked: AggregatedSupplierRank[] = [];
  for (const supplier of activeSuppliers) {
    const records = recordsBySupplier.get(supplier.id) ?? [];
    // 每位专家对该供应商的总评分
    const perExpert = new Map<string, number>();
    for (const r of records) {
      if (formulaPriceScores.size > 0 && priceItemIds.has(r.scoreItemId)) continue; // P1: 仅在公式引擎产出价格分时跳过专家 PRICE 打分
      perExpert.set(r.expertId, (perExpert.get(r.expertId) ?? 0) + Number(r.score));
    }
    // P1: 公式价格分作为常量加到每位专家总分(不影响去极值)
    const formulaScore = formulaPriceScores.get(supplier.id) ?? 0;
    if (formulaScore > 0) {
      if (perExpert.size > 0) {
        for (const eid of perExpert.keys()) perExpert.set(eid, perExpert.get(eid)! + formulaScore);
      } else {
        perExpert.set('__formula__', formulaScore); // 纯价格模式(无专家评分)
      }
    }
    const expertTotals = [...perExpert.values()].sort((a, b) => a - b);
    const totalScore = expertTotals.reduce((s, v) => s + v, 0);

    // 专家组≥5 时去 1 高 1 低（标准评标实务）——length 是实际打分专家数
    let trimmed = expertTotals;
    if (expertTotals.length >= 5) {
      trimmed = expertTotals.slice(1, -1);
    }
    const averageScore = trimmed.length > 0
      ? Math.round((trimmed.reduce((s, v) => s + v, 0) / trimmed.length) * 100) / 100
      : 0;

    ranked.push({
      supplierId: supplier.id,
      supplierName: supplier.supplierName,
      totalScore,
      averageScore,
      disqualified: !!passFailVerdicts.get(supplier.id),
      expertCount: expertTotals.length,
      trimmedCount: trimmed.length,
    });
  }
  // 合格者在前、废标者在后
  ranked.sort((a, b) => {
    if (a.disqualified !== b.disqualified) return a.disqualified ? 1 : -1;
    if (isNegotiation) {
      // 谈判采购: 合格组按最终报价升序（最低价中标），无报价者排末位
      const priceA = bidPrices.get(a.supplierId);
      const priceB = bidPrices.get(b.supplierId);
      if (priceA == null && priceB == null) return a.supplierName.localeCompare(b.supplierName, 'zh-CN');
      if (priceA == null) return 1;
      if (priceB == null) return -1;
      if (priceA !== priceB) return priceA - priceB;
      return a.supplierName.localeCompare(b.supplierName, 'zh-CN');
    }
    // 其余方式: 同组内按 averageScore 降序；同分按供应商名确定性排序（P2：tiebreaker，结果可复现）
    if (b.averageScore !== a.averageScore) return b.averageScore - a.averageScore;
    return a.supplierName.localeCompare(b.supplierName, 'zh-CN');
  });
  return ranked;
}
