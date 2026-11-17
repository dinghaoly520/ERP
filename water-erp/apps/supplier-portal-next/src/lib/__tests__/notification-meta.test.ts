import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getNotificationMeta,
  isRegistryActionable,
  notificationActionMode,
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
    ["AWARD_LETTER", "BID_CLARIFICATION_CREATED", "BID_ROUND_OPEN", "BID_OPENING_SOON", "DECRYPT_WINDOW_CLOSING", "SELECTION_NOTIFY"].sort(),
    "待办只应包含已有明确完成条件和 resolvedAt 闭环的业务动作（签到/解密完成即消音；采购邀请回执即办结，2026-10-14）",
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

test("actionable 未办结待办的行动模式必须是「标记已办」——「标为已读」后端是 no-op（2026-11-17 供应商端角标不减根因）", () => {
  // 后端 markAsRead 对 actionable 且未办结 no-op、markAllAsRead 只清知会类——前端不得再渲染会静默失效的「标为已读」
  assert.deepEqual(
    notificationActionMode({ type: "QUALIFICATION_EXPIRING", isRead: false, resolvedAt: null }),
    { canResolve: true, canMarkRead: false },
  );
  assert.deepEqual(
    notificationActionMode({ type: "BID_INVITED", isRead: false }),
    { canResolve: true, canMarkRead: false },
  );
  assert.deepEqual(
    notificationActionMode({ type: "AWARD_LETTER", isRead: false, resolvedAt: null }),
    { canResolve: true, canMarkRead: false },
  );
  // CERT_EXPIRY_REMINDER 后端 actionable，但供应商端本地 META 缺登记曾落 fallback「其他消息」——口径必须取注册表真值
  assert.equal(isRegistryActionable("CERT_EXPIRY_REMINDER"), true);
  assert.equal(isRegistryActionable("ANNOUNCEMENT_PUBLISHED"), false);
  // 注册表与本地 META 漂移样例：SELECTION_NOTIFY 注册表非 actionable（标为已读有效）
  assert.equal(isRegistryActionable("SELECTION_NOTIFY"), false);
});

test("知会类、已办结待办与未注册历史类型的行动模式是「标为已读」", () => {
  assert.deepEqual(
    notificationActionMode({ type: "ANNOUNCEMENT_PUBLISHED", isRead: false, resolvedAt: null }),
    { canResolve: false, canMarkRead: true },
  );
  // 已办结（resolvedAt 已落）的待办：后端 markAsRead 放行落 isRead
  assert.deepEqual(
    notificationActionMode({ type: "AWARD_LETTER", isRead: false, resolvedAt: "2026-11-17T00:00:00.000Z" }),
    { canResolve: false, canMarkRead: true },
  );
  // 未注册历史类型（BID_OPENING 等）：不在 ACTIONABLE_TYPES，后端标为已读放行
  assert.deepEqual(
    notificationActionMode({ type: "BID_OPENING", isRead: false }),
    { canResolve: false, canMarkRead: true },
  );
  assert.deepEqual(
    notificationActionMode({ type: "ANNOUNCEMENT_PUBLISHED", isRead: true, resolvedAt: null }),
    { canResolve: false, canMarkRead: false },
  );
});

test("notification summary does not expose raw environment URLs", () => {
  assert.equal(
    summarizeNotification("请访问 http://localhost:3004/rsvp?t=secret 完成确认。", 80),
    "请通过消息中的“查看详情”完成确认。",
  );
});
