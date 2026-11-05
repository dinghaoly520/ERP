/* =================================================================
   crypto-worker.ts — 分块加解密 Web Worker 数据面（Task 5，接 Task 3 骨架）
   全库首例 Web Worker。实例化模式定案见 spec §4.4：
   `new Worker(new URL('../workers/crypto-worker.ts', import.meta.url), { type: 'module' })`
   —— Turbopack dev（运行中 :3004 实测）与 build（同版本 next 16.2.3 合成应用
   实测产出独立 worker chunk）双过。
   职责：分发主线程请求 → crypto-pipeline 直跑（@water-erp/ukey 分块原语）→
   progress 节流（2MB 或 250ms 先到者 + 终值兜底）→ done 帧 postMessage 传
   Blob 句柄（大数据盘背书，不拷主线程堆）。解密请求在本 worker 内 fetch
   （同源 cookie + X-Portal: supplier）流式拉取。
   协议类型自 ../utils/crypto-engine type-only 引用（编译期擦除）——worker 侧
   运行时反向依赖门面模块会成打包环，勿改成值导入。
   ================================================================= */
import { SM4_CHUNK_BYTES } from '@water-erp/ukey';
import { decryptStream, encryptFileStream } from '../utils/crypto-pipeline';
import type {
  CryptoWorkerDecryptBody,
  CryptoWorkerEncryptBody,
  CryptoWorkerRequest,
  CryptoWorkerResponse,
} from '../utils/crypto-engine';

/** progress 时间窗（字节闸 2MB = SM4_CHUNK_BYTES，与 pipeline 读段闸同源） */
const PROGRESS_MIN_MS = 250;

/**
 * progress 节流：2MB 或 250ms 先到者放行；doneBytes 达已知总量（终值档）必放
 * ——pipeline 侧已有 2MB 字节闸，此处时间窗折叠快流的密集档，终值兜底保证
 * 「最后一档 == 总量」不被时间窗吞掉。lastAt 初值 0（Date.now() 口径）保证
 * 首帧必过。
 */
class ProgressThrottle {
  private lastBytes = 0;
  private lastAt = 0;
  constructor(private readonly totalKnown: number) {}
  hit(doneBytes: number): boolean {
    const now = Date.now();
    if (
      doneBytes - this.lastBytes >= SM4_CHUNK_BYTES ||
      now - this.lastAt >= PROGRESS_MIN_MS ||
      (this.totalKnown > 0 && doneBytes >= this.totalKnown)
    ) {
      this.lastBytes = doneBytes;
      this.lastAt = now;
      return true;
    }
    return false;
  }
}

// self：worker 全局（lib.dom 将 self 类型化为 Window 主线程形态，postMessage
// 单参调用在其第二重载下类型兼容；运行时这里是 DedicatedWorkerGlobalScope）
const post = (msg: CryptoWorkerResponse): void => {
  self.postMessage(msg);
};

const fail = (id: number, err: unknown): void => {
  post({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
};

async function runEncrypt(body: CryptoWorkerEncryptBody & { id: number }): Promise<void> {
  const totalBytes = body.file.size;
  const throttle = new ProgressThrottle(totalBytes);
  const result = await encryptFileStream(body.file.stream(), totalBytes, body.dekS, body.dekA, (done) => {
    if (throttle.hit(done)) post({ id: body.id, type: 'progress', doneBytes: done, totalBytes });
  });
  post({ id: body.id, type: 'done', ...result });
}

/** Content-Length → totalBytes（缺失/非法 → 0=未知）。与 crypto-engine.ts 同义
 *  拷贝——见该文件注释（防打包环，勿单边改口径）。 */
function toTotalBytes(raw: string | null): number {
  const n = Number(raw ?? '');
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function runDecrypt(body: CryptoWorkerDecryptBody & { id: number }): Promise<void> {
  const res = await fetch(body.url, { credentials: 'include', headers: { 'X-Portal': 'supplier' } });
  if (!res.ok) throw new Error(`密文下载失败（HTTP ${res.status}）`);
  if (!res.body) throw new Error('下载响应无流式 body（response.body 为空）');
  const totalBytes = toTotalBytes(res.headers.get('content-length'));
  const throttle = new ProgressThrottle(totalBytes);
  const result = await decryptStream(res.body, body.dek, (done) => {
    if (throttle.hit(done)) post({ id: body.id, type: 'progress', doneBytes: done, totalBytes });
  });
  post({ id: body.id, type: 'done', ...result });
}

self.onmessage = (event: MessageEvent<CryptoWorkerRequest>): void => {
  const req = event.data;
  if (!req || typeof req !== 'object' || typeof req.id !== 'number') return;
  switch (req.cmd) {
    case 'ping':
      post({ id: req.id, type: 'pong' });
      break;
    case 'encrypt':
      // 异步处理器必须兜 catch——worker 内未捕获异常会触发 onerror（引擎侧按崩溃处置）
      runEncrypt(req).catch((err) => fail(req.id, err));
      break;
    case 'decrypt':
      runDecrypt(req).catch((err) => fail(req.id, err));
      break;
  }
};
