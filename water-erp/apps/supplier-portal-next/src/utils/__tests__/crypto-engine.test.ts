/**
 * crypto-engine 单测（Task 5）——引擎门面四件套：
 * ① local 引擎（同进程直跑 pipeline）：File 往返 one-shot 双层锚 + 可注入
 *    fetchImpl 的 decryptUrl（credentials/X-Portal/Content-Length 口径）
 * ② worker 协议编解码：手写 fake Worker（Node 无 Worker 全局）锁请求帧/
 *    响应帧/id 关联/并发不串线/error→reject
 * ③ terminate 语义：pending 全 reject、worker.terminate 被调、下次调用自动重建
 * ④ 构造失败 → null；getDefaultCryptoEngine 回退 local 且记忆化
 *    F5 补：worker onerror（脚本装载失败=构造后异步炸）→ 默认引擎会话级熔断改指 local
 * 另设一组直驱真实 crypto-worker 模块（伪造 self 全局）：真数据面（pipeline 直跑、
 * progress 节流、done 帧形状、解密 fetch、error 帧）——node:test 按文件分进程，
 * 全局替身不影响其他测试文件。
 * 等价锚沿用 Task 4：one-shot 双层 sm4Encrypt 手工期望值（信封字节级零变化）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomHex, sha256Hex, sm4Encrypt } from '@water-erp/ukey';
import type { DekHex } from '../crypto-pipeline';
import {
  createLocalCryptoEngine,
  createWorkerCryptoEngine,
  getDefaultCryptoEngine,
  type CryptoWorkerCtor,
  type CryptoWorkerRequest,
  type CryptoWorkerResponse,
} from '../crypto-engine';

const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
// 返回类型显式锚 ArrayBuffer：new File([plain]) 的 BlobPart 要求 ArrayBufferView<ArrayBuffer>
const fromHex = (h: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array((h.match(/.{2}/g) ?? []).map((x) => parseInt(x, 16)));
const randomDek = (): DekHex => ({ keyHex: randomHex(16), ivHex: randomHex(16) });
/** getRandomValues 单次上限 65536B——超限分段填充 */
const randomBytes = (n: number): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(n);
  for (let pos = 0; pos < n; pos += 65536) crypto.getRandomValues(out.subarray(pos, pos + 65536));
  return out;
};
const blobBytes = async (b: Blob): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(await b.arrayBuffer());
/** 随机切分喂流（1B..16KB 段）——任意非对齐读段 */
const chunkedStream = (bytes: Uint8Array, maxChunk = 16 * 1024): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      for (let pos = 0; pos < bytes.length; ) {
        const len = 1 + Math.floor(Math.random() * maxChunk);
        controller.enqueue(bytes.slice(pos, pos + len));
        pos += len;
      }
      controller.close();
    },
  });

/** 手写 fake Worker：实现引擎依赖的最小结构面（postMessage/onmessage/onerror/terminate） */
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<CryptoWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly posted: CryptoWorkerRequest[] = [];
  terminated = 0;
  readonly scriptURL: string;
  readonly options: unknown;
  constructor(scriptURL: URL | string, options?: unknown) {
    this.scriptURL = String(scriptURL);
    this.options = options;
    FakeWorker.instances.push(this);
  }
  postMessage(message: CryptoWorkerRequest): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated += 1;
  }
  /** 模拟 worker → 主线程回帧 */
  reply(msg: CryptoWorkerResponse): void {
    this.onmessage?.({ data: msg } as MessageEvent<CryptoWorkerResponse>);
  }
  /** 模拟 worker 崩溃（onerror） */
  crash(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
  get lastPosted(): CryptoWorkerRequest {
    const last = this.posted[this.posted.length - 1];
    if (!last) throw new Error('FakeWorker: 尚无 postMessage');
    return last;
  }
}

const asEncryptRequest = (msg: CryptoWorkerRequest) => {
  if (msg.cmd !== 'encrypt') throw new Error(`期望 encrypt 帧，实得 ${String(msg.cmd)}`);
  return msg;
};
const asDecryptRequest = (msg: CryptoWorkerRequest) => {
  if (msg.cmd !== 'decrypt') throw new Error(`期望 decrypt 帧，实得 ${String(msg.cmd)}`);
  return msg;
};

/** encrypt done 帧样本（字段值与锚无关，锁的是引擎透传） */
const encryptDone = (id: number, outerBlob: Blob): CryptoWorkerResponse => ({
  id,
  type: 'done',
  outerBlob,
  plainSha256: 'ps',
  innerSha256: 'is',
  outerSha256: 'os',
  plainBytes: 3,
  innerBytes: 19,
  outerBytes: 35,
});

/* ───────────────────── 组1：local 引擎（同进程直跑 pipeline） ───────────────────── */

test('local 加密：File → encryptFile == one-shot 双层锚逐字节；onProgress(done,total) total 恒为 file.size', async () => {
  const engine = createLocalCryptoEngine();
  const plain = randomBytes(100 * 1024 + 7);
  const dekS = randomDek();
  const dekA = randomDek();

  const progress: Array<[number, number]> = [];
  const r = await engine.encryptFile(
    new File([plain], 'bid.pdf', { type: 'application/pdf' }),
    dekS,
    dekA,
    (done, total) => progress.push([done, total]),
  );

  const innerHex = sm4Encrypt(dekS.keyHex, dekS.ivHex, toHex(plain));
  const outerHex = sm4Encrypt(dekA.keyHex, dekA.ivHex, innerHex);
  assert.equal(toHex(await blobBytes(r.outerBlob)), outerHex, 'outerBlob == one-shot 双层密文');
  assert.equal(r.plainSha256, await sha256Hex(plain));
  assert.equal(r.innerSha256, await sha256Hex(fromHex(innerHex)));
  assert.equal(r.outerSha256, await sha256Hex(fromHex(outerHex)));
  assert.equal(r.plainBytes, plain.length);
  assert.equal(r.innerBytes, fromHex(innerHex).length);
  assert.equal(r.outerBytes, fromHex(outerHex).length);
  assert.ok(r.outerBlob instanceof Blob, 'pipeline 产物 Blob 原样透传');

  assert.ok(progress.length >= 1, '至少收尾档');
  assert.deepEqual(progress[progress.length - 1], [plain.length, plain.length], '终值 (done,total)==(size,size)');
  assert.ok(progress.every(([, total]) => total === plain.length), 'totalBytes 恒为 file.size（加密侧）');
});

test('local 解密：decryptUrl 走注入 fetchImpl（credentials=include + X-Portal:supplier）两跳还原；Content-Length 作 totalBytes', async () => {
  const seed = createLocalCryptoEngine();
  const plain = randomBytes(64 * 1024 + 3);
  const dekS = randomDek();
  const dekA = randomDek();
  const enc = await seed.encryptFile(new File([plain], 'bid.pdf'), dekS, dekA);
  const cOuter = await blobBytes(enc.outerBlob);

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const queue: Response[] = [
    new Response(chunkedStream(cOuter), { headers: { 'content-length': String(cOuter.length) } }),
  ];
  const engine = createLocalCryptoEngine(async (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error(`未预期的 fetch: ${url}`);
    return next;
  });

  // 第一跳：剥外层（dekA）——totalBytes 取 Content-Length
  const prog1: Array<[number, number]> = [];
  const hop1 = await engine.decryptUrl('/api/upload/files/outer-1', dekA, (d, t) => prog1.push([d, t]));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/upload/files/outer-1');
  assert.equal(calls[0].init?.credentials, 'include', '同源 cookie');
  assert.equal(
    (calls[0].init?.headers as Record<string, string> | undefined)?.['X-Portal'],
    'supplier',
    '门户头',
  );
  assert.equal(hop1.plainBytes, enc.innerBytes, '第一跳产出 C_inner');
  assert.equal(hop1.plainSha256, enc.innerSha256);
  assert.deepEqual(prog1[prog1.length - 1], [cOuter.length, cOuter.length], '解密进度终值 (密文长, Content-Length)');
  assert.ok(prog1.every(([, total]) => total === cOuter.length), 'totalBytes 恒为 Content-Length');

  // 第二跳：剥内层（dekS）——响应无 Content-Length → totalBytes=0
  const cInner = await blobBytes(hop1.plainBlob);
  queue.push(new Response(chunkedStream(cInner)));
  const prog2: Array<[number, number]> = [];
  const back = await engine.decryptUrl('/api/upload/files/inner-1', dekS, (d, t) => prog2.push([d, t]));
  assert.equal(toHex(await blobBytes(back.plainBlob)), toHex(plain), '两跳还原原明文');
  assert.equal(back.plainSha256, enc.plainSha256);
  assert.equal(back.plainBytes, plain.length);
  assert.ok(prog2.every(([, total]) => total === 0), '无 Content-Length → totalBytes=0');
});

test('local 解密：非 2xx → reject 带状态码；无 body 响应 → reject', async () => {
  const engine403 = createLocalCryptoEngine(async () => new Response('forbidden', { status: 403 }));
  await assert.rejects(engine403.decryptUrl('/api/upload/files/x', randomDek()), /403/);

  const engineNoBody = createLocalCryptoEngine(async () => new Response());
  await assert.rejects(engineNoBody.decryptUrl('/api/upload/files/x', randomDek()), /body/);
});

/* ───────────────────── 组2：worker 协议编解码（fake Worker） ───────────────────── */

test('worker encrypt：发 {cmd:encrypt,file,dekS,dekA}；progress×3 双参透传；done resolve 且 Blob 引用不重建', async () => {
  FakeWorker.instances.length = 0;
  const engine = createWorkerCryptoEngine({ workerCtor: FakeWorker });
  assert.ok(engine, 'fake 构造可用 → 引擎非 null');
  assert.equal(FakeWorker.instances.length, 1, '构造即建一个 worker');
  const w = FakeWorker.instances[0]!;
  assert.ok(w.scriptURL.includes('crypto-worker'), 'URL 指 worker 文件');
  assert.deepEqual(w.options, { type: 'module' });

  const file = new File([new Uint8Array([1, 2, 3])], 'bid.pdf');
  const dekS = randomDek();
  const dekA = randomDek();
  const progress: Array<[number, number]> = [];
  const blob = new Blob([new Uint8Array([9, 9])], { type: 'application/octet-stream' });

  const p = engine.encryptFile(file, dekS, dekA, (done, total) => progress.push([done, total]));
  const sent = asEncryptRequest(w.lastPosted);
  assert.ok(typeof sent.id === 'number' && sent.id > 0, '帧带正数数字 id');
  assert.equal(sent.file, file, 'File 引用透传（真 postMessage 才结构化克隆，fake 直传）');
  assert.equal(sent.dekS, dekS);
  assert.equal(sent.dekA, dekA);
  assert.equal(w.posted.length, 1);

  w.reply({ id: sent.id, type: 'progress', doneBytes: 1, totalBytes: 30 });
  w.reply({ id: sent.id, type: 'progress', doneBytes: 10, totalBytes: 30 });
  w.reply({ id: sent.id, type: 'progress', doneBytes: 30, totalBytes: 30 });
  assert.deepEqual(
    progress,
    [
      [1, 30],
      [10, 30],
      [30, 30],
    ],
    'progress (doneBytes,totalBytes) 三次直转——节流在 worker 侧，引擎不吞帧',
  );

  w.reply(encryptDone(sent.id, blob));
  const r = await p;
  assert.equal(r.outerBlob, blob, 'done 帧 Blob 引用原样透传（引擎不重建 Blob）');
  assert.equal(r.plainSha256, 'ps');
  assert.equal(r.innerSha256, 'is');
  assert.equal(r.outerSha256, 'os');
  assert.equal(r.plainBytes, 3);
  assert.equal(r.innerBytes, 19);
  assert.equal(r.outerBytes, 35);
});

test('worker decrypt：发 {cmd:decrypt,url,dek}；error 帧 → reject(message)，之后引擎仍可用', async () => {
  FakeWorker.instances.length = 0;
  const engine = createWorkerCryptoEngine({ workerCtor: FakeWorker });
  assert.ok(engine);
  const w = FakeWorker.instances[0]!;

  const dek = randomDek();
  const pErr = engine.decryptUrl('/api/upload/files/asset-1', dek);
  const sentErr = asDecryptRequest(w.lastPosted);
  assert.equal(sentErr.url, '/api/upload/files/asset-1');
  assert.equal(sentErr.dek, dek);
  w.reply({ id: sentErr.id, type: 'error', message: 'padding is invalid' });
  await assert.rejects(pErr, /padding is invalid/);

  const blob = new Blob([new Uint8Array([7])]);
  const pOk = engine.decryptUrl('/api/upload/files/asset-2', dek);
  const sentOk = asDecryptRequest(w.lastPosted);
  assert.notEqual(sentOk.id, sentErr.id, 'id 递增不复用');
  w.reply({ id: sentOk.id, type: 'done', plainBlob: blob, plainSha256: 'ph', plainBytes: 1 });
  const r = await pOk;
  assert.equal(r.plainBlob, blob);
  assert.equal(r.plainSha256, 'ph');
  assert.equal(r.plainBytes, 1);
});

test('worker 并发：id 关联不串线——后发 id 先 done 也不误投', async () => {
  FakeWorker.instances.length = 0;
  const engine = createWorkerCryptoEngine({ workerCtor: FakeWorker });
  assert.ok(engine);
  const w = FakeWorker.instances[0]!;
  const file = new File([new Uint8Array(4)], 'f');
  const dekS = randomDek();
  const dekA = randomDek();

  const progA: number[] = [];
  const progB: number[] = [];
  const pA = engine.encryptFile(file, dekS, dekA, (d) => progA.push(d));
  const reqA = asEncryptRequest(w.lastPosted);
  const pB = engine.encryptFile(file, dekS, dekA, (d) => progB.push(d));
  const reqB = asEncryptRequest(w.lastPosted);
  assert.notEqual(reqA.id, reqB.id, '并发请求 id 相异');

  w.reply({ id: reqA.id, type: 'progress', doneBytes: 1, totalBytes: 8 });
  assert.deepEqual(progA, [1]);
  assert.deepEqual(progB, [], 'B 未收 A 的进度');

  w.reply({ id: reqB.id, type: 'progress', doneBytes: 5, totalBytes: 8 });
  assert.deepEqual(progB, [5]);
  assert.deepEqual(progA, [1]);

  const blobB = new Blob([new Uint8Array([2])]);
  w.reply(encryptDone(reqB.id, blobB));
  assert.equal((await pB).outerBlob, blobB, 'B 先完成拿自己的载荷');

  const blobA = new Blob([new Uint8Array([1])]);
  w.reply(encryptDone(reqA.id, blobA));
  assert.equal((await pA).outerBlob, blobA, 'A 拿自己的载荷，不串 B');
  assert.deepEqual(progA, [1]);
  assert.deepEqual(progB, [5]);
});

/* ───────────────────── 组3：terminate / 崩溃语义 ───────────────────── */

test('worker terminate：pending 全 reject（取消语义）+ worker.terminate 被调；下次调用自动重建新 worker', async () => {
  FakeWorker.instances.length = 0;
  const engine = createWorkerCryptoEngine({ workerCtor: FakeWorker });
  assert.ok(engine);
  const w1 = FakeWorker.instances[0]!;
  const file = new File([new Uint8Array(3)], 'f');
  const dekS = randomDek();
  const dekA = randomDek();

  const p1 = engine.encryptFile(file, dekS, dekA);
  const p2 = engine.decryptUrl('/api/upload/files/x', dekS);

  engine.terminate();
  assert.equal(w1.terminated, 1, '底层 worker.terminate 被调');
  await assert.rejects(p1, /已终止|取消/);
  await assert.rejects(p2, /已终止|取消/);

  // 同一 engine 再次调用 → 自动重建（无「须手动重建」态）
  const p3 = engine.encryptFile(file, dekS, dekA);
  assert.equal(FakeWorker.instances.length, 2, '新 worker 实例被构造');
  const w2 = FakeWorker.instances[1]!;
  assert.notEqual(w2, w1);
  const sent3 = asEncryptRequest(w2.lastPosted);
  w2.reply(encryptDone(sent3.id, new Blob([new Uint8Array(0)])));
  assert.equal((await p3).plainBytes, 3);

  // 旧 worker 迟到帧不误投（id 已不在 map——静默忽略，不炸不串）
  w1.reply({ id: sent3.id, type: 'error', message: 'late zombie' });
  assert.equal(w2.posted.length, 1);
});

test('worker 崩溃（onerror）：pending 全 reject、坏 worker 被 terminate，下次调用重建', async () => {
  FakeWorker.instances.length = 0;
  const engine = createWorkerCryptoEngine({ workerCtor: FakeWorker });
  assert.ok(engine);
  const w1 = FakeWorker.instances[0]!;
  const file = new File([new Uint8Array(2)], 'f');
  const p1 = engine.encryptFile(file, randomDek(), randomDek());

  w1.crash('sm-crypto OOM');
  assert.equal(w1.terminated, 1, '状态不明的 worker 被 terminate');
  await assert.rejects(p1, /sm-crypto OOM|worker 异常/);

  const p2 = engine.encryptFile(file, randomDek(), randomDek());
  assert.equal(FakeWorker.instances.length, 2, '下次调用重建');
  const w2 = FakeWorker.instances[1]!;
  const sent = asEncryptRequest(w2.lastPosted);
  w2.reply(encryptDone(sent.id, new Blob([new Uint8Array(0)])));
  await p2; // 重建后可正常完成
});

/* ───────────────────── 组4：构造失败 / 默认引擎 ───────────────────── */

test('构造失败 → null：WorkerCtor 抛错被吞，不外泄', () => {
  class ThrowingWorker {
    constructor() {
      throw new Error('module workers unsupported');
    }
  }
  const engine = createWorkerCryptoEngine({
    workerCtor: ThrowingWorker as unknown as CryptoWorkerCtor,
  });
  assert.equal(engine, null);
});

test('getDefaultCryptoEngine：Node（无 Worker 全局）→ 回退 local，记忆化同实例，terminate 后仍可用', async () => {
  const e1 = getDefaultCryptoEngine();
  const e2 = getDefaultCryptoEngine();
  assert.equal(e1, e2, 'lazy 记忆化');

  // Node 下 worker 引擎必 null → 拿到的必是 local：以 one-shot 双层锚证真跑
  const plain = randomBytes(100);
  const dekS = randomDek();
  const dekA = randomDek();
  const r = await e1.encryptFile(new File([plain], 'f'), dekS, dekA);
  const outerHex = sm4Encrypt(dekA.keyHex, dekA.ivHex, sm4Encrypt(dekS.keyHex, dekS.ivHex, toHex(plain)));
  assert.equal(toHex(await blobBytes(r.outerBlob)), outerHex);
  assert.equal(r.outerSha256, await sha256Hex(fromHex(outerHex)));
  assert.equal(r.plainBytes, 100);

  // local terminate = no-op，后续调用照常
  e1.terminate();
  const r2 = await e1.encryptFile(new File([plain], 'f'), dekS, dekA);
  assert.equal(r2.plainBytes, 100);
});

/* ───────────────────── 组4b：F5 熔断——worker onerror 后默认引擎改指 local ───────────────────── */

test('F5 worker 脚本装载失败熔断：构造成功→onerror→后续 getDefaultCryptoEngine 改指 local（不再复用死 worker）', async () => {
  // 伪造浏览器全局（window+Worker）并带 query 重导入——fresh 模块实例的 defaultSpawn
  // 在模块求值期生效（Node 原生导入永远拿 local，测不到浏览器侧路径）
  class BrowserFakeWorker {
    static instances: BrowserFakeWorker[] = [];
    onmessage: ((event: MessageEvent<CryptoWorkerResponse>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    terminated = 0;
    constructor(_scriptURL: URL, _options?: unknown) {
      BrowserFakeWorker.instances.push(this);
    }
    postMessage(): void {
      /* 引擎会 post，本测试不回帧 */
    }
    terminate(): void {
      this.terminated += 1;
    }
    crash(message: string): void {
      this.onerror?.({ message } as ErrorEvent);
    }
  }
  const g = globalThis as unknown as { window?: unknown; Worker?: unknown };
  const savedWindow = g.window;
  const savedWorker = g.Worker;
  g.window = {};
  g.Worker = BrowserFakeWorker;
  try {
    // query 后缀使 TS 无法静态解析模块（运行时 tsx/Node 正常按 query 取 fresh 实例）——
    // 非 literal specifier + typeof import 显式回类型
    type CryptoEngineModule = typeof import('../crypto-engine');
    const specifier = new URL('../crypto-engine.ts?fuse=fix-wave', import.meta.url).href;
    const mod = (await import(specifier)) as unknown as CryptoEngineModule;
    BrowserFakeWorker.instances.length = 0;

    // ① 构造成功期：默认引擎解析到 worker 门面，worker 实例在位
    const engineA = mod.getDefaultCryptoEngine();
    assert.equal(BrowserFakeWorker.instances.length, 1, '默认引擎 lazy 构造 worker');
    const w = BrowserFakeWorker.instances[0]!;

    // ② 挂起请求 → onerror（脚本装载失败=构造成功后异步炸，同一 onerror 路径）
    const pPending = engineA.decryptUrl('/api/upload/files/big', randomDek());
    w.crash('worker script load failed（打包回归模拟）');
    assert.equal(w.terminated, 1, '坏 worker 被 terminate');
    await assert.rejects(pPending, /worker script load failed|worker 异常/, 'pending 请求被 reject（不挂死）');

    // ③ 熔断后：默认引擎重指向 local——新请求直跑 pipeline，零新 worker 构造
    const engineB = mod.getDefaultCryptoEngine();
    assert.notEqual(engineB, engineA, '默认引擎已改指 local（非原 worker 门面）');
    const plain = randomBytes(100);
    const dekS = randomDek();
    const dekA = randomDek();
    const r = await engineB.encryptFile(new File([plain], 'f'), dekS, dekA);
    const outerHex = sm4Encrypt(dekA.keyHex, dekA.ivHex, sm4Encrypt(dekS.keyHex, dekS.ivHex, toHex(plain)));
    assert.equal(toHex(await blobBytes(r.outerBlob)), outerHex, 'local 引擎真跑（one-shot 双层锚）');
    assert.equal(BrowserFakeWorker.instances.length, 1, '熔断后不再构造新 worker（不会重建再失败死循环）');
  } finally {
    if (savedWindow === undefined) delete g.window;
    else g.window = savedWindow;
    if (savedWorker === undefined) delete g.Worker;
    else g.Worker = savedWorker;
  }
});

/* ───────────────────── 组5：直驱真实 worker 模块（伪造 self 全局，真数据面） ───────────────────── */

test('真 worker 数据面：encrypt 全链（progress 节流 + done 帧 == one-shot 锚）与 decrypt fetch 流', async () => {
  interface WorkerSelf {
    onmessage: ((event: MessageEvent<CryptoWorkerRequest>) => void) | null;
    postMessage(message: CryptoWorkerResponse): void;
  }
  const frames: CryptoWorkerResponse[] = [];
  const fakeSelf: WorkerSelf = {
    onmessage: null,
    postMessage: (msg) => frames.push(msg),
  };
  const g = globalThis as unknown as { self?: unknown; fetch: typeof fetch };
  const savedFetch = g.fetch;
  g.self = fakeSelf;
  try {
    await import('../../workers/crypto-worker');
    assert.ok(fakeSelf.onmessage, 'worker 模块装载即挂 onmessage');
    const onmessage = fakeSelf.onmessage;

    // ping → pong（骨架协议槽位保留）
    onmessage({ data: { id: 100, cmd: 'ping' } } as MessageEvent<CryptoWorkerRequest>);
    assert.deepEqual(frames.at(-1), { id: 100, type: 'pong' });

    // encrypt：2MB+100B——字节节流放行 1 档（≥2MB 跨越）+ 终值兜底 1 档
    const plain = randomBytes(2 * 1024 * 1024 + 100);
    const dekS = randomDek();
    const dekA = randomDek();
    const file = new File([plain], 'bid.pdf');
    const encryptId = 101;
    onmessage({ data: { id: encryptId, cmd: 'encrypt', file, dekS, dekA } } as MessageEvent<CryptoWorkerRequest>);

    const framesFor = (id: number) => frames.filter((f) => f.id === id);
    const waitForDone = async (id: number, ms = 20000): Promise<void> => {
      const t0 = Date.now();
      while (!framesFor(id).some((f) => f.type === 'done' || f.type === 'error')) {
        if (Date.now() - t0 > ms) throw new Error(`worker 帧 ${id} 超时`);
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    await waitForDone(encryptId);

    const innerHex = sm4Encrypt(dekS.keyHex, dekS.ivHex, toHex(plain));
    const outerHex = sm4Encrypt(dekA.keyHex, dekA.ivHex, innerHex);
    const encFrames = framesFor(encryptId);
    const progFrames = encFrames.filter((f) => f.type === 'progress');
    assert.ok(
      progFrames.length >= 2 && progFrames.length <= 3,
      `2MB+ 跨节流档：progress ${progFrames.length} 档（≥字节闸 1 档 + 终值兜底）`,
    );
    assert.ok(progFrames.every((f) => f.type === 'progress' && f.totalBytes === plain.length), 'totalBytes 恒为 file.size');
    const lastProg = progFrames.at(-1);
    assert.ok(lastProg?.type === 'progress' && lastProg.doneBytes === plain.length, '终值档 doneBytes==总量');
    const doneFrame = encFrames.find((f) => f.type === 'done');
    assert.ok(doneFrame && doneFrame.type === 'done' && 'outerBlob' in doneFrame, 'done 帧带 outerBlob');
    if (doneFrame?.type === 'done' && 'outerBlob' in doneFrame) {
      assert.equal(toHex(await blobBytes(doneFrame.outerBlob)), outerHex, 'worker 产出 == one-shot 双层锚');
      assert.equal(doneFrame.plainSha256, await sha256Hex(plain));
      assert.equal(doneFrame.innerSha256, await sha256Hex(fromHex(innerHex)));
      assert.equal(doneFrame.outerSha256, await sha256Hex(fromHex(outerHex)));
      assert.equal(doneFrame.plainBytes, plain.length);
      assert.equal(doneFrame.outerBytes, fromHex(outerHex).length);
    }

    // decrypt：伪造全局 fetch 回 C_outer 流（带 Content-Length）→ 还原 C_inner
    const cOuter = fromHex(outerHex);
    g.fetch = (async () =>
      new Response(chunkedStream(cOuter), { headers: { 'content-length': String(cOuter.length) } })) as typeof fetch;
    const decryptId = 102;
    onmessage({ data: { id: decryptId, cmd: 'decrypt', url: '/api/upload/files/c-outer', dek: dekA } } as MessageEvent<CryptoWorkerRequest>);
    await waitForDone(decryptId);
    const decDone = framesFor(decryptId).find((f) => f.type === 'done');
    assert.ok(decDone && decDone.type === 'done' && 'plainBlob' in decDone, '解密 done 帧带 plainBlob');
    if (decDone?.type === 'done' && 'plainBlob' in decDone) {
      assert.equal(toHex(await blobBytes(decDone.plainBlob)), innerHex, 'worker 解密 == C_inner');
      assert.equal(decDone.plainSha256, await sha256Hex(fromHex(innerHex)));
      assert.equal(decDone.plainBytes, cInnerLen(innerHex));
    }
    const decProg = framesFor(decryptId).filter((f) => f.type === 'progress');
    assert.ok(decProg.every((f) => f.type === 'progress' && f.totalBytes === cOuter.length), '解密 totalBytes==Content-Length');

    // 错误帧：错钥解密 → padding 校验失败 → {type:'error', message}
    g.fetch = (async () => new Response(chunkedStream(cOuter))) as typeof fetch;
    const errId = 103;
    onmessage({ data: { id: errId, cmd: 'decrypt', url: '/api/upload/files/c-outer', dek: randomDek() } } as MessageEvent<CryptoWorkerRequest>);
    await waitForDone(errId);
    const errFrame = framesFor(errId).find((f) => f.type === 'error');
    assert.ok(errFrame?.type === 'error' && /padding/i.test(errFrame.message), `错钥 → error 帧（${errFrame?.type === 'error' ? errFrame.message : '无'}）`);
  } finally {
    g.fetch = savedFetch;
    delete g.self;
  }
});

/** C_inner 长度（hex → 字节数）——测试内小工具 */
function cInnerLen(innerHex: string): number {
  return fromHex(innerHex).length;
}
