// 集团全级次企业名单守护（2026-11-10 上移 shared 单一源）：名单是「勿手改」的
// 自动生成件、被注册页与公司主数据同步脚本两端消费——长度/唯一性/代码格式漂移
// 会直接变成注册候选与 Company 主数据的脏数据，在此拦截。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SASAC_UNITS } from '../sasac-units';

test('SASAC_UNITS 共 62 家（与 2026-09-17 提取底稿一致）', () => {
  assert.equal(SASAC_UNITS.length, 62);
});

test('公司名称唯一（重名会在按名补缺/查重语义下静默并轨）', () => {
  const names = SASAC_UNITS.map((u) => u.name);
  assert.equal(new Set(names).size, names.length);
});

test('统一社会信用代码均为 18 位且唯一', () => {
  const codes = SASAC_UNITS.map((u) => u.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const c of codes) assert.match(c, /^[0-9A-Z]{18}$/);
});
