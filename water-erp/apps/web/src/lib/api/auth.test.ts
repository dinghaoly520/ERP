import test from "node:test";
import assert from "node:assert/strict";

import {
  login,
  logout,
  normalizeApiBaseUrl,
  parseJsonResponse,
  normalizeRequestErrorMessage,
} from "./auth";
import {
  getWebToken,
  readLoginPrefill,
  saveLoginPrefill,
} from "../session-store";

test("normalizeApiBaseUrl adds a protocol for localhost-style values", () => {
  assert.equal(
    normalizeApiBaseUrl("localhost:4000/api"),
    "http://localhost:4000/api",
  );
});

test("normalizeRequestErrorMessage translates browser URL pattern failures", () => {
  assert.equal(
    normalizeRequestErrorMessage(
      new Error("The string did not match the expected pattern."),
    ),
    "接口地址配置无效，请检查前端环境变量 NEXT_PUBLIC_API_BASE_URL。",
  );
});

test("parseJsonResponse converts plain-text 500 responses into a friendly message", async () => {
  await assert.rejects(
    () =>
      parseJsonResponse(
        new Response("Internal Server Error", {
          status: 500,
          headers: { "content-type": "text/plain" },
        }),
      ),
    new Error("服务处理失败，请稍后重试。"),
  );
});

// ── 「记住密码」门控（勾选才落本地预填，登出不再清除）──

class LocalStorageMock {
  private store = new Map<string, string>();

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }
}

class SessionStorageMock {
  private store = new Map<string, string>();

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }
}

function installWindowMock() {
  const localStorage = new LocalStorageMock();
  const sessionStorage = new SessionStorageMock();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage, sessionStorage },
  });
  return { localStorage, sessionStorage };
}

function stubFetchOk(body: unknown) {
  globalThis.fetch = (async (
    _input: RequestInfo | URL,
    _init?: RequestInit,
  ) => {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

test("记住密码勾选：登录成功后保存账号密码预填，请求体不夹带 remember", async () => {
  installWindowMock();
  let sentBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    sentBody = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    return new Response(
      JSON.stringify({ success: true, access_token: "tok-1", role: "staff", username: "Swhi-CGZX-05" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  await login({ username: "Swhi-CGZX-05", password: "secret", remember: true });

  assert.deepEqual(readLoginPrefill(), { username: "Swhi-CGZX-05", password: "secret" });
  assert.deepEqual(Object.keys(sentBody ?? {}).sort(), ["password", "username"]);
  assert.equal(getWebToken(), "tok-1");
});

test("记住密码未勾选：登录不保存预填，并清除此前记住的旧预填", async () => {
  installWindowMock();
  stubFetchOk({ success: true, access_token: "tok-2", role: "staff", username: "Swhi-CGZX-05" });

  saveLoginPrefill("old-user", "old-pass");
  assert.ok(readLoginPrefill(), "前置：旧预填存在");

  await login({ username: "Swhi-CGZX-05", password: "secret", remember: false });

  assert.equal(readLoginPrefill(), null, "取消勾选后的登录应撤销旧预填");
});

test("手动登出：保留记住的密码预填（记住语义），仅清 tab 级 token", async () => {
  installWindowMock();
  stubFetchOk({ success: true, access_token: "tok-3", role: "staff", username: "u1" });

  await login({ username: "u1", password: "p1", remember: true });
  assert.ok(readLoginPrefill());

  stubFetchOk({ success: true });
  await logout();

  assert.deepEqual(readLoginPrefill(), { username: "u1", password: "p1" }, "登出不应清除勾选记住的预填");
  assert.equal(getWebToken(), null);
});
