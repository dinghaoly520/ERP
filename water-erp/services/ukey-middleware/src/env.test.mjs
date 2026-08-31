/* env 数值解析单测:整数放行;未设置静默回退;空串/非数字/小数回退+warn */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvInt } from './env.mjs';

test('parseEnvInt:整数放行;未设置/空串/非数字/小数回退', () => {
  const cases = [
    ['T_OK', '18000', 18000],
    ['T_EMPTY', '', 17999],
    ['T_BAD', 'abc', 17999],
    ['T_FLOAT', '12.5', 17999],
  ];
  for (const [name, raw, want] of cases) {
    process.env[name] = raw;
    assert.equal(parseEnvInt(name, 17999), want, `${name}="${raw}"`);
    delete process.env[name];
  }
  assert.equal(parseEnvInt('T_UNSET', 17999), 17999, '未设置 → 静默 fallback');
});
