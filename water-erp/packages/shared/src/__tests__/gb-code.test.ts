// packages/shared/src/__tests__/gb-code.test.ts
// GB/T 43711 B.4 组合码（国标编码）口径测试。
// 原为 src/gb-code.spec.ts（jest 风格）——shared 测试走 tsx --test，
// jest 风格 spec 无 runner 执行，2026-11-05 转为 node:test 使其真正跑起来。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGbProjectCode, buildGbProcureCode, buildGbSectionCode, buildSubjectCode } from '../gb-code';

test('buildGbProjectCode：项目编码 18 位结构正确', () => {
  const code = buildGbProjectCode({
    industryCode: '511', regionCode: '51', platformSeq: '0001',
    date: new Date('2026-08-26'), projectSeq: 7,
  });
  assert.equal(code, '511510001260826007');
  assert.equal(code.length, 18);
});

test('buildGbProcureCode：采购项目编码 21 位 = 项目编码 + 序列', () => {
  assert.equal(buildGbProcureCode('511510001260826007', 1), '511510001260826007001');
});

test('buildGbSectionCode：标段编码 24 位，单标段默认 001', () => {
  assert.equal(buildGbSectionCode('511510001260826007001'), '511510001260826007001001');
  assert.equal(buildGbSectionCode('511510001260826007001', 12).length, 24);
});

test('buildGb*Code：非法输入抛错', () => {
  assert.throws(() => buildGbProjectCode({ industryCode: '51', regionCode: '51', platformSeq: '0001', projectSeq: 1 }));
  assert.throws(() => buildGbProcureCode('123', 1));
  assert.throws(() => buildGbSectionCode('511510001260826007001', 0));
});

test('buildSubjectCode：B+信用代码；非法/缺失返回 null', () => {
  assert.equal(buildSubjectCode('91510000MA6CMJ0004'), 'B91510000MA6CMJ0004');
  assert.equal(buildSubjectCode(null), null);
  assert.equal(buildSubjectCode('123'), null);
});
