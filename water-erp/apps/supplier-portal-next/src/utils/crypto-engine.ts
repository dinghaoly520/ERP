/* =================================================================
   crypto-engine.ts — 分块加解密引擎门面（Task 5，2026-11-05，接 Task 3 骨架）
   - createWorkerCryptoEngine()：worker 数据面门面——模块内单 worker 实例 +
     Map<id,{resolve,reject,onProgress}> 关联。terminate() 清 Map 全 reject 后
     置空，下次调用自动重建（取消后重试直达，无「须手动重建」态）。
   - createLocalCryptoEngine(fetchImpl?)：同进程直跑 crypto-pipeline——
     Node 测试与降级双用；decryptUrl 的 fetch 可注入（默认全局 fetch）。
   - getDefaultCryptoEngine()：lazy——worker 优先，不可用回退 local
     （兜底③，spec §4.4）；worker onerror 后会话级熔断改指 local
     （脚本装载失败在构造成功后异步炸——不熔断则永远 erroring）。
   进度口径桥接：引擎公开 onProgress(doneBytes, totalBytes)；pipeline 是单参
   (doneBytes)——total 由本层补齐（encrypt=file.size、decrypt=Content-Length
   （parseContentLengthBytes 统一实现落 pipeline 模块），缺失=0）。pipeline
   产出的 Blob 原样透传，本层绝不重建。
   取消（2026-11-05 修复波 F5）：encryptFile/decryptUrl 末参可选 AbortSignal
   ——local 引擎桥 pipeline.shouldStop（块边界 CRYPTO_CANCELLED）；worker
   引擎 abort 即 disposeWorker（pending 全 reject，与 terminate 同语义、幂等）。
   ================================================================= */
import { decryptStream, encryptFileStream, parseContentLengthBytes } from './crypto-pipeline';
import type { DecryptStreamResult, DekHex, EncryptFileResult } from './crypto-pipeline';

/* ───────────── 消息协议（spec §4.2 定案；crypto-worker.ts type-only 引用共享） ───────────── */

export interface CryptoWorkerEncryptBody {
  cmd: 'encrypt';
  file: File;
  dekS: DekHex;
  dekA: DekHex;
}
export interface CryptoWorkerDecryptBody {
  cmd: 'decrypt';
  url: string;
  dek: DekHex;
}
export type CryptoWorkerRequest =
  /** 打包链路探针（Task 3 spike 遗产），协议槽位保留 */
  | { id: number; cmd: 'ping' }
  | ({ id: number } & CryptoWorkerEncryptBody)
  | ({ id: number } & CryptoWorkerDecryptBody);

export type CryptoWorkerEncryptDone = { id: number; type: 'done' } & EncryptFileResult;
export type CryptoWorkerDecryptDone = { id: number; type: 'done' } & DecryptStreamResult;
export type CryptoWorkerDone = CryptoWorkerEncryptDone | CryptoWorkerDecryptDone;
export type CryptoWorkerResponse =
  | { id: number; type: 'progress'; doneBytes: number; totalBytes: number }
  | CryptoWorkerDone
  | { id: number; type: 'error'; message: string }
  | { id: number; type: 'pong' };

/* ───────────── 引擎接口 ───────────── */

export type CryptoProgressFn = (doneBytes: number, totalBytes: number) => void;

export interface CryptoEngine {
  encryptFile(
    file: File,
    dekS: DekHex,
    dekA: DekHex,
    onProgress?: CryptoProgressFn,
    signal?: AbortSignal,
  ): Promise<EncryptFileResult>;
  decryptUrl(
    url: string,
    dek: DekHex,
    onProgress?: CryptoProgressFn,
    signal?: AbortSignal,
  ): Promise<DecryptStreamResult>;
  /** worker 引擎：终止 worker + pending 全 reject（取消语义）；local 引擎：no-op */
  terminate(): void;
}

/** 引擎依赖的 worker 最小结构面（真 Worker 结构兼容；Node 测试注入手写 fake） */
export interface CryptoWorkerHandle {
  postMessage(message: CryptoWorkerRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<CryptoWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}
export interface CryptoEngineOptions {
  /** 测试注入 worker 构造（Node 无 Worker 全局）——直接给「造一个 handle」的
   *  函数（与生产 defaultSpawn 同形）。注入只落「当前生效 spawn」槽位（共享
   *  worker 重建跟随）；生产默认 defaultSpawn 为 const 永不被改写。 */
  spawn?: () => CryptoWorkerHandle;
}

/* ───────────── worker 引擎（模块内单实例 + promise map） ───────────── */

type SpawnWorker = () => CryptoWorkerHandle;

/** 默认 spawn：仅浏览器窗口可用（SSR/Node → null → 调用方回退 local）。
 *  const——生产构造路径，测试注入永不触碰本引用。 */
const defaultSpawn: SpawnWorker | null =
  typeof window !== 'undefined' && typeof Worker === 'function'
    ? () =>
        // URL 必须是静态字面量相对路径——Turbopack 编译期识别该模式并产出独立
        // worker chunk（实例化模式定案 spec §4.4），勿改成运行时拼接变量。
        new Worker(new URL('../workers/crypto-worker.ts', import.meta.url), { type: 'module' })
    : null;

interface PendingEntry {
  resolve: (value: EncryptFileResult | DecryptStreamResult) => void;
  reject: (reason: Error) => void;
  onProgress?: CryptoProgressFn;
}

/** 当前生效 spawn：共享 worker 懒重建（terminate/崩溃置空后）跟随本槽位。
 *  仅 createWorkerCryptoEngine 写入——显式注入=换装、无参调用=复位生产默认。
 *  之所以保留模块槽位（而非纯参数传递）：workerEngine 是共享单例，terminate
 *  后的重建必须沿用「最后一次换装的 spawn」，否则注入环境下的重建会回落
 *  到 Node 下的 null。生产 defaultSpawn（const）不会被注入污染（F5 修复波）。 */
let activeSpawn: SpawnWorker | null = defaultSpawn;
let activeWorker: CryptoWorkerHandle | null = null;
const pendingRequests = new Map<number, PendingEntry>();
let nextRequestId = 1;

function attachHandlers(worker: CryptoWorkerHandle): void {
  worker.onmessage = (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    const entry = pendingRequests.get(msg.id);
    if (!entry) return; // 迟到帧（已 done / terminate 后残留消息）——静默丢弃
    switch (msg.type) {
      case 'progress':
        entry.onProgress?.(msg.doneBytes, msg.totalBytes);
        return;
      case 'done': {
        pendingRequests.delete(msg.id);
        const { id: _dropId, type: _dropType, ...result } = msg;
        void _dropId;
        void _dropType;
        entry.resolve(result);
        return;
      }
      case 'error':
        pendingRequests.delete(msg.id);
        entry.reject(new Error(msg.message));
        return;
      case 'pong':
        // 引擎不发 ping（Task 3 探针槽位）——pong 能关联到 pending 即协议异常，reject 防挂死
        // （旧行为只 delete 不 settle，恰好制造它注释里声称要防止的挂死 promise）
        pendingRequests.delete(msg.id);
        entry.reject(new Error('意外 pong 帧（引擎不发 ping）'));
        return;
    }
  };
  worker.onerror = (event) => {
    // 未捕获异常 = worker 状态不明：pending 全 reject，坏 worker 按 terminate
    // 处理并置空——下次调用自动重建新实例
    const err = new Error(`crypto worker 异常：${event.message ?? '未知错误'}`);
    for (const entry of pendingRequests.values()) entry.reject(err);
    pendingRequests.clear();
    try {
      worker.terminate();
    } catch {
      /* 已死 */
    }
    if (activeWorker === worker) activeWorker = null;
    // 脚本装载失败（如打包回归）在构造成功后异步炸 onerror——不熔断则默认引擎每次
    // 重建新 worker 再失败，永远 erroring、local 兜底永不介入。会话级熔断（阈值 1）：
    // 默认引擎改指 local；直连 createWorkerCryptoEngine 的重建语义不变（显式换引擎）。
    defaultEngineFusedToLocal = true;
    defaultEngine = null;
  };
}

function getWorker(): CryptoWorkerHandle | null {
  if (activeWorker) return activeWorker;
  const spawn = activeSpawn;
  if (!spawn) return null;
  try {
    const worker = spawn();
    attachHandlers(worker);
    activeWorker = worker;
    return worker;
  } catch {
    return null; // 构造失败（不支持 module worker 等）——调用方回退 local
  }
}

/** 终止 worker + 清空 pending（全 reject）——terminate 语义与重建前清场共用 */
function disposeWorker(): void {
  if (activeWorker) {
    try {
      activeWorker.terminate();
    } catch {
      /* 忽略 */
    }
    activeWorker = null;
  }
  if (pendingRequests.size > 0) {
    const err = new Error('CryptoEngine 已终止（terminate），请求取消');
    for (const entry of pendingRequests.values()) entry.reject(err);
    pendingRequests.clear();
  }
}

function requestViaWorker<T>(
  body: CryptoWorkerEncryptBody | CryptoWorkerDecryptBody,
  onProgress?: CryptoProgressFn,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const worker = getWorker();
    if (!worker) {
      reject(new Error('crypto worker 不可用（环境不支持或构造失败）——应回退 local 引擎'));
      return;
    }
    // 调用即已取消：不发帧、不动共享 worker（dispose 会误伤其他在途 pending）
    if (signal?.aborted) {
      reject(new Error('CRYPTO_CANCELLED'));
      return;
    }
    const id = nextRequestId++;
    // abort → disposeWorker（幂等）：本请求与其余 pending 一并 reject——worker 引擎
    // 的取消语义本就是「整场终止」（与 terminate 同源），settle 时摘监听防泄漏/防误触发
    const onAbort = (): void => disposeWorker();
    const cleanup = (): void => signal?.removeEventListener('abort', onAbort);
    signal?.addEventListener('abort', onAbort, { once: true });
    pendingRequests.set(id, {
      resolve: (value) => {
        cleanup();
        resolve(value as T);
      },
      reject: (reason) => {
        cleanup();
        reject(reason);
      },
      onProgress,
    });
    worker.postMessage({ ...body, id });
  });
}

/** worker 引擎门面（模块单例——多次 create 共享同一 worker 与 pending map） */
const workerEngine: CryptoEngine = {
  encryptFile: (file, dekS, dekA, onProgress, signal) =>
    requestViaWorker<EncryptFileResult>({ cmd: 'encrypt', file, dekS, dekA }, onProgress, signal),
  decryptUrl: (url, dek, onProgress, signal) =>
    requestViaWorker<DecryptStreamResult>({ cmd: 'decrypt', url, dek }, onProgress, signal),
  terminate: disposeWorker,
};

/**
 * 构造 worker 引擎。
 *
 * - 浏览器：静态字面量 URL 构造（见 defaultSpawn 注释）
 * - SSR / Worker 不可用 / 构造抛错（注入 spawn 抛错同理）→ null，调用方降级 local
 * - 重复调用 = 换引擎：旧 worker 与 pending 先清场（terminate + 全 reject）。
 *   ⚠ 本工厂会重置共享 worker——「重复调用=换引擎」的清场语义是刻意的：
 *   生产代码勿在业务在途请求时调用（会 reject 全部 pending）；测试注入走 opts.spawn。
 */
export function createWorkerCryptoEngine(options?: CryptoEngineOptions): CryptoEngine | null {
  activeSpawn = options?.spawn ?? defaultSpawn;
  disposeWorker();
  return getWorker() ? workerEngine : null;
}

/* ───────────── local 引擎（同进程直跑 pipeline） ───────────── */

/** local 引擎可注入的 fetch 形态（decryptUrl 数据源；默认全局 fetch） */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** AbortSignal → pipeline.shouldStop 桥（F5 修复波）：local 引擎的取消通道——
 *  每块边界检查，取消时 pipeline 抛 CRYPTO_CANCELLED 并尽力断流。 */
const signalToShouldStop = (signal?: AbortSignal): (() => boolean) | undefined =>
  signal ? () => signal.aborted === true : undefined;

export function createLocalCryptoEngine(
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
): CryptoEngine {
  return {
    async encryptFile(file, dekS, dekA, onProgress, signal) {
      // file.stream() 直喂 pipeline；totalBytes 恒为 file.size
      return encryptFileStream(
        file.stream(),
        file.size,
        dekS,
        dekA,
        (done) => onProgress?.(done, file.size),
        signalToShouldStop(signal),
      );
    },
    async decryptUrl(url, dek, onProgress, signal) {
      // 与既有主线程取件同构（ca-opening-decrypt-card）：同源 cookie + 门户头
      const res = await fetchImpl(url, { credentials: 'include', headers: { 'X-Portal': 'supplier' } });
      if (!res.ok) throw new Error(`密文下载失败（HTTP ${res.status}）`);
      if (!res.body) throw new Error('下载响应无流式 body（response.body 为空）');
      const totalBytes = parseContentLengthBytes(res.headers.get('content-length'));
      // 取消检查在 pipeline 读流循环内——下载连接随 reader.cancel 一并释放
      return decryptStream(res.body, dek, (done) => onProgress?.(done, totalBytes), signalToShouldStop(signal));
    },
    terminate() {
      // 同进程直跑无 worker 可终止——取消语义经 AbortSignal→shouldStop 通道（F5 修复波）
    },
  };
}

/* ───────────── 默认引擎（lazy） ───────────── */

let defaultEngine: CryptoEngine | null = null;
/** worker onerror 会话级熔断旗（阈值 1）：置位后默认引擎不再试 worker，改指 local */
let defaultEngineFusedToLocal = false;

/** lazy 默认引擎：worker 优先，构造失败/环境不可用 → 回退 local 同进程直跑；
 *  worker 运行中 onerror（含脚本装载失败）→ 会话级熔断，后续调用恒 local */
export function getDefaultCryptoEngine(): CryptoEngine {
  if (defaultEngineFusedToLocal) {
    defaultEngine ??= createLocalCryptoEngine();
    return defaultEngine;
  }
  if (!defaultEngine) {
    defaultEngine = createWorkerCryptoEngine() ?? createLocalCryptoEngine();
  }
  return defaultEngine;
}
