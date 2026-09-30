import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { authedHeaders } from "../authed-file";

/**
 * authedHeaders 的纯逻辑（不触及 fetch/URL API）：tab token 存在时带上 X-Supplier-Token，
 * 缺失时仅带 X-Portal 回退 cookie 鉴权——串身份收口的关键路径用单测锁住。
 */
test("authedHeaders：无 tab token 时仅 X-Portal，安全回退 cookie", () => {
  // 清 sessionStorage，模拟新开 tab / 无头客户端
  (globalThis as any).window = { sessionStorage: { getItem: () => null } };
  const h = authedHeaders();
  assert.equal(h["X-Portal"], "supplier");
  assert.equal("X-Supplier-Token" in h, false);
});

test("authedHeaders：有 tab token 时带 X-Supplier-Token", () => {
  (globalThis as any).window = { sessionStorage: { getItem: () => "tok-abc" } };
  const h = authedHeaders();
  assert.equal(h["X-Portal"], "supplier");
  assert.equal(h["X-Supplier-Token"], "tok-abc");
});

beforeEach(() => {
  delete (globalThis as any).window;
});
