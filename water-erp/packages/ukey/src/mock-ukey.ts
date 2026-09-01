/* =================================================================
   MockUKeyAdapter — 口令加密的软件 UKey 介质（双信封 v2 · 演示/联调）

   介质语义（对齐真实 UKey：私钥不可导出为明文）：
   - storage 键 `mock-ukey-keystore` 只存
     { version: 1, salt, nonce, ciphertext }，其中
     ciphertext = AES-256-GCM(PBKDF2-SHA256(password, salt, 210k), certsJson)，
     certsJson = [{ certSn, certDn, publicKey, alg, encPrivKey }] ——
     **storage 里永无明文私钥**（encPrivKey 仅以密文信封整体加密的形态存在）。
   - 导出文件 = `UK1 || base64("saltB64:nonceB64:ctB64")`，同结构换口令重加密，
     可跨浏览器/跨实例导入；importFile 全量解密+解析成功后才写 storage，
     口令错抛错且零残留。
   - 仅用 Web 标准全局（crypto.subtle / crypto.getRandomValues / btoa / atob /
     TextEncoder / TextDecoder），浏览器与 Node ≥16 同源可跑，无 Node 专有 API。
   ================================================================= */

declare const require: (id: string) => { sm2: { generateKeyPairHex(): { publicKey: string; privateKey: string } } };

const sm2 = require('sm-crypto').sm2;

import { randomHex, signEnvelopeMsg, sm2DecryptHex } from './sm-crypto-layer';
import type { CertInfo, UKeyAdapter } from './types';

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

interface Keystore {
  version: 1;
  salt: string;
  nonce: string;
  ciphertext: string;
}

/** encPrivKey（SM2 私钥 hex）仅在 certsJson 内，而 certsJson 只以 AES-GCM 密文形态落盘/导出。 */
interface CertRecord extends CertInfo {
  encPrivKey: string;
}

const KEYSTORE_KEY = 'mock-ukey-keystore';
const EXPORT_MAGIC = 'UK1';
const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;

// ── Web 标准编解码（无 Buffer 依赖，浏览器可用）──
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const fromUtf8 = (b: Uint8Array): string => new TextDecoder().decode(b);
const toB64 = (u: Uint8Array): string => btoa(Array.from(u, (byte) => String.fromCharCode(byte)).join(''));
const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const randomBytes = (n: number): Uint8Array => {
  const u = new Uint8Array(n);
  crypto.getRandomValues(u);
  return u;
};

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', utf8(password) as BufferSource, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function aesGcmEncrypt(key: CryptoKey, nonce: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, key, data as BufferSource),
  );
}

/** 口令不符 / 密文被篡改时 GCM 认证失败 → WebCrypto 抛错（语义上即导入/打开失败）。 */
async function aesGcmDecrypt(key: CryptoKey, nonce: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, key, ciphertext as BufferSource),
  );
}

/** 解出并校验证书表（介质损坏给出明确错误而非半初始化状态）。 */
function parseCerts(json: string): CertRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('mock-ukey 介质损坏：证书表非法 JSON');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (c) =>
        typeof (c as CertRecord)?.certSn !== 'string' ||
        typeof (c as CertRecord)?.publicKey !== 'string' ||
        typeof (c as CertRecord)?.encPrivKey !== 'string',
    )
  ) {
    throw new Error('mock-ukey 介质损坏：证书表结构非法');
  }
  return parsed as CertRecord[];
}

export class MockUKeyAdapter implements UKeyAdapter {
  readonly name = 'mock-ukey';

  /**
   * 打开（或新建）口令介质。
   * - 已有介质：口令不符 / 介质损坏 → 抛错（不返回半初始化实例）。
   * - 全新介质：建空库（惰性落盘，首次 createCertificate 时写入）。
   */
  static async open(opts: { storage: StorageLike; password: string }): Promise<MockUKeyAdapter> {
    const raw = opts.storage.getItem(KEYSTORE_KEY);
    if (!raw) return new MockUKeyAdapter(opts.storage, opts.password, randomBytes(SALT_BYTES), []);

    let ks: Keystore;
    try {
      ks = JSON.parse(raw) as Keystore;
    } catch {
      throw new Error('mock-ukey 介质损坏：keystore 非法 JSON');
    }
    if (ks.version !== 1) throw new Error(`mock-ukey 介质版本不支持：${String(ks.version)}`);

    let plain: Uint8Array;
    try {
      const key = await deriveKey(opts.password, fromB64(ks.salt));
      plain = await aesGcmDecrypt(key, fromB64(ks.nonce), fromB64(ks.ciphertext));
    } catch {
      throw new Error('mock-ukey 打开失败：口令不符或介质损坏');
    }
    return new MockUKeyAdapter(opts.storage, opts.password, fromB64(ks.salt), parseCerts(fromUtf8(plain)));
  }

  /** 解包 `UK1 || base64("saltB64:nonceB64:ctB64")`；全量解密+解析成功后才落库（零残留）。 */
  static async importFile(blob: string, password: string, storage: StorageLike): Promise<MockUKeyAdapter> {
    if (!blob.startsWith(EXPORT_MAGIC)) {
      throw new Error(`导入失败：介质文件格式不正确（magic=${blob.slice(0, EXPORT_MAGIC.length)}）`);
    }
    let raw: Uint8Array;
    try {
      raw = fromB64(blob.slice(EXPORT_MAGIC.length));
    } catch {
      throw new Error('导入失败：介质文件不是合法 base64');
    }
    const parts = fromUtf8(raw).split(':');
    if (parts.length !== 3) throw new Error('导入失败：介质文件结构不完整');
    let salt: Uint8Array, nonce: Uint8Array, ct: Uint8Array;
    try {
      salt = fromB64(parts[0]);
      nonce = fromB64(parts[1]);
      ct = fromB64(parts[2]);
    } catch {
      throw new Error('导入失败：介质文件段不是合法 base64');
    }

    let certs: CertRecord[];
    try {
      const key = await deriveKey(password, salt);
      certs = parseCerts(fromUtf8(await aesGcmDecrypt(key, nonce, ct)));
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('mock-ukey 介质损坏')) throw e; // 结构损坏原样透传
      throw new Error('导入失败：口令不符或介质损坏');
    }

    // 全量成功：以新 salt 落库到目标介质（与导出件材料解耦），再返回可用实例
    const uk = new MockUKeyAdapter(storage, password, randomBytes(SALT_BYTES), certs);
    await uk.persist();
    return uk;
  }

  private constructor(
    private readonly storage: StorageLike,
    private readonly password: string,
    private salt: Uint8Array,
    private readonly certs: CertRecord[],
  ) {}

  /** 最新证书表整体重加密落盘（新 nonce；persist 时读取 certs 当前内容，与实例永不脱节）。 */
  private async persist(): Promise<void> {
    const key = await deriveKey(this.password, this.salt);
    const nonce = randomBytes(NONCE_BYTES);
    const ciphertext = await aesGcmEncrypt(key, nonce, utf8(JSON.stringify(this.certs)));
    const ks: Keystore = {
      version: 1,
      salt: toB64(this.salt),
      nonce: toB64(nonce),
      ciphertext: toB64(ciphertext),
    };
    this.storage.setItem(KEYSTORE_KEY, JSON.stringify(ks));
  }

  async createCertificate(label: string): Promise<CertInfo> {
    const kp = sm2.generateKeyPairHex();
    const record: CertRecord = {
      certSn: `MOCK-${randomHex(8).toUpperCase()}`,
      certDn: `CN=${label}`,
      publicKey: kp.publicKey,
      alg: 'SM2',
      encPrivKey: kp.privateKey,
    };
    this.certs.push(record);
    await this.persist();
    return this.publicView(record);
  }

  async listCertificates(): Promise<CertInfo[]> {
    return this.certs.map((c) => this.publicView(c));
  }

  async sign(certSn: string, msg: string): Promise<string> {
    return signEnvelopeMsg(msg, this.bySn(certSn).encPrivKey);
  }

  /** sm-crypto 解密失败返回 ''（从不抛错）——此处收口为抛错，调用方可据以判定失败。 */
  async decrypt(certSn: string, cipherHex: string): Promise<string> {
    const plain = sm2DecryptHex(this.bySn(certSn).encPrivKey, cipherHex);
    if (!plain) throw new Error('解密失败：密文损坏或口令不符');
    return plain;
  }

  /** mock 介质无会话概念——不参与空闲自动锁定倒计时 */
  secondsUntilLock(): number | null { return null; }

  /** 导出介质文件（可换口令）：`UK1 || base64("saltB64:nonceB64:ctB64")`。 */
  async exportFile(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await deriveKey(password, salt);
    const nonce = randomBytes(NONCE_BYTES);
    const ct = await aesGcmEncrypt(key, nonce, utf8(JSON.stringify(this.certs)));
    return EXPORT_MAGIC + toB64(utf8(`${toB64(salt)}:${toB64(nonce)}:${toB64(ct)}`));
  }

  private publicView({ certSn, certDn, publicKey, alg }: CertRecord): CertInfo {
    return { certSn, certDn, publicKey, alg };
  }

  private bySn(certSn: string): CertRecord {
    const c = this.certs.find((x) => x.certSn === certSn);
    if (!c) throw new Error(`mock-ukey 无证书 ${certSn}`);
    return c;
  }
}
