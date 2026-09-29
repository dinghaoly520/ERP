// packages/shared/src/__tests__/evaluation-rules.test.ts
// 生成评标结果「生成规则」文案的口径测试——文案必须随 :3005 配置
// （BidProject.scoreTrimEnabled / priceFormulaConfig / evaluationMethod / ceilingPrice）走，
// 镜像 apps/api generateEvaluationResults + aggregateSupplierScores 的实际行为。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveEvaluationMethod,
  resolvePriceFormulaType,
  summarizeEvaluationRules,
  PRICE_FORMULA_LABELS,
} from '../evaluation-rules';

test('deriveEvaluationMethod：显式 evaluationMethod 优先，缺省按采购方式推导', () => {
  assert.equal(deriveEvaluationMethod('lowest_price', '邀请招标'), 'lowest_price');
  assert.equal(deriveEvaluationMethod(null, '谈判采购'), 'qualified_lowest_price');
  assert.equal(deriveEvaluationMethod(null, '邀请招标'), 'manual');
  assert.equal(deriveEvaluationMethod(undefined, '未知方式'), 'manual'); // FALLBACK 同口径
  assert.equal(deriveEvaluationMethod(undefined, undefined), 'manual');
});

test('resolvePriceFormulaType：null=manual；非法/缺失回退 lowest_price（引擎 default 分支同口径）', () => {
  assert.equal(resolvePriceFormulaType(null), 'manual');
  assert.equal(resolvePriceFormulaType(undefined), 'manual');
  assert.equal(resolvePriceFormulaType({ formulaType: 'benchmark_deviation', K: 0.97 }), 'benchmark_deviation');
  assert.equal(resolvePriceFormulaType({ formulaType: 'ratio' }), 'ratio');
  assert.equal(resolvePriceFormulaType({}), 'lowest_price'); // 历史 {} 脏数据
  assert.equal(resolvePriceFormulaType({ formulaType: 'bogus' }), 'lowest_price');
});

test('默认配置（trim 开、无公式、综合评估）：去极值 + 专家手填价格分 + 前 3 名候选', () => {
  const s = summarizeEvaluationRules({
    procurementMethod: '邀请招标',
    hasPriceScoreItems: true,
  });
  assert.equal(s.trimEnabled, true);
  assert.equal(s.formulaType, 'manual');
  assert.equal(s.formulaActive, false);
  assert.equal(s.winnerCount, 3);
  assert.equal(s.isNegotiation, false);
  assert.equal(s.overCeilingDisqualifies, false);
  assert.ok(s.ruleLines.some(l => l.includes('去掉 1 个最高分与 1 个最低分')));
  assert.ok(s.ruleLines.some(l => l.includes('价格分由专家按评分标准手填')));
  assert.ok(s.ruleLines.some(l => l.includes('前 3 名推荐为中标候选人')));
  assert.ok(!s.ruleLines.some(l => l.includes('最高限价')));
});

test('scoreTrimEnabled=false：文案改为全额均分，不再宣称去极值', () => {
  const s = summarizeEvaluationRules({ scoreTrimEnabled: false, procurementMethod: '邀请招标' });
  assert.equal(s.trimEnabled, false);
  assert.ok(s.ruleLines.some(l => l.includes('直接求均分') && l.includes('已关闭去极值')));
  assert.ok(!s.ruleLines.some(l => l.includes('去掉 1 个最高分')));
});

test('配置公式（基准价偏离法 + 限价）：公式行 + 超限价废标行，无手填行', () => {
  const s = summarizeEvaluationRules({
    procurementMethod: '邀请招标',
    evaluationMethod: 'comprehensive',
    priceFormulaConfig: { formulaType: 'benchmark_deviation', K: 0.97, penaltyRate: 2 },
    ceilingPrice: '1000000',
    hasPriceScoreItems: true,
  });
  assert.equal(s.formulaType, 'benchmark_deviation');
  assert.equal(s.formulaActive, true);
  assert.equal(s.overCeilingDisqualifies, true);
  assert.ok(s.ruleLines.some(l => l.includes(`「${PRICE_FORMULA_LABELS.benchmark_deviation}」`) && l.includes('公式自动计算')));
  assert.ok(!s.ruleLines.some(l => l.includes('专家按评分标准手填')));
  assert.ok(s.ruleLines.some(l => l.includes('报价超过最高限价') && l.includes('废标')));
});

test('公式配置但无 PRICE 评分项：引擎不激活（formulaActive=false），不出现公式/手填行', () => {
  const s = summarizeEvaluationRules({
    procurementMethod: '邀请招标',
    priceFormulaConfig: { formulaType: 'lowest_price' },
    hasPriceScoreItems: false,
  });
  assert.equal(s.formulaActive, false);
  assert.ok(!s.ruleLines.some(l => l.includes('价格分')));
  assert.equal(s.overCeilingDisqualifies, false); // 无公式且非谈判 → 限价不参与判废
});

test('谈判采购：按最终报价升序 + 最低价中标 + 第 1 名候选', () => {
  const s = summarizeEvaluationRules({
    procurementMethod: '谈判采购',
    ceilingPrice: 500000,
  });
  assert.equal(s.isNegotiation, true);
  assert.equal(s.winnerCount, 1);
  assert.equal(s.overCeilingDisqualifies, true); // 谈判按最终报价判超限价
  assert.ok(s.ruleLines.some(l => l.includes('按最终报价由低到高排序') && l.includes('最低价')));
  assert.ok(s.ruleLines.some(l => l.includes('报价超过最高限价')));
});

test('最低价法（询比/竞价）：第 1 名候选', () => {
  const s = summarizeEvaluationRules({ procurementMethod: '询比采购', evaluationMethod: 'lowest_price' });
  assert.equal(s.winnerCount, 1);
  assert.ok(s.ruleLines.some(l => l.includes('第 1 名推荐为中标候选人')));
  assert.ok(!s.ruleLines.some(l => l.includes('前 3 名')));
});

test('不评分（直接采购）：第 1 名候选', () => {
  const s = summarizeEvaluationRules({ procurementMethod: '直接采购' });
  assert.equal(s.winnerCount, 1);
});
