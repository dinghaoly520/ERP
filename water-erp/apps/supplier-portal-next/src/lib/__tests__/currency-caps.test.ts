import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCNYCaps, integerToCaps, shiftDecimal } from '../currency-caps';

test('integerToCaps 基本与零的压缩', () => {
  assert.equal(integerToCaps('0'), '零');
  assert.equal(integerToCaps('5'), '伍');
  assert.equal(integerToCaps('10'), '壹拾');
  assert.equal(integerToCaps('5000'), '伍仟');
  assert.equal(integerToCaps('1001'), '壹仟零壹');
  assert.equal(integerToCaps('10500'), '壹万零伍佰');
  assert.equal(integerToCaps('10001'), '壹万零壹');
  assert.equal(integerToCaps('100000000'), '壹亿');
  assert.equal(integerToCaps('100000001'), '壹亿零壹');
  assert.equal(integerToCaps('100010000'), '壹亿零壹万');
  assert.equal(integerToCaps('50000000'), '伍仟万');
  assert.equal(integerToCaps('1000000000000'), '壹万亿');
});

test('integerToCaps 非法输入返回空串', () => {
  assert.equal(integerToCaps('12a'), '');
  assert.equal(integerToCaps(''), '');
});

test('shiftDecimal 精确右移（无浮点误差）', () => {
  assert.equal(shiftDecimal('5000', 4), '50000000');
  assert.equal(shiftDecimal('5000.5', 4), '50005000');
  assert.equal(shiftDecimal('0.5', 4), '5000');
  assert.equal(shiftDecimal('1.2345', 4), '12345');
  assert.equal(shiftDecimal('abc', 4), '');
});

test('formatCNYCaps 财务口径', () => {
  assert.equal(formatCNYCaps('0'), '人民币零元整');
  assert.equal(formatCNYCaps('50000000'), '人民币伍仟万元整');
  assert.equal(formatCNYCaps('12345678.09'), '人民币壹仟贰佰叁拾肆万伍仟陆佰柒拾捌元零玖分');
  assert.equal(formatCNYCaps('0.5'), '人民币零元伍角');
  assert.equal(formatCNYCaps('0.05'), '人民币零元零伍分');
  assert.equal(formatCNYCaps('1.05'), '人民币壹元零伍分');
  assert.equal(formatCNYCaps('1.5'), '人民币壹元伍角');
  assert.equal(formatCNYCaps('1.55'), '人民币壹元伍角伍分');
  // 元位为 0 时「零」可省（人行《正确填写票据基本规定》第五条），取不写零的简写
  assert.equal(formatCNYCaps(3000.5), '人民币叁仟元伍角');
  assert.equal(formatCNYCaps('abc'), '');
  assert.equal(formatCNYCaps('1.234'), '');
});

test('注册资金万元口径组合：输入万元数 → 右移 4 位再转大写', () => {
  // 5000 万元 = 50000000 元
  assert.equal(formatCNYCaps(shiftDecimal('5000', 4)), '人民币伍仟万元整');
  // 5000.5 万元 = 50005000 元
  assert.equal(formatCNYCaps(shiftDecimal('5000.5', 4)), '人民币伍仟万伍仟元整');
  // 123.45 万元 = 1234500 元
  assert.equal(formatCNYCaps(shiftDecimal('123.45', 4)), '人民币壹佰贰拾叁万肆仟伍佰元整');
});
