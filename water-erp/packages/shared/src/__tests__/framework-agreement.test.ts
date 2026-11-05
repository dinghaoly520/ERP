// packages/shared/src/__tests__/framework-agreement.test.ts
// checkEliminationRatio（GB/T 43711 D.2.6 淘汰率）口径测试。
// 原为 src/framework-agreement.spec.ts（jest 风格）——shared 测试走 tsx --test，
// jest 风格 spec 无 runner 执行，2026-11-05 转为 node:test 使其真正跑起来。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEliminationRatio } from '../framework-agreement';

test('checkEliminationRatio：开放式资格审查不适用', () => {
  const r = checkEliminationRatio({ entryMode: 'open', rounds: 0, participants: [], entered: 5 });
  assert.equal(r.passed, true);
});

test('checkEliminationRatio：一次竞争 10 参与 5 入围（淘汰 50%）→ 通过', () => {
  const r = checkEliminationRatio({ entryMode: 'closed', rounds: 1, participants: [10], entered: 5 });
  assert.equal(r.passed, true);
});

test('checkEliminationRatio：一次竞争 10 参与 7 入围（淘汰 30%<50%）→ 不通过', () => {
  const r = checkEliminationRatio({ entryMode: 'closed', rounds: 1, participants: [10], entered: 7 });
  assert.equal(r.passed, false);
  assert.ok(r.detail.includes('50%'));
});

test('checkEliminationRatio：两次竞争 10 参与 6 入围（淘汰 40%≥30%）→ 通过', () => {
  const r = checkEliminationRatio({ entryMode: 'closed', rounds: 2, participants: [10, 8], entered: 6 });
  assert.equal(r.passed, true);
});

test('checkEliminationRatio：参与数为 0 → 不通过', () => {
  const r = checkEliminationRatio({ entryMode: 'closed', rounds: 1, participants: [0], entered: 1 });
  assert.equal(r.passed, false);
});
