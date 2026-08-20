# 双层数字信封 + 供应商 CA 开标解密 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 spec v5——供应商 U盾内层加密 + 管理方国密外层加密的双层信封投递，开标时管理方先解外层、供应商在线解内层，平台开标前零解密能力、零明文留存。

**Architecture:** 新共享包 `@water-erp/ukey`（canonical 纯函数 + SM2/SM4 信封操作 + UKey 适配层，前后端同源消费）；服务端 `DualEnvelopeService`（验签/解外层）+ `AdminKeyService`（keystore/轮转/bootstrap）；投递端 submitBid 按 `envelopeVersion='dual-v2'` 双轨分派；开标端 decrypt-outer → opening-package → decrypt-upload（原子抢占+唱标预填），归因矩阵惰性挂入 `assertOpeningDone`。

**Tech Stack:** NestJS 11 + Prisma（API）；sm-crypto ^0.4.0（国密，前后端共用）；Vue 3 + Element Plus（供应商门户）；Next.js 16（bid-portal）；pnpm workspace。

**Spec:** `water-erp/docs/superpowers/specs/2026-08-20-dual-envelope-ca-opening-design.md`（v5，含 §2 数据流/§5.4a 下载分派/§5.5 归因矩阵——执行任务前先读对应章节）

## Global Constraints

- **迁移纪律**（memory `main-db-migration-drift`）：`npx prisma migrate dev --create-only --name <x>` → 人工审查 SQL（只保留本次新表/ADD COLUMN；diff 若重生成 OperationLog 分区 PK/超集索引/pgvector DDL 一律删除那些行）→ `npx prisma db execute --file prisma/migrations/<x>/migration.sql` → `npx prisma migrate resolve --applied <name>`。**禁用 `migrate deploy` 验证**。
- **workspace 包**：改 `packages/ukey` 后必须 `pnpm --filter @water-erp/ukey build`；供应商门户消费它须清 `apps/supplier-portal/node_modules/.vite` 并重启 dev server（memory `vite-dep-cache-workspace-packages`）。
- **回退开关**：env `BID_DUAL_ENVELOPE`（默认 `true`）。`false` → submitBid 走旧轨（clientDeks/服务端分支保留在 flag 分支内），仅应急回退用（需同时回退前端发布）。Phase 2 之后不得删除旧轨代码（存量项目开标依赖）。
- **错误形状**：`BadRequestException({ error, code })` / `ForbiddenException` / `ConflictException`；单测断言 `.rejects.toMatchObject({ response: { code } })`（jest 30 无 toThrowError——memory `nest-di-value-import-metadata`）。
- **TS import 约定**：CJS 函数导出包（如 sm-crypto）用 `const sm2 = require('sm-crypto').sm2`；tsconfig 无 esModuleInterop。
- **不主动 push**：commit 后只提醒未推送数量（memory `no-auto-push-reminder-only`）。**commit 前必查分支**（memory `check-branch-before-commit`）：`git branch --show-current` 必须在预期分支。
- **验证命令**：API 单测 `pnpm --filter api test -- <pattern>`；bid-portal `npx tsc --noEmit`（在 apps/bid-portal 下）；supplier-portal `npx vue-tsc --noEmit`（不可用则 `pnpm --filter supplier-portal build`）。
- **测试环境隔离**：spec 文件内自设 `process.env.KMS_SECRET`（参照 `supplier-portal.service.spec.ts:30-34` 的 beforeAll/afterAll 模式）；keystore 测试用 `fs.mkdtempSync(os.tmpdir())` 且测试后清理。
- SM2 参数全局唯一定义点在 `@water-erp/ukey`：`doSignature/doVerifySignature { hash: true }`（与既有 `SignatureService` 同参）；SM2 加密 `cipherMode: 1`（C1C3C2）；SM4 `{ mode: 'cbc', padding: 'pkcs#7' }`，key/iv 均 32 hex。
- FileAsset 新 category 值：`bid_inner_ciphertext`、`bid_decrypted`；新轨密文上传仍用 `bid_document`。

---

## Phase 1 基座

### Task 1: `@water-erp/ukey` 包骨架 + canonical 纯函数（golden vector 锁前后端一致）

**Files:**
- Create: `packages/ukey/package.json`、`packages/ukey/tsconfig.json`、`packages/ukey/src/index.ts`、`packages/ukey/src/types.ts`、`packages/ukey/src/canonical.ts`
- Test: `apps/api/src/common/crypto/ukey-canonical.spec.ts`（API jest 跑包测试——单一 test runner）
- Modify: `apps/api/package.json`（+`"@water-erp/ukey": "workspace:*"`）、`apps/supplier-portal/package.json`（+`@water-erp/ukey`、+`sm-crypto@^0.4.0`）、根 `pnpm-workspace.yaml` 若 packages/* 已含则不动

**Interfaces:**
- Produces（后续所有任务依赖，签名不可漂移）:
  - `canonicalJson(value: unknown): string`
  - `sha256Hex(input: string | Uint8Array): Promise<string>`
  - `canonicalEnvelopeHash(envelope: DualEnvelope): Promise<string>`
  - `computeFieldsCommit(fields: SealedFields, nonce: string): Promise<string>`
  - types: `EnvelopeRole = 'technical'|'business'|'coverLetter'|'bond'`；`SealedFields { price: string; deliveryPeriod: string; qualityCommitment: string }`；`DualEnvelope { version: 'dual-v2'; certSn: string; adminCertId: string; files: Partial<Record<EnvelopeRole, { sha256: string; kself: string; kadmin: string }>>; sealedFields: { cipher: string; kself: string; fieldsSha256: string }; fieldsCommit: string }`

- [ ] **Step 1: 建包**

`packages/ukey/package.json`（照 packages/shared 模式）:
```json
{
  "name": "@water-erp/ukey",
  "version": "1.0.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": { "build": "tsc -p tsconfig.json", "dev": "tsc -p tsconfig.json --watch" },
  "dependencies": { "sm-crypto": "^0.4.0" }
}
```
`packages/ukey/tsconfig.json` 与 packages/shared 完全一致（module commonjs、declaration、ES2021、outDir dist、rootDir src、strict）。

- [ ] **Step 2: 写 types.ts**

```ts
export type EnvelopeRole = 'technical' | 'business' | 'coverLetter' | 'bond';
export interface SealedFields { price: string; deliveryPeriod: string; qualityCommitment: string; }
export interface EnvelopeFileEntry { sha256: string; kself: string; kadmin: string; }
export interface DualEnvelope {
  version: 'dual-v2';
  certSn: string;
  adminCertId: string;
  files: Partial<Record<EnvelopeRole, EnvelopeFileEntry>>;
  /** F+nonce 的供应商层密封件（spec v5）：cipher=SM4(canonicalJson({fields,nonce}))，kself=SM2_Enc(供应商公钥, DEK_F) */
  sealedFields: { cipher: string; kself: string; fieldsSha256: string };
  fieldsCommit: string;
}
export interface CertInfo { certSn: string; certDn: string; publicKey: string; alg: 'SM2'; }
export interface UKeyAdapter {
  name: string;
  listCertificates(): Promise<CertInfo[]>;
  sign(certSn: string, msg: string): Promise<string>;
  /** SM2 解密（私钥在介质内），输入输出均 hex */
  decrypt(certSn: string, cipherHex: string): Promise<string>;
}
```

- [ ] **Step 3: 写失败测试**（`apps/api/src/common/crypto/ukey-canonical.spec.ts`）

```ts
import { canonicalJson, canonicalEnvelopeHash, computeFieldsCommit } from '@water-erp/ukey';

describe('ukey canonical（前后端一致性锚点）', () => {
  const fields = { price: '798000', deliveryPeriod: '120日历天', qualityCommitment: '合格' };

  it('canonicalJson：键字典序、无空白、嵌套递归', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 2], c: 'x' } }))
      .toBe('{"a":{"c":"x","d":[3,2]},"b":1}');
  });
  it('canonicalJson：undefined 值键被剔除（Partial files 场景）', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
  it('computeFieldsCommit：确定性 + nonce 变化则变化', async () => {
    const c1 = await computeFieldsCommit(fields, 'ff'.repeat(16));
    const c2 = await computeFieldsCommit(fields, 'ff'.repeat(16));
    const c3 = await computeFieldsCommit(fields, '00'.repeat(16));
    expect(c1).toBe(c2); expect(c1).not.toBe(c3); expect(c1).toMatch(/^[0-9a-f]{64}$/);
  });
  it('canonicalEnvelopeHash：file 条目次序不影响哈希（canonical 排序）', async () => {
    const mk = (order: string[]) => ({ version: 'dual-v2' as const, certSn: 'sn-1', adminCertId: 'ac-1',
      files: Object.fromEntries(order.map(r => [r, { sha256: 'a', kself: 'b', kadmin: 'c' }])),
      sealedFields: { cipher: 'c1', kself: 'k1', fieldsSha256: 'f1' }, fieldsCommit: 'fc' });
    const h1 = await canonicalEnvelopeHash(mk(['technical', 'bond'] as any));
    const h2 = await canonicalEnvelopeHash(mk(['bond', 'technical'] as any));
    expect(h1).toBe(h2);
  });
});
```

- [ ] **Step 4: 跑测试确认失败**

Run: `pnpm --filter @water-erp/ukey build 2>&1 | head -3`（应报缺文件）；`pnpm --filter api test -- ukey-canonical`（应 FAIL：找不到模块）。

- [ ] **Step 5: 实现 canonical.ts**

```ts
import { createHash } from 'crypto';
import type { DualEnvelope, SealedFields } from './types';

/** 规范化 JSON：键字典序递归排序、无空白；undefined 值剔除。前后端唯一实现。 */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v === undefined ? undefined : v;
    if (Array.isArray(v)) return v.map(norm);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const n = norm((v as Record<string, unknown>)[k]);
      if (n !== undefined) out[k] = n;
    }
    return out;
  };
  return JSON.stringify(norm(value));
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export const canonicalEnvelopeHash = (envelope: DualEnvelope): Promise<string> =>
  sha256Hex(canonicalJson(envelope));

export const computeFieldsCommit = (fields: SealedFields, nonce: string): Promise<string> =>
  sha256Hex(`${canonicalJson(fields)}:${nonce}`);
```
注：用 WebCrypto 全局（Node ≥18 与浏览器都有），**不用 node:crypto**——包要跑在浏览器里。

- [ ] **Step 6: index.ts 导出 + build + 测试通过**

`packages/ukey/src/index.ts`: `export * from './types'; export * from './canonical';`
Run: `pnpm --filter @water-erp/ukey build && pnpm --filter api test -- ukey-canonical` → PASS。

- [ ] **Step 7: Commit**（含两处 package.json 依赖与 `pnpm install` 后的 lockfile）

```bash
cd water-erp && git branch --show-current && git add packages/ukey apps/api/package.json apps/supplier-portal/package.json pnpm-lock.yaml && git commit -m "feat(ukey): @water-erp/ukey 包骨架与 canonical 纯函数（前后端同源）"
```

### Task 2: ukey 国密封装层（SM2/SM4 信封操作）

**Files:**
- Create: `packages/ukey/src/sm-crypto-layer.ts`
- Modify: `packages/ukey/src/index.ts`（+export）
- Test: `apps/api/src/common/crypto/ukey-sm.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 types。
- Produces:
  - `randomHex(bytes: number): string`
  - `sm2EncryptHex(publicKey: string, plaintextHex: string): string` / `sm2DecryptHex(privateKey: string, cipherHex: string): string`
  - `sm4Encrypt(keyHex: string, ivHex: string, dataHex: string): string` / `sm4Decrypt(keyHex: string, ivHex: string, cipherHex: string): string`
  - `wrapDekJson(dek: { keyHex: string; ivHex: string }): string`（→ `{"k":"...","iv":"..."}`）与 `unwrapDekJson(json: string): { keyHex: string; ivHex: string }`
  - `signEnvelopeMsg(msg: string, privateKey: string): string`、`verifyEnvelopeMsg(msg: string, sig: string, publicKey: string): boolean`（内部 `sm2.doSignature/doVerifySignature(msg, key, { hash: true })`——与既有 SignatureService 同参）

- [ ] **Step 1: 写失败测试**（roundtrip 四件套：SM2 包/解包、SM4 加/解、签名验证）

```ts
import { sm2EncryptHex, sm2DecryptHex, sm4Encrypt, sm4Decrypt, randomHex, signEnvelopeMsg, verifyEnvelopeMsg } from '@water-erp/ukey';
const sm2 = require('sm-crypto').sm2;

describe('ukey sm-crypto layer', () => {
  it('SM2 hex 包裹/解包 roundtrip（cipherMode 1）', () => {
    const kp = sm2.generateKeyPairHex();
    const dek = randomHex(16 + 16); // key+iv 十六进制拼接
    const cipher = sm2EncryptHex(kp.publicKey, dek);
    expect(sm2DecryptHex(kp.privateKey, cipher)).toBe(dek);
  });
  it('SM4 cbc roundtrip（utf8 经 hex 透传）', () => {
    const key = randomHex(16), iv = randomHex(16);
    const dataHex = Buffer.from('智慧水发·蜀水云采', 'utf8').toString('hex');
    expect(Buffer.from(sm4Decrypt(key, iv, sm4Encrypt(key, iv, dataHex)), 'hex').toString('utf8')).toBe('智慧水发·蜀水云采');
  });
  it('签名与既有 SignatureService 同参互验', () => {
    const kp = sm2.generateKeyPairHex();
    const sig = signEnvelopeMsg('abc123', kp.privateKey);
    expect(sm2.doVerifySignature('abc123', sig, kp.publicKey, { hash: true })).toBe(true);
    expect(verifyEnvelopeMsg('abc123', sig, kp.publicKey)).toBe(true);
    expect(verifyEnvelopeMsg('other', sig, kp.publicKey)).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → `pnpm --filter api test -- ukey-sm` FAIL（模块不存在）。

- [ ] **Step 3: 实现 sm-crypto-layer.ts**

```ts
const sm2 = require('sm-crypto').sm2;
const sm4 = require('sm-crypto').sm4;

export const SM2_CIPHER_MODE = 1; // C1C3C2
const hexToUtf8 = (h: string) => Buffer.from(h, 'hex').toString('utf8');
const utf8ToHex = (s: string) => Buffer.from(s, 'utf8').toString('hex');

export function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** SM2 加密：hex 明文 → hex 密文（浏览器/Node 通用，不经 TextEncoder 走 hex 通道防非 ASCII 歧义） */
export function sm2EncryptHex(publicKey: string, plaintextHex: string): string {
  return sm2.doEncrypt(hexToUtf8(plaintextHex), publicKey, SM2_CIPHER_MODE);
}
export function sm2DecryptHex(privateKey: string, cipherHex: string): string {
  return utf8ToHex(sm2.doDecrypt(cipherHex, privateKey, SM2_CIPHER_MODE));
}

export function sm4Encrypt(keyHex: string, ivHex: string, dataHex: string): string {
  return sm4.encrypt(dataHex, keyHex, { iv: ivHex, mode: 'cbc', padding: 'pkcs#7' });
}
export function sm4Decrypt(keyHex: string, ivHex: string, cipherHex: string): string {
  return sm4.decrypt(cipherHex, keyHex, { iv: ivHex, mode: 'cbc', padding: 'pkcs#7' });
}

export const wrapDekJson = (dek: { keyHex: string; ivHex: string }): string => JSON.stringify(dek);
export const unwrapDekJson = (json: string): { keyHex: string; ivHex: string } => JSON.parse(json);

export const signEnvelopeMsg = (msg: string, privateKey: string): string =>
  sm2.doSignature(msg, privateKey, { hash: true });
export const verifyEnvelopeMsg = (msg: string, sig: string, publicKey: string): boolean => {
  try { return sm2.doVerifySignature(msg, sig, publicKey, { hash: true }); } catch { return false; }
};
```

- [ ] **Step 4: build + 测试通过 + Commit**

`pnpm --filter @water-erp/ukey build && pnpm --filter api test -- ukey-sm` → PASS →
`git add packages/ukey apps/api/src/common/crypto/ukey-sm.spec.ts && git commit -m "feat(ukey): SM2/SM4 信封操作封装（cipherMode=1、SM4-CBC、签名参数锁死）"`

### Task 3: UKeyAdapter 接口 + MockUKeyAdapter + Vendor 骨架

**Files:**
- Create: `packages/ukey/src/mock-ukey.ts`、`packages/ukey/src/vendor-ukey.ts`
- Modify: `packages/ukey/src/index.ts`
- Test: `apps/api/src/common/crypto/ukey-mock.spec.ts`

**Interfaces:**
- Produces:
  - `interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }`
  - `class MockUKeyAdapter implements UKeyAdapter`：`static async open(opts: { storage: StorageLike; password: string }): Promise<MockUKeyAdapter>`；`createCertificate(label: string): Promise<CertInfo>`（DN=`CN=${label}`）；`async exportFile(password: string): Promise<string>`；`static async importFile(blob: string, password: string, storage: StorageLike): Promise<MockUKeyAdapter>`
  - `class VendorUKeyAdapter implements UKeyAdapter`（骨架，方法抛 `Error('VendorUKeyAdapter 未接入：待 CA 厂商 SDK')`，`static readonly VENDOR_BASE_URL`）

- [ ] **Step 1: 写失败测试**

```ts
import { MockUKeyAdapter } from '@water-erp/ukey';

describe('MockUKeyAdapter', () => {
  const mkStorage = () => { const m = new Map<string, string>(); return {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v),
    removeItem: (k: string) => m.delete(k) }; };

  it('生成证书→sign→跨实例 import 后仍可 sign/decrypt（介质可携带语义）', async () => {
    const storage = mkStorage();
    const uk = await MockUKeyAdapter.open({ storage, password: 'p@ss' });
    const cert = await uk.createCertificate('四川水发建设有限公司');
    expect(cert.certDn).toBe('CN=四川水发建设有限公司');
    const sig = await uk.sign(cert.certSn, 'msg-1');
    // 导出（新口令）→ 另一浏览器导入 → 同证书可用
    const blob = await uk.exportFile('p@ss2');
    const uk2 = await MockUKeyAdapter.importFile(blob, 'p@ss2', mkStorage());
    const sig2 = await uk2.sign(cert.certSn, 'msg-1');
    expect(sig).toBeTruthy(); expect(sig2).toBeTruthy();
  });
  it('错误口令 import 拒绝', async () => {
    const uk = await MockUKeyAdapter.open({ storage: mkStorage(), password: 'right' });
    await uk.createCertificate('甲');
    const blob = await uk.exportFile('right');
    await expect(MockUKeyAdapter.importFile(blob, 'wrong', mkStorage())).rejects.toThrow();
  });
  it('decrypt roundtrip（用 sm2EncryptHex 包的 DEK）', async () => {
    const { sm2EncryptHex, sm2DecryptHex } = await import('@water-erp/ukey');
    const uk = await MockUKeyAdapter.open({ storage: mkStorage(), password: 'x' });
    const cert = await uk.createCertificate('乙');
    const cipher = sm2EncryptHex(cert.publicKey, 'deadbeef'.repeat(4));
    expect(await uk.decrypt(cert.certSn, cipher)).toBe(sm2DecryptHex('', cipher) === '' ? await uk.decrypt(cert.certSn, cipher) : 'deadbeef'.repeat(4));
    expect(await uk.decrypt(cert.certSn, cipher)).toBe('deadbeef'.repeat(4));
  });
});
```
（第三条用例写直白版：`expect(await uk.decrypt(cert.certSn, sm2EncryptHex(cert.publicKey, 'deadbeef'.repeat(4)))).toBe('deadbeef'.repeat(4));`）

- [ ] **Step 2: 确认失败** → FAIL。

- [ ] **Step 3: 实现 mock-ukey.ts**（要点：密钥库 = storage 键 `mock-ukey-keystore`，内容 = PBKDF2(password, salt 16B, 210k 迭代) 派生 AES-256-GCM 加密的 `{ certs: [{certSn, certDn, publicKey, encPrivKey}] }`——**storage 里永无明文私钥**；`createCertificate` 用 `sm2.generateKeyPairHex()` + `randomHex(8)` 生成 certSn；exportFile = 同结构换口令重加密的 base64 JSON）

```ts
const sm2 = require('sm-crypto').sm2;
import { randomHex, signEnvelopeMsg, sm2DecryptHex } from './sm-crypto-layer';
import type { CertInfo, UKeyAdapter } from './types';

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; }

interface Keystore { version: 1; salt: string; nonce: string; ciphertext: string; } // ciphertext = AES-GCM(privKeysJson)
interface CertRecord extends CertInfo { encPrivKey: string; } // encPrivKey = AES-GCM(口令派生钥, 私钥) 自包含字段

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 210000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function aesGcm(key: CryptoKey, nonce: Uint8Array, data: Uint8Array, mode: 'enc' | 'dec'): Promise<Uint8Array> {
  if (mode === 'enc') return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, key, data as BufferSource));
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, key, data as BufferSource));
}
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const un64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

export class MockUKeyAdapter implements UKeyAdapter {
  readonly name = 'mock-ukey';
  private constructor(private certs: CertRecord[], private save: () => Promise<void>, private storage: StorageLike, private password: string) {}
  static async open(opts: { storage: StorageLike; password: string }): Promise<MockUKeyAdapter> {
    let certs: CertRecord[] = [];
    let saltB = new Uint8Array(randomHex(16).match(/../g)!.map(h => parseInt(h, 16)));
    let saver: () => Promise<void> = async () => {};
    const raw = opts.storage.getItem('mock-ukey-keystore');
    if (raw) {
      const ks: Keystore = JSON.parse(raw);
      const key = await deriveKey(opts.password, un64(ks.salt));
      const plain = await aesGcm(key, un64(ks.nonce), un64(ks.ciphertext), 'dec'); // 口令错→抛 DOMException
      certs = JSON.parse(Buffer.from(plain).toString('utf8'));
      const saveRef = { certs };
      saver = async () => { const k = await deriveKey(opts.password, un64(ks.salt));
        const n = new Uint8Array(12); crypto.getRandomValues(n);
        opts.storage.setItem('mock-ukey-keystore', JSON.stringify({ version: 1, salt: ks.salt, nonce: b64(n), ciphertext: b64(await aesGcm(k, n, new TextEncoder().encode(JSON.stringify(saveRef.certs)), 'enc')) } as Keystore)); };
      return new MockUKeyAdapter(certs, saver, opts.storage, opts.password);
    }
    // 新建空库
    const store = opts.storage; const pass = opts.password;
    const ensureSalt = new Uint8Array(16); crypto.getRandomValues(ensureSalt); saltB = ensureSalt;
    const persist = async () => { const k = await deriveKey(pass, saltB);
      const n = new Uint8Array(12); crypto.getRandomValues(n);
      store.setItem('mock-ukey-keystore', JSON.stringify({ version: 1, salt: b64(saltB), nonce: b64(n), ciphertext: b64(await aesGcm(k, n, new TextEncoder().encode(JSON.stringify(certs)), 'enc')) } as Keystore)); };
    return new MockUKeyAdapter(certs, persist, store, pass);
  }
  async createCertificate(label: string): Promise<CertInfo> {
    const kp = sm2.generateKeyPairHex();
    const cert: CertRecord = { certSn: `MOCK-${randomHex(8).toUpperCase()}`, certDn: `CN=${label}`, publicKey: kp.publicKey, alg: 'SM2', encPrivKey: kp.privateKey };
    this.certs.push(cert); await this.save(); return cert;
  }
  async listCertificates(): Promise<CertInfo[]> { return this.certs.map(({ certSn, certDn, publicKey, alg }) => ({ certSn, certDn, publicKey, alg })); }
  private bySn(certSn: string) { const c = this.certs.find(c => c.certSn === certSn); if (!c) throw new Error(`mock-ukey 无证书 ${certSn}`); return c; }
  async sign(certSn: string, msg: string): Promise<string> { return signEnvelopeMsg(msg, this.bySn(certSn).encPrivKey); }
  async decrypt(certSn: string, cipherHex: string): Promise<string> { return sm2DecryptHex(this.bySn(certSn).encPrivKey, cipherHex); }
  async exportFile(password: string): Promise<string> { return MockUKeyAdapter.exportFrom(this.certs, password); }
  private static async exportFrom(certs: CertRecord[], password: string): Promise<string> {
    const salt = new Uint8Array(16); crypto.getRandomValues(salt);
    const k = await deriveKey(password, salt);
    const n = new Uint8Array(12); crypto.getRandomValues(n);
    const ct = await aesGcm(k, n, new TextEncoder().encode(JSON.stringify(certs)), 'enc');
    return b64(new Uint8Array(Buffer.concat([Buffer.from('UK1'), Buffer.from(b64(salt) + ':' + b64(n) + ':' + b64(ct))]))); }
  static async importFile(blob: string, password: string, storage: StorageLike): Promise<MockUKeyAdapter> {
    const j = JSON.parse(Buffer.from(Buffer.from(blob, 'base64').subarray(3).toString('utf8').length ? Buffer.from(blob, 'base64').subarray(3).toString() : '{}');
    // UK1||base64("saltB64:nonceB64:ctB64") —— 实现时按此拆包，口令错抛错
    const [salt, nonce, ct] = j.s ? ['', '', ''] : ['', '', '']; // 见 Step 3 备注
    const ks = Buffer.from(Buffer.from(blob, 'base64').subarray(3).toString('utf8'), 'base64').toString('utf8').split(':');
    const k = await deriveKey(password, un64(ks[0]));
    const certs: CertRecord[] = JSON.parse(Buffer.from(await aesGcm(k, un64(ks[1]), un64(ks[2]), 'dec')).toString('utf8'));
    const uk = new MockUKeyAdapter(certs, async () => {}, storage, password);
    // 落库到新 storage
    const fresh = await MockUKeyAdapter.open({ storage, password });
    for (const c of certs) (fresh as any).certs.push(c);
    await (fresh as any).save();
    return fresh;
  }
}
```
> **备注（执行者注意）**：上面 `importFile` 的骨架里删掉那两行无用的 `const [salt...]` 占位，直接用 `ks` 三段拆包即可；`exportFrom` 的封装格式锁定为 `UK1 || base64("saltB64:nonceB64:ctB64")`。若实现中发现 open() 的 save 闭包与 certs 数组引用脱节，改成显式持 `certs` 引用的对象（保证 createCertificate 后 save 写入最新列表）。

- [ ] **Step 4: vendor-ukey.ts 骨架**

```ts
import type { CertInfo, UKeyAdapter } from './types';
/** CA 厂商本地中间件适配骨架：拿到 SDK 文档后填三方法，业务代码零改动（spec §3.3）。 */
export class VendorUKeyAdapter implements UKeyAdapter {
  readonly name = 'vendor-ukey';
  static readonly VENDOR_BASE_URL = 'http://127.0.0.1:17999'; // 厂商本地服务（占位端口，以 SDK 为准）
  async listCertificates(): Promise<CertInfo[]> { throw new Error('VendorUKeyAdapter 未接入：待 CA 厂商 SDK 文档'); }
  async sign(): Promise<string> { throw new Error('VendorUKeyAdapter 未接入'); }
  async decrypt(): Promise<string> { throw new Error('VendorUKeyAdapter 未接入'); }
}
```

- [ ] **Step 5: build + 测试通过 + Commit**
`pnpm --filter @water-erp/ukey build && pnpm --filter api test -- ukey`（三个 spec 全绿）→
`git add packages/ukey apps/api/src/common/crypto && git commit -m "feat(ukey): MockUKeyAdapter（口令加密介质+导出导入）与 Vendor 骨架"`

### Task 4: Prisma 迁移（SupplierCert / AdminEncryptionCert / submission 七列 / dangerAttribution）

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（Supplier 关系 `certs SupplierCert[]` 一并加）
- Create: `apps/api/prisma/migrations/<ts>_dual_envelope_v2/migration.sql`（工具生成后人工审查）

**Interfaces:**
- Produces: prisma models `SupplierCert`、`AdminEncryptionCert`；`SupplierBidSubmission` 新列 `envelope Json? envelopeVersion String? decryptedPrice String? outerDecryptedAt DateTime? packageFetchedAt DateTime? innerAssets Json? decryptedAssets Json?`；`BidSupplier.dangerAttribution String?`

- [ ] **Step 1: schema 追加**（SupplierCert/AdminEncryptionCert 按 spec §3.1/§3.2 原文；列注释照 spec）

在 `model Supplier` 内加 `certs SupplierCert[]`；文件尾部（BidFileBackup 之后）加两模型；`SupplierBidSubmission` 加：
```prisma
  envelope          Json?    // dual-v2 信封（version/certSn/adminCertId/files/sealedFields/fieldsCommit）
  envelopeVersion   String?  // 'dual-v2' | null(旧轨)
  decryptedPrice    String?  // 解密上传后经 fieldsCommit 验证的报价
  outerDecryptedAt  DateTime?
  packageFetchedAt  DateTime?
  innerAssets       Json?    // {role: assetId}——C_inner 归属链（§5.4a）
  decryptedAssets   Json?    // {role: assetId}——解密明文归属链（§5.4a）
```
`model BidSupplier` 加 `dangerAttribution String? // BIDDER | PLATFORM | UNKNOWN`。

- [ ] **Step 2: create-only 生成迁移** → `cd apps/api && npx prisma migrate dev --create-only --name dual_envelope_v2`
- [ ] **Step 3: 人工审查 migration.sql**——只允许出现 `CREATE TABLE "SupplierCert"`、`CREATE TABLE "AdminEncryptionCert"` 与两条 `ALTER TABLE ... ADD COLUMN`；**删除**任何触碰 OperationLog/pgvector/既有索引的行。
- [ ] **Step 4: 执行+标记** → `npx prisma db execute --file prisma/migrations/<dir>/migration.sql && npx prisma migrate resolve --applied dual_envelope_v2 && npx prisma generate`
- [ ] **Step 5: Commit** → `git add apps/api/prisma && git commit -m "feat(db): 双信封 v2 迁移——证书两表/信封七列/归因列"`

### Task 5: AdminKeyService（keystore/轮转/bootstrap）+ admin-cert 端点

**Files:**
- Create: `apps/api/src/common/crypto/admin-keystore.service.ts`、`apps/api/src/bid/admin-cert.controller.ts`
- Modify: `apps/api/src/bid/bid.module.ts`（providers/exports AdminKeyService）、`apps/api/src/bid/bid.controller.ts` 或新 controller（路由挂 `/bid/admin-cert`）
- Test: `apps/api/src/common/crypto/admin-keystore.service.spec.ts`

**Interfaces:**
- Consumes: Task 4 模型。
- Produces:
  - `class AdminKeyService`：`getActiveCert(): Promise<AdminEncryptionCert | null>`；`generate(): Promise<AdminEncryptionCert>`；`readPrivateKey(adminCertId: string): Promise<string>`；`ensureBootstrap(): Promise<void>`
  - 端点：`POST /api/bid/admin-cert/generate`（@Roles('admin')）→ 生成并置 active（旧证 active=false）；`GET /api/bid/admin-cert`（@Roles('admin','bid_host')）→ `{ id, publicKey, certDn, active, createdAt }`
  - env：`ADMIN_KEYSTORE_DIR`（默认 `<repo>/apps/api/.data/admin-keystore`，写 `.gitignore` 追加 `apps/api/.data/`）
- Module 生命周期：BidModule 实现 `OnModuleInit` 调 `ensureBootstrap()`（无 active 证书 → 自动 generate + logger.warn）

- [ ] **Step 1: 写失败测试**（用 tmpdir 做 keystore；mock prisma 的 adminEncryptionCert upsert/findFirst）

```ts
import { AdminKeyService } from './admin-keystore.service';
const sm2 = require('sm-crypto').sm2;

describe('AdminKeyService', () => {
  let dir: string; let svc: AdminKeyService; let prisma: any;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystore-'));
    process.env.ADMIN_KEYSTORE_DIR = dir;
    prisma = { adminEncryptionCert: { findFirst: jest.fn(), updateMany: jest.fn(), create: jest.fn() } };
    prisma.adminEncryptionCert.create.mockImplementation(({ data }) => Promise.resolve({ ...data, createdAt: new Date() }));
    svc = new AdminKeyService(prisma as any);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('generate：私钥落盘 600 权限、公钥入库置 active、旧证全部 inactive', async () => {
    const cert = await svc.generate();
    const file = path.join(dir, cert.id);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const priv = fs.readFileSync(file, 'utf8');
    expect(sm2.doVerifySignature('m', sm2.doSignature('m', priv, { hash: true }), cert.publicKey, { hash: true })).toBe(true);
    expect(prisma.adminEncryptionCert.updateMany).toHaveBeenCalledWith({ where: { active: true }, data: { active: false } });
  });
  it('ensureBootstrap：无 active 自动生成；已有则不生成', async () => {
    prisma.adminEncryptionCert.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'x' });
    await svc.ensureBootstrap(); expect(prisma.adminEncryptionCert.create).toHaveBeenCalledTimes(1);
    await svc.ensureBootstrap(); expect(prisma.adminEncryptionCert.create).toHaveBeenCalledTimes(1);
  });
  it('readPrivateKey：adminCertId 定位对应文件（轮转后旧证仍可读）', async () => {
    const c1 = await svc.generate(); const c2 = await svc.generate();
    expect(await svc.readPrivateKey(c1.id)).toBeTruthy();
    expect(await svc.readPrivateKey(c2.id)).not.toBe(await svc.readPrivateKey(c1.id));
  });
  it('readPrivateKey：未知 id 抛错', async () => {
    await expect(svc.readPrivateKey('nope')).rejects.toThrow(/不存在/);
  });
});
```

- [ ] **Step 2: 确认失败** → FAIL。
- [ ] **Step 3: 实现 AdminKeyService**（要点：`generate()` = `sm2.generateKeyPairHex()` → `prisma.$transaction`（create 行 {id: cuid 由 prisma default、publicKey、certDn: 'CN=蜀水云采-管理方加密证书'、active: true} 前先 updateMany 旧 active→false）→ 写文件 `ADMIN_KEYSTORE_DIR/<id>`（fs.mkdirSync recursive、writeFileSync、chmodSync 0o600）；`readPrivateKey` = readFileSync + 不存在抛 `Error('管理方私钥不存在: id')`；`ensureBootstrap` 如测试）
- [ ] **Step 4: controller + module 接线**（新 AdminCertController：`@Controller('bid/admin-cert') @Roles('admin','bid_host')` 类级 + generate 方法级 `@Roles('admin')`；BidModule providers/exports 加 AdminKeyService，`implements OnModuleInit` → constructor 注入 AdminKeyService，`onModuleInit() { return this.adminKey.ensureBootstrap(); }`）
- [ ] **Step 5: .gitignore 追加 `apps/api/.data/`；测试通过；Commit**
`pnpm --filter api test -- admin-keystore` → PASS → `git add apps/api/src apps/api/.gitignore && git commit -m "feat(bid): 管理方加密证书 keystore 服务与端点（轮转/bootstrap/600 权限）"`

### Task 6: 供应商证书绑定端点（DN↔企业名校验）

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.controller.ts`（+`POST profile/cert`、+`DELETE profile/cert/:id`）、`apps/api/src/supplier-portal/supplier-portal.service.ts`（+`bindCert`/`revokeCert`）
- Test: `apps/api/src/supplier-portal/supplier-portal.service.spec.ts`（新增 describe 块）

**Interfaces:**
- Produces:
  - `POST /api/supplier-portal/profile/cert` body `{ certSn, certDn, publicKey, alg? }` → `{ cert }`；错误：400 `INVALID_PUBLIC_KEY`（非 `^04[0-9a-fA-F]{128}$`）、400 `DN_MISMATCH`（DN 的 CN 归一化后不含企业名归一化串）、409 `CERT_SN_EXISTS`
  - `DELETE /api/supplier-portal/profile/cert/:id` → REVOKED；响应含 `{ pendingSubmissions: number }`（依赖旧证书的未开标提交数——提示文案用）
  - 绑定成功同时回填 `Supplier.sm2PublicKey = publicKey`

- [ ] **Step 1: 写失败测试**（沿用 spec 文件既有 mock prisma 模式；新增 `prisma.supplierCert`、`prisma.supplier.update` mock）：
  - 绑定成功：DN `CN=四川水发建设有限公司,O=测试` + supplier.name `四川水发建设有限公司` → 创建 + sm2PublicKey 回填断言；
  - DN 不匹配：`CN=别家公司` → `rejects.toMatchObject({ response: { code: 'DN_MISMATCH' } })`；
  - 公钥格式非法（`05` 开头）→ `INVALID_PUBLIC_KEY`；
  - 撤销：置 REVOKED + 统计 `supplierBidSubmission.count({ where: { envelope: { path: ['certSn'], equals: certSn } } })`——Prisma Json path 过滤写法在测试里 mock 断言参数即可。
- [ ] **Step 2: 确认失败** → FAIL。
- [ ] **Step 3: 实现**（名称归一化用本地 `normalizeCn(s) = s.replace(/[\s（）()·]/g, '').replace(/(有限责任公司|股份有限公司|有限公司|集团)/g, '')`，注释注明与 expert-conflict 同口径）。
- [ ] **Step 4: 测试通过 + Commit** → `git commit -m "feat(supplier-portal): 供应商 CA 证书绑定（DN↔企业名校验+回填 sm2PublicKey）"`

### Task 7: 管理方公钥公开端点（投递端取用）

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.controller.ts`（+`GET admin-cert`）
- Test: 同 Task 6 spec 文件加一例

**Interfaces:**
- Produces: `GET /api/supplier-portal/admin-cert` → `{ adminCertId, publicKey, certDn }`；无 active 证书 → 409 `ADMIN_CERT_MISSING`（bootstrap 后不应发生，兜底）

- [ ] **Step 1-4**: 测试（active 存在返回 / null 时 409）→ 实现（`prisma.adminEncryptionCert.findFirst({ where: { active: true } })`）→ 通过 → `git commit -m "feat(supplier-portal): 管理方加密证书公钥查询端点"`

---

## Phase 2 投递

### Task 8: DualEnvelopeService（服务端验签/解外层/双闸校验）

**Files:**
- Create: `apps/api/src/common/crypto/dual-envelope.service.ts`
- Modify: `apps/api/src/bid/bid.module.ts` 与 `apps/api/src/supplier-portal/supplier-portal.module.ts`（providers/exports 各加一份——沿用仓内跨模块 service 直注模式）
- Test: `apps/api/src/common/crypto/dual-envelope.service.spec.ts`

**Interfaces:**
- Consumes: Task 1/2 的 ukey 函数。
- Produces:
  - `verifySignature(envelope: DualEnvelope, signature: string, certPublicKey: string): Promise<boolean>`（canonicalEnvelopeHash → verifyEnvelopeMsg）
  - `assertEnvelopeIntact(envelope, declared: { role: EnvelopeRole; sha256: string }[]): void`——每个角色的 envelope.files[role].sha256 必须等于投递声明的明文哈希，缺失角色条目 → 400 `ENVELOPE_INCOMPLETE`（错误由调用方包好抛出；本方法抛业务 Error，见步骤实现）
  - `decryptOuterFile(envelope: DualEnvelope, role: EnvelopeRole, outerBuf: Buffer, adminPrivateKey: string): Promise<Buffer>`（sm2DecryptHex(adminPriv, kadmin) → unwrapDekJson → sm4Decrypt → Buffer.from(hex)）
  - `verifyFieldsCommit(fields: SealedFields, nonce: string, commit: string): Promise<boolean>`

- [ ] **Step 1: 写失败测试**（构造真实 SM2 管理方密钥对 + 真实 SM4 双层加密样本：明文→C_inner→C_outer，断言 decryptOuterFile 还原原文；篡改 fields/nonce → verifyFieldsCommit false；签名验签正反例）
- [ ] **Step 2: 确认失败** → FAIL。
- [ ] **Step 3: 实现**（纯组合 Task 1/2 函数，无 prisma 依赖；`assertEnvelopeIntact` 对缺角色抛 `BadRequestException({ error: '信封缺少角色密封件', code: 'ENVELOPE_INCOMPLETE' })`）
- [ ] **Step 4: 测试通过 + Commit** → `git commit -m "feat(api): DualEnvelopeService——验签/解外层/fieldsCommit 校验"`

### Task 9: submitBid 新轨重构（拒收+验签+envelope 落库+backup v2+白名单）

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（submitBid 双轨分支、pickBidSubmissionFields 白名单、BidSupplier encryptStatus 文案、BidFileBackup dual-envelope-v2）
- Test: `apps/api/src/supplier-portal/supplier-portal.service.spec.ts`（新增「dual-v2 投递」describe）

**Interfaces:**
- Consumes: Task 8 DualEnvelopeService；Task 4 列；Task 5 active 证书。
- Produces: submitBid 在 `data.envelope?.version === 'dual-v2' && BID_DUAL_ENVELOPE !== 'false'` 时走新轨；新轨副作用：submission 写 envelope/envelopeVersion/fileHash(canonicalHash)/signature/signedAt + **bidPrice 列写 null**；bidSupplier `encryptStatus: '双层信封已验签'`；backup `cryptoVersion: 'dual-envelope-v2'`、`wrappedDek: JSON{ kself, kadmin, adminCertId }`。
- 错误码：`BID_FILE_NOT_ENCRYPTED`（asset.clientEncrypted!==true）、`ENVELOPE_INCOMPLETE`、`ADMIN_CERT_CHANGED`（envelope.adminCertId ≠ active.id）、`SM2_SIGNATURE_INVALID`。

- [ ] **Step 1: 写失败测试**（新 describe；用真实 ukey 函数构造合法 envelope+签名 fixture——生成一对"供应商证书"密钥、envelope 含 technical 角色密封件（真实 SM2 包 DEK），mock prisma / minio 同既有模式）：
  1. 合法新轨提交：submission.upsert 被调用且 `data.envelope` 有值、`data.bidPrice` 为 null、`envelopeVersion='dual-v2'`、bidSupplier 更新含 `encryptStatus: '双层信封已验签'`、stageBackup 收到 `cryptoVersion: 'dual-envelope-v2'`；
  2. asset 非 clientEncrypted → `BID_FILE_NOT_ENCRYPTED`；
  3. envelope.adminCertId 不匹配 active → `ADMIN_CERT_CHANGED`；
  4. 验签失败（换公钥）→ `SM2_SIGNATURE_INVALID`；
  5. **旧轨回归**：不传 envelope（flag 默认开）→ 走旧 clientDeks 分支不炸（既有用例保持绿）；
  6. flag 关（`process.env.BID_DUAL_ENVELOPE='false'` + envelope 传入）→ 仍走旧轨（afterAll 还原 env）。
- [ ] **Step 2: 确认失败** → FAIL。
- [ ] **Step 3: 实现**（结构）：
  - `pickBidSubmissionFields` 追加 `envelope: data.envelope ?? undefined, envelopeVersion: data.envelope?.version ?? undefined`（**保留** bidPrice 的 sealField 行——旧轨用；新轨在 submitBid 双轨分支内把 bidPrice 显式置 null 后再走 upsert）；
  - submitBid 在资产所有权断言后插双轨判断：
    ```ts
    const dualOn = process.env.BID_DUAL_ENVELOPE !== 'false';
    const dual = dualOn && (data as any).envelope?.version === 'dual-v2';
    if (dual) {
      const active = await this.prisma.adminEncryptionCert.findFirst({ where: { active: true } });
      if (!active || (data as any).envelope.adminCertId !== active.id)
        throw new BadRequestException({ error: '管理方加密证书已变更，请重新加密上传', code: 'ADMIN_CERT_CHANGED' });
      // 逐角色：clientEncrypted + envelope 条目 + sha256 一致
      for (const [role, idKey] of [['technical','technicalFileAssetId'],['business','businessFileAssetId'],['coverLetter','coverLetterAssetId'],['bond','bidBondAssetId']] as const) {
        const assetId = (data as any)[idKey] as string | undefined;
        if (!assetId) { if (role === 'bond' && !project?.bondRequired) continue; if (role !== 'bond') continue; }
        const asset = await this.prisma.fileAsset.findUnique({ where: { id: assetId } });
        if (!asset?.clientEncrypted) throw new BadRequestException({ error: `投标文件未按双层信封加密（${role}），请重新加密上传`, code: 'BID_FILE_NOT_ENCRYPTED' });
        const entry = (data as any).envelope.files[role];
        if (!entry || entry.sha256 !== asset.sha256) throw new BadRequestException({ error: '信封缺少角色密封件或哈希不符', code: 'ENVELOPE_INCOMPLETE' });
      }
      // 验签：envelope.certSn → SupplierCert（ACTIVE），回退 supplier.sm2PublicKey
      const cert = await this.prisma.supplierCert.findFirst({ where: { supplierId, certSn: (data as any).envelope.certSn, bindingStatus: 'ACTIVE' } });
      const pubKey = cert?.publicKey ?? supplier.sm2PublicKey;
      const ok = await this.dualEnvelope.verifySignature((data as any).envelope, data.signature ?? '', pubKey ?? '');
      if (!ok) throw new BadRequestException({ error: 'envelope 签名验证失败', code: 'SM2_SIGNATURE_INVALID' });
      const canonicalHash = await canonicalEnvelopeHash((data as any).envelope);
      data.bidPrice = undefined; // 新轨不写 KMS 密封报价列
      // …之后与旧轨共用 upsert/backup 收尾，backup 逐角色 wrappedDek=JSON{kself,kadmin,adminCertId}、cryptoVersion='dual-envelope-v2'；bidSupplier encryptStatus='双层信封已验签'；fileHash=canonicalHash；signedAt=new Date()
    }
    ```
  - 同事务里 submission.upsert 的 data 追加 `envelope, envelopeVersion: 'dual-v2', fileHash: canonicalHash, signature, signedAt`。
- [ ] **Step 4: 测试通过（含旧轨回归）+ Commit** → `git commit -m "feat(supplier-portal): submitBid 双信封新轨——拒收/验签/envelope 落库/backup v2"`

### Task 10: 草稿同构 + 新轨补传（供应商端）

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（saveBidDraft 已随白名单生效，补 envelopeVersion 传递即可）、`apps/api/src/bid/bid.service.ts`（reuploadBidFile 入口：submission.envelopeVersion==='dual-v2' → 400 `USE_SUPPLIER_REUPLOAD`）、`apps/api/src/supplier-portal/supplier-portal.controller.ts`（+`POST bid-submissions/:projectId/reupload-dual`）
- Test: bid.service.spec（reupload 分派 1 例）+ supplier-portal.service.spec（reupload-dual 3 例）

**Interfaces:**
- Produces: `POST /api/supplier-portal/bid-submissions/:projectId/reupload-dual`（multipart：`file`、`role`、`envelope`（整体新 envelope JSON string）、`signature`）——服务端：阶段 OPENING + 成员 + sha256 闸门（上传明文 vs FileAsset.sha256）+ 验签 + adminCertId 校验 → 新 C_outer 写 MinIO（`dual-reupload/<pid>/<sid>/<role>-<ts>.enc`）→ FileAsset 更新 sealedPath 指新密文 + submission 更新 envelope/signature → bidSupplier 重置 PENDING → 自动调 decrypt-upload 管线（复用 Task 12 的方法，届时接线；本任务先返回 `{ recovered: true, message: '已恢复，请等待解密' }` 并在 Task 12 完成后补自动重解一步）。
- 主持端旧 reupload 端点对 dual-v2 一律 400 `USE_SUPPLIER_REUPLOAD`。

- [ ] **Step 1: 写失败测试**（sha256 不符拒绝/合法恢复更新 envelope/旧端点 dual-v2 400）→ **Step 2: FAIL** → **Step 3: 实现** → **Step 4: PASS** → **Step 5: Commit** `git commit -m "feat: 新轨补传走供应商端（sha256 闸门+重签）；主持端旧通道对 dual-v2 拒绝"`

### Task 11: 供应商前端——U盾管理页 + 双层加密投递 + 密封核验准备

**Files:**
- Create: `apps/supplier-portal/src/utils/dual-envelope.ts`（前端加密编排）、`apps/supplier-portal/src/views/profile/UkeyManage.vue`
- Modify: `apps/supplier-portal/src/views/bid/BidSubmit.vue`、`apps/supplier-portal/src/api/supplier.ts`（+`getAdminCert/bindCert/revokeCert`）、`apps/supplier-portal/src/router/index.ts`（+`/profile/ukey`）、`apps/supplier-portal/src/views/bid/MyBids.vue`（报价列 dual-v2 显示「已密封·开标时揭示」——后端 getMySubmissions 对 dual-v2 已不回 bidPrice 明文）

**Interfaces:**
- Consumes: `@water-erp/ukey`（MockUKeyAdapter/canonical/sm 层）；Task 6/7 端点。
- Produces（`utils/dual-envelope.ts`）:
  - `interface DualUploadResult { assetId: string; entry: { sha256; kself; kadmin } }`
  - `async function encryptAndUploadFile(file: File, role: EnvelopeRole, ukey: MockUKeyAdapter, certSn: string, admin: { adminCertId: string; publicKey: string }, onProgress?: (p: number) => void): Promise<DualUploadResult>`（M→C_inner(SM4)→C_outer(SM4)→File→`/api/upload?category=bid_document&clientEncrypted=true&plaintextSha256=`，body FormData；返回 entry；**并返回 DEK_F 等内部值经函数闭包暂存**）
  - `async function buildEnvelope(parts: { entries: Partial<Record<EnvelopeRole, DualUploadResult['entry']>> }, fields: SealedFields, ukey, certSn, admin): Promise<{ envelope: DualEnvelope; signature: string }>`（生成 nonce/DEK_F → sealedFields → fieldsCommit → canonicalEnvelopeHash → ukey.sign）
- BidSubmit.vue 改造点：① 文件上传全部走 `encryptAndUploadFile`（bond 同）；② 提交按钮流程 = `getAdminCert` → `buildEnvelope` → payload 携带 `{ envelope, signature }`（不再传 clientDeks）；③ 草稿保存传 envelope（localStorage 仅为回显缓存）；④ 提交成功提示「请妥善保管 U盾导出文件」。
- UkeyManage.vue：口令开锁 → 证书列表/新建证书（label=企业名）/导出/导入 → `bindCert`（展示 DN 校验结果）→ 换证时展示「依赖旧证书的未开标提交 N 个」警示（revokeCert 响应）。

- [ ] **Step 1: 实现 utils/dual-envelope.ts**（代码骨架按 Interfaces；加密编排 = Task 2 函数直调；`fileToBuffer` 用 `file.arrayBuffer()`；进度 = 假进度条（SM4 同步阻塞，用 `await new Promise(r => setTimeout(r))` 分片让 UI 刷新，50MB 文件按 4MB 块循环 SM4（CBC 链式手传上一块密文——**实现注**：sm-crypto 不支持流式 CBC，分块拼接时每块独立 IV 会破坏 CBC 语义，因此**整文件一次性 `sm4Encrypt`**，进度条只在 hash/上传阶段真实））
- [ ] **Step 2: UkeyManage.vue + api client + 路由**（Element Plus 表单；导出文件下载用 Blob）
- [ ] **Step 3: BidSubmit.vue 接线**（替换 uploadEncryptedFile 内部为 encryptAndUploadFile；提交组装 envelope；移除 clientDeks 上传字段——`buildClientDeksPayload` 保留仅用于本地草稿缓存）
- [ ] **Step 4: 类型检查** `cd apps/supplier-portal && rm -rf node_modules/.vite && npx vue-tsc --noEmit`（清 Vite 缓存——Global Constraints）
- [ ] **Step 5: 手工冒烟**（dev 起门户：开锁→建证书→绑定→上传加密→提交→DB 验 envelope 落库）→ **Step 6: Commit** `git commit -m "feat(supplier-portal): U盾管理页与双层加密投递"`

---

## Phase 3 开标

### Task 12: decrypt-outer（主持端解外层 + innerAssets 归属链）

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（+`decryptOuter(projectId, supplierId?, actorId)`）、`apps/api/src/bid/bid.controller.ts`（+`POST projects/:id/opening/decrypt-outer` @Roles('admin','bid_host')，body `{ supplierId?: string }`）
- Test: `apps/api/src/bid/bid.service.spec.ts`（新增 describe）

**Interfaces:**
- Consumes: Task 5 AdminKeyService、Task 8 DualEnvelopeService、Task 4 innerAssets 列。
- Produces:
  - 单家：门控（OPENING + 会话 + 窗口开 + 未暂停）→ submission.envelope.files 逐角色（有 outer 引用的）→ `minioClient.getObject(asset.key)` 读 C_outer → `decryptOuterFile` → C_inner 写 MinIO `bid-inner/<projectId>/<bidSupplierId>/<role>.inner` → `fileAsset.create({ category: 'bid_inner_ciphertext', clientEncrypted: false, encrypted: true, uploaderId: actorId, sha256: sha256(C_inner) })` → 事务：submission.update `innerAssets={role:assetId}` + `outerDecryptedAt` + bidSupplier 无状态变化 + 监督日志「管理方解外层」+ auditLog；
  - 批量（supplierId 空）：所有 `envelopeVersion='dual-v2' && outerDecryptedAt=null && submitStatus!='已撤回'` 逐家串行，逐家独立成败返回明细；
  - 幂等：outerDecryptedAt 已存在 → 跳过（返回 skipped）。

- [ ] **Step 1: 写失败测试**（fixture：真实双层加密样本 buffer + envelope；mock minio/keystore/prisma）：窗口未开 400 `DECRYPT_WINDOW_NOT_OPEN`；成功写入 innerAssets+outerDecryptedAt+监督日志；批量幂等跳过；旧轨项目（envelopeVersion null）→ 400 `NOT_DUAL_TRACK`。
- [ ] **Step 2-4: FAIL → 实现 → PASS**
- [ ] **Step 5: Commit** `git commit -m "feat(bid): 主持端解外层——keystore 私钥解 K_admin、C_inner 归属链落库"`

### Task 13: opening-package + decrypt-upload（供应商解内层全链路）

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（+`getOpeningPackage`、+`decryptUpload`）、`apps/api/src/supplier-portal/supplier-portal.controller.ts`（+两个路由，`decrypt-upload` 用 `FileFieldsInterceptor`：`file_technical?/file_business?/file_coverLetter?/file_bond?` + body `fieldsJson`、`nonce`）
- Modify: `apps/api/src/bid/bid.service.ts`（`assertPriceMatchesSealed` 新轨读 decryptedPrice：submission.envelopeVersion==='dual-v2' → 期望值取 `decryptedPrice`；旧轨不动）
- Test: supplier-portal.service.spec（新轨解密 describe）+ bid.service.spec（assertPrice 新轨 1 例）

**Interfaces:**
- Produces:
  - `GET .../opening-package`：成员门控（BidSupplier 存在）+ stage=OPENING + 窗口开 + outerDecryptedAt 非空 → `{ windowEnd, paused, files: [{ role, assetId, downloadUrl, ciphertextSha256(密封核验) }], kselfByRole: { role: kself }, sealedFields: { cipher, kself } }`；outer 未解 → 400 `OUTER_NOT_DECRYPTED`；窗口关 → 400 `DECRYPT_WINDOW_CLOSED`。成功即写 `packageFetchedAt`。
  - `POST .../decrypt-upload`：三段式——① 原子抢占 `bidSupplier.updateMany({ where: { id, decryptStatus: 'PENDING' }, data: { decryptStatus: 'RUNNING' } })`（count=0 且非终局 → 409 `DECRYPT_ALREADY_IN_FLIGHT`，60s 接管同旧轨）；② 事务外逐上传文件 `sha256 == FileAsset(innerAssets[role]).sha256` + `computeFieldsCommit(JSON.parse(fieldsJson), nonce) == envelope.fieldsCommit`，任一失败 → DANGER+EXCEPTION+dangerAttribution='UNKNOWN'+监督日志+notifyDecryptStatus；③ 短事务：明文 FileAsset（category='bid_decrypted', uploaderId=供应商 userId）+ submission.update `decryptedAssets={role:assetId}, decryptedPrice=fields.price` + bidSupplier `decryptStatus:'SUCCESS'` + **BidOpeningRecord upsert 预填**（amount=price、period=deliveryPeriod、qualityTarget=qualityCommitment、confirmStatus='待供应商确认'、bondStatus=''——supplierName 取 bidSupplier）+ 监督日志「供应商解密成功」+ WS `notifyDecryptStatus(projectId, supplierId, name, 'SUCCESS')`（事务后）。

- [ ] **Step 1: 写失败测试**（fixture 同 Task 12）：成功路径全断言（decryptedAssets/decryptedPrice/开标记录预填字段/WS 调用）；sha256 篡改 → DANGER+UNKNOWN；fieldsCommit 错 nonce → 同；并发抢占 count=0 → 409；outer 未解取包 → 400。
- [ ] **Step 2-4: FAIL → 实现 → PASS**
- [ ] **Step 5: Commit** `git commit -m "feat(supplier-portal): 供应商解内层——双闸/抢占/唱标预填/密封核验"`

### Task 14: 下载链路分派（§5.4a 四场景）

**Files:**
- Modify: `apps/api/src/upload/upload.service.ts`（download 的 E2EE 分支前置 dual-v2 检查 + canAccessFile 新分支）、`apps/api/src/expert/expert.service.ts`（getDecryptedDocuments：dual-v2 时文件列表取 decryptedAssets 资产）、`apps/web`/`apps/bid-portal` 文件链接处（若硬编码 assetId 来源，改为服务端下发字段——先 grep `technicalFileAssetId` 在两前端的引用，逐处改为优先 decryptedAssets）
- Test: `apps/api/src/upload/upload.service.spec.ts`（若不存在则建）+ expert.service.spec 增例

**Interfaces:**
- Produces（canAccessFile/upload 逻辑）:
  1. download 入口：`asset.category==='bid_document'` 且被 dual-v2 submission 引用（四列任一）→ 400 `SEALED_NO_DOWNLOAD`（提示「双层信封密文不提供下载；请走开标解密流程」）——置于 clientEncrypted AES 分支**之前**；
  2. `canAccessFile` 新分支：`bid_inner_ciphertext` → 反查 submission（`innerAssets` JSON 含 asset.id）→ 请求者是该项目 BidSupplier（supplierId 匹配 + 登录 user 为该 supplier 的 userId）→ 允许，否则 false；
  3. `bid_decrypted` → 反查 decryptedAssets → 允许：项目成员本人（本人回看）、admin/bid_host/leader/staff（要求该供应商 decryptStatus==='SUCCESS'）、本项目专家（SUCCESS 门控复用）；
  4. expert.service：dual-v2 时 `getDecryptedDocuments` 返回 `{ supplierId, files: [{ role, assetId: decryptedAssets[role], name, sha256 }] }`；旧轨不变。

- [ ] **Step 1: 写失败测试**（四场景各一例：本人 C_outer 400、staff 无 SUCCESS 403 / 有 SUCCESS 200 指向 bid_decrypted、专家新轨拿 decrypted、非成员 C_inner 403）
- [ ] **Step 2-4: FAIL → 实现 → PASS**
- [ ] **Step 5: 前端链接改造**（expert-portal/bid-portal/web 中取 `technicalFileAssetId` 直接拼 `/api/upload/files/` 的调用点改为消费服务端下发的 files 列表——grep 定位，逐处替换）
- [ ] **Step 6: Commit** `git commit -m "feat(upload): 新轨下载分派——C_outer 拒收/bid_decrypted 指派/C_inner 成员放行"`

### Task 15: 归因矩阵（assertOpeningDone 惰性触发）+ 裁决端点 + 权利告知通知

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（assertOpeningDone 前置惰性归因 + `adjudicateDecryptFault` + 通知文案）、`apps/api/src/bid/bid.controller.ts`（+`POST projects/:id/opening/decrypt-adjudge` @Roles('admin','bid_host')，body `{ supplierId, attribution: 'BIDDER'|'PLATFORM', reason }`——spec 的 mark-platform-fault 泛化为双向裁决）
- Test: bid.service.spec（矩阵四行 + 幂等 + UNKNOWN 阻塞 + 通知文案）

**Interfaces:**
- Produces:
  - `attributePendingDualSuppliers(projectId)`（私有，被 assertOpeningDone 首行 await）：session 窗口已过（`decryptWindowEnd < now`）时，对 `envelopeVersion='dual-v2' && decryptStatus='PENDING' && submitStatus!='已撤回'` 逐家：`outerDecryptedAt==null || packageFetchedAt==null` → 只置 `dangerAttribution='UNKNOWN'`（**不**置终局态，守卫继续阻塞）；两者皆有 → 置 DANGER+EXCEPTION+`dangerAttribution='BIDDER'`+decryptError='投标人未在解密窗口内完成解密'+通知「视为撤销…保证金依招标文件规定处理」；
  - `adjudicateDecryptFault`：对 UNKNOWN 供应商落 BIDDER/PLATFORM 终局（PLATFORM 文案含「视为撤回…有权要求责任方赔偿直接损失」），reason 必填写监督日志+auditLog；
  - 幂等：已有 dangerAttribution 的不重算。

- [ ] **Step 1: 写失败测试**（矩阵四行各一例 + 重复调用不重复通知 + UNKNOWN 家导致 assertOpeningDone 仍 409 OPENING_NOT_DONE + 裁决后守卫放行）
- [ ] **Step 2-4: FAIL → 实现 → PASS**
- [ ] **Step 5: Commit** `git commit -m "feat(bid): 解密失败归因矩阵（惰性触发）与裁决端点、按归因告知权利"`

### Task 16: 旧轨端点收窄 + reseal 明文分支删除

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（decryptSupplier 入口 + decryptAllSuppliers 过滤 + resealBidFiles 删明文分支）
- Test: bid.service.spec（3 例）

**Interfaces:**
- decryptSupplier 入口：submission.envelopeVersion==='dual-v2' → 400 `USE_SUPPLIER_DECRYPT`；decryptAllSuppliers：待解名单先查 submissions，dual-v2 家跳过并在 results 标 `error: '新轨项目请走供应商解密'`；resealBidFiles：dual-v2 → 400 `USE_SUPPLIER_REUPLOAD`，且**删除「读 FileAsset.key 明文恢复」整段**（`bid.service.ts:2452-2500`）——保留 E2EE 重包裹分支（旧轨）。
- [ ] **Step 1: 写失败测试** → **Step 2: FAIL** → **Step 3: 实现**（删码 + 门控）→ **Step 4: PASS + 全量回归** `pnpm --filter api test -- bid.service` → **Step 5: Commit** `git commit -m "feat(bid): 解密/reseal 旧轨收窄——删除服务端明文恢复分支"`

### Task 17: 前端——开标大厅解外层 + 待裁决面板 + 管理方证书按钮

**Files:**
- Modify: `apps/bid-portal/src/components/opening-hall.tsx`（供应商行操作区：dual-v2 项目显示「解外层」按钮（单家/全部），触发 `POST /bid/projects/:id/opening/decrypt-outer`，进度条按返回明细；UNKNOWN 供应商行内「裁决」按钮 → 弹窗选 BIDDER/PLATFORM + 理由 → decrypt-adjudge）、`apps/bid-portal/src/lib/api/bid.ts`（+`decryptOuter/decryptAdjudge/getAdminCert/generateAdminCert`）、`apps/bid-portal/src/app/(dashboard)/bid/page.tsx` 或侧栏（admin 可见「管理方加密证书」卡片：查看/生成，生成需 confirm 弹窗「将使旧证书 inactive」）
- Modify: `apps/supplier-portal/src/views/bid/OpeningHall.vue`（「解密我的投标」卡片：轮询 opening-package（10s，OPENING 阶段）→ 就绪后展示文件清单+密封核验结果（本地算密文 sha256 对比）→「U盾解密并上传」按钮 → decrypt-upload → 成功显示 F 揭示值；失败显示原因）

- [ ] **Step 1: api client 函数**（四个，含类型）→ **Step 2: opening-hall.tsx 两块 UI**（按 §5.2/§5.5 语义；dual 判定用接口已回传的 `envelopeVersion`——需要 bid-portal 项目详情接口带出该字段：Modify `bid.service.ts` 的 listSuppliers/project 详情 select 加 `envelopeVersion`）→ **Step 3: OpeningHall.vue 解密卡片** → **Step 4: `npx tsc --noEmit`（bid-portal）+ `npx vue-tsc --noEmit`（supplier-portal）** → **Step 5: 手工冒烟**（引大济岷快照项目外新建演示项目走全链路）→ **Step 6: Commit** `git commit -m "feat(bid-portal,supplier-portal): 解外层/解密卡片/裁决面板/证书管理 UI"`

### Task 18: 解密后归档物 + 新类目删除保护

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（buildHandoverPackage suppliers 段 + `decryptedFileSha256`（取 decryptedAssets 各 FileAsset.sha256）；ensureArchiveItems 标准清单：项目含 dual-v2 提交时追加「解密后投标文件」项）、`apps/api/src/upload/upload.service.ts`（delete()：category ∈ {bid_inner_ciphertext, bid_decrypted} 或被 dual-v2 submission 四列引用的 bid_document → 409 `FILE_PROTECTED`）
- Test: bid.service.spec（归档清单 1 例）+ upload.service.spec（删除保护 2 例）

- [ ] **Step 1: 写失败测试** → **Step 2: FAIL** → **Step 3: 实现** → **Step 4: PASS** → **Step 5: Commit** `git commit -m "feat(bid,upload): 解密后投标文件入归档与三类目删除保护"`

---

## Phase 4 清理

### Task 19: 存量明文清理脚本（dry-run → 执行）

**Files:**
- Create: `apps/api/scripts/clean-legacy-plaintext.ts`（参照 scripts/ 下既有 tsx 脚本模式；memory `nest-tsx-script-gotchas`：tsx 无 decorator metadata，模型从 `@prisma/client` import 即可）
- 逻辑：查 `fileAsset.findMany({ where: { encrypted: true, clientEncrypted: false } })` → join submitted 状态的 submission（四列引用）→ 逐条输出 `{ assetId, key, submission, size }`；`--execute` 时 `minioClient.removeObject(bucket, asset.key)` + `fileAsset.update({ data: { encrypted: false } })`（sealedPath 密文保留，encrypted 标记翻 false 表示明文对象已移除）；未提交草稿跳过并列出。
- [ ] **Step 1: 实现** → **Step 2: dry-run 跑一遍核对清单**（`npx tsx apps/api/scripts/clean-legacy-plaintext.ts`，无 --execute）→ **Step 3: Commit** `git commit -m "chore(scripts): 存量投标明文清理脚本（dry-run/--execute）"`

### Task 20: 端到端冒烟 + 回归 + 收尾文档

- [ ] **Step 1: 全量单测** `pnpm --filter api test`（全绿）
- [ ] **Step 2: 手工端到端**（dev 起 api+supplier+bid+web）：新供应商注册→审核→绑 mock 证书→建项目（:3005 发公告）→加密投递→开标（:3007 建会话开窗）→解外层→供应商解内层（含密封核验显示）→唱标比对（decryptedPrice 一致）→供应商确认→启动评标→…（评标归档走既有流）→归档包含「解密后投标文件」项；另验「解外层未跑+窗口关→UNKNOWN→裁决→完成开标」路径。
- [ ] **Step 3: 旧轨回归冒烟**（演示快照 BID-1786934256839 恢复后旧轨开标演示不受影响）
- [ ] **Step 4: 文档**——CLAUDE.md 追加：`@water-erp/ukey` 包说明、`BID_DUAL_ENVELOPE`/`ADMIN_KEYSTORE_DIR` 环境变量、新 category 值；spec 状态改「已实施」。
- [ ] **Step 5: Commit** `git commit -m "docs: 双信封落地文档（env/包/category）与 spec 状态"`；提醒未推送 commit 数（不主动 push）。

---

## Self-Review 记录

1. **Spec 覆盖**：§2 数据流→T2/T8/T9/T12/T13；§3.1→T6；§3.2→T5；§3.3→T1-T3/T11；§4.1-4.2→T9/T11；§4.3→T9；§4.4→T9/T13；§5.1→T12 复用门控；§5.2→T12；§5.3→T13；§5.4/5.4a→T13/T14；§5.5→T15；§5.6→T10/T16；§5.7→T18；§6→T4；§7→各任务；§8→T19/T20；§9→T11/T17；§10→各任务测试项；§11→四 Phase 分组；§12→风险随任务内嵌。**无缺口**。
2. **占位符扫描**：无 TBD/TODO 型步骤；Task 3 mock importFile 骨架内有一处标注「执行者注意」的整理指令（属明确的实现指引而非占位）。
3. **类型一致性**：`DualEnvelope`/`SealedFields`/`EnvelopeRole` 全计划单一定义点（Task 1）；`canonicalEnvelopeHash` 等函数签名在 T1 定义、T8/T9/T13 消费处一致；错误码集中列出且与 spec §7 对齐（`decrypt-adjudge` 为 `mark-platform-fault` 的泛化，已在 T15 注明）。
