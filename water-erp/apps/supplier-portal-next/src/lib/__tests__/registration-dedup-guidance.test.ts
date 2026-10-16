import assert from "node:assert/strict";
import { test } from "node:test";
import { creditCodeGuidance } from "../registration-dedup-guidance";

/** 信用代码命中 → 引导矩阵：文案/链接/阻断语义的唯一出口（临时+正式两页共用） */
const hit = (over: Partial<Parameters<typeof creditCodeGuidance>[0]> = {}) => ({
  creditCode: true,
  creditCodeStatus: "APPROVED" as string | null,
  creditCodeIsTemporary: false,
  creditCodeTemporaryExpired: false,
  ...over,
});

test("未命中 → null（无引导）", () => {
  assert.equal(creditCodeGuidance({ creditCode: false, creditCodeStatus: null, creditCodeIsTemporary: false, creditCodeTemporaryExpired: false }), null);
});

test("临时已过期 → renew 引导到登录页续期（?reactivate=1 预展开面板）", () => {
  const g = creditCodeGuidance(hit({ creditCodeIsTemporary: true, creditCodeTemporaryExpired: true }));
  assert.equal(g?.kind, "renew");
  assert.equal(g?.blocking, true);
  assert.equal(g?.link?.href, "/login?reactivate=1");
});

test("临时未过期 → login 引导直接登录", () => {
  const g = creditCodeGuidance(hit({ creditCodeIsTemporary: true }));
  assert.equal(g?.kind, "login");
  assert.match(g?.message ?? "", /临时供应商资格有效期内/);
});

test("正式 APPROVED → login 引导（忘记密码走管理员）", () => {
  const g = creditCodeGuidance(hit({}));
  assert.equal(g?.kind, "login");
  assert.equal(g?.link?.href, "/login");
});

test("PENDING → 引导查询审核进度（登录页 ?registered=1 自动展开进度面板）", () => {
  const g = creditCodeGuidance(hit({ creditCodeStatus: "PENDING" }));
  assert.equal(g?.kind, "pending");
  assert.equal(g?.link?.href, "/login?registered=1");
});

test("RETURNED → 引导到正式注册页补正流程", () => {
  const g = creditCodeGuidance(hit({ creditCodeStatus: "RETURNED" }));
  assert.equal(g?.kind, "returned");
  assert.equal(g?.link?.href, "/register");
});

test("REJECTED → 引导改走正式注册（壳重开在正式页实现）", () => {
  const g = creditCodeGuidance(hit({ creditCodeStatus: "REJECTED" }));
  assert.equal(g?.kind, "rejected");
  assert.equal(g?.link?.href, "/register");
});

test("DISABLED/BLACKLIST → blocked 且无链接", () => {
  for (const status of ["DISABLED", "BLACKLIST"] as const) {
    const g = creditCodeGuidance(hit({ creditCodeStatus: status }));
    assert.equal(g?.kind, "blocked");
    assert.equal(g?.link, undefined);
  }
});

test("未知状态 → 兜底传统重复文案", () => {
  const g = creditCodeGuidance(hit({ creditCodeStatus: "WHATEVER" }));
  assert.equal(g?.kind, "blocked");
  assert.match(g?.message ?? "", /已被注册/);
});

test("临时过期优先于 status 分支（临时过期即使 status 异常也先给续期出路）", () => {
  const g = creditCodeGuidance(hit({ creditCodeStatus: "DISABLED", creditCodeIsTemporary: true, creditCodeTemporaryExpired: true }));
  assert.equal(g?.kind, "renew");
});
