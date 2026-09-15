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

test('parseAmountToYuan：unitHint=万元（dual-v2 唱标口径）裸数字按万元换算', () => {
  assert.equal(parseAmountToYuan('153.95', { unitHint: '万元' }), 1_539_500);
  assert.equal(parseAmountToYuan('153.8998', { unitHint: '万元' }), 1_538_998);
  assert.equal(parseAmountToYuan('1,260.5', { unitHint: '万元' }), 12_605_000);
  // 非「万元」提示不改变语义（裸数字仍按元）
  assert.equal(parseAmountToYuan('153.95', { unitHint: null }), 153.95);
  assert.equal(parseAmountToYuan('153.95', {}), 153.95);
});

test('parseAmountToYuan：unitHint 与文本自带单位并存时文本单位优先（两者同源不冲突）', () => {
  assert.equal(parseAmountToYuan('1150万元', { unitHint: '万元' }), 11_500_000);
  // 不可解析自由文本（面议）带 unitHint 仍 null——宁缺勿猜
  assert.equal(parseAmountToYuan('面议', { unitHint: '万元' }), null);
});

test('formatBidPrice：可解析格式化、不可解析回原文、空值占位', () => {
  assert.equal(formatBidPrice('1150万元'), '¥11,500,000');
  assert.equal(formatBidPrice(1485000), '¥1,485,000');
  assert.equal(formatBidPrice('1260.5'), '¥1,260.5');
  assert.equal(formatBidPrice('面议'), '面议');
  assert.equal(formatBidPrice(null), '—');
});

// 2026-09-15 P1-1：unitHint='万元'（dual-v2 报告口径）——裸数字直出「N 万元」；无提示零漂移
test('formatBidPrice：unitHint=万元——dual-v2 裸数字直出「N 万元」，无提示维持旧语义', () => {
  assert.equal(formatBidPrice('153.8998', { unitHint: '万元' }), '153.8998 万元');
  assert.equal(formatBidPrice('1,539,000', { unitHint: '万元' }), '1,539,000 万元');
  // 自带单位文本/自由文本行为不变（自描述）
  assert.equal(formatBidPrice('1150万元', { unitHint: '万元' }), '¥11,500,000');
  assert.equal(formatBidPrice('面议', { unitHint: '万元' }), '面议');
  // 无提示维持旧语义（裸数字=元，2 位小数截断——正是 P1-1 修复前报告页的误显形态）
  assert.equal(formatBidPrice('153.8998'), '¥153.9');
  assert.equal(formatBidPrice('153.8998', { unitHint: null }), '¥153.9');
});
