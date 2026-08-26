# Mock U盾中间件 + VendorUKeyAdapter 实装实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付本地 mock U盾中间件服务(全仿真:盾文件插拔/PIN 会话/锁死 PUK/发行 CLI)+ `VendorUKeyAdapter` HTTP 实装 + 供应商门户探测优先自动切换。

**Architecture:** 新独立服务 `services/ukey-middleware/`(纯 Node .mjs,镜像 services/ocr 模式,不进 pnpm workspace)监听 `127.0.0.1:17999`;`packages/ukey/src/vendor-ukey.ts` 三方法实装为对该服务的 fetch 调用;供应商门户新增 `ukey-factory.ts`,三视图(`UkeyManage.vue`/`BidSubmit.vue`/`OpeningHall.vue`)通过它探测切换 vendor/mock。

**Tech Stack:** Node ≥20(实际 24.16)内置 `node:http`/`node:test`/webcrypto/fetch;sm-crypto ^0.4.0(SM2/SM4);TypeScript(packages/ukey,无 @types/node,禁 Node API);Vue 3 + Element Plus。

**Spec:** `water-erp/docs/superpowers/specs/2026-08-26-mock-ukey-middleware-design.md`(本计划从 spec 立论,执行者须同读)

## Global Constraints

- 每个任务开始前 `git branch --show-current` 确认在 `main`(多会话共库,别的会话会切分支);提交信息用 conventional 前缀 + 尾行 `Co-Authored-By: Claude Fable 5 <noreponame@anthropic.com>`;**不 push**(用户明确说 push 才 push)。
- `services/ukey-middleware/` **不在 pnpm workspace**(workspace globs 只有 apps/* 与 packages/*):一切命令用 `cd water-erp/services/ukey-middleware && node src/...`,没有 `pnpm --filter`。
- `packages/ukey` 被浏览器与 Node 双端消费、tsconfig 无 @types/node:`vendor-ukey.ts` 只准用 Web 标准 API(fetch/AbortController/setTimeout/DOM lib);改包后必须 `pnpm --filter @water-erp/ukey build`,供应商门户 dev 重启前 `rm -rf apps/supplier-portal/node_modules/.vite`(Vite 预打包缓存,见 memory `vite-dep-cache-workspace-packages`)。
- 服务端与 CLI 的用户可见文案一律中文,注释密度对齐仓库(中文、说明 why、关键坑注记)。
- 私钥永不以明文落盘:盾文件内只有 AES-GCM 密文(PIN 封装份 + PUK 封装份);中间件进程内存中允许持有已解锁私钥(模拟盾芯片内态)。
- 端口 17999、盾槽默认 `~/.shuidi-ukey/slots`、会话空闲 300s、PIN 6 次锁死——数值来自 spec §5/§11,勿漂移。
- 编辑 `CLAUDE.md` 必须走 Bash(ARS 守卫拦 Edit/Write,memory `edit-claudemd-via-bash`)。
- 现有 mock 轨道(MockUKeyAdapter、dual-selfcheck、e2e 55 项)零改动。

---

### Task 1: 服务脚手架 + shield.mjs(盾介质文件/PIN 计数/PUK)

**Files:**
- Create: `water-erp/services/ukey-middleware/package.json`
- Create: `water-erp/services/ukey-middleware/src/shield.mjs`
- Test: `water-erp/services/ukey-middleware/src/shield.test.mjs`

**Interfaces:**
- Consumes: 无(首任务)。
- Produces(Task 3/4/5 依赖,签名精确如下):
  - `defaultSlotDir(): string`
  - `listShields(slotDir?: string): ShieldFile[]`(每次实时扫描目录)
  - `findShieldByCertSn(slotDir: string, certSn: string): ShieldFile | null`
  - `issueShield({ cn, pin, slotDir }): Promise<{ shield: ShieldFile; puk: string }>`
  - `unlockShieldFile(shield, pin, slotDir): Promise<{ ok: boolean; privKeyHex?: string; retryLeft: number; locked: boolean }>`(错 PIN 持久化扣减计数)
  - `unblockShield({ slotDir, shieldId, puk, newPin? }): Promise<{ ok: boolean }>`
  - `ShieldFile` 形状(spec §4):`{ version:1, shieldId, certSn, certDn, publicKey, alg:'SM2', issuedAt, kdf:{algo,iterations,salt,pukSalt}, encPrivKey:{nonce,ct}, encPrivKeyPuk:{nonce,ct}, pinPolicy:{maxRetry,retryLeft,locked,pukHash} }`;**certSn === shieldId**,格式 `SHD-` + 8 位大写 hex;certDn = `CN=<cn>,O=蜀水云采模拟CA,C=CN`

- [ ] **Step 1: 建脚手架并装依赖**

`water-erp/services/ukey-middleware/package.json`:

```json
{
  "name": "ukey-middleware",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Mock CA U盾本地中间件(全仿真:盾文件插拔/PIN 会话/锁死 PUK/发行 CLI)——协议见 docs/superpowers/specs/2026-08-26-mock-ukey-middleware-design.md §5",
  "bin": { "ukeymw": "src/cli.mjs" },
  "scripts": {
    "serve": "node src/cli.mjs serve",
    "test": "node --test src/"
  },
  "dependencies": { "sm-crypto": "^0.4.0" }
}
```

Run: `cd water-erp/services/ukey-middleware && npm install --no-fund --no-audit`
Expected: 生成 node_modules/ 与 package-lock.json。
再验忽略: `cd water-erp && git check-ignore services/ukey-middleware/node_modules` 有输出即被忽略;若无,创建 `services/ukey-middleware/.gitignore` 内容一行 `node_modules/`。

- [ ] **Step 2: 写失败测试**

`water-erp/services/ukey-middleware/src/shield.test.mjs`:

```js
/* 盾介质文件单测:发行形状 / PIN 计数与锁死 / PUK 解锁与重设 PIN / 目录扫描 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { issueShield, listShields, unlockShieldFile, unblockShield } from './shield.mjs';

const require = createRequire(import.meta.url);
const { sm2 } = require('sm-crypto');

const tmpSlot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ukey-shield-'));

test('issueShield:文件形状与持久化(0600,私钥仅密文)', async () => {
  const slotDir = tmpSlot();
  const { shield, puk } = await issueShield({ cn: '四川水发建设有限公司', pin: '123456', slotDir });
  assert.match(shield.shieldId, /^SHD-[0-9A-F]{8}$/);
  assert.equal(shield.certSn, shield.shieldId);
  assert.equal(shield.certDn, 'CN=四川水发建设有限公司,O=蜀水云采模拟CA,C=CN');
  assert.match(shield.publicKey, /^04[0-9a-fA-F]{128}$/);
  assert.match(puk, /^[A-Z2-9]{12}$/);
  assert.equal(shield.pinPolicy.retryLeft, 6);
  assert.ok(shield.encPrivKey.ct && shield.encPrivKeyPuk.ct);
  const raw = fs.readFileSync(path.join(slotDir, `${shield.shieldId}.ukey`), 'utf8');
  assert.ok(!raw.includes(puk), 'PUK 不得明文落盘(只存 pukHash)');
  assert.ok(!raw.includes('123456'), 'PIN 不得明文落盘');
  assert.equal((fs.statSync(path.join(slotDir, `${shield.shieldId}.ukey`)).mode & 0o777), 0o600);
});

test('unlockShieldFile:错 PIN 扣计数、6 次锁死、锁死后正 PIN 也拒', async () => {
  const slotDir = tmpSlot();
  const { shield } = await issueShield({ cn: '甲公司', pin: '123456', slotDir });
  for (let i = 0; i < 6; i++) {
    const r = await unlockShieldFile(shield, '000000', slotDir);
    assert.equal(r.ok, false);
    assert.equal(r.retryLeft, 5 - i);
  }
  assert.equal(shield.pinPolicy.locked, true);
  const lockedTry = await unlockShieldFile(shield, '123456', slotDir);
  assert.equal(lockedTry.ok, false, '锁死后正确 PIN 也不放行');
  assert.equal(lockedTry.locked, true);
});

test('unlockShieldFile:正确 PIN 返回私钥且不扣计数', async () => {
  const slotDir = tmpSlot();
  const { shield } = await issueShield({ cn: '乙公司', pin: '654321', slotDir });
  const r = await unlockShieldFile(shield, '654321', slotDir);
  assert.equal(r.ok, true);
  assert.match(r.privKeyHex, /^[0-9a-fA-F]{64}$/);
  assert.equal(r.retryLeft, 6);
});

test('unblockShield:错 PUK 拒;正 PUK 重置计数;--new-pin 重设后旧 PIN 失效新 PIN 生效', async () => {
  const slotDir = tmpSlot();
  const { shield, puk } = await issueShield({ cn: '丙公司', pin: '111111', slotDir });
  for (let i = 0; i < 6; i++) await unlockShieldFile(shield, '000000', slotDir);
  const bad = await unblockShield({ slotDir, shieldId: shield.shieldId, puk: 'WRONGPUK000' });
  assert.equal(bad.ok, false);
  const r1 = await unblockShield({ slotDir, shieldId: shield.shieldId, puk, newPin: '222222' });
  assert.equal(r1.ok, true);
  const oldPin = await unlockShieldFile(shield, '111111', slotDir);
  assert.equal(oldPin.ok, false, 'PUK 通道重设 PIN 后旧 PIN 不再可用');
  const newPin = await unlockShieldFile(shield, '222222', slotDir);
  assert.equal(newPin.ok, true);
  assert.equal(shield.pinPolicy.retryLeft, 6);
  assert.equal(shield.pinPolicy.locked, false);
});

test('listShields:扫描槽目录全部 .ukey 文件', async () => {
  const slotDir = tmpSlot();
  await issueShield({ cn: '丁公司', pin: '123456', slotDir });
  await issueShield({ cn: '戊公司', pin: '123456', slotDir });
  const all = listShields(slotDir);
  assert.equal(all.length, 2);
  assert.ok(all.every((s) => s.certSn.startsWith('SHD-')));
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd water-erp/services/ukey-middleware && npm test`
Expected: FAIL —— `Cannot find module .../shield.mjs`。

- [ ] **Step 4: 实现 shield.mjs**

`water-erp/services/ukey-middleware/src/shield.mjs`:

```js
/* =================================================================
   盾介质文件 —— 「USB 盾」的文件化模拟(spec §4)

   - 一文件一盾:槽目录里放 <shieldId>.ukey = 插盾;移走 = 拔盾
   - 私钥永不落明文:encPrivKey(PIN 封装份)+ encPrivKeyPuk(PUK 封装份,
     PUK 权限高于 PIN,可不知旧 PIN 而重设新 PIN —— 真实盾语义)
   - PIN 校验方式 = 尝试 GCM 解封(认证失败即 PIN 错),不存 PIN 哈希
   - 参数族与 MockUKeyAdapter 一致:PBKDF2-SHA256 210k + AES-256-GCM
   ================================================================= */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const { sm2 } = require('sm-crypto');

const PBKDF2_ITERATIONS = 210_000;
const MAX_RETRY = 6;
const PUK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去易混淆字符
const subtle = crypto.subtle;
const utf8 = (s) => new TextEncoder().encode(s);
const toB64 = (u8) => Buffer.from(u8).toString('base64');
const fromB64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const sha256Hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

export const defaultSlotDir = () =>
  process.env.UKEY_SLOT_DIR ?? path.join(os.homedir(), '.shuidi-ukey', 'slots');

async function deriveKey(secret, salt) {
  const base = await subtle.importKey('raw', utf8(secret), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}
/** GCM 认证失败(口令错/密文坏)抛错——上层据此判定 PIN 错 */
async function aesUnwrap(entry, secret, salt) {
  const key = await deriveKey(secret, salt);
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(entry.nonce) }, key, fromB64(entry.ct));
  return new TextDecoder().decode(plain);
}
async function aesWrap(plainHex, secret, salt) {
  const key = await deriveKey(secret, salt);
  const nonce = crypto.randomBytes(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, utf8(plainHex));
  return { nonce: toB64(nonce), ct: toB64(new Uint8Array(ct)) };
}

export function persistShield(slotDir, shield) {
  fs.mkdirSync(slotDir, { recursive: true, mode: 0o700 });
  const file = path.join(slotDir, `${shield.shieldId}.ukey`);
  fs.writeFileSync(file, JSON.stringify(shield, null, 2), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export function listShields(slotDir = defaultSlotDir()) {
  if (!fs.existsSync(slotDir)) return [];
  return fs
    .readdirSync(slotDir)
    .filter((f) => f.endsWith('.ukey'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(slotDir, f), 'utf8')));
}

export function findShieldByCertSn(slotDir, certSn) {
  return listShields(slotDir).find((s) => s.certSn === certSn) ?? null;
}

export function randomPUK(len = 12) {
  const buf = crypto.randomBytes(len);
  return Array.from(buf, (b) => PUK_ALPHABET[b % PUK_ALPHABET.length]).join('');
}

/** 发行(=模拟 CA 柜台办证):CN 由发行方传参,须与平台注册企业名一致否则 bindCert 拒收 */
export async function issueShield({ cn, pin, slotDir }) {
  if (!cn || !pin) throw new Error('--cn 与 --pin 必填');
  const kp = sm2.generateKeyPairHex();
  const shieldId = `SHD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const puk = randomPUK();
  const pinSalt = crypto.randomBytes(16);
  const pukSalt = crypto.randomBytes(16);
  const shield = {
    version: 1,
    shieldId,
    certSn: shieldId,
    certDn: `CN=${cn},O=蜀水云采模拟CA,C=CN`,
    publicKey: kp.publicKey,
    alg: 'SM2',
    issuedAt: new Date().toISOString(),
    kdf: { algo: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, salt: toB64(pinSalt), pukSalt: toB64(pukSalt) },
    encPrivKey: await aesWrap(kp.privateKey, pin, pinSalt),
    encPrivKeyPuk: await aesWrap(kp.privateKey, puk, pukSalt),
    pinPolicy: { maxRetry: MAX_RETRY, retryLeft: MAX_RETRY, locked: false, pukHash: sha256Hex(puk + toB64(pukSalt)) },
  };
  persistShield(slotDir, shield);
  return { shield, puk };
}

/** PIN 尝试:成功返私钥;失败扣 retryLeft(持久化),减到 0 置 locked */
export async function unlockShieldFile(shield, pin, slotDir) {
  if (shield.pinPolicy.locked) return { ok: false, retryLeft: shield.pinPolicy.retryLeft, locked: true };
  try {
    const privKeyHex = await aesUnwrap(shield.encPrivKey, pin, fromB64(shield.kdf.salt));
    return { ok: true, privKeyHex, retryLeft: shield.pinPolicy.retryLeft, locked: false };
  } catch {
    shield.pinPolicy.retryLeft = Math.max(0, shield.pinPolicy.retryLeft - 1);
    if (shield.pinPolicy.retryLeft === 0) shield.pinPolicy.locked = true;
    persistShield(slotDir, shield);
    return { ok: false, retryLeft: shield.pinPolicy.retryLeft, locked: shield.pinPolicy.locked };
  }
}

/** PUK 解锁:重置计数;可顺带重设 PIN(经 PUK 封装份取私钥重封,不需旧 PIN) */
export async function unblockShield({ slotDir, shieldId, puk, newPin }) {
  const shield = listShields(slotDir).find((s) => s.shieldId === shieldId || s.certSn === shieldId);
  if (!shield) return { ok: false };
  if (sha256Hex(puk + shield.kdf.pukSalt) !== shield.pinPolicy.pukHash) return { ok: false };
  shield.pinPolicy.retryLeft = shield.pinPolicy.maxRetry;
  shield.pinPolicy.locked = false;
  if (newPin) {
    const privKeyHex = await aesUnwrap(shield.encPrivKeyPuk, puk, fromB64(shield.kdf.pukSalt));
    const salt = crypto.randomBytes(16);
    shield.kdf.salt = toB64(salt);
    shield.encPrivKey = await aesWrap(privKeyHex, newPin, salt);
  }
  persistShield(slotDir, shield);
  return { ok: true };
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd water-erp/services/ukey-middleware && npm test`
Expected: PASS(5 tests)。

- [ ] **Step 6: 提交**

```bash
cd water-erp && git add services/ukey-middleware
git commit -m "feat(ukey-mw): 盾介质文件层——PIN 封装+PUK 封装双份私钥、错误计数锁死、发行/解锁/PUK 解锁

Co-Authored-By: Claude Fable 5 <noreponame@anthropic.com>"
```

---

### Task 2: session.mjs(解锁会话 + 空闲自动锁)

**Files:**
- Create: `water-erp/services/ukey-middleware/src/session.mjs`
- Test: `water-erp/services/ukey-middleware/src/session.test.mjs`

**Interfaces:**
- Consumes: 无。
- Produces(Task 3 依赖): `class ShieldSessions { constructor(ttlSeconds?: number); set(id: string, privKeyHex: string): void; peek(id: string): string | null; get(id: string): string | null; drop(id: string): void; dropAll(): void; unlockedIds(): string[] }` —— `peek` 不刷新时间(health 计数用),`get` 刷新(私钥操作用);过期惰性淘汰。

- [ ] **Step 1: 写失败测试**

`water-erp/services/ukey-middleware/src/session.test.mjs`:

```js
/* 解锁会话:set/peek 不续时、get 续时、TTL 惰性过期、drop/dropAll */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShieldSessions } from './session.mjs';

test('TTL 过期惰性淘汰', async () => {
  const s = new ShieldSessions(0); // ttl=0:立即过期
  s.set('A', 'aa');
  await new Promise((r) => setTimeout(r, 5)); // 推进时钟,防同毫秒 flaky
  assert.equal(s.peek('A'), null);
  assert.deepEqual(s.unlockedIds(), []);
});

test('get 刷新 lastActive,peek 不刷新', async () => {
  const s = new ShieldSessions(1); // 1s
  s.set('A', 'aa');
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(s.get('A'), 'aa', '600ms 时 get 触达且续时');
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(s.peek('A'), 'aa', '距上次 get 700ms < 1000ms,仍在会话内');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(s.get('A'), null, '1100ms 无操作,已过期');
});

test('drop / dropAll', () => {
  const s = new ShieldSessions(300);
  s.set('A', 'aa'); s.set('B', 'bb');
  s.drop('A');
  assert.deepEqual(s.unlockedIds().sort(), ['B']);
  s.dropAll();
  assert.deepEqual(s.unlockedIds(), []);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd water-erp/services/ukey-middleware && npm test`
Expected: FAIL —— `Cannot find module .../session.mjs`(shield 测试仍绿)。

- [ ] **Step 3: 实现 session.mjs**

`water-erp/services/ukey-middleware/src/session.mjs`:

```js
/* =================================================================
   盾解锁会话(spec §5)—— 中间件进程内存 = 「盾芯片内态」的模拟载体

   - 解锁后私钥只在进程内存;签名/解密刷新 lastActive(=盾在用)
   - 超过 TTL 惰性淘汰(下次访问时判),/health 计数用 peek(不续时)
   - 中间件重启(内存丢失)= 全部上锁,须重新开锁
   ================================================================= */
export class ShieldSessions {
  constructor(ttlSeconds = Number(process.env.UKEY_MW_SESSION_TTL ?? 300)) {
    this.ttlMs = ttlSeconds * 1000;
    /** @type {Map<string, { privKeyHex: string, lastActive: number }>} */
    this.entries = new Map();
  }

  set(id, privKeyHex) {
    this.entries.set(id, { privKeyHex, lastActive: Date.now() });
  }

  peek(id) {
    const e = this.entries.get(id);
    if (!e) return null;
    if (Date.now() - e.lastActive > this.ttlMs) { this.entries.delete(id); return null; }
    return e.privKeyHex;
  }

  get(id) {
    const key = this.peek(id);
    if (key !== null) this.entries.get(id).lastActive = Date.now();
    return key;
  }

  drop(id) { this.entries.delete(id); }
  dropAll() { this.entries.clear(); }
  unlockedIds() { return [...this.entries.keys()].filter((id) => this.peek(id) !== null); }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd water-erp/services/ukey-middleware && npm test`
Expected: PASS(8 tests)。

- [ ] **Step 5: 提交**

```bash
git add services/ukey-middleware/src/session.mjs services/ukey-middleware/src/session.test.mjs
git commit -m "feat(ukey-mw): 解锁会话——TTL 惰性淘汰、get 续时/peek 只读

Co-Authored-By: Claude Fable 5 <noreponame@anthropic.com>"
```

---

### Task 3: server.mjs(HTTP 协议 + CORS + 错误映射)

**Files:**
- Create: `water-erp/services/ukey-middleware/src/server.mjs`
- Test: `water-erp/services/ukey-middleware/src/server.test.mjs`

**Interfaces:**
- Consumes: Task 1 `listShields/findShieldByCertSn/unlockShieldFile`;Task 2 `ShieldSessions`。
- Produces(Task 4/5 依赖): `startServer({ port?: number; host?: string; slotDir: string; sessions?: ShieldSessions }): Promise<{ server; port: number; close(): void }>`(port 0 = 随机端口,selfcheck/测试用)。端点与错误码按 spec §5:`GET /health`、`GET /certs`、`POST /session/unlock`、`POST /session/lock`、`POST /sign`、`POST /sm2/decrypt`;错误 `{error, code}` + 状态映射 400 BAD_REQUEST / 403 PIN_REQUIRED / 404 SHIELD_NOT_FOUND / 423 SHIELD_LOCKED / 422 DECRYPT_FAILED。

- [ ] **Step 1: 写失败测试**

`water-erp/services/ukey-middleware/src/server.test.mjs`:

```js
/* HTTP 协议测试:六端点happy path + 守卫次序(404→423→403)+ CORS 预检 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createRequire } from 'node:module';
import { startServer } from './server.mjs';
import { issueShield } from './shield.mjs';

const require = createRequire(import.meta.url);
const { sm2 } = require('sm-crypto');
const hexToBytes = (h) => Array.from({ length: h.length / 2 }, (_, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16));

let slotDir, base, srv, certSn, pub;
const PIN = '123456';
const get = (p, init) => fetch(base + p, init).then(async (r) => ({ status: r.status, headers: r.headers, j: await r.json().catch(() => null) }));
const post = (p, body) => get(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

before(async () => {
  slotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ukey-srv-'));
  const { shield } = await issueShield({ cn: '测试甲公司', pin: PIN, slotDir });
  certSn = shield.certSn; pub = shield.publicKey;
  srv = await startServer({ port: 0, slotDir });
  base = `http://127.0.0.1:${srv.port}`;
});
after(() => srv.close());

test('/health 与 /certs:在场盾计数与证书枚举(免 PIN)', async () => {
  const h = await get('/health');
  assert.equal(h.status, 200);
  assert.deepEqual({ ok: h.j.ok, shields: h.j.shields, unlocked: h.j.unlocked }, { ok: true, shields: 1, unlocked: 0 });
  const c = await get('/certs');
  assert.equal(c.j.certs.length, 1);
  assert.equal(c.j.certs[0].certSn, certSn);
  assert.equal(c.j.certs[0].shieldId, certSn);
});

test('未解锁签名 → 403 PIN_REQUIRED;错 PIN 扣计数;对 PIN 解锁', async () => {
  const s0 = await post('/sign', { certSn, data: 'abc' });
  assert.equal(s0.status, 403); assert.equal(s0.j.code, 'PIN_REQUIRED');
  const u1 = await post('/session/unlock', { pin: '000000' });
  assert.deepEqual(u1.j.failed, [{ shieldId: certSn, retryLeft: 5 }]);
  const u2 = await post('/session/unlock', { pin: PIN });
  assert.deepEqual(u2.j.unlocked, [certSn]); assert.deepEqual(u2.j.failed, []);
});

test('/sign:SM2 {hash:true},公钥可验签;/sm2/decrypt:回环;坏密文 422', async () => {
  const msg = 'sha256-envelope-hash-demo';
  const s = await post('/sign', { certSn, data: msg });
  assert.equal(s.status, 200);
  assert.equal(sm2.doVerifySignature(msg, s.j.sig, pub, { hash: true }), true);
  const dekHex = 'ab'.repeat(24);
  const cipher = sm2.doEncrypt(hexToBytes(dekHex), pub, 1);
  const d = await post('/sm2/decrypt', { certSn, cipher });
  assert.equal(d.j.plain, dekHex);
  const bad = await post('/sm2/decrypt', { certSn, cipher: '00' + cipher.slice(2) });
  assert.equal(bad.status, 422); assert.equal(bad.j.code, 'DECRYPT_FAILED');
});

test('拔盾(文件移走)→ 404 SHIELD_NOT_FOUND;放回恢复', async () => {
  const file = path.join(slotDir, `${certSn}.ukey`);
  const bak = file + '.bak';
  fs.renameSync(file, bak);
  const r = await post('/sign', { certSn, data: 'x' });
  assert.equal(r.status, 404); assert.equal(r.j.code, 'SHIELD_NOT_FOUND');
  fs.renameSync(bak, file);
  const ok = await post('/sign', { certSn, data: 'x' });
  assert.equal(ok.status, 200);
});

test('连错至锁死 → sign 423 SHIELD_LOCKED;lock 端点全员上锁', async () => {
  for (let i = 0; i < 5; i++) await post('/session/unlock', { pin: '000000' });
  const locked = await post('/sign', { certSn, data: 'x' });
  assert.equal(locked.status, 423); assert.equal(locked.j.code, 'SHIELD_LOCKED');
});

test('CORS:localhost Origin 回显、OPTIONS 预检 204;非白名单 Origin 不回显', async () => {
  const pre = await get('/health', { method: 'OPTIONS', headers: { Origin: 'http://localhost:3004', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'http://localhost:3004');
  const bad = await get('/health', { headers: { Origin: 'http://evil.example.com' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('坏 JSON 体 → 400 BAD_REQUEST', async () => {
  const r = await fetch(base + '/sign', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
  assert.equal(r.status, 400);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd water-erp/services/ukey-middleware && npm test`
Expected: FAIL —— `Cannot find module .../server.mjs`。

- [ ] **Step 3: 实现 server.mjs**

`water-erp/services/ukey-middleware/src/server.mjs`:

```js
/* =================================================================
   Mock U盾中间件 HTTP 服务(spec §5)—— 模拟 CA 厂商本机驱动服务

   仅绑定 loopback(UKEY_MW_BIND,默认 127.0.0.1,勿改 0.0.0.0);
   守卫次序:找盾(404) → 锁死(423) → 会话(403) → 运算;
   每请求实时扫描槽目录(插拔即时生效);请求体上限 1MB。
   ================================================================= */
import http from 'node:http';
import { createRequire } from 'node:module';
import { listShields, findShieldByCertSn, unlockShieldFile } from './shield.mjs';
import { ShieldSessions } from './session.mjs';

const require = createRequire(import.meta.url);
const { sm2 } = require('sm-crypto');

const VERSION = '1.0.0';
const BODY_LIMIT = 1024 * 1024;
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const bytesToHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const ERR = {
  BAD_REQUEST: [400, '请求参数缺失或格式错误'],
  SHIELD_NOT_FOUND: [404, '未找到 U盾(可能已拔出)'],
  PIN_REQUIRED: [403, 'U盾未解锁或会话已超时,请先开锁'],
  SHIELD_LOCKED: [423, 'U盾已锁定(PIN 错误次数超限),请使用管理码解锁'],
  DECRYPT_FAILED: [422, '解密失败:密文损坏'],
};

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  const extra = (process.env.UKEY_MW_ALLOW_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!LOCAL_ORIGIN.test(origin) && !extra.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'Origin',
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > BODY_LIMIT) { reject(Object.assign(new Error('body too large'), { code: 'BAD_REQUEST' })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('bad json'), { code: 'BAD_REQUEST' })); }
    });
    req.on('error', reject);
  });
}

export function startServer({ port = Number(process.env.UKEY_MW_PORT ?? 17999), host = process.env.UKEY_MW_BIND ?? '127.0.0.1', slotDir, sessions = new ShieldSessions() } = {}) {
  const server = http.createServer(async (req, res) => {
    const cors = corsHeaders(req);
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...cors }); res.end(JSON.stringify(obj)); };
    const fail = (code, extra) => send(ERR[code][0], { error: ERR[code][1], code, ...extra });
    const url = new URL(req.url, 'http://x');

    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        const shields = listShields(slotDir);
        return send(200, { ok: true, version: VERSION, shields: shields.length, unlocked: shields.filter((s) => sessions.peek(s.certSn) !== null).length });
      }
      if (req.method === 'GET' && url.pathname === '/certs') {
        const certs = listShields(slotDir).map((s) => ({ certSn: s.certSn, certDn: s.certDn, publicKey: s.publicKey, alg: s.alg, shieldId: s.shieldId }));
        return send(200, { certs });
      }
      if (req.method === 'POST' && url.pathname === '/session/unlock') {
        const body = await readBody(req);
        if (typeof body.pin !== 'string' || !body.pin) return fail('BAD_REQUEST');
        const unlocked = []; const failed = [];
        for (const s of listShields(slotDir)) {
          if (s.pinPolicy.locked) { failed.push({ shieldId: s.shieldId, retryLeft: 0, locked: true }); continue; }
          const r = await unlockShieldFile(s, body.pin, slotDir);
          if (r.ok) { sessions.set(s.certSn, r.privKeyHex); unlocked.push(s.shieldId); }
          else failed.push({ shieldId: s.shieldId, retryLeft: r.retryLeft, ...(r.locked ? { locked: true } : {}) });
        }
        return send(200, { ok: true, unlocked, failed });
      }
      if (req.method === 'POST' && url.pathname === '/session/lock') {
        sessions.dropAll();
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && (url.pathname === '/sign' || url.pathname === '/sm2/decrypt')) {
        const body = await readBody(req);
        if (typeof body.certSn !== 'string' || !body.certSn) return fail('BAD_REQUEST');
        const shield = findShieldByCertSn(slotDir, body.certSn);
        if (!shield) return fail('SHIELD_NOT_FOUND');
        if (shield.pinPolicy.locked) return fail('SHIELD_LOCKED');
        const privKeyHex = sessions.get(shield.certSn);
        if (!privKeyHex) return fail('PIN_REQUIRED');
        if (url.pathname === '/sign') {
          if (typeof body.data !== 'string' || !body.data) return fail('BAD_REQUEST');
          return send(200, { sig: sm2.doSignature(body.data, privKeyHex, { hash: true }) }); // 与 SignatureService 同参 {hash:true}
        }
        if (typeof body.cipher !== 'string' || !body.cipher) return fail('BAD_REQUEST');
        const plain = bytesToHex(sm2.doDecrypt(body.cipher, privKeyHex, 1, { output: 'array' })); // C1C3C2;失败返 '' 从不抛错
        if (!plain) return fail('DECRYPT_FAILED');
        return send(200, { plain });
      }
      return send(404, { error: 'not found', code: 'NOT_FOUND' });
    } catch (e) {
      if (e?.code && ERR[e.code]) return fail(e.code);
      return send(500, { error: String(e?.message ?? e), code: 'INTERNAL' });
    }
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, port: server.address().port, close: () => { sessions.dropAll(); server.close(); } }));
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd water-erp/services/ukey-middleware && npm test`
Expected: PASS(15 tests:5 shield + 3 session + 7 server)。

- [ ] **Step 5: 提交**

```bash
git add services/ukey-middleware/src/server.mjs services/ukey-middleware/src/server.test.mjs
git commit -m "feat(ukey-mw): HTTP 协议六端点——CORS 白名单回显、守卫次序 404→423→403、每请求实时扫槽(插拔即时生效)

Co-Authored-By: Claude Fable 5 <noreponame@anthropic.com>"
```

---

### Task 4: CLI(serve/issue/list/unblock)+ start.sh + 根脚本 + README + CLAUDE.md

**Files:**
- Create: `water-erp/services/ukey-middleware/src/cli.mjs`
- Create: `water-erp/services/ukey-middleware/start.sh`
- Create: `water-erp/services/ukey-middleware/README.md`
- Modify: `water-erp/package.json`(dev scripts 区,`dev:ocr` 行附近)
- Modify: `CLAUDE.md`(Development Commands 区,走 Bash 编辑)

**Interfaces:**
- Consumes: Task 1 `issueShield/listShields/unblockShield/defaultSlotDir`;Task 3 `startServer`。
- Produces: 可执行入口 `node src/cli.mjs <serve|issue|list|unblock>`;根脚本 `pnpm dev:ukey-mw`。

- [ ] **Step 1: 写 cli.mjs**

`water-erp/services/ukey-middleware/src/cli.mjs`:

```js
#!/usr/bin/env node
/* =================================================================
   ukeymw —— Mock U盾中间件 CLI(spec §8)

   serve   启动中间件(默认 127.0.0.1:17999)
   issue   模拟 CA 柜台办证:生成盾文件并打印 PUK(仅此一次!)
   list    在场盾清单(证书信息 + 锁定状态 + 剩余 PIN 次数)
   unblock PUK 解锁(锁死后),可顺带 --new-pin 重设口令
   ================================================================= */
import readline from 'node:readline/promises';
import { startServer } from './server.mjs';
import { issueShield, listShields, unblockShield, defaultSlotDir } from './shield.mjs';

function parseFlags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out[a.slice(2)] = next; i++; }
      else out[a.slice(2)] = true;
    } else out._.push(a);
  }
  return out;
}

const HELP = `ukeymw — Mock U盾中间件(协议见 docs/superpowers/specs/2026-08-26-mock-ukey-middleware-design.md §5)
  serve   [--port 17999] [--slot-dir ~/.shuidi-ukey/slots]
  issue   --cn <企业名> [--pin 123456] [--slot-dir …]
  list    [--slot-dir …]
  unblock --shield <SHD-XXXXXXXX> [--puk <PUK>] [--new-pin <PIN>] [--slot-dir …]
环境变量:UKEY_SLOT_DIR / UKEY_MW_PORT / UKEY_MW_BIND / UKEY_MW_SESSION_TTL / UKEY_MW_ALLOW_ORIGIN`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseFlags(rest);
  const slotDir = args['slot-dir'] ?? defaultSlotDir();

  if (cmd === 'serve') {
    const srv = await startServer({ port: Number(args.port ?? 0) || undefined, slotDir });
    console.log(`[ukeymw] 盾槽 ${slotDir}`);
    console.log(`[ukeymw] 中间件已启动 → http://127.0.0.1:${srv.port}  (Ctrl-C 退出;插拔盾 = 移动槽目录内 .ukey 文件)`);
    process.on('SIGINT', () => { console.log('\n[ukeymw] 已停止(会话全清,重启后须重新开锁)'); srv.close(); process.exit(0); });
    return;
  }
  if (cmd === 'issue') {
    const { shield, puk } = await issueShield({ cn: args.cn, pin: args.pin ?? '123456', slotDir });
    console.log(`已发行盾文件:${slotDir}/${shield.shieldId}.ukey`);
    console.log(`  证书序列号 ${shield.certSn}`);
    console.log(`  证书主体   ${shield.certDn}`);
    console.log(`  默认 PIN   ${args.pin ?? '123456'}`);
    console.log(`  管理码 PUK ${puk}   ← 仅此一次显示,请抄录妥善保管(锁死后解锁用)`);
    return;
  }
  if (cmd === 'list') {
    const shields = listShields(slotDir);
    if (shields.length === 0) { console.log(`槽目录 ${slotDir} 内无盾(=未插盾)。办证:ukeymw issue --cn <企业名>`); return; }
    for (const s of shields) {
      console.log(`${s.shieldId}  ${s.pinPolicy.locked ? '🔒已锁死' : `PIN 剩余 ${s.pinPolicy.retryLeft}/${s.pinPolicy.maxRetry}`}  ${s.certDn}`);
    }
    return;
  }
  if (cmd === 'unblock') {
    if (!args.shield) { console.error('缺少 --shield <SHD-XXXXXXXX>'); process.exit(1); }
    let puk = args.puk;
    if (!puk) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      puk = (await rl.question('管理码 PUK: ')).trim();
      rl.close();
    }
    const r = await unblockShield({ slotDir, shieldId: args.shield, puk, newPin: args['new-pin'] });
    console.log(r.ok ? `已解锁 ${args.shield}${args['new-pin'] ? ' 并重设 PIN' : ''}(计数已重置)` : 'PUK 不符,解锁失败');
    process.exit(r.ok ? 0 : 1);
  }
  console.log(HELP);
}

main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
```

`water-erp/services/ukey-middleware/start.sh`:

```bash
#!/usr/bin/env bash
# 首跑自装依赖(镜像 services/ocr 模式),再启动中间件(协议见 spec §5)
set -euo pipefail
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --no-fund --no-audit
exec node src/cli.mjs serve "$@"
```

Run: `chmod +x water-erp/services/ukey-middleware/start.sh`

- [ ] **Step 2: 冒烟验证 CLI**

```bash
cd water-erp/services/ukey-middleware
node src/cli.mjs issue --cn "四川水发建设有限公司" --pin 123456 --slot-dir /tmp/ukey-smoke   # 输出含「已发行盾文件」+ PUK
node src/cli.mjs list --slot-dir /tmp/ukey-smoke                                              # 输出 SHD-… PIN 剩余 6/6
node src/cli.mjs serve --port 17998 --slot-dir /tmp/ukey-smoke & MWPID=$!                       # 起在 17998 避免撞后续任务
curl -s http://127.0.0.1:17998/health                                                          # {"ok":true,...,"shields":1,"unlocked":0}
curl -s -X POST http://127.0.0.1:17998/session/unlock -H 'content-type: application/json' -d '{"pin":"123456"}'  # unlocked:["SHD-…"]
kill $MWPID; rm -rf /tmp/ukey-smoke
```

- [ ] **Step 3: 根脚本 + README + CLAUDE.md**

`water-erp/package.json` scripts 区,`"dev:ocr": …` 行后加:

```json
    "dev:ukey-mw": "cd services/ukey-middleware && bash start.sh",
```

`water-erp/services/ukey-middleware/README.md`:

```markdown
# Mock U盾中间件(:17999)

模拟 CA 厂商本机驱动服务 + USB 盾(全仿真:盾文件插拔 / PIN 会话 / 锁死 PUK / 柜台发行)。
设计 spec:`docs/superpowers/specs/2026-08-26-mock-ukey-middleware-design.md`。
**诚实边界**:自签密钥对,不构成《电子签名法》可靠电子签名;演示材料涉「U盾签名」须标注 mock 出处。

## 快速开始

```bash
node src/cli.mjs issue --cn "四川水发建设有限公司" --pin 123456   # 办证,打印 PUK(仅一次,抄录!)
pnpm dev:ukey-mw                                                # 根目录启动中间件(water-erp/ 下)
```

供应商门户(:3004)→ U盾管理:自动探测到中间件 → 徽标「U盾(厂商中间件)」→ PIN 开锁 → 绑定 → 投标/开标全流程。

## 联调剧本(异常态)

| 场景 | 操作 | 预期 |
|------|------|------|
| 中间件未启动 | 不起服务开门户 | 回落「浏览器模拟介质」+ 提示条 |
| 未插盾 | `mv ~/.shuidi-ukey/slots/*.ukey /tmp/` | /certs 空,门户「未检测到 U盾」 |
| 错 PIN ×6 | 连续输错 | SHIELD_LOCKED;`node src/cli.mjs unblock --shield SHD-… --puk <PUK>` 解锁 |
| 闲置 5min | 解锁后等待 | 自动上锁,再操作 → 重新开锁 |
| 拔盾后操作 | 解锁状态下移走文件 | SHIELD_NOT_FOUND |
| 重启中间件 | Ctrl-C 再起 | 全部上锁,须重新开锁 |

## 端点与配置

端点/错误码见 spec §5;env:`UKEY_SLOT_DIR`(默认 `~/.shuidi-ukey/slots`)、`UKEY_MW_PORT` 17999、`UKEY_MW_BIND` 127.0.0.1、`UKEY_MW_SESSION_TTL` 300、`UKEY_MW_ALLOW_ORIGIN`。
```

CLAUDE.md(Development Commands 区,`pnpm dev:ocr` 行后)——**用 Bash 追加,勿用 Edit/Write**(ARS 守卫):

```bash
cd /home/asus/桌面/ERP && sed -i '/# OCR 微服务（Python，:8100）/,+1 s|# OCR 微服务（Python，:8100）|# Mock U盾中间件（Node，:17999，全仿真 CA 盾：插拔/PIN/锁死）\npnpm dev:ukey-mw            # :17999\n\n# OCR 微服务（Python，:8100）|' CLAUDE.md
```

(若 sed 定位失败,手动在 `# OCR 微服务` 注释块前插入等价两行;改完 `git diff CLAUDE.md` 目检。)

- [ ] **Step 4: 验证根脚本可起**

Run: `cd water-erp && timeout 3 pnpm dev:ukey-mw` (或起后台后 curl /health 再杀)
Expected: 日志 `[ukeymw] 中间件已启动 → http://127.0.0.1:17999`。

- [ ] **Step 5: 提交**

```bash
git add services/ukey-middleware package.json ../CLAUDE.md
git commit -m "feat(ukey-mw): CLI 四命令 + start.sh 自装依赖 + 根脚本 dev:ukey-mw + 联调 README

Co-Authored-By: Claude Fable 5 <noreponame@anthropic.com>"
```

(注意 `../CLAUDE.md` 是仓库根的;若 git add 报路径错,用 `git -C /home/asus/桌面/ERP add CLAUDE.md water-erp/services/ukey-middleware water-erp/package.json` 一次性加。)

---

### Task 5: selfcheck.mjs(全链自验)

**Files:**
- Create: `water-erp/services/ukey-middleware/src/selfcheck.mjs`

**Interfaces:**
- Consumes: Task 1-4 全部。
- Produces: `node src/selfcheck.mjs` 退出码 0 = 全链健康(spec §9 第一行验收)。

- [ ] **Step 1: 写 selfcheck.mjs**

`water-erp/services/ukey-middleware/src/selfcheck.mjs`:

```js
/* =================================================================
   全链自验(spec §9):随机端口起服务 → 双盾 → 计数 → 锁死 → PUK
   → 签名反验 → SM2 回环 → 拔盾/放回。node:assert 全绿即退出 0。
   运行:cd services/ukey-middleware && node src/selfcheck.mjs
   ================================================================= */
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createRequire } from 'node:module';
import { startServer } from './server.mjs';
import { issueShield, unblockShield } from './shield.mjs';

const require = createRequire(import.meta.url);
const { sm2 } = require('sm-crypto');
const hexToBytes = (h) => Array.from({ length: h.length / 2 }, (_, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16));

const slotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ukey-selfcheck-'));
const srv = await startServer({ port: 0, slotDir });
const base = `http://127.0.0.1:${srv.port}`;
const get = (p) => fetch(base + p).then((r) => r.json());
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

try {
  // ① 双盾发行(不同 PIN,验证多盾独立)
  const a = await issueShield({ cn: '甲公司', pin: '123456', slotDir });
  const b = await issueShield({ cn: '乙公司', pin: '654321', slotDir });
  console.log('① 发行双盾', a.shield.shieldId, b.shield.shieldId);
  assert.equal((await get('/health')).shields, 2);

  // ② 全错 PIN:两盾各扣 1
  const wrong = await post('/session/unlock', { pin: '000000' });
  assert.equal(wrong.unlocked.length, 0);
  assert.deepEqual(wrong.failed.map((f) => f.retryLeft), [5, 5]);

  // ③ 甲 PIN 只解锁甲(乙再扣 1 → 4)
  const part = await post('/session/unlock', { pin: '123456' });
  assert.deepEqual(part.unlocked, [a.shield.shieldId]);
  assert.equal(part.failed.find((f) => f.shieldId === b.shield.shieldId).retryLeft, 4);

  // ④ 乙未解锁签名 → 403;甲签名可公钥验签;SM2 加解密回环
  const guard = await post('/sign', { certSn: b.shield.certSn, data: 'x' });
  assert.equal(guard.status, 403);
  const msg = 'canonical-envelope-hash-demo';
  const s = await post('/sign', { certSn: a.shield.certSn, data: msg });
  assert.equal(sm2.doVerifySignature(msg, s.sig, a.shield.publicKey, { hash: true }), true);
  const dekHex = 'cd'.repeat(24);
  const cipher = sm2.doEncrypt(hexToBytes(dekHex), a.shield.publicKey, 1);
  assert.equal((await post('/sm2/decrypt', { certSn: a.shield.certSn, cipher })).plain, dekHex);
  console.log('②③④ 计数/守卫/签名验签/SM2 回环 全通过');

  // ⑤ 乙连错 4 次锁死(4→0)→ 423;错 PUK 拒;正 PUK 解锁后乙 PIN 可用
  for (let i = 0; i < 4; i++) await post('/session/unlock', { pin: '000000' });
  assert.equal((await post('/sign', { certSn: b.shield.certSn, data: 'x' })).status, 423);
  assert.equal((await unblockShield({ slotDir, shieldId: b.shield.shieldId, puk: 'WRONGPUK000' })).ok, false);
  assert.equal((await unblockShield({ slotDir, shieldId: b.shield.shieldId, puk: b.puk })).ok, true);
  const bUnlock = await post('/session/unlock', { pin: '654321' });
  assert.deepEqual(bUnlock.unlocked, [b.shield.shieldId]);
  console.log('⑤ 锁死 → PUK 解锁 全通过');

  // ⑥ 拔盾(移文件)→ 404;放回恢复
  const file = path.join(slotDir, `${b.shield.shieldId}.ukey`);
  fs.renameSync(file, file + '.bak');
  assert.equal((await post('/sign', { certSn: b.shield.certSn, data: 'x' })).status, 404);
  assert.equal((await get('/health')).shields, 1);
  fs.renameSync(file + '.bak', file);
  assert.equal((await post('/sign', { certSn: b.shield.certSn, data: 'x' })).status, 200);
  console.log('⑥ 拔盾/放回 全通过');

  // ⑦ 全员上锁端点
  await post('/session/lock', {});
  assert.equal((await get('/health')).unlocked, 0);
  console.log('⑦ 手动上锁 全通过');
  console.log('\n✓ selfcheck 全链通过(15 项断言)');
} finally {
  srv.close();
  fs.rmSync(slotDir, { recursive: true, force: true });
}
```

- [ ] **Step 2: 运行**

Run: `cd water-erp/services/ukey-middleware && node src/selfcheck.mjs`
Expected: 末行 `✓ selfcheck 全链通过`,退出码 0。

- [ ] **Step 3: 提交**

```bash
git add services/ukey-middleware/src/selfcheck.mjs
git commit -m "feat(ukey-mw): 全链自验 selfcheck——双盾独立计数/锁死 PUK/签名反验/SM2 回环/拔盾恢复

Co-Authored-By: Claude Fable 5 <noreponame@anthropic.com>"
```

---

### Task 6: VendorUKeyAdapter HTTP 实装(packages/ukey)

**Files:**
- Modify: `water-erp/packages/ukey/src/vendor-ukey.ts`(整文件替换 stub)
- Test: `water-erp/apps/api/src/common/crypto/vendor-ukey.spec.ts`

**Interfaces:**
- Consumes: Task 3 的 HTTP 协议(端点/错误码/响应形状)。
- Produces(Task 7 依赖):
  - `static probe(timeoutMs = 300, baseUrl = 'http://127.0.0.1:17999'): Promise<{ shields: number; unlocked: number } | null>`
  - `static open(opts: { password: string; baseUrl?: string }): Promise<VendorUKeyAdapter>`
  - `listCertificates(): Promise<CertInfo[]>`(剥掉 `shieldId` 字段,保持 `CertInfo` 形状)
  - `sign(certSn: string, msg: string): Promise<string>`
  - `decrypt(certSn: string, cipherHex: string): Promise<string>`
  - `name = 'vendor-ukey'` 不变;错误抛中文 `Error`(message 含 retryLeft 等上下文)

- [ ] **Step 1: 写失败测试**

`water-erp/apps/api/src/common/crypto/vendor-ukey.spec.ts`:

```typescript
/* VendorUKeyAdapter HTTP 协议适配测试:node:http 随机端口桩服务,baseUrl 注入(不碰 17999) */
import * as http from 'http';
import { AddressInfo } from 'net';
import { VendorUKeyAdapter } from '@water-erp/ukey';

/* 桩:mode 由各用例切换;模拟中间件的响应形状与错误码 */
let mode: 'ok' | 'wrongPin' | 'lockedPin' | 'opError' | 'unreachable' = 'ok';

const stub = http.createServer((req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.url === '/health' && req.method === 'GET') {
    if (mode === 'unreachable') return send(500, { ok: false });
    return send(200, { ok: true, version: '1.0.0', shields: 2, unlocked: 1 });
  }
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    if (req.url === '/certs') {
      return send(200, { certs: [{ certSn: 'SHD-AAAABBBB', certDn: 'CN=甲公司', publicKey: '04' + 'a'.repeat(128), alg: 'SM2', shieldId: 'SHD-AAAABBBB' }] });
    }
    if (req.url === '/session/unlock') {
      if (mode === 'wrongPin') return send(200, { ok: true, unlocked: [], failed: [{ shieldId: 'SHD-X', retryLeft: 2 }] });
      if (mode === 'lockedPin') return send(200, { ok: true, unlocked: [], failed: [{ shieldId: 'SHD-X', retryLeft: 0, locked: true }] });
      return send(200, { ok: true, unlocked: ['SHD-AAAABBBB'], failed: [] });
    }
    if (req.url === '/sign') {
      if (mode === 'opError') return send(403, { error: 'x', code: 'PIN_REQUIRED' });
      return send(200, { sig: 'sig-hex-fixture' });
    }
    if (req.url === '/sm2/decrypt') {
      if (mode === 'opError') return send(422, { error: 'x', code: 'DECRYPT_FAILED' });
      return send(200, { plain: 'ab'.repeat(24) });
    }
    send(404, {});
  });
});

let base = '';
beforeAll(async () => {
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => stub.close(() => r()));
});
beforeEach(() => { mode = 'ok'; });

describe('VendorUKeyAdapter', () => {
  it('probe:中间件在线 → 计数;离线/非 200 → null', async () => {
    expect(await VendorUKeyAdapter.probe(500, base)).toEqual({ shields: 2, unlocked: 1 });
    mode = 'unreachable';
    expect(await VendorUKeyAdapter.probe(500, base)).toBeNull();
    expect(await VendorUKeyAdapter.probe(200, 'http://127.0.0.1:9')).toBeNull(); // 无人监听端口
  });

  it('open:成功返回实例;错 PIN 抛含剩余次数;锁死抛锁定文案', async () => {
    const uk = await VendorUKeyAdapter.open({ password: '123456', baseUrl: base });
    expect(uk.name).toBe('vendor-ukey');
    mode = 'wrongPin';
    await expect(VendorUKeyAdapter.open({ password: '0', baseUrl: base })).rejects.toThrow('剩余尝试次数 2');
    mode = 'lockedPin';
    await expect(VendorUKeyAdapter.open({ password: '0', baseUrl: base })).rejects.toThrow('已锁定');
  });

  it('listCertificates:透传并剥 shieldId', async () => {
    const certs = await (await VendorUKeyAdapter.open({ password: '1', baseUrl: base })).listCertificates();
    expect(certs).toEqual([{ certSn: 'SHD-AAAABBBB', certDn: 'CN=甲公司', publicKey: '04' + 'a'.repeat(128), alg: 'SM2' }]);
  });

  it('sign/decrypt:结果透传;错误码转中文 Error', async () => {
    const uk = await VendorUKeyAdapter.open({ password: '1', baseUrl: base });
    expect(await uk.sign('SHD-AAAABBBB', 'msg')).toBe('sig-hex-fixture');
    expect(await uk.decrypt('SHD-AAAABBBB', 'cipher')).toBe('ab'.repeat(24));
    mode = 'opError';
    await expect(uk.sign('SHD-AAAABBBB', 'msg')).rejects.toThrow('未解锁');
    await expect(uk.decrypt('SHD-AAAABBBB', 'c')).rejects.toThrow('密文损坏');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd water-erp && pnpm --filter api test -- vendor-ukey`
Expected: FAIL —— stub 上 `probe` 不存在(TS 编译错/undefined is not a function)。

- [ ] **Step 3: 实装 vendor-ukey.ts(整文件替换)**

`water-erp/packages/ukey/src/vendor-ukey.ts`:

```typescript
import type { CertInfo, UKeyAdapter } from './types';

/* =================================================================
   VendorUKeyAdapter — CA 厂商本地中间件适配层
   (mock 中间件协议 v1,docs/superpowers/specs/2026-08-26-mock-ukey-middleware-design.md §5/§6)

   - 纯 fetch + Web 标准 API(浏览器与 Node 同源);无 Node 专有 API
   - probe() 是门户「探测优先切换」的依据:中间件不在 → null
   - open() 镜像 MockUKeyAdapter.open 的工厂形状,三视图切换只改一行
   - 接真 CA 时只改本文件:协议端点换厂商 SDK + DER/PEM↔hex 转换在此消化
   ================================================================= */

const OP_TIMEOUT_MS = 10_000;

const CODE_MSG: Record<string, string> = {
  PIN_REQUIRED: 'U盾未解锁或会话已超时,请重新开锁',
  SHIELD_LOCKED: 'U盾已锁定(PIN 错误次数超限),请使用管理码(PUK)解锁',
  SHIELD_NOT_FOUND: '未找到 U盾(可能已拔出)',
  DECRYPT_FAILED: 'U盾解密失败:密文损坏',
  BAD_REQUEST: 'U盾中间件请求参数错误',
};

interface HealthInfo { shields: number; unlocked: number; }

async function requestJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ status: number; body: any }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function raise(status: number, body: any): never {
  const code = typeof body?.code === 'string' ? body.code : '';
  throw new Error(CODE_MSG[code] ?? body?.error ?? `U盾中间件请求失败(HTTP ${status})`);
}

const jsonInit = (payload: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});

export class VendorUKeyAdapter implements UKeyAdapter {
  readonly name = 'vendor-ukey';
  static readonly VENDOR_BASE_URL = 'http://127.0.0.1:17999';

  private constructor(private readonly baseUrl: string) {}

  /** 探测中间件(默认 300ms 超时):不在/异常 → null;在 → 在场盾与已解锁计数 */
  static async probe(
    timeoutMs = 300,
    baseUrl: string = VendorUKeyAdapter.VENDOR_BASE_URL,
  ): Promise<HealthInfo | null> {
    try {
      const { status, body } = await requestJson(`${baseUrl}/health`, { method: 'GET' }, timeoutMs);
      if (status !== 200 || body?.ok !== true) return null;
      return { shields: Number(body.shields) || 0, unlocked: Number(body.unlocked) || 0 };
    } catch {
      return null;
    }
  }

  /** 开锁:probe → unlock(PIN)。错 PIN/锁死抛中文 Error(message 含 retryLeft)。 */
  static async open(opts: { password: string; baseUrl?: string }): Promise<VendorUKeyAdapter> {
    const baseUrl = opts.baseUrl ?? VendorUKeyAdapter.VENDOR_BASE_URL;
    if (!(await VendorUKeyAdapter.probe(300, baseUrl))) {
      throw new Error('未检测到 U盾中间件——请插入 U盾并启动驱动服务(pnpm dev:ukey-mw)');
    }
    const { status, body } = await requestJson(
      `${baseUrl}/session/unlock`,
      jsonInit({ pin: opts.password }),
      OP_TIMEOUT_MS,
    );
    if (status !== 200) raise(status, body);
    const unlocked: unknown[] = Array.isArray(body?.unlocked) ? body.unlocked : [];
    const failed: Array<{ shieldId: string; retryLeft?: number; locked?: boolean }> = Array.isArray(body?.failed) ? body.failed : [];
    if (unlocked.length === 0 && failed.length > 0) {
      const f = failed[0];
      throw new Error(
        f.locked
          ? 'U盾已锁定(PIN 错误次数超限),请使用管理码(PUK)解锁'
          : `U盾口令不符(剩余尝试次数 ${f.retryLeft ?? '?'})`,
      );
    }
    return new VendorUKeyAdapter(baseUrl);
  }

  async listCertificates(): Promise<CertInfo[]> {
    const { status, body } = await requestJson(`${this.baseUrl}/certs`, { method: 'GET' }, OP_TIMEOUT_MS);
    if (status !== 200) raise(status, body);
    return (Array.isArray(body?.certs) ? body.certs : []).map(
      (c: any): CertInfo => ({ certSn: c.certSn, certDn: c.certDn, publicKey: c.publicKey, alg: c.alg ?? 'SM2' }),
    );
  }

  async sign(certSn: string, msg: string): Promise<string> {
    const { status, body } = await requestJson(`${this.baseUrl}/sign`, jsonInit({ certSn, data: msg }), OP_TIMEOUT_MS);
    if (status !== 200) raise(status, body);
    if (typeof body?.sig !== 'string') throw new Error('U盾签名失败:中间件返回缺失');
    return body.sig;
  }

  async decrypt(certSn: string, cipherHex: string): Promise<string> {
    const { status, body } = await requestJson(`${this.baseUrl}/sm2/decrypt`, jsonInit({ certSn, cipher: cipherHex }), OP_TIMEOUT_MS);
    if (status !== 200) raise(status, body);
    if (typeof body?.plain !== 'string' || !body.plain) throw new Error('U盾解密失败:密文损坏或口令不符');
    return body.plain;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd water-erp && pnpm --filter api test -- vendor-ukey`
Expected: PASS(4 specs)。

- [ ] **Step 5: 重建共享包(门户消费 dist)**

Run: `cd water-erp && pnpm --filter @water-erp/ukey build`
Expected: 构建成功,`packages/ukey/dist/vendor-ukey.js` 含 `probe`。

- [ ] **Step 6: 提交**

```bash
git add packages/ukey/src/vendor-ukey.ts apps/api/src/common/crypto/vendor-ukey.spec.ts
git commit -m "feat(ukey): VendorUKeyAdapter 实装——probe/open/list/sign/decrypt 走 mock 中间件协议,错误码转译中文;baseUrl 可注入供测试

Co-Authored-By: Claude Fable 5 <noreponame@anthropic.com>"
```

---

### Task 7: 门户接入(ukey-factory + 三视图探测优先切换)

> **⚠️ 2026-08-26 重定契约**:本节原文以 Vue 版 `apps/supplier-portal` 三视图为目标,该目录已被 `303b5bca`(Vue→Next 迁移)删除。有效契约以控制器重写的 brief 为准:`.superpowers/sdd/2026-08-26-mock-ukey-middleware/task-7-brief.md`(目标 = `apps/supplier-portal-next` 等价三文件,设计意图不变)。以下原文仅留档。

#### 留档原文(Vue 版,已失效)

**Files:**
- Create: `water-erp/apps/supplier-portal/src/utils/ukey-factory.ts`
- Modify: `water-erp/apps/supplier-portal/src/views/profile/UkeyManage.vue`
- Modify: `water-erp/apps/supplier-portal/src/views/bid/BidSubmit.vue:17,67,75-80,404-424`
- Modify: `water-erp/apps/supplier-portal/src/views/bid/OpeningHall.vue:9,47,59-66,234-252`

**Interfaces:**
- Consumes: Task 6 `VendorUKeyAdapter.probe/open`;既有 `MockUKeyAdapter.open({storage, password})`。
- Produces: `detectUkey(): Promise<'vendor' | 'mock'>`;`openUkey(password: string): Promise<{ kind: 'vendor' | 'mock'; adapter: MockUKeyAdapter | VendorUKeyAdapter }>`。

- [ ] **Step 1: 写 ukey-factory.ts**

`water-erp/apps/supplier-portal/src/utils/ukey-factory.ts`:

```typescript
/* =================================================================
   UKey 介质工厂 —— 探测优先自动切换(spec §7)

   VendorUKeyAdapter.probe() 在线(中间件已启动)→ 盾模式;
   离线 → 回落 MockUKeyAdapter(localStorage 软件介质,演示/CI 保底轨道)。
   三视图统一经本入口开锁;mock 轨道行为零改动。
   ================================================================= */
import { MockUKeyAdapter, VendorUKeyAdapter, type StorageLike } from '@water-erp/ukey'

export type UkeyKind = 'vendor' | 'mock'
export interface OpenedUkey { kind: UkeyKind; adapter: MockUKeyAdapter | VendorUKeyAdapter }

/** 与 UkeyManage/BidSubmit/OpeningHall 原有同键(mock 介质 keystore 落 localStorage) */
const ukeyStorage: StorageLike = {
  getItem: (k) => localStorage.getItem(k),
  setItem: (k, v) => localStorage.setItem(k, v),
  removeItem: (k) => localStorage.removeItem(k),
}

export async function detectUkey(): Promise<UkeyKind> {
  return (await VendorUKeyAdapter.probe()) ? 'vendor' : 'mock'
}

export async function openUkey(password: string): Promise<OpenedUkey> {
  if (await VendorUKeyAdapter.probe()) {
    return { kind: 'vendor', adapter: await VendorUKeyAdapter.open({ password }) }
  }
  return { kind: 'mock', adapter: await MockUKeyAdapter.open({ storage: ukeyStorage, password }) }
}
```

- [ ] **Step 2: 改 UkeyManage.vue**

script 段(对照原行号):

(a) 第 9 行 import 替换:

```typescript
// 旧:import { MockUKeyAdapter, type StorageLike, type CertInfo } from '@water-erp/ukey'
import { MockUKeyAdapter, VendorUKeyAdapter, type CertInfo } from '@water-erp/ukey'
import { detectUkey, openUkey, type UkeyKind } from '@/utils/ukey-factory'
```

(b) `const ukey = ref<MockUKeyAdapter | null>(null)`(约 18 行)放宽类型并新增介质状态;**原 42-46 行 `ukeyStorage` 保留不删**(下方 `handleImportFile` 的 mock 介质导入仍需要):

```typescript
const ukey = ref<MockUKeyAdapter | VendorUKeyAdapter | null>(null)   // 原类型放宽
const ukeyKind = ref<UkeyKind>('mock')
const mwOffline = ref(false)   // vendor 探测不到 → 顶部提示条
```

onMounted 内(`await Promise.all(...)` 后)追加:

```typescript
ukeyKind.value = await detectUkey()
mwOffline.value = ukeyKind.value === 'mock'
```

(c) `handleOpen`(83-94 行)替换为:

```typescript
async function handleOpen() {
  if (!password.value) { ElMessage.warning('请输入 U盾口令'); return }
  opening.value = true
  try {
    const { kind, adapter } = await openUkey(password.value)
    ukeyKind.value = kind
    ukey.value = adapter
    ukeyCerts.value = await adapter.listCertificates()
    if (ukeyCerts.value.length > 0) ElMessage.success('U盾已开锁')
    else if (kind === 'mock') ElMessage.success('已创建空介质（尚未生成证书）')
    else ElMessage.warning('U盾内未检测到证书（演示发行：ukeymw issue --cn <企业名>）')
  } catch (e: any) {
    ElMessage.error(e?.message || '开锁失败：口令不符或介质损坏')
  } finally { opening.value = false }
}
```

(d) mock 专属操作加守卫——`handleCreateCert`(103 行)与 `handleExport`(172 行)开头各插一行:

```typescript
if (!(ukey.value instanceof MockUKeyAdapter)) { ElMessage.warning('U盾介质为厂商中间件管理，请在 CA 服务机构办理证书（演示：ukeymw issue）'); return }
```

template 段:

(e) 卡片头状态徽标(240 行)`<span class="ukey-state" ...>` 改为带介质类型:

```html
<span class="ukey-state" :class="ukey ? 'open' : ''">{{ ukey ? `${ukeyKind === 'vendor' ? 'U盾·厂商中间件' : '模拟介质'} · 已开锁 · ${ukeyCerts.length} 张证书` : '未开锁' }}</span>
```

(f) 未开锁分支(243-254 行)的「已有导出文件？…导入介质文件」块包 `v-if="ukeyKind === 'mock'"`,placeholder 改动态:

```html
<el-input v-model="password" type="password" show-password :placeholder="ukeyKind === 'vendor' ? '输入 U盾 PIN' : '输入 U盾口令（首次使用将创建新介质）'" size="large" @keyup.enter="handleOpen" />
```

(g) 已开锁分支工具栏(257-261 行):「新建证书」「导出介质」两按钮与提示包 `v-if="ukeyKind === 'mock'"`,追加 vendor 提示行:

```html
<div class="cert-toolbar">
  <template v-if="ukeyKind === 'mock'">
    <el-button size="large" :loading="creating" @click="handleCreateCert"><el-icon><Plus /></el-icon>新建证书</el-button>
    <el-button size="large" @click="exportVisible = true"><el-icon><Download /></el-icon>导出介质</el-button>
    <span class="file-hint">证书主体 CN 自动取注册企业名称，绑定校验 CN↔企业名一致性</span>
  </template>
  <span v-else class="file-hint">证书由 CA 服务机构发制（演示：<code>ukeymw issue --cn 企业名</code>），此处仅枚举与绑定</span>
</div>
```

(h) 空证书文案(263 行)按介质分流:

```html
<div v-if="ukeyCerts.length === 0" class="ukey-empty">
  {{ ukeyKind === 'vendor' ? 'U盾内未检测到证书（演示：ukeymw issue 发行后重新开锁）' : '介质内暂无证书，点击「新建证书」生成' }}
</div>
```

(i) 页面顶部(v-loading 容器内、error 块后)加探测提示条:

```html
<el-alert v-if="mwOffline && !loading" type="info" :closable="false" show-icon class="mw-offline-tip"
  title="未检测到 U盾中间件——当前使用浏览器模拟介质"
  description="启动中间件并插入 U盾：pnpm dev:ukey-mw（发行：ukeymw issue --cn 企业名）" />
```

`<style scoped>` 追加 `.mw-offline-tip { margin-top: 12px; }`。

- [ ] **Step 3: 改 BidSubmit.vue**

(a) 第 17 行 import 替换:

```typescript
// 旧:import { MockUKeyAdapter, type StorageLike, type EnvelopeFileEntry, type EnvelopeRole } from '@water-erp/ukey'
import { type UKeyAdapter, type EnvelopeFileEntry, type EnvelopeRole } from '@water-erp/ukey'
import { openUkey } from '@/utils/ukey-factory'
```

(b) 67 行:`const ukeyAdapter = ref<MockUKeyAdapter | null>(null)` → `const ukeyAdapter = ref<UKeyAdapter | null>(null)`。

(c) 75-80 行 `ukeyStorage` 定义删除(mock 路径已收进工厂;本文件不再直用)。

(d) `handleUkeyOpen`(404-424 行)中 408 行替换:

```typescript
// 旧:const uk = await MockUKeyAdapter.open({ storage: ukeyStorage, password: ukeyPassword.value })
const uk = (await openUkey(ukeyPassword.value)).adapter
```

其余(cert 匹配/赋值/成功提示)不变。

- [ ] **Step 4: 改 OpeningHall.vue**

(a) 第 9 行 import 替换:

```typescript
// 旧:import { MockUKeyAdapter, type StorageLike, sha256Hex, canonicalJson, sm4Decrypt, unwrapDekJson } from '@water-erp/ukey'
import { type UKeyAdapter, sha256Hex, canonicalJson, sm4Decrypt, unwrapDekJson } from '@water-erp/ukey'
import { openUkey } from '@/utils/ukey-factory'
```

(b) 47 行:`const ukeyAdapter = ref<MockUKeyAdapter | null>(null)` → `const ukeyAdapter = ref<UKeyAdapter | null>(null)`。

(c) 59-66 行 `ukeyStorage` 定义删除。

(d) `handleUkeyOpen`(234-252 行)中 238 行替换:

```typescript
// 旧:const uk = await MockUKeyAdapter.open({ storage: ukeyStorage, password: ukeyPassword.value })
const uk = (await openUkey(ukeyPassword.value)).adapter
```

- [ ] **Step 5: 构建验证 + 清 Vite 缓存**

```bash
cd water-erp
pnpm --filter @water-erp/ukey build          # 若 Task 6 后未再动包可跳过
rm -rf apps/supplier-portal/node_modules/.vite
pnpm --filter supplier-portal build          # SFC 编译闸(本应用无 vue-tsc,类型靠 dev 冒烟)
pnpm --filter api test -- vendor-ukey        # adapter 回归仍绿
```

Expected: build 成功;测试 PASS。

- [ ] **Step 6: 手工验收(spec §8 剧本 ①→③ + 异常 a/b)**

```bash
# ① 办证(企业名必须与种子供应商一致,否则 bindCert DN 校验拒收——这本身也是一个验收点)
cd water-erp/services/ukey-middleware
node src/cli.mjs issue --cn "四川水发建设有限公司" --pin 123456     # 抄录 PUK
# ② 起中间件(另终端):cd water-erp && pnpm dev:ukey-mw
# ③ 起门户与 API(已有 dev 环境则复用):pnpm dev:api / pnpm dev:supplier
```

浏览器 `http://localhost:3004` 登录 `四川水发建设有限公司 / supplier@2026`:

1. U盾管理:徽标「U盾·厂商中间件」;PIN `123456` 开锁 → 枚举到 SHD 证书 → 绑定成功(CN↔企业名校验通过)
2. 异常 a:停掉中间件刷新页 → 提示条「未检测到 U盾中间件」,回落模拟介质
3. 异常 b:开锁状态下移走盾文件再操作 → 报「未找到 U盾(可能已拔出)」
4. (可选完整流)投标提交开锁链路 + 开标大厅解密链路走一遍

- [ ] **Step 7: 回归确认 mock 轨道未破**

Run: `cd water-erp/apps/supplier-portal && ../api/node_modules/.bin/tsx scripts/dual-selfcheck.ts`
Expected: 原有五段自验全绿(mock 轨道零改动)。

- [ ] **Step 8: 提交**

```bash
git add apps/supplier-portal/src/utils/ukey-factory.ts apps/supplier-portal/src/views/profile/UkeyManage.vue apps/supplier-portal/src/views/bid/BidSubmit.vue apps/supplier-portal/src/views/bid/OpeningHall.vue
git commit -m "feat(supplier-portal): UKey 介质探测优先切换——vendor 中间件在线走盾模式,离线回落 mock;UkeyManage 盾模式隐藏 mock 专属操作并提示柜台发行

Co-Authored-By: Claude Fable 5 <noreponame@anthropic.com>"
```

---

## 附:执行注意(非任务)

- Task 4 的 CLAUDE.md sed 若与当前文件内容不完全匹配(行内容有变),以手检 `git diff CLAUDE.md` 为准,勿盲跑。
- Task 6/7 之间必须先 `pnpm --filter @water-erp/ukey build` 再起门户 dev,否则门户消费旧 dist。
- 全部完成后总回归:`cd water-erp && pnpm --filter api test`(全量单测)+ `node services/ukey-middleware/src/selfcheck.mjs`。
