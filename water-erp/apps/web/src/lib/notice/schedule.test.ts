import test from "node:test";
import assert from "node:assert/strict";

// @ts-expect-error Node 原生 --test 的 ESM 解析需要显式 .ts 扩展；tsc（bundler 分辨）不接受——压此行
import { scheduledPublishDue, isOverdueScheduledDraft, scheduledPublishErrorOf, SCHEDULED_PUBLISH_GRACE_MS } from "./schedule.ts";

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

test("失败留痕读取（2026-11-23）：合法标记归一返回、缺失/畸形/空消息返回 null（存量滞留件无标记）", () => {
  assert.deepEqual(
    scheduledPublishErrorOf({ metadata: { scheduledPublishError: { message: "项目未取得国标采购编码", code: "GB_CODE_REQUIRED", at: "2026-11-23T04:00:00.000Z" } } }),
    { message: "项目未取得国标采购编码", code: "GB_CODE_REQUIRED", at: "2026-11-23T04:00:00.000Z" },
  );
  assert.equal(scheduledPublishErrorOf({ metadata: {} }), null);
  assert.equal(scheduledPublishErrorOf({ metadata: { scheduledPublishError: { message: "", code: "X" } } }), null);
  assert.equal(scheduledPublishErrorOf({ metadata: { scheduledPublishError: "bad-shape" } }), null);
  assert.equal(scheduledPublishErrorOf({}), null);
});

// @ts-expect-error 同上：Node 原生 --test 的 ESM 解析需要显式 .ts 扩展
import { scheduledDuplicatePendingErrorOf, pendingScheduledDuplicateLines } from "./schedule.ts";

test("冲突待处理标记（2026-11-24）：只认定时任务写入的冲突码；其他失败码、缺失、畸形 → null", () => {
  const err = { message: "同项目同类型还有 1 条定时待发公告，系统无法判定应发布哪一条", code: "SCHEDULED_DUPLICATE_PENDING", at: "2026-11-24T01:00:00.000Z" };
  assert.deepEqual(scheduledDuplicatePendingErrorOf({ metadata: { scheduledPublishError: err } }), err);
  // 其他失败原因（赋码闸/盖章版闸）不是冲突——未到点时不得亮「定时待处理」
  assert.equal(scheduledDuplicatePendingErrorOf({ metadata: { scheduledPublishError: { message: "项目未取得国标采购编码", code: "GB_CODE_REQUIRED", at: "" } } }), null);
  assert.equal(scheduledDuplicatePendingErrorOf({ metadata: { scheduledPublishError: { message: "", code: "SCHEDULED_DUPLICATE_PENDING" } } }), null);
  assert.equal(scheduledDuplicatePendingErrorOf({ metadata: {} }), null);
  assert.equal(scheduledDuplicatePendingErrorOf({}), null);
});

test("待发草稿查重提示：标题一行、属性一行括注（定时时刻按东八区回显；无定时值只标待发）", () => {
  assert.deepEqual(
    pendingScheduledDuplicateLines([
      { id: "p1", title: "询比采购公告 — 科创中心外立面清洗", type: "BID_NOTICE", status: "DRAFT", scheduledPublishDate: "2026-11-24T09:00+08:00" },
      { id: "p2", title: "询比采购公告 — 科创中心外立面清洗", type: "BID_NOTICE", status: "DRAFT", scheduledPublishDate: null },
    ]),
    [
      "· 询比采购公告 — 科创中心外立面清洗\n（定时 2026-11-24 09:00 发布 ～ 待发）",
      "· 询比采购公告 — 科创中心外立面清洗\n（待发）",
    ],
  );
});
