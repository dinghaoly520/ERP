import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterScorableItems, buildPendingScoreDraft } from '../score-validation.ts';

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
