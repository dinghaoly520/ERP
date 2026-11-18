import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterScorableItems, buildPendingScoreDraft, buildServerMentionedEntries } from '../score-validation.ts';

test('EXP-P0-01: 价格分公式激活时剔除 PRICE 项（不进校验/payload/进度分母）', () => {
  const items = [
    { id: 'a', category: 'TECHNICAL', maxScore: 30 },
    { id: 'b', category: 'PRICE', maxScore: 30 },
    { id: 'c', category: 'QUALIFICATION', maxScore: 10 },
  ];
  assert.deepEqual(
    filterScorableItems(items, true).map((i) => i.id),
    ['a', 'c'],
  );
});

test('EXP-P0-01: 公式未激活（专家手填模式）保留 PRICE 项', () => {
  const items = [
    { id: 'a', category: 'TECHNICAL', maxScore: 30 },
    { id: 'b', category: 'PRICE', maxScore: 30 },
  ];
  assert.deepEqual(
    filterScorableItems(items, false).map((i) => i.id),
    ['a', 'b'],
  );
});

test('EXP-P0-01: 无 PRICE 项时原样返回（含空数组）', () => {
  assert.equal(filterScorableItems([{ id: 'a', category: 'TECHNICAL', maxScore: 30 }], true).length, 1);
  assert.deepEqual(filterScorableItems([], true), []);
});

// ── TAB-SYNC-02 Task 1（⑤）：buildPendingScoreDraft——双页 buildPendingDraft/ buildPendingTabletDraft 收敛 ──

test('BPSD-① 与已提交记录等价（三字段+得分点）→ 不入草稿', () => {
  const myScores = [{ supplierId: 's1', scoreItemId: 'i1', score: 90, passed: true, reason: '好' }];
  const items = [{ id: 'i1', category: 'TECHNICAL' }];
  const scores = { 's1:i1': { score: 90, reason: '好', passed: true } };
  const pending = buildPendingScoreDraft(scores as any, myScores as any, items as any);
  assert.deepEqual(Object.keys(pending), []);
});

test('BPSD-② 与已提交记录不等价（改了分）→ 保留', () => {
  const myScores = [{ supplierId: 's1', scoreItemId: 'i1', score: 90, passed: true, reason: '好' }];
  const items = [{ id: 'i1', category: 'TECHNICAL' }];
  const scores = { 's1:i1': { score: 95, reason: '好', passed: true } };
  const pending = buildPendingScoreDraft(scores as any, myScores as any, items as any);
  assert.deepEqual(Object.keys(pending), ['s1:i1']);
});

test('BPSD-③ 无已提交记录 → 保留（未提交编辑是草稿本体）', () => {
  const pending = buildPendingScoreDraft({ 's1:i1': { score: 60, reason: '' } } as any, [], []);
  assert.deepEqual(Object.keys(pending), ['s1:i1']);
});

// ── T2/T3 审查 Important#1 回修：pointDecisions 提及键的基线条目必须纯服务端构造 ──

test('BSM-① 提及键有 committed 记录 → 三字段取记录值、points 仅含该键服务端点决策（本地值零混入）', () => {
  const myScores = [{ supplierId: 's1', scoreItemId: 'i1', score: 90, passed: true, reason: '服务端理由' }];
  const items = [{ id: 'i1', category: 'TECHNICAL', points: [{ id: 'p1' }, { id: 'p2' }] }];
  const pds = [{ pointId: 'p1', supplierId: 's1', checked: true, awardedScore: 5, note: 'n1' }];
  const out = buildServerMentionedEntries(myScores as any, items as any, pds);
  // 纯服务端：三字段来自记录；points 只带 p1（p2 无服务端决策不出现——不回退本地/不造默认）
  assert.deepEqual(out['s1:i1'], {
    score: 90, reason: '服务端理由', passed: true,
    points: { p1: { checked: true, awardedScore: 5, note: 'n1' } },
  });
});

test('BSM-② 提及键无 committed 记录 → 三字段取零值兜底、points 服务端（防本地未推送值经 cur 混入基线）', () => {
  const items = [{ id: 'i1', category: 'TECHNICAL', points: [{ id: 'p1' }] }];
  const pds = [{ pointId: 'p1', supplierId: 's9', checked: false, awardedScore: 0 }];
  const out = buildServerMentionedEntries([], items as any, pds);
  assert.deepEqual(out['s9:i1'], {
    score: 0, reason: '',
    points: { p1: { checked: false, awardedScore: 0, note: undefined } },
  });
});

test('BSM-③ pointId 不属于任何评分项 → 跳过（不造悬空键）；空决策 → 空对象', () => {
  const items = [{ id: 'i1', category: 'TECHNICAL', points: [{ id: 'p1' }] }];
  const out = buildServerMentionedEntries([], items as any, [{ pointId: 'ghost', supplierId: 's1', checked: true, awardedScore: 1 }]);
  assert.deepEqual(Object.keys(out), []);
  assert.deepEqual(buildServerMentionedEntries([], items as any, []), {});
});
