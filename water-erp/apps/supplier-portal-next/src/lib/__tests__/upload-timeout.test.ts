import assert from "node:assert/strict";
import { test, mock, beforeEach, afterEach } from "node:test";
import { supplierApi, xhrTimeoutMs, attachStallWatchdog } from "../api/supplier";

/**
 * 上传链路 XHR 超时修复（Task8：500MB 广域网上传可达）：
 *
 * 现状缺陷：caDecryptUpload / caUploadEncryptedOuter 均硬编码 xhr.timeout=180000——
 * 500MB 级密文在真实供应商上行带宽下 180s 内几乎必然跑不完 → XHR 确定性 abort。
 *
 * 修复契约：
 *  - xhrTimeoutMs(bytes)：≤50MB → 180000（维持现状硬超时）；>50MB → 0（禁用硬超时，走停滞判活）
 *  - attachStallWatchdog(xhr, ms=60s)：每次 upload.onprogress 复位计时；停滞满窗 → xhr.abort()；
 *    abort 后无论浏览器派发 onabort 还是 onerror，promise 一律以
 *    「上传中断（网络停滞超过 60 秒），请检查网络后重试」reject（而非泛化网络异常）
 *  - caDecryptUpload 签名扩展第三参 onProgress（既有两参调用方不受影响），fd 体积 = 各 Blob size 求和
 *
 * 纯 Node：手写 fake XMLHttpRequest 记录 timeout 赋值 / abort 调用，node:test mock.timers 驱动看门狗。
 */

const MB = 1024 * 1024;

/** >50MB 单体 Blob（>50MB 轨） */
const BIG_BLOB = new Blob([new Uint8Array(51 * MB)]);
/** 两个各 26MB（单件均 ≤50MB，求和 52MB >50MB —— 锁「FormData 内 Blob 求和」而非只看首件） */
const HALF_BLOB_A = new Blob([new Uint8Array(26 * MB)]);
const HALF_BLOB_B = new Blob([new Uint8Array(26 * MB)]);

type FakeEvent = { lengthComputable?: boolean; loaded?: number; total?: number };

class FakeXMLHttpRequest {
  static last: FakeXMLHttpRequest | null = null;
  timeout = 0;
  withCredentials = false;
  status = 0;
  responseText = "";
  upload: { onprogress?: (ev: FakeEvent) => void } = {};
  onload: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  onabort: ((ev?: unknown) => void) | null = null;
  ontimeout: ((ev?: unknown) => void) | null = null;
  sentBody: unknown = undefined;
  abortCalls = 0;
  /** abort() 后派发哪个事件：规范=abort，个别浏览器=error（看门狗两条路都要给出停滞文案） */
  abortDispatch: "abort" | "error" = "abort";
  headers: Record<string, string> = {};
  openedUrl = "";
  open(_method: string, url: string) {
    this.openedUrl = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body?: unknown) {
    this.sentBody = body;
    FakeXMLHttpRequest.last = this;
  }
  abort() {
    this.abortCalls += 1;
    if (this.abortDispatch === "error") this.onerror?.({});
    else this.onabort?.({});
  }
  /** 测试驱动：以服务端口吻完成请求 */
  finish(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.({});
  }
}

const RealXMLHttpRequest = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;

beforeEach(() => {
  FakeXMLHttpRequest.last = null;
  (globalThis as Record<string, unknown>).XMLHttpRequest = FakeXMLHttpRequest;
});

afterEach(() => {
  (globalThis as Record<string, unknown>).XMLHttpRequest = RealXMLHttpRequest;
  mock.timers.reset();
});

// ── xhrTimeoutMs 阈值 ─────────────────────────────────────────────────────────

test("xhrTimeoutMs：50MB=180000（含边界）、50MB+1=0、0=180000", () => {
  assert.equal(xhrTimeoutMs(50 * MB), 180_000);
  assert.equal(xhrTimeoutMs(50 * MB + 1), 0);
  assert.equal(xhrTimeoutMs(1), 180_000);
  assert.equal(xhrTimeoutMs(0), 180_000);
});

// ── attachStallWatchdog ───────────────────────────────────────────────────────

test("watchdog：默认 60s 无任何 progress → abort（59_999 仍不触发）", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const xhr = new FakeXMLHttpRequest() as unknown as XMLHttpRequest;
  attachStallWatchdog(xhr);
  mock.timers.tick(59_999);
  assert.equal(xhrAsFake(xhr).abortCalls, 0);
  mock.timers.tick(1);
  assert.equal(xhrAsFake(xhr).abortCalls, 1);
});

test("watchdog：progress 持续心跳不 abort（每次复位）；停滞满窗 → abort；原 handler 不被包裹吞掉", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const xhr = new FakeXMLHttpRequest();
  const seen: number[] = [];
  attachStallWatchdog(xhrAsXhr(xhr), 100);
  xhr.upload.onprogress = (ev) => seen.push(ev.loaded ?? -1);
  // 5 × (80ms 间隔 + progress)：累计 400ms > 100ms 窗口，但每次 progress 都复位 → 不 abort
  for (let i = 0; i < 5; i++) {
    mock.timers.tick(80);
    xhr.upload.onprogress!({ lengthComputable: true, loaded: i + 1, total: 10 });
  }
  assert.equal(xhr.abortCalls, 0);
  assert.deepEqual(seen, [1, 2, 3, 4, 5]);
  // 停滞满 100ms → abort
  mock.timers.tick(100);
  assert.equal(xhr.abortCalls, 1);
});

test("watchdog：先赋 onprogress 后挂看门狗——复位同样生效（挂载顺序不敏感）", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const xhr = new FakeXMLHttpRequest();
  const seen: number[] = [];
  xhr.upload.onprogress = (ev) => seen.push(ev.loaded ?? -1);
  attachStallWatchdog(xhrAsXhr(xhr), 100);
  mock.timers.tick(90);
  xhr.upload.onprogress!({ lengthComputable: true, loaded: 7, total: 10 });
  mock.timers.tick(90); // 距上次 progress 90ms < 100ms
  assert.equal(xhr.abortCalls, 0);
  mock.timers.tick(10); // 停滞累计满 100ms
  assert.equal(xhr.abortCalls, 1);
  assert.deepEqual(seen, [7]);
});

test("watchdog：终态（onload）自动解除——上传完成后不再残留 abort", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const xhr = new FakeXMLHttpRequest();
  let loaded = false;
  attachStallWatchdog(xhrAsXhr(xhr), 100);
  xhr.onload = () => {
    loaded = true;
  };
  xhr.onload!({});
  mock.timers.tick(10_000);
  assert.ok(loaded);
  assert.equal(xhr.abortCalls, 0);
});

// ── caDecryptUpload：体积求和 + onProgress 透传 + 停滞文案 ────────────────────

test("caDecryptUpload 两参调用兼容：小 fd 维持 180s 硬超时，成功路径解析响应（既有调用方不受影响）", { timeout: 10_000 }, async () => {
  const fd = new FormData();
  fd.append("plain", new Blob(["hello"]), "p.bin");
  const pr = supplierApi.caDecryptUpload("p1", fd);
  const xhr = FakeXMLHttpRequest.last!;
  assert.equal(xhr.timeout, 180_000);
  assert.equal(xhr.headers["X-Portal"], "supplier");
  xhr.finish(200, { ok: 1 });
  assert.deepEqual(await pr, { ok: 1 });
});

test("caDecryptUpload 体积=fd 内各 Blob size 求和（26MB+26MB=52MB → 无硬超时；字符串字段不计）", { timeout: 10_000 }, () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const fd = new FormData();
  fd.append("fieldsJson", JSON.stringify({ a: 1 }));
  fd.append("plain", HALF_BLOB_A, "plain.bin");
  fd.append("proof", HALF_BLOB_B, "proof.p7b");
  const pr = supplierApi.caDecryptUpload("p1", fd);
  const xhr = FakeXMLHttpRequest.last!;
  assert.equal(xhr.timeout, 0);
  // 收尾：停滞前手动完成，避免挂起
  xhr.finish(200, { ok: 1 });
  return pr;
});

test("caDecryptUpload onProgress：整数百分比透传；lengthComputable=false 不回调", { timeout: 10_000 }, async () => {
  const pcts: number[] = [];
  const fd = new FormData();
  fd.append("plain", new Blob(["abc"]), "p.bin");
  const pr = supplierApi.caDecryptUpload("p1", fd, (pct) => pcts.push(pct));
  const xhr = FakeXMLHttpRequest.last!;
  const fire = (ev: FakeEvent) => xhr.upload.onprogress!(ev);
  fire({ lengthComputable: true, loaded: 0, total: 3 });
  fire({ lengthComputable: true, loaded: 1, total: 3 }); // 33.33 → 33
  fire({ lengthComputable: true, loaded: 2, total: 3 }); // 66.67 → 67
  fire({ lengthComputable: true, loaded: 3, total: 3 }); // 100
  fire({ lengthComputable: false, loaded: 2, total: 0 });
  assert.deepEqual(pcts, [0, 33, 67, 100]);
  xhr.finish(200, { ok: 1 });
  await pr;
});

test("caDecryptUpload >50MB：停滞满 60s → abort → 以停滞文案 reject（onabort 派发面）", { timeout: 10_000 }, async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const fd = new FormData();
  fd.append("plain", BIG_BLOB, "plain.bin");
  const pr = supplierApi.caDecryptUpload("p1", fd);
  const xhr = FakeXMLHttpRequest.last!;
  assert.equal(xhr.timeout, 0);
  const expectation = assert.rejects(pr, /网络停滞超过 60 秒/);
  mock.timers.tick(60_000);
  await expectation;
  assert.equal(xhr.abortCalls, 1);
});

test("caDecryptUpload >50MB：abort 派发走 onerror 的浏览器 → 仍是停滞文案而非「网络异常」", { timeout: 10_000 }, async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const fd = new FormData();
  fd.append("plain", BIG_BLOB, "plain.bin");
  const pr = supplierApi.caDecryptUpload("p1", fd);
  const xhr = FakeXMLHttpRequest.last!;
  xhr.abortDispatch = "error";
  const expectation = assert.rejects(pr, /网络停滞超过 60 秒/);
  mock.timers.tick(60_000);
  await expectation;
  assert.equal(xhr.abortCalls, 1);
});

test("caDecryptUpload：硬超时（ontimeout 面）不再让 promise 悬挂", { timeout: 10_000 }, async () => {
  const fd = new FormData();
  fd.append("plain", new Blob(["hello"]), "p.bin");
  const pr = supplierApi.caDecryptUpload("p1", fd);
  const xhr = FakeXMLHttpRequest.last!;
  const expectation = assert.rejects(pr, /上传超时/);
  xhr.ontimeout?.({});
  await expectation;
});

// ── caUploadEncryptedOuter：公开签名不变，内部换 xhrTimeoutMs + 看门狗 ────────

test("caUploadEncryptedOuter ≤50MB：硬超时 180s 不变、onProgress 透传、成功解析", { timeout: 10_000 }, async () => {
  const pcts: number[] = [];
  const blob = new Blob([new Uint8Array(1024)]);
  const pr = supplierApi.caUploadEncryptedOuter("p1", blob, "o.bin", (pct) => pcts.push(pct));
  const xhr = FakeXMLHttpRequest.last!;
  assert.equal(xhr.timeout, 180_000);
  xhr.upload.onprogress!({ lengthComputable: true, loaded: 5, total: 20 });
  assert.deepEqual(pcts, [25]);
  xhr.finish(200, { fileAssetId: "f1", outerSha256: "x", outerBytes: 1024, expiresAt: "later" });
  const res = await pr;
  assert.equal(res.fileAssetId, "f1");
});

test("caUploadEncryptedOuter 无 onProgress 调用（既有三参/两参形态）仍工作", { timeout: 10_000 }, async () => {
  const blob = new Blob([new Uint8Array(2048)]);
  const pr = supplierApi.caUploadEncryptedOuter("p1", blob, "o.bin");
  const xhr = FakeXMLHttpRequest.last!;
  assert.equal(xhr.timeout, 180_000);
  xhr.finish(200, { fileAssetId: "f2", outerSha256: "x", outerBytes: 2048, expiresAt: "later" });
  await pr;
});

test("caUploadEncryptedOuter >50MB：timeout=0 + 看门狗；传输中 progress 复位不误杀，停滞满 60s → 停滞文案", { timeout: 10_000 }, async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const pcts: number[] = [];
  const pr = supplierApi.caUploadEncryptedOuter("p1", BIG_BLOB, "o.bin", (pct) => pcts.push(pct));
  const xhr = FakeXMLHttpRequest.last!;
  assert.equal(xhr.timeout, 0);
  // 3 × (30s 心跳 + progress)：累计 90s > 60s 窗口，但持续有进度 → 不 abort（500MB 慢链路不误杀）
  for (let i = 1; i <= 3; i++) {
    mock.timers.tick(30_000);
    xhr.upload.onprogress!({ lengthComputable: true, loaded: i, total: 4 });
  }
  assert.equal(xhr.abortCalls, 0);
  assert.deepEqual(pcts, [25, 50, 75]);
  // 停滞满 60s → abort → 停滞文案
  const expectation = assert.rejects(pr, /网络停滞超过 60 秒/);
  mock.timers.tick(60_000);
  await expectation;
  assert.equal(xhr.abortCalls, 1);
});

// ── 测试小工具 ────────────────────────────────────────────────────────────────

function xhrAsXhr(fake: FakeXMLHttpRequest): XMLHttpRequest {
  return fake as unknown as XMLHttpRequest;
}

function xhrAsFake(xhr: XMLHttpRequest): FakeXMLHttpRequest {
  return xhr as unknown as FakeXMLHttpRequest;
}
