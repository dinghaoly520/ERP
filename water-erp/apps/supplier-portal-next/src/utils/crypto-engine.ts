/* =================================================================
   crypto-engine.ts — 分块加解密 Worker 引擎（骨架，2026-11-05 Task 3 spike）
   createWorkerCryptoEngine()：浏览器端构造 crypto worker（实例化模式定案见
   spec §4.4——`new Worker(new URL(...), import.meta.url)` Turbopack 双模式可用）。
   SSR 或构造失败 → null，调用方据此降级主线程分块（兜底③，spec §4.4）。
   完整消息协议（请求路由/进度回调/transferable 回传/取消）Task 5 实现。
   ================================================================= */

/**
 * 构造分块加解密 Worker。
 *
 * - SSR（无 window）→ null
 * - Worker 构造抛错（如浏览器不支持 module worker）→ null，调用方降级主线程分块
 *
 * 注意：URL 必须是静态字面量相对路径（Turbopack 编译期识别该模式并产出独立
 * worker chunk），勿改成运行时拼接变量。
 */
export function createWorkerCryptoEngine(): Worker | null {
  if (typeof window === "undefined") return null;
  try {
    return new Worker(new URL("../workers/crypto-worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
}
