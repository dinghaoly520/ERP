import test from "node:test";
import assert from "node:assert/strict";

/**
 * 局域网访问契约（2026-10-09）：通知 WS 与供应商上传直连基址必须按「当前访问主机」推导，
 * 不得硬编码 localhost——LAN 设备经 http://192.168.1.111 访问门户时，localhost 兜底
 * 会让浏览器连到客户端自己的机器，通知铃铛/标书上传全部失联。
 */
import { notificationWsUrl, gatewayWsUrl, bidWsUrl } from "@water-erp/config";

/** upload-base 尚未实现时动态导入失败只影响上传用例，不掩盖 WS 用例的断言失败 */
async function loadResolveUploadBase(): Promise<() => string> {
  const mod = await import("../api/upload-base");
  return mod.resolveUploadBase;
}

interface StubLocation {
  protocol: string;
  hostname: string;
  origin?: string;
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

test("notificationWsUrl：生产域名模式走同源 + 命名空间（2026-11-03 拓扑修正——前后端分离、api 子域对浏览器不可达，门户 nginx 反代 /socket.io/）", async () => {
  await withDevEnv(async () => {
    // origin 存在（真浏览器形态）——断言走真实分支而非兜底
    await withWindow({ protocol: "https:", hostname: "procurement-ssyc.scsfjt.com", origin: "https://procurement-ssyc.scsfjt.com" }, () => {
      assert.equal(notificationWsUrl(), "https://procurement-ssyc.scsfjt.com/notifications");
    });
  });
});

test("gatewayWsUrl：端口模式协议随页面（http 页面 → http 直连）", async () => {
  await withDevEnv(() =>
    withWindow({ protocol: "http:", hostname: "192.168.1.50" }, () => {
      assert.equal(gatewayWsUrl("/bid"), "http://192.168.1.50:4001/bid");
      assert.equal(gatewayWsUrl("/chat"), "http://192.168.1.50:4001/chat");
    }),
  );
});

test("gatewayWsUrl：命名空间拼接（无前导斜杠自动补）+ bidWsUrl 契约（须与 bid.gateway 装饰器锁步）", async () => {
  await withDevEnv(() =>
    withWindow({ protocol: "http:", hostname: "localhost" }, () => {
      assert.equal(gatewayWsUrl("bid"), "http://localhost:4001/bid");
      assert.equal(bidWsUrl(), gatewayWsUrl("/bid"));
    }),
  );
});

test("gatewayWsUrl：NEXT_PUBLIC_WS_ORIGIN 覆盖（分机前端拓扑出口；仅 origin，命名空间自动拼）", async () => {
  const saved = process.env.NEXT_PUBLIC_WS_ORIGIN;
  process.env.NEXT_PUBLIC_WS_ORIGIN = "https://api.example.com/";
  try {
    await withDevEnv(() =>
      withWindow({ protocol: "http:", hostname: "10.1.2.3" }, () => {
        assert.equal(gatewayWsUrl("/bid"), "https://api.example.com/bid");
        assert.equal(notificationWsUrl(), "https://api.example.com/notifications");
      }),
    );
  } finally {
    if (saved) process.env.NEXT_PUBLIC_WS_ORIGIN = saved;
    else delete process.env.NEXT_PUBLIC_WS_ORIGIN;
  }
});

test("gatewayWsUrl：SSR（无 window）兜底 localhost", async () => {
  await withDevEnv(() =>
    withWindow(undefined, () => {
      assert.equal(gatewayWsUrl("/bid"), "http://localhost:4001/bid");
    }),
  );
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
