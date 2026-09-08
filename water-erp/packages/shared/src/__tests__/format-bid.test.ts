// packages/shared/src/__tests__/format-bid.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmountToYuan, formatBidPrice } from '../format-bid';

test('parseAmountToYuan：万元字符串', () => {
  assert.equal(parseAmountToYuan('1150万元'), 11_500_000);
  assert.equal(parseAmountToYuan('1080 万元'), 10_800_000);
  assert.equal(parseAmountToYuan('1.5万元'), 15_000);
});

test('parseAmountToYuan：纯数字与千分位', () => {
  assert.equal(parseAmountToYuan('1260.5'), 1260.5);
  assert.equal(parseAmountToYuan('1,485,000'), 1_485_000);
  assert.equal(parseAmountToYuan(1485000), 1_485_000);
});

test('parseAmountToYuan：不可解析与空值', () => {
  assert.equal(parseAmountToYuan('面议'), null);
  assert.equal(parseAmountToYuan(''), null);
  assert.equal(parseAmountToYuan(null), null);
  assert.equal(parseAmountToYuan(undefined), null);
});

test('formatBidPrice：可解析格式化、不可解析回原文、空值占位', () => {
  assert.equal(formatBidPrice('1150万元'), '¥11,500,000');
  assert.equal(formatBidPrice(1485000), '¥1,485,000');
  assert.equal(formatBidPrice('1260.5'), '¥1,260.5');
  assert.equal(formatBidPrice('面议'), '面议');
  assert.equal(formatBidPrice(null), '—');
});
