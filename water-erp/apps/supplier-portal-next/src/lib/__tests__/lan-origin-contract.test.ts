import test from "node:test";
import assert from "node:assert/strict";

/**
 * 局域网访问契约（2026-10-09）：通知 WS 与供应商上传直连基址必须按「当前访问主机」推导，
 * 不得硬编码 localhost——LAN 设备经 http://192.168.1.111 访问门户时，localhost 兜底
 * 会让浏览器连到客户端自己的机器，通知铃铛/标书上传全部失联。
 */
import { notificationWsUrl } from "@water-erp/config";

/** upload-base 尚未实现时动态导入失败只影响上传用例，不掩盖 WS 用例的断言失败 */
async function loadResolveUploadBase(): Promise<() => string> {
  const mod = await import("../api/upload-base");
  return mod.resolveUploadBase;
}

interface StubLocation {
  protocol: string;
  hostname: string;
}

/** 临时替换/移除 globalThis.window，测完还原（支持异步回调） */
async function withWindow(loc: StubLocation | undefined, fn: () => Promise<void> | void): Promise<void> {
  const g = globalThis as Record<string, unknown>;
  const had = Object.getOwnPropertyDescriptor(globalThis, "window");
  if (loc) g.window = { location: loc };
  else delete g.window;
  try {
    await fn();
  } finally {
    if (had) Object.defineProperty(globalThis, "window", had);
    else delete g.window;
  }
}

/** 临时切到 dev env（清掉 NEXT_PUBLIC/API_ORIGIN 覆盖），测完还原 */
async function withDevEnv(fn: () => Promise<void> | void): Promise<void> {
  // Next 的 env 类型把 NODE_ENV 标记为只读，测试内改写需走可变视图
  const env = process.env as Record<string, string | undefined>;
  const saved = {
    NODE_ENV: env.NODE_ENV,
    API_BASE: env.NEXT_PUBLIC_API_BASE,
    WS_URL: env.NEXT_PUBLIC_WS_URL,
    API_ORIGIN: env.API_ORIGIN,
  };
  env.NODE_ENV = "development";
  delete env.NEXT_PUBLIC_API_BASE;
  delete env.NEXT_PUBLIC_WS_URL;
  delete env.API_ORIGIN;
  try {
    await fn();
  } finally {
    env.NODE_ENV = saved.NODE_ENV;
    if (saved.API_BASE) env.NEXT_PUBLIC_API_BASE = saved.API_BASE;
    if (saved.WS_URL) env.NEXT_PUBLIC_WS_URL = saved.WS_URL;
    if (saved.API_ORIGIN) env.API_ORIGIN = saved.API_ORIGIN;
  }
}

test("notificationWsUrl：局域网主机访问时直连该主机的 API 端口", async () => {
  await withDevEnv(async () => {
    await withWindow({ protocol: "http:", hostname: "192.168.1.111" }, () => {
      assert.equal(notificationWsUrl(), "http://192.168.1.111:4001/notifications");
    });
  });
});

test("notificationWsUrl：本机 localhost 访问仍指向 localhost", async () => {
  await withDevEnv(async () => {
    await withWindow({ protocol: "http:", hostname: "localhost" }, () => {
      assert.equal(notificationWsUrl(), "http://localhost:4001/notifications");
    });
  });
});

test("notificationWsUrl：SSR（无 window）兜底 localhost", async () => {
  await withDevEnv(async () => {
    await withWindow(undefined, () => {
      assert.equal(notificationWsUrl(), "http://localhost:4001/notifications");
    });
  });
});

test("resolveUploadBase：浏览器端局域网访问直连该主机的 API", async () => {
  const resolveUploadBase = await loadResolveUploadBase();
  await withDevEnv(() =>
    withWindow({ protocol: "http:", hostname: "192.168.1.111" }, () => {
      assert.equal(resolveUploadBase(), "http://192.168.1.111:4001/api");
    }),
  );
});

test("resolveUploadBase：SSR（无 window）走 apiOrigin()", async () => {
  const resolveUploadBase = await loadResolveUploadBase();
  await withDevEnv(() =>
    withWindow(undefined, () => {
      assert.equal(resolveUploadBase(), "http://localhost:4001/api");
    }),
  );
});

test("resolveUploadBase：显式 NEXT_PUBLIC_API_BASE 覆盖优先", async () => {
  const resolveUploadBase = await loadResolveUploadBase();
  const saved = process.env.NEXT_PUBLIC_API_BASE;
  process.env.NEXT_PUBLIC_API_BASE = "https://erp.example.com/api";
  try {
    assert.equal(resolveUploadBase(), "https://erp.example.com/api");
  } finally {
    if (saved) process.env.NEXT_PUBLIC_API_BASE = saved;
    else delete process.env.NEXT_PUBLIC_API_BASE;
  }
});
