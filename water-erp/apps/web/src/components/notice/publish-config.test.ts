import test from "node:test";
import assert from "node:assert/strict";

// @ts-expect-error Node 原生 --test 的 ESM 解析需要显式 .ts 扩展；tsc（bundler 分辨）不接受——压此行
import { configToMetadata, DEFAULT_PUBLISH_CONFIG, type PublishConfig } from "./publish-config.ts";

const scheduled: PublishConfig = {
  ...DEFAULT_PUBLISH_CONFIG,
  scheduleMode: "scheduled",
  scheduledPublishDate: "2026-10-29T17:00",
};

test("定时态「保存草稿」保留定时（2026-10-29 裁定，审计 D）——不再静默拆弹", () => {
  const meta = configToMetadata(scheduled, {}, { draft: true });
  assert.equal(meta.scheduledPublishDate, "2026-10-29T17:00");
});

test("定时态「发布」照旧带定时（回归：2026-10-23 根治路径不变）", () => {
  const meta = configToMetadata(scheduled, {}, { draft: false });
  assert.equal(meta.scheduledPublishDate, "2026-10-29T17:00");
});

test("默认 immediate（含保存草稿）不带定时键——2026-10-16「草稿被误定时」不复发", () => {
  const meta = configToMetadata(DEFAULT_PUBLISH_CONFIG, {}, { draft: true });
  assert.equal("scheduledPublishDate" in meta, false);
});

test("切回立即发布再存 → 剥除既有定时（取消定时的正门）", () => {
  const meta = configToMetadata({ ...scheduled, scheduleMode: "immediate" }, { scheduledPublishDate: "2026-10-29T17:00" }, { draft: true });
  assert.equal("scheduledPublishDate" in meta, false);
});

test("定时模式但时间为空 → 不落定时键（半配置不调度）", () => {
  const meta = configToMetadata({ ...scheduled, scheduledPublishDate: "" }, {}, { draft: false });
  assert.equal("scheduledPublishDate" in meta, false);
});
