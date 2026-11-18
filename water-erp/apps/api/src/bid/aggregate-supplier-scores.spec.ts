// apps/api/src/bid/aggregate-supplier-scores.spec.ts
// F12：官方口径聚合纯函数——自 generateEvaluationResults 提取（行为守门由既有 generate 用例承担），
// 这里补齐提取前无独立覆盖的分支：去极值边界/公式常量替换/纯价格模式/废标置后/谈判排序。
import { aggregateSupplierScores } from './aggregate-supplier-scores';

const emptyFormula = new Map<string, number>();
const emptyItemIds = new Set<string>();
const emptyVerdicts = new Map<string, boolean>();
const emptyPrices = new Map<string, number>();

/** n 位专家对一家供应商各打一条记录 */
const recs = (supplierId: string, scoresByExpert: Record<string, number>, scoreItemId = 'si-tech') =>
  [supplierId, Object.entries(scoresByExpert).map(([expertId, score]) => ({ expertId, scoreItemId, score })) ] as const;

describe('aggregateSupplierScores（F12 提取纯函数）', () => {
  it('≥5 位实际打分专家 → 去 1 高 1 低再均分；不足 5 位不去', () => {
    const records = new Map([
      recs('s1', { e1: 90, e2: 92, e3: 94, e4: 96, e5: 98 }), // 去 90/98 → [92,94,96] 均 94
      recs('s2', { e1: 80, e2: 82 }), // 2 位不去 → 均 81
    ]);
    const ranked = aggregateSupplierScores({
      activeSuppliers: [{ id: 's1', supplierName: '甲' }, { id: 's2', supplierName: '乙' }],
      recordsBySupplier: records, formulaPriceScores: emptyFormula, priceItemIds: emptyItemIds,
      passFailVerdicts: emptyVerdicts, bidPrices: emptyPrices, isNegotiation: false,
    });
    const s1 = ranked.find(r => r.supplierId === 's1')!;
    expect(s1.averageScore).toBe(94);
    expect(s1.expertCount).toBe(5);
    expect(s1.trimmedCount).toBe(3);
    expect(s1.totalScore).toBe(470); // 去极值不影响 totalScore（全员合计）
    expect(ranked.find(r => r.supplierId === 's2')!.averageScore).toBe(81);
    expect(ranked.find(r => r.supplierId === 's2')!.trimmedCount).toBe(2);
  });

  it('trimOutliers=false（项目关闭去极值）→ ≥5 位专家也全额均分', () => {
    const records = new Map([
      recs('s1', { e1: 90, e2: 92, e3: 94, e4: 96, e5: 98 }), // 全额 [90..98] 均 94
    ]);
    const ranked = aggregateSupplierScores({
      activeSuppliers: [{ id: 's1', supplierName: '甲' }],
      recordsBySupplier: records, formulaPriceScores: emptyFormula, priceItemIds: emptyItemIds,
      passFailVerdicts: emptyVerdicts, bidPrices: emptyPrices, isNegotiation: false,
      trimOutliers: false,
    });
    const s1 = ranked[0];
    expect(s1.averageScore).toBe(94); // (90+92+94+96+98)/5 = 94
    expect(s1.trimmedCount).toBe(5); // 未去极值=全员参与均分
    expect(s1.expertCount).toBe(5);
  });

  it('trimOutliers 缺省 → 沿用 ≥5 去极值（存量调用方零变化）', () => {
    const records = new Map([
      recs('s1', { e1: 90, e2: 92, e3: 94, e4: 96, e5: 98 }),
    ]);
    const ranked = aggregateSupplierScores({
      activeSuppliers: [{ id: 's1', supplierName: '甲' }],
      recordsBySupplier: records, formulaPriceScores: emptyFormula, priceItemIds: emptyItemIds,
      passFailVerdicts: emptyVerdicts, bidPrices: emptyPrices, isNegotiation: false,
    });
    expect(ranked[0].trimmedCount).toBe(3); // 默认去极值仍生效
  });

  it('公式价格分作常量：跳过专家 PRICE 打分 + 加到每位专家总分（不影响去极值对称性）', () => {
    // 专家对 PRICE 项各打 10（应被忽略），技术项 5 位专家打 80-100
    const records = new Map([
      ['s1', [
        ...Object.entries({ e1: 80, e2: 85, e3: 90, e4: 95, e5: 100 }).map(([expertId, score]) => ({ expertId, scoreItemId: 'si-tech', score })),
        ...Object.entries({ e1: 10, e2: 10, e3: 10, e4: 10, e5: 10 }).map(([expertId, score]) => ({ expertId, scoreItemId: 'si-price', score })),
      ]],
    ]);
    const ranked = aggregateSupplierScores({
      activeSuppliers: [{ id: 's1', supplierName: '甲' }],
      recordsBySupplier: records,
      formulaPriceScores: new Map([['s1', 30]]),
      priceItemIds: new Set(['si-price']),
      passFailVerdicts: emptyVerdicts, bidPrices: emptyPrices, isNegotiation: false,
    });
    // 每位专家总分 = 技术 + 30；[110,115,120,125,130] 去 110/130 → [115,120,125] 均 120
    expect(ranked[0].averageScore).toBe(120);
    expect(ranked[0].totalScore).toBe(600);
  });

  it('纯价格模式（无专家评分）→ __formula__ 单值直接作均分与总分', () => {
    const ranked = aggregateSupplierScores({
      activeSuppliers: [{ id: 's1', supplierName: '甲' }],
      recordsBySupplier: new Map(),
      formulaPriceScores: new Map([['s1', 28.5]]),
      priceItemIds: new Set(['si-price']),
      passFailVerdicts: emptyVerdicts, bidPrices: emptyPrices, isNegotiation: false,
    });
    expect(ranked[0].averageScore).toBe(28.5);
    expect(ranked[0].totalScore).toBe(28.5);
    expect(ranked[0].expertCount).toBe(1);
    // formulaScore=0 不写 __formula__（原语义）——无记录无公式分 → 均分 0
    const zero = aggregateSupplierScores({
      activeSuppliers: [{ id: 's2', supplierName: '乙' }],
      recordsBySupplier: new Map(),
      formulaPriceScores: new Map([['s2', 0]]),
      priceItemIds: new Set(['si-price']),
      passFailVerdicts: emptyVerdicts, bidPrices: emptyPrices, isNegotiation: false,
    });
    expect(zero[0].averageScore).toBe(0);
    expect(zero[0].expertCount).toBe(0);
  });

  it('废标置后；均分降序 + 同分按名称确定性 tiebreaker', () => {
    const records = new Map([
      recs('s1', { e1: 90 }), // 90
      recs('s2', { e1: 95 }), // 95 高分但废标
      recs('s3', { e1: 85 }), // 85
    ]);
    const ranked = aggregateSupplierScores({
      activeSuppliers: [
        { id: 's1', supplierName: '甲' }, { id: 's2', supplierName: '乙' }, { id: 's3', supplierName: '丙' },
      ],
      recordsBySupplier: records, formulaPriceScores: emptyFormula, priceItemIds: emptyItemIds,
      passFailVerdicts: new Map([['s2', true]]), bidPrices: emptyPrices, isNegotiation: false,
    });
    expect(ranked.map(r => r.supplierId)).toEqual(['s1', 's3', 's2']); // 合格降序，废标垫底
    expect(ranked[0].disqualified).toBe(false);
    expect(ranked[2].disqualified).toBe(true);
  });

  it('谈判采购：合格组按报价升序（最低价中标），无报价者排末位', () => {
    const records = new Map([recs('s1', { e1: 90 }), recs('s2', { e1: 90 }), recs('s3', { e1: 90 })]);
    const ranked = aggregateSupplierScores({
      activeSuppliers: [
        { id: 's1', supplierName: '甲' }, { id: 's2', supplierName: '乙' }, { id: 's3', supplierName: '丙' },
      ],
      recordsBySupplier: records, formulaPriceScores: emptyFormula, priceItemIds: emptyItemIds,
      passFailVerdicts: emptyVerdicts,
      bidPrices: new Map([['s1', 120], ['s2', 100]]), // s3 无报价
      isNegotiation: true,
    });
    expect(ranked.map(r => r.supplierId)).toEqual(['s2', 's1', 's3']); // 100 < 120 < 无报价垫底
  });
});

describe('bug#140a 资格短路豁免——判不通过的专家不进该供应商聚合', () => {
  const PF = new Set(['si-pf']);
  const base = {
    formulaPriceScores: emptyFormula, priceItemIds: emptyItemIds,
    passFailVerdicts: emptyVerdicts, bidPrices: emptyPrices, isNegotiation: false,
  };

  it('豁免专家（通过性记录 passed=false）不进 perExpert：幻影 0 不拖均分、不虚增 expertCount', () => {
    const records = new Map<string, any[]>([
      ['s1', [
        { expertId: 'e1', scoreItemId: 'si-pf', score: 0, passed: false },
        { expertId: 'e2', scoreItemId: 'si-tech', score: 85 },
        { expertId: 'e3', scoreItemId: 'si-tech', score: 90 },
      ]],
    ]);
    const ranked = aggregateSupplierScores({
      ...base, passFailItemIds: PF,
      activeSuppliers: [{ id: 's1', supplierName: '甲' }],
      recordsBySupplier: records,
    });
    expect(ranked[0].averageScore).toBe(87.5); // 修复前 [0,85,90] → 58.33
    expect(ranked[0].expertCount).toBe(2);
    expect(ranked[0].totalScore).toBe(175);
  });

  it('豁免专家的历史全量残留记录一并排除（先全量评完再改判不通过——同态同果）', () => {
    const records = new Map<string, any[]>([
      ['s1', [
        { expertId: 'e1', scoreItemId: 'si-pf', score: 0, passed: false },
        { expertId: 'e1', scoreItemId: 'si-tech', score: 88 }, // 改判前残留
        { expertId: 'e2', scoreItemId: 'si-tech', score: 90 },
      ]],
    ]);
    const ranked = aggregateSupplierScores({
      ...base, passFailItemIds: PF,
      activeSuppliers: [{ id: 's1', supplierName: '甲' }],
      recordsBySupplier: records,
    });
    expect(ranked[0].averageScore).toBe(90); // 残留 88 不参与，与「先判后评」一致
    expect(ranked[0].expertCount).toBe(1);
  });

  it('豁免只按 (专家,供应商) 对：e1 对 s1 豁免不影响其对 s2 的正常参与', () => {
    const records = new Map<string, any[]>([
      ['s1', [
        { expertId: 'e1', scoreItemId: 'si-pf', score: 0, passed: false },
        { expertId: 'e2', scoreItemId: 'si-tech', score: 90 },
      ]],
      ['s2', [
        { expertId: 'e1', scoreItemId: 'si-pf', score: 0, passed: true },
        { expertId: 'e1', scoreItemId: 'si-tech', score: 80 },
        { expertId: 'e2', scoreItemId: 'si-tech', score: 90 },
      ]],
    ]);
    const ranked = aggregateSupplierScores({
      ...base, passFailItemIds: PF,
      activeSuppliers: [{ id: 's1', supplierName: '甲' }, { id: 's2', supplierName: '乙' }],
      recordsBySupplier: records,
    });
    expect(ranked.find(r => r.supplierId === 's1')!.expertCount).toBe(1);
    const s2 = ranked.find(r => r.supplierId === 's2')!;
    expect(s2.expertCount).toBe(2);
    expect(s2.averageScore).toBe(85);
  });

  it('改票（passed 翻 true）→ 自动回参与（无状态自愈，与 recompute 分母豁免同构）', () => {
    const records = new Map<string, any[]>([
      ['s1', [
        { expertId: 'e1', scoreItemId: 'si-pf', score: 0, passed: true }, // 改判通过
        { expertId: 'e1', scoreItemId: 'si-tech', score: 82 },
        { expertId: 'e2', scoreItemId: 'si-tech', score: 90 },
      ]],
    ]);
    const ranked = aggregateSupplierScores({
      ...base, passFailItemIds: PF,
      activeSuppliers: [{ id: 's1', supplierName: '甲' }],
      recordsBySupplier: records,
    });
    expect(ranked[0].averageScore).toBe(86); // (82+90)/2
    expect(ranked[0].expertCount).toBe(2);
  });

  it('passFailItemIds 缺省 → 不过滤（未提供 PF 集的既有调用零变化）', () => {
    const records = new Map<string, any[]>([
      ['s1', [
        { expertId: 'e1', scoreItemId: 'si-pf', score: 0, passed: false },
        { expertId: 'e2', scoreItemId: 'si-tech', score: 90 },
      ]],
    ]);
    const ranked = aggregateSupplierScores({
      ...base,
      activeSuppliers: [{ id: 's1', supplierName: '甲' }],
      recordsBySupplier: records,
    });
    expect(ranked[0].averageScore).toBe(45); // (0+90)/2 —— 旧口径
    expect(ranked[0].expertCount).toBe(2);
  });

  it('幻影 0 不再提前触发去极值（4 真实 + 1 豁免 → 4 人不去极值，真实最高分不被误剔）', () => {
    const records = new Map<string, any[]>([
      ['s1', [
        { expertId: 'e0', scoreItemId: 'si-pf', score: 0, passed: false },
        ...Object.entries({ e1: 80, e2: 85, e3: 90, e4: 95 }).map(([expertId, score]) => ({ expertId, scoreItemId: 'si-tech', score })),
      ]],
    ]);
    const ranked = aggregateSupplierScores({
      ...base, passFailItemIds: PF,
      activeSuppliers: [{ id: 's1', supplierName: '甲' }],
      recordsBySupplier: records,
    });
    expect(ranked[0].expertCount).toBe(4);
    expect(ranked[0].trimmedCount).toBe(4); // 修复前 5 值（含幻影 0）去极值误剔真实最高 95
    expect(ranked[0].averageScore).toBe(87.5); // (80+85+90+95)/4
  });
});
