import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePhoneInput } from '../phone-input.ts';

// 背景（2026-10-19 注册手机号「输入正确仍提示无效」事故）：输入框 maxLength={11}
// 按原始字符计数，粘贴「138 1234 5678」先被截成 11 字符、onChange 再剥非数字，
// 状态只剩 9 位 → ^1[3-9]\d{9}$ 校验失败。收口原则：先归一化（全角→半角）、
// 再剥分隔符、后截 11 位。
test('sanitizePhoneInput 空格/连字符分隔的完整手机号不丢数字', () => {
  assert.equal(sanitizePhoneInput('138 1234 5678'), '13812345678');
  assert.equal(sanitizePhoneInput('138-1234-5678'), '13812345678');
  assert.equal(sanitizePhoneInput('138 12345678'), '13812345678');
});

test('sanitizePhoneInput 全角数字（中文输入法）归一为半角而非丢弃', () => {
  assert.equal(sanitizePhoneInput('１３８１２３４５６７８'), '13812345678');
  assert.equal(sanitizePhoneInput('１３８ １２３４ ５６７８'), '13812345678');
});

test('sanitizePhoneInput +86/86 前缀粘贴（通讯录复制）剥国家码', () => {
  assert.equal(sanitizePhoneInput('+86 138 1234 5678'), '13812345678');
  assert.equal(sanitizePhoneInput('8613812345678'), '13812345678');
});

test('sanitizePhoneInput 13 位但非 86 前缀形态按位截断（不猜）', () => {
  assert.equal(sanitizePhoneInput('1381234567890'), '13812345678');
});

test('sanitizePhoneInput 超过 11 位截断（保留逐位键入的 maxLength 行为）', () => {
  assert.equal(sanitizePhoneInput('138123456789'), '13812345678');
});

test('sanitizePhoneInput 纯非数字输入归空', () => {
  assert.equal(sanitizePhoneInput('abc'), '');
  assert.equal(sanitizePhoneInput(''), '');
});
