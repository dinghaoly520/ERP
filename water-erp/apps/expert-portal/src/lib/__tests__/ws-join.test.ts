import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Socket } from "socket.io-client";
import { joinProjectOnConnect, joinProjectWithRetry } from '../ws-join.ts';

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
