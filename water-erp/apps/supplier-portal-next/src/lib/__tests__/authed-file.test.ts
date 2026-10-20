import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { authedHeaders, saveBlob } from "../authed-file";

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

/**
 * saveBlob 落盘竞态回归（2026-10-19，:3004 采购文件下载失败根因）：
 * 旧 doDownload「离屏 anchor + click 后立即 revokeObjectURL」在真实浏览器中抢在
 * 读取 blob URL 前撤销它 → 下载静默失败（API 已 200、fetch/blob 均成功，唯独不落盘）。
 * 契约：锚必须挂进 DOM、click 触发、revoke 只能在 60s 延迟之后。
 */
test("saveBlob：锚挂 DOM + click 触发 + 延迟 revoke（saveBlob 返回时不得已 revoke）", async () => {
  const g = globalThis as any;
  const savedDoc = g.document;
  const savedUrl = g.URL;
  const savedWindow = g.window;

  const timers: Array<{ fn: () => void; ms: number }> = [];
  const revoked: string[] = [];
  const anchor: any = {
    href: "", download: "", clicks: 0, removed: false,
    click() { this.clicks++; },
    remove() { this.removed = true; },
  };
  const appended: any[] = [];
  g.document = { createElement: () => anchor, body: { appendChild: (el: any) => appended.push(el) } };
  g.URL = { createObjectURL: () => "blob:mock-1", revokeObjectURL: (u: string) => revoked.push(u) };
  g.window = { setTimeout: (fn: () => void, ms: number) => { timers.push({ fn, ms }); return timers.length; } };

  try {
    await saveBlob(new Blob(["x"]), "采购文件.docx");

    // ① 锚挂进 DOM（离屏 anchor 老版本 Safari 不触发下载）
    assert.equal(appended.length, 1, "anchor 应 appendChild 到 document.body");
    assert.equal(appended[0], anchor);
    // ② 下载名 + blob URL + 点击各就位
    assert.equal(anchor.download, "采购文件.docx");
    assert.equal(anchor.href, "blob:mock-1");
    assert.equal(anchor.clicks, 1, "anchor 应被 click()");
    assert.equal(anchor.removed, true, "点击后 anchor 应从 DOM 移除");
    // ③ saveBlob 返回时不得已 revoke（立即 revoke = 浏览器竞态下载失败）
    assert.equal(revoked.length, 0, "saveBlob 返回后不得立即 revokeObjectURL");
    // ④ 延迟 60s 后 revoke 恰好一次
    const revokeTimers = timers.filter((t) => t.ms >= 60_000);
    assert.equal(revokeTimers.length, 1, "应恰好调度一个 ≥60s 的延迟 revoke");
    revokeTimers[0].fn();
    assert.deepEqual(revoked, ["blob:mock-1"]);
  } finally {
    if (savedDoc === undefined) delete g.document; else g.document = savedDoc;
    if (savedUrl === undefined) delete g.URL; else g.URL = savedUrl;
    if (savedWindow === undefined) delete g.window; else g.window = savedWindow;
  }
});
