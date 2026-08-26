/* 解锁会话:set/peek 不续时、get 续时、TTL 惰性过期、drop/dropAll */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShieldSessions } from './session.mjs';

test('TTL 过期惰性淘汰', async () => {
  const s = new ShieldSessions(0); // ttl=0:立即过期
  s.set('A', 'aa');
  await new Promise((r) => setTimeout(r, 5)); // 推进时钟,防同毫秒 flaky
  assert.equal(s.peek('A'), null);
  assert.deepEqual(s.unlockedIds(), []);
});

test('get 刷新 lastActive,peek 不刷新', async () => {
  const s = new ShieldSessions(1); // 1s
  s.set('A', 'aa');
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(s.get('A'), 'aa', '600ms 时 get 触达且续时');
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(s.peek('A'), 'aa', '距上次 get 700ms < 1000ms,仍在会话内');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(s.get('A'), null, '1100ms 无操作,已过期');
});

test('drop / dropAll', () => {
  const s = new ShieldSessions(300);
  s.set('A', 'aa'); s.set('B', 'bb');
  s.drop('A');
  assert.deepEqual(s.unlockedIds().sort(), ['B']);
  s.dropAll();
  assert.deepEqual(s.unlockedIds(), []);
});
