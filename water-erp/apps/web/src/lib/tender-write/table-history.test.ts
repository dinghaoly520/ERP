import test from "node:test";
import assert from "node:assert/strict";

// @ts-expect-error Node 原生 --test 的 ESM 解析需要显式 .ts 扩展；tsc（bundler 分辨）不接受——压此行（须单行 import：指令只作用于下一行）
import { createTableHistoryState, popTableHistory, recordTableEdit, TABLE_HISTORY_LIMIT } from "./table-history.ts";
import type { TableData } from "../types/tender-write";

function snap(content: string): TableData {
  return {
    rows: 1,
    cols: 1,
    cells: [[{ content, rowSpan: 1, colSpan: 1, align: "center" }]],
  };
}

test("structural edits always push a snapshot", () => {
  let state = createTableHistoryState();
  state = recordTableEdit(state, snap("s0"), null);
  state = recordTableEdit(state, snap("s1"), null);
  assert.equal(state.history.length, 2);
  assert.equal(state.lastEditCell, null);
});

test("consecutive typing in the same cell coalesces into one step", () => {
  let state = recordTableEdit(createTableHistoryState(), snap("s0"), { r: 1, c: 2 });
  state = recordTableEdit(state, snap("s0-改"), { r: 1, c: 2 });
  state = recordTableEdit(state, snap("s0-再改"), { r: 1, c: 2 });
  assert.equal(state.history.length, 1);
  assert.deepEqual(state.lastEditCell, { r: 1, c: 2 });
  // 一次撤回即回到打字前
  const undone = popTableHistory(state);
  assert.equal(undone.snapshot!.cells[0][0].content, "s0");
});

test("typing in a different cell starts a new step", () => {
  let state = recordTableEdit(createTableHistoryState(), snap("s0"), { r: 0, c: 0 });
  state = recordTableEdit(state, snap("s1"), { r: 0, c: 1 });
  assert.equal(state.history.length, 2);
});

test("a structural edit between typing sessions re-arms coalescing", () => {
  let state = recordTableEdit(createTableHistoryState(), snap("s0"), { r: 0, c: 0 });
  state = recordTableEdit(state, snap("s1"), null); // 结构操作
  state = recordTableEdit(state, snap("s2"), { r: 0, c: 0 }); // 回到同一格也要重压
  assert.equal(state.history.length, 3);
});

test("history is capped at TABLE_HISTORY_LIMIT, dropping the oldest", () => {
  let state = createTableHistoryState();
  for (let i = 0; i < TABLE_HISTORY_LIMIT + 5; i++) {
    state = recordTableEdit(state, snap(`s${i}`), null);
  }
  assert.equal(state.history.length, TABLE_HISTORY_LIMIT);
  assert.equal(state.history[0].cells[0][0].content, "s5"); // 最旧的 5 个被丢弃
});

test("popTableHistory returns the latest snapshot and resets coalescing", () => {
  let state = recordTableEdit(createTableHistoryState(), snap("s0"), null);
  state = recordTableEdit(state, snap("s1"), { r: 2, c: 3 });
  const undone = popTableHistory(state);
  assert.equal(undone.snapshot!.cells[0][0].content, "s1");
  assert.equal(undone.state.history.length, 1);
  assert.equal(undone.state.lastEditCell, null); // 撤回后打字重新压栈
  const redoTyping = recordTableEdit(undone.state, snap("s2"), { r: 2, c: 3 });
  assert.equal(redoTyping.history.length, 2);
});

test("popTableHistory on an empty stack is a no-op", () => {
  const state = createTableHistoryState();
  const undone = popTableHistory(state);
  assert.equal(undone.snapshot, null);
  assert.deepEqual(undone.state, state);
});
