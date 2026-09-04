import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getNotificationMeta,
  notificationTypesForGroup,
  resolveNotificationLink,
  summarizeNotification,
} from "../notification-meta";

test("supplier notification taxonomy covers current workflow events", () => {
  for (const type of [
    "AWARD_LETTER", "BID_ROUND_OPEN", "BID_NUDGE_SUPPLIER", "BID_SCHEDULE_CHANGE",
    "PASSWORD_CHANGE_REVIEWED", "PROFILE_CHANGE_REVIEWED", "QUALIFICATION_EXPIRING",
    "CLARIFICATION", "BID_CLARIFICATION_CREATED", "CONTRACT_NOTICE", "PREQUAL_NOTICE", "SUPPLIER_BLACKLISTED",
  ]) {
    const meta = getNotificationMeta(type);
    assert.notEqual(meta.label, "其他消息", `${type} should have explicit metadata`);
  }
  assert.deepEqual(
    notificationTypesForGroup("todo").sort(),
    ["AWARD_LETTER", "BID_CLARIFICATION_CREATED", "BID_ROUND_OPEN"].sort(),
    "待办只应包含已有明确完成条件和 resolvedAt 闭环的业务动作",
  );
});

test("notification link resolver normalizes legacy links and distinguishes external destinations", () => {
  const origin = "https://supplier.example.com";
  assert.deepEqual(resolveNotificationLink("/award-letter", origin), { kind: "internal", href: "/award-letters" });
  assert.deepEqual(resolveNotificationLink("/supplier/bid/p-1", origin), { kind: "internal", href: "/my-bids/p-1/opening-hall" });
  assert.deepEqual(resolveNotificationLink("/bids/p-1/opening-hall", origin), { kind: "internal", href: "/my-bids/p-1/opening-hall" });
  assert.deepEqual(resolveNotificationLink("https://supplier.example.com/rsvp?t=x", origin), { kind: "internal", href: "/rsvp?t=x" });
  assert.deepEqual(resolveNotificationLink("https://external.example.org/help", origin), { kind: "external", href: "https://external.example.org/help" });
  assert.equal(resolveNotificationLink("javascript:alert(1)", origin), null);
  assert.equal(resolveNotificationLink("not a url", origin), null);
});

test("notification summary does not expose raw environment URLs", () => {
  assert.equal(
    summarizeNotification("请访问 http://localhost:3004/rsvp?t=secret 完成确认。", 80),
    "请通过消息中的“查看详情”完成确认。",
  );
});
