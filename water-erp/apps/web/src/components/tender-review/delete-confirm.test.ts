import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { deleteReviewConfirmMessage } from "./delete-confirm";

/**
 * 删除审查任务前的确认（审计第 3 处跟进，2026-11-26）。
 * 任务栏里的删除此前单击即删、没有确认——旁边就是「停止」，点错一下在跑的审查就没了。
 */
test("在跑的任务（running/pending）：确认框说明删除会立即停止审查，并且没人用的上传源文件会一并删除", () => {
  // 删掉在跑的任务同样连带清理源文件——想换个知识库重跑的人删完才发现上传没了，这一点必须先说
  for (const status of ["running", "pending"]) {
    const message = deleteReviewConfirmMessage(status);
    assert.match(message, /正在审查中/, status);
    assert.match(message, /立即停止审查/, status);
    assert.match(message, /上传源文件/, status);
    assert.match(message, /无法恢复/, status);
  }
});

test("已结束的记录（completed/failed）：说明没有别的记录在用的上传源文件会一并删除，不提停止", () => {
  for (const status of ["completed", "failed"]) {
    const message = deleteReviewConfirmMessage(status);
    assert.match(message, /审查记录/, status);
    assert.match(message, /上传源文件/, status);
    assert.doesNotMatch(message, /停止/, status);
  }
});

test("任务栏：删除先过确认框，确认后才删；确认框要渲染出来", () => {
  const source = readFileSync(resolve("src/components/tender-review/task-queue-bar.tsx"), "utf8");
  assert.match(source, /useConfirm\(\)/, "任务栏要用统一的确认框");
  const handler = source.match(/onClick=\{async \(\) => \{([\s\S]*?)\}\}/)?.[1] ?? "";
  const confirmAt = handler.indexOf("await confirm(");
  const deleteAt = handler.indexOf("await deleteTask(");
  assert.ok(confirmAt >= 0, "删除按钮的点击处理里要先 await confirm");
  assert.ok(deleteAt > confirmAt, "确认之后才调用 deleteTask");
  assert.match(source, /\{dialog\}/, "确认框节点要渲染");
  assert.match(
    source,
    /await deleteTask\(task\.id\)\.catch\(\(\) => undefined\)/,
    "删除失败的提示由 deleteTask 自己发：点击处理里接住它重新抛出的错，不留没人接的拒绝",
  );
  assert.match(
    source,
    /if \(runningTasks\.length === 0\) \{\s*return dialog;\s*\}/,
    "任务都跑完了组件不再画任务栏，但已经打开的确认框要画完（否则弹窗凭空消失、确认请求永远不结算）",
  );
});

test("报告面板：删除记录的确认文案说明源文件会一并删除", () => {
  const source = readFileSync(resolve("src/components/tender-review/reports-panel-compact.tsx"), "utf8");
  assert.match(source, /await confirm\(\{ message: deleteReviewConfirmMessage\(task\.status\), danger: true \}\)/);
});
