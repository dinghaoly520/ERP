import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Socket } from "socket.io-client";
import { joinProjectOnConnect, joinProjectWithRetry, onDisconnectedBeforeJoin } from '../ws-join.ts';

const U = { error: "UNAUTHORIZED" };
const noWait = async () => {};

/** 假连接：按顺序回给定的应答；队列空了就不回（模拟服务端不应答） */
function fakeSocket(acks: unknown[]) {
  const emitted: string[] = [];
  const socket = {
    emit(event: string, _projectId: string, ack?: (a: unknown) => void) {
      emitted.push(event);
      const next = acks.shift();
      if (next === undefined) return;
      setTimeout(() => ack?.(next), 0);
    },
    disconnect: () => { emitted.push("disconnect"); },
  } as unknown as Socket;
  return { socket, emitted };
}

/** 策略依赖与可观测的内部状态 */
function deps() {
  const state = { streak: 0, stopped: 0, gets: 0, sets: 0, current: true };
  const d = {
    isCurrent: () => state.current,
    getFailStreak: () => { state.gets++; return state.streak; },
    setFailStreak: (n: number) => { state.sets++; state.streak = n; },
    stopReconnect: () => { state.stopped++; },
  };
  return { d, state };
}

test("未授权两次后成功：共发三次，返回成功", async () => {
  const { socket, emitted } = fakeSocket([U, U, { ok: true }]);
  assert.deepEqual(await joinProjectWithRetry(socket, "p1", { sleep: noWait }), { ok: true });
  assert.equal(emitted.length, 3);
});

test("一直未授权：发满三次后原样返回 UNAUTHORIZED", async () => {
  const { socket, emitted } = fakeSocket([U, U, U]);
  assert.deepEqual(await joinProjectWithRetry(socket, "p1", { sleep: noWait }), U);
  assert.equal(emitted.length, 3);
});

test("重试间隔逐次翻倍：150 → 300", async () => {
  const waits: number[] = [];
  const { socket } = fakeSocket([U, U, { ok: true }]);
  await joinProjectWithRetry(socket, "p1", { sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(waits, [150, 300]);
});

test("业务性拒绝不重试", async () => {
  const { socket, emitted } = fakeSocket([{ error: "NOT_PROJECT_MEMBER" }]);
  assert.deepEqual(await joinProjectWithRetry(socket, "p1", { sleep: noWait }), { error: "NOT_PROJECT_MEMBER" });
  assert.equal(emitted.length, 1);
});

test("等不到应答：返回 JOIN_TIMEOUT 且不重试", async () => {
  const { socket, emitted } = fakeSocket([]);
  assert.deepEqual(await joinProjectWithRetry(socket, "p1", { sleep: noWait, ackTimeoutMs: 5 }), { error: "JOIN_TIMEOUT" });
  assert.equal(emitted.length, 1);
});

test("连接已作废：停止重发", async () => {
  let stale = false;
  const { socket, emitted } = fakeSocket([U, { ok: true }]);
  const ack = await joinProjectWithRetry(socket, "p1", { sleep: async () => { stale = true; }, isStale: () => stale });
  assert.deepEqual(ack, { error: "JOIN_ABORTED" });
  assert.equal(emitted.length, 1);
});

test("入会成功：失败计数清零，不断开", async () => {
  const { socket, emitted } = fakeSocket([U, { ok: true }]);
  const { d, state } = deps();
  await joinProjectOnConnect(socket, "p1", d, { sleep: noWait });
  assert.deepEqual(emitted, ["join:project", "join:project"]);
  assert.deepEqual(state, { streak: 0, stopped: 0, gets: 0, sets: 1, current: true });
});

test("重试耗尽：断开连接，失败次数记为 1", async () => {
  const { socket, emitted } = fakeSocket([U, U, U]);
  const { d, state } = deps();
  await joinProjectOnConnect(socket, "p1", d, { sleep: noWait });
  assert.equal(emitted[emitted.length - 1], "disconnect");
  assert.deepEqual(state, { streak: 1, stopped: 0, gets: 1, sets: 1, current: true });
});

test("连续三次连接入会失败：第三次时要求停止重连并断开", async () => {
  const { d, state } = deps();
  for (let i = 1; i <= 3; i++) {
    const { socket, emitted } = fakeSocket([U, U, U]);
    await joinProjectOnConnect(socket, "p1", d, { sleep: noWait });
    assert.equal(state.streak, i);
    assert.equal(state.stopped, i >= 3 ? 1 : 0);
    assert.equal(emitted[emitted.length - 1], "disconnect");
  }
});

test("迟到的应答（连接已被替换）：不改动任何状态、不断开", async () => {
  const { socket, emitted } = fakeSocket([{ ok: true }]);
  const { d, state } = deps();
  const pending = joinProjectOnConnect(socket, "p1", d, { sleep: noWait });
  state.current = false; // 应答回来之前连接已被替换
  await pending;
  assert.deepEqual(emitted, ["join:project"]);
  assert.deepEqual(state, { streak: 0, stopped: 0, gets: 0, sets: 0, current: false });
});

test("业务性拒绝：不重试、不断开、不计失败", async () => {
  const { socket, emitted } = fakeSocket([{ error: "NOT_PROJECT_MEMBER" }]);
  const { d, state } = deps();
  await joinProjectOnConnect(socket, "p1", d, { sleep: noWait });
  assert.deepEqual(emitted, ["join:project"]);
  assert.deepEqual(state, { streak: 0, stopped: 0, gets: 0, sets: 0, current: true });
});

// ── 返回值（2026-11-26 审查 I-1）：调用方据此标记「本连接已入会」──

test('入会成功：返回 true', async () => {
  const { socket } = fakeSocket([{ ok: true }]);
  const { d } = deps();
  assert.equal(await joinProjectOnConnect(socket, 'p1', d, { sleep: noWait }), true);
});

test('入会失败：返回 false', async () => {
  const { socket } = fakeSocket([U, U, U]);
  const { d } = deps();
  assert.equal(await joinProjectOnConnect(socket, 'p1', d, { sleep: noWait }), false);
});

test('迟到的成功应答（连接已被替换）：返回 false，不算入会成功', async () => {
  const { socket } = fakeSocket([{ ok: true }]);
  const { d, state } = deps();
  const pending = joinProjectOnConnect(socket, 'p1', d, { sleep: noWait });
  state.current = false; // 应答回来之前连接已被替换
  assert.equal(await pending, false);
});

// ── 会话真正失效：服务端在握手鉴权里直接断开连接、不给入会应答，这次失败只有 disconnect 事件看得到（2026-11-26 审查 I-1）──

test('连上却被断开、从未入会：记一次入会失败，不满三次不要求停', () => {
  const { d, state } = deps();
  onDisconnectedBeforeJoin(false, 'io server disconnect', d);
  assert.deepEqual(state, { streak: 1, stopped: 0, gets: 1, sets: 1, current: true });
});

test('连续三条连接连上即被断开：第三次要求停止重连', () => {
  const { d, state } = deps();
  for (let i = 1; i <= 3; i++) {
    onDisconnectedBeforeJoin(false, 'io server disconnect', d);
    assert.equal(state.streak, i);
    assert.equal(state.stopped, i >= 3 ? 1 : 0);
  }
});

test('断开的是已入会的连接：不计', () => {
  const { d, state } = deps();
  onDisconnectedBeforeJoin(true, 'io server disconnect', d);
  assert.deepEqual(state, { streak: 0, stopped: 0, gets: 0, sets: 0, current: true });
});

test('未入会的连接以其他原因断开（如传输层关闭）也计：服务端断开时客户端报到的原因并不固定', () => {
  const { d, state } = deps();
  onDisconnectedBeforeJoin(false, 'transport close', d);
  assert.equal(state.streak, 1);
});

test('客户端自己断开的不计：入会未授权、超时那条路已经记过一次', () => {
  const { d, state } = deps();
  onDisconnectedBeforeJoin(false, 'io client disconnect', d);
  assert.deepEqual(state, { streak: 0, stopped: 0, gets: 0, sets: 0, current: true });
});

test('入会超时：记一次并断开；随后客户端自己断开不重复记', async () => {
  const { socket, emitted } = fakeSocket([]);
  const { d, state } = deps();
  await joinProjectOnConnect(socket, 'p1', d, { sleep: noWait, ackTimeoutMs: 5 });
  assert.equal(emitted[emitted.length - 1], 'disconnect');
  onDisconnectedBeforeJoin(false, 'io client disconnect', d); // hook 的 disconnect 处理随后被触发
  assert.deepEqual(state, { streak: 1, stopped: 0, gets: 1, sets: 1, current: true });
});

test('中途入会成功一次：连续计数清零，之后的断开重新从 1 记', async () => {
  const { d, state } = deps();
  onDisconnectedBeforeJoin(false, 'io server disconnect', d);
  onDisconnectedBeforeJoin(false, 'io server disconnect', d);
  assert.equal(state.streak, 2);
  await joinProjectOnConnect(fakeSocket([{ ok: true }]).socket, 'p1', d, { sleep: noWait });
  assert.equal(state.streak, 0);
  onDisconnectedBeforeJoin(false, 'io server disconnect', d);
  assert.deepEqual(state, { streak: 1, stopped: 0, gets: 3, sets: 4, current: true });
});
