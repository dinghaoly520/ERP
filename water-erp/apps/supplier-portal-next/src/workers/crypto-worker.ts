/* =================================================================
   crypto-worker.ts — 分块加解密 Web Worker（骨架，2026-11-05 Task 3 spike）
   全库首例 Web Worker。实例化模式定案见 spec §4.4：
   `new Worker(new URL('../workers/crypto-worker.ts', import.meta.url), { type: 'module' })`
   —— Turbopack dev（运行中 :3004 实测）与 build（同版本 next 16.2.3 合成应用
   实测产出独立 worker chunk）双过。
   本骨架仅 ping/pong echo 验证打包链路；分块 SM4 / 增量 SHA-256 消息协议、
   进度节流与取消语义在 Task 5 实现（@water-erp/ukey 分块原语）。
   ================================================================= */

/** 主线程 → worker 请求（骨架协议：仅 ping；完整协议 Task 5 定义） */
export interface CryptoWorkerRequest {
  id: number | string;
  cmd: string;
}

/** worker → 主线程响应（骨架协议：仅 pong） */
export interface CryptoWorkerResponse {
  id: number | string;
  type: string;
}

self.onmessage = (event: MessageEvent<CryptoWorkerRequest>) => {
  const req = event.data;
  if (req && typeof req === "object" && req.cmd === "ping") {
    const res: CryptoWorkerResponse = { id: req.id, type: "pong" };
    self.postMessage(res);
  }
};
