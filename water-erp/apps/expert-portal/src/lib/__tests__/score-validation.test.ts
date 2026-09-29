import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterScorableItems } from '../score-validation.ts';

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
