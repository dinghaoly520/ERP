// apps/api/src/bid/aggregate-supplier-scores.ts
// F12（2026-08-28）官方口径供应商聚合与排名——自 generateEvaluationResults 提取为纯函数，与
// live-official-scores（排名预览）共用单一事实源（旧前端预览复刻口径双偏：原始均分 vs 官方
// 「跳过公式项打分+公式分常量+≥5 实际打分专家去 1 高 1 低+废标置后」）。
// 语义与提取前逐行一致：length>=5 的 length 是实际打分专家数（非 panelSize）；formulaScore>0
// 才写 '__formula__' 单值；同分按供应商名确定性 tiebreaker。

export interface SupplierScoreRecordLite {
  expertId: string;
  scoreItemId: string;
  score: number | string | { toNumber?: () => number };
  /** 通过性结论（bug#140a 聚合豁免过滤用；缺省/null = 非通过性记录或未投） */
  passed?: boolean | null;
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
  /** 去极值开关（2026-09-26 项目级配置 BidProject.scoreTrimEnabled）：false=全额均分（即便 ≥5 人）；
   *  缺省 true=沿用 ≥5 去 1 高 1 低（存量调用方零变化） */
  trimOutliers?: boolean;
  /** 通过性评分项 id 集（bug#140a 资格短路豁免）：该专家对该供应商任一通过性记录 passed=false →
   *  该专家不进该供应商的专家总分（豁免家只交通过性记录 score=0，计入即幻影 0 拖均分/虚增
   *  expertCount/提前触发去极值误剔真实极值；历史全量残留记录同口径一并排除）。
   *  与 recomputeExpertProgress 分母豁免同构——改票后 passed 不再 false 自动回参与。
   *  缺省 = 不过滤（未接线的既有调用零变化） */
  passFailItemIds?: Set<string>;
  /** P3-15（2026-11-20 全链路审查）：专家回避申报（expertId → 回避 supplierId 集）——
   *  对该供应商申报回避的专家，其已交评分不进该供应商的聚合与去极值序列（可评集合与
   *  聚合集合一致；回避后评分视同作废，与核对/进度分母的回避收缩同构）。
   *  缺省 = 不过滤（未接线的既有调用零变化）。 */
  expertConflicts?: Map<string, Set<string>>;
}

export function aggregateSupplierScores(input: AggregateSupplierScoresInput): AggregatedSupplierRank[] {
  const { activeSuppliers, recordsBySupplier, formulaPriceScores, priceItemIds, passFailVerdicts, bidPrices, isNegotiation, trimOutliers = true, passFailItemIds, expertConflicts } = input;
  const ranked: AggregatedSupplierRank[] = [];
  for (const supplier of activeSuppliers) {
    const records = recordsBySupplier.get(supplier.id) ?? [];
    // bug#140a 资格短路豁免：该专家对该供应商已判任一通过性项「不通过」→ 该专家不进该供应商的
    // 专家总分（豁免仅本专家×本供应商；废标置后仍由 passFailVerdicts 全员投票轨决定，两轨不互斥）
    const exemptExperts = new Set<string>();
    if (passFailItemIds && passFailItemIds.size > 0) {
      for (const r of records) {
        if (r.passed === false && passFailItemIds.has(r.scoreItemId)) exemptExperts.add(r.expertId);
      }
    }
    // P3-15：回避排除——对该供应商申报回避的专家整体不参与（含历史残留记录）
    if (expertConflicts) {
      for (const [expertId, conflicted] of expertConflicts) {
        if (conflicted.has(supplier.id)) exemptExperts.add(expertId);
      }
    }
    // 每位专家对该供应商的总评分
    const perExpert = new Map<string, number>();
    for (const r of records) {
      if (exemptExperts.has(r.expertId)) continue; // bug#140a：豁免专家整体不参与（含历史残留记录）
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

    // 专家组≥5 时去 1 高 1 低（标准评标实务）——length 是实际打分专家数；
    // trimOutliers=false（项目关闭）→ 全额均分（2026-09-26 项目级开关）
    let trimmed = expertTotals;
    if (trimOutliers && expertTotals.length >= 5) {
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
