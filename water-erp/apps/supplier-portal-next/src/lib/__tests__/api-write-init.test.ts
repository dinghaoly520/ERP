import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { api } from "../api";

/**
 * 供应商门户写请求（put/patch/delete）行为锁（2026-10-28 联系人「假成功」根因）：
 *
 * 根因链：X-P3-06 让 put/patch 走 client.raw——raw 返回 Response 且 fetch 对 4xx/5xx
 * 是 resolve 而非 reject，guard 只 catch reject → 两个缺陷：
 *  ① 手动 stringify 未带 Content-Type → Express 不解析 body → 后端收空 DTO →
 *     条件更新全跳过 → 200 假成功（用户实测：编辑联系人提示成功但数据未变）；
 *  ② 非 2xx 一律静默（400/403/409/500 全被当成功值 resolve，调用方 catch 永不触发）。
 *
 * 本测试 mock fetch 锁行为：写请求必须带 Content-Type；非 2xx 必须 reject。
 */

const realFetch = globalThis.fetch;
let lastInit: RequestInit | undefined;
let lastUrl = "";

beforeEach(() => {
  (globalThis as any).window = { sessionStorage: { getItem: () => null } };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(status: number, body: unknown) {
  (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
    lastUrl = String(url);
    lastInit = init;
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
}

test("api.put：有 body 时必须带 Content-Type: application/json", async () => {
  stubFetch(200, { ok: true });
  await api.put("/x", { a: 1 }, { silent: true });
  const headers = (lastInit!.headers ?? {}) as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(lastInit!.method, "PUT");
  assert.equal(lastInit!.body, JSON.stringify({ a: 1 }));
});

test("api.put：非 2xx 必须 reject（400 假成功回归锁）", async () => {
  stubFetch(400, { statusCode: 400, code: "EMPTY_UPDATE", error: "未提供任何要更新的字段" });
  await assert.rejects(
    api.put("/x", { a: 1 }, { silent: true }),
    (e: any) => e?.status === 400,
  );
});

test("api.patch：带 Content-Type 且非 2xx reject", async () => {
  stubFetch(200, { ok: true });
  await api.patch("/x", { b: 2 }, { silent: true });
  const headers = (lastInit!.headers ?? {}) as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(lastInit!.method, "PATCH");

  stubFetch(403, { statusCode: 403, code: "FORBIDDEN", error: "无权访问" });
  await assert.rejects(api.patch("/x", { b: 2 }, { silent: true }), (e: any) => e?.status === 403);
});

test("api.delete：非 2xx 必须 reject", async () => {
  stubFetch(409, { statusCode: 409, code: "CONFLICT", error: "冲突" });
  await assert.rejects(api.delete("/x", { silent: true }), (e: any) => e?.status === 409);
});

test("api.put：2xx 返回解析后的 JSON（调用方拿业务数据而非 Response）", async () => {
  stubFetch(200, { position: "采购经理" });
  const r: any = await api.put("/x", { a: 1 }, { silent: true });
  assert.equal(r?.position, "采购经理");
});

test("api.put：请求带 X-Portal 头与超时信号（withTimeout 接线）", async () => {
  stubFetch(200, { ok: true });
  await api.put("/x", { a: 1 }, { silent: true });
  const headers = (lastInit!.headers ?? {}) as Record<string, string>;
  assert.equal(headers["X-Portal"], "supplier");
  assert.ok(lastInit!.signal instanceof AbortSignal, "put 必须接上超时 AbortSignal");
});
