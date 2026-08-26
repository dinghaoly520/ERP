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
