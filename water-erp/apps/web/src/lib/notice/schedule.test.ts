import test from "node:test";
import assert from "node:assert/strict";

// @ts-expect-error Node 原生 --test 的 ESM 解析需要显式 .ts 扩展；tsc（bundler 分辨）不接受——压此行
import { scheduledPublishDue, isOverdueScheduledDraft, SCHEDULED_PUBLISH_GRACE_MS } from "./schedule.ts";

test("解析：无时区值按东八区，带偏移原样，缺失/非法 null", () => {
  assert.equal(scheduledPublishDue("2099-01-01T09:00")?.toISOString(), "2099-01-01T01:00:00.000Z");
  assert.equal(scheduledPublishDue("2099-01-01T09:00+08:00")?.toISOString(), "2099-01-01T01:00:00.000Z");
  assert.equal(scheduledPublishDue("garbage"), null);
  assert.equal(scheduledPublishDue(undefined), null);
});

test("定时未生效判定：非 DRAFT 不标、未到期不标", () => {
  assert.equal(isOverdueScheduledDraft({ status: "PUBLISHED", metadata: { scheduledPublishDate: "2020-01-01T00:00" } }), false);
  assert.equal(isOverdueScheduledDraft({ status: "DRAFT", metadata: { scheduledPublishDate: "2099-01-01T00:00" } }), false);
  assert.equal(isOverdueScheduledDraft({ status: "DRAFT", metadata: {} }), false);
});

test("宽限窗（2026-10-29 复验补）：过期 90 秒内不标——cron 每分钟 :00 扫描的空窗期合法待发", () => {
  const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
  const draft = (sched: string) => ({ status: "DRAFT", metadata: { scheduledPublishDate: sched } });
  // 过期 30 秒（< 90s 宽限）→ 不标
  assert.equal(isOverdueScheduledDraft(draft(iso(30_000))), false);
  // 过期恰好超宽限 → 标
  assert.equal(isOverdueScheduledDraft(draft(iso(SCHEDULED_PUBLISH_GRACE_MS + 5_000))), true);
});
