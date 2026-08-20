/* =================================================================
   双层加密信封 v2 — 前端加密编排（纯函数核心，无 axios/上传依赖）

   与后端口径的字节级对称点（Task 8 已锁定，勿漂移）：
   1. SM2/SM4 全走 hex 通道：sm2EncryptHex(pub, utf8ToHex(wrapDekJson(dek)))，
      解密侧（DualEnvelopeService.decryptOuterFile）= sm2DecryptHex → hex → utf8
      → unwrapDekJson —— wrapDekJson 的 utf8 字节必须先转 hex 再喂 SM2。
   2. C_inner = SM4-CBC(DEK_S, M)，C_outer = SM4-CBC(DEK_A, C_inner)；
      kself/kadmin 各为对应 DEK 的 wrapDekJson SM2 信封。
   3. entry.sha256 = 明文 SHA-256（上传时以 plaintextSha256 参数落 FileAsset，
      服务端 assertEnvelopeIntact 逐角色比对）。
   4. signature = ukey.sign(certSn, canonicalEnvelopeHash(envelope))；
      服务端 verifyEnvelopeMsg 同参 { hash: true }。
   5. sealedFields.cipher = SM4-CBC(DEK_F, canonicalJson({fields, nonce}))，
      kself = SM2_Enc(供应商公钥, DEK_F)，fieldsSha256 = sha256(canonicalJson(fields))，
      fieldsCommit = sha256(canonicalJson(fields) + ':' + nonce)。

   本文件仅依赖 @water-erp/ukey 与 Web 标准全局（crypto/TextEncoder/File），
   浏览器与 Node ≥20 同源可跑——scripts/dual-selfcheck.ts 直接 import 本文件做对称性自验。
   ================================================================= */

import {
  type DualEnvelope,
  type EnvelopeFileEntry,
  type EnvelopeRole,
  type SealedFields,
  type UKeyAdapter,
  canonicalEnvelopeHash,
  canonicalJson,
  computeFieldsCommit,
  randomHex,
  sha256Hex,
  sm2EncryptHex,
  sm4Encrypt,
  wrapDekJson,
} from '@water-erp/ukey'

// ── hex ↔ utf8 / bytes（浏览器无 Buffer，自写）──

export function utf8ToHex(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

export function hexToUtf8(h: string): string {
  const bytes = new Uint8Array(h.length / 2)
  for (let i = 0; i + 1 < h.length; i += 2) bytes[i / 2] = parseInt(h.slice(i, i + 2), 16)
  return new TextDecoder().decode(bytes)
}

export function bytesToHex(bytes: ArrayLike<number>): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0')
  return out
}

export function hexToBytes(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i + 1 < h.length; i += 2) out[i / 2] = parseInt(h.slice(i, i + 2), 16)
  return out
}

/** 双信封条目所需的最小证书信息（上传阶段只用公钥，签名阶段才需 UKey 介质） */
export interface DualCertRef {
  certSn: string
  publicKey: string
}

export interface AdminCertRef {
  adminCertId: string
  publicKey: string
}

/** 单文件双层密封产物（M → C_inner → C_outer），尚未上传 */
export interface SealedFileResult {
  /** C_outer 密文文件（可直接 FormData 上传） */
  file: File
  /** 明文 SHA-256（上传 plaintextSha256 参数 + envelope entry.sha256 共用） */
  plainSha256: string
  entry: EnvelopeFileEntry
}

/** 单文件双层密封（SM4 整文件一次性加密——sm-crypto 无流式 CBC，分块会破坏链式语义） */
export async function sealFileForRole(
  file: File,
  role: EnvelopeRole,
  certPublicKey: string,
  adminPublicKey: string,
  onProgress?: (pct: number) => void,
): Promise<SealedFileResult> {
  const plainBytes = new Uint8Array(await file.arrayBuffer())
  const plainHex = bytesToHex(plainBytes)

  onProgress?.(10)
  const plainSha256 = await sha256Hex(plainBytes)

  onProgress?.(20)
  // DEK_S（供应商内层）与 DEK_A（管理方外层）各随机 16B 密钥 + 16B IV
  const dekS = { keyHex: randomHex(16), ivHex: randomHex(16) }
  const dekA = { keyHex: randomHex(16), ivHex: randomHex(16) }

  const cInnerHex = sm4Encrypt(dekS.keyHex, dekS.ivHex, plainHex)
  onProgress?.(35)
  const cOuterHex = sm4Encrypt(dekA.keyHex, dekA.ivHex, cInnerHex)
  onProgress?.(50)

  const cOuterFile = new File([hexToBytes(cOuterHex)], `${file.name}.enc`, {
    type: 'application/octet-stream',
  })

  // wrapDekJson → utf8 → hex → SM2（与服务端解密侧对称）
  const entry: EnvelopeFileEntry = {
    sha256: plainSha256,
    kself: sm2EncryptHex(certPublicKey, utf8ToHex(wrapDekJson(dekS))),
    kadmin: sm2EncryptHex(adminPublicKey, utf8ToHex(wrapDekJson(dekA))),
  }

  return { file: cOuterFile, plainSha256, entry }
}

export interface BuildEnvelopeInput {
  entries: Partial<Record<EnvelopeRole, EnvelopeFileEntry>>
  fields: SealedFields
  ukey: Pick<UKeyAdapter, 'sign'>
  certSn: string
  certPublicKey: string
  adminCertId: string
}

/** 组装整体信封 + 供应商证书签名（canonicalEnvelopeHash → signEnvelopeMsg） */
export async function buildEnvelope(input: BuildEnvelopeInput): Promise<{ envelope: DualEnvelope; signature: string }> {
  const { entries, fields, ukey, certSn, certPublicKey, adminCertId } = input

  const nonce = randomHex(16)
  const fieldsJson = canonicalJson(fields)
  const fieldsSha256 = await sha256Hex(fieldsJson)
  const fieldsCommit = await computeFieldsCommit(fields, nonce)

  // DEK_F：唱标字段密封件（{fields, nonce} 的供应商层 SM4 密文）
  const dekF = { keyHex: randomHex(16), ivHex: randomHex(16) }
  const sealedFields = {
    cipher: sm4Encrypt(dekF.keyHex, dekF.ivHex, utf8ToHex(canonicalJson({ fields, nonce }))),
    kself: sm2EncryptHex(certPublicKey, utf8ToHex(wrapDekJson(dekF))),
    fieldsSha256,
  }

  const envelope: DualEnvelope = {
    version: 'dual-v2',
    certSn,
    adminCertId,
    files: entries,
    sealedFields,
    fieldsCommit,
  }

  const hash = await canonicalEnvelopeHash(envelope)
  const signature = await ukey.sign(certSn, hash)
  return { envelope, signature }
}

/**
 * 补传重封（reupload-dual，T17 复用）：单文件重新双层密封 + 以旧信封为底组新信封。
 * 唱标字段密封件（sealedFields/fieldsCommit）逐字保留旧值——服务端 FIELDS_COMMIT_CHANGED 闸门
 * 拒收任何变更；files 其余角色条目保留，仅覆盖补传角色。
 */
export async function reencryptDualFile(
  file: File,
  role: EnvelopeRole,
  ukey: Pick<UKeyAdapter, 'sign'>,
  certSn: string,
  certPublicKey: string,
  admin: AdminCertRef,
  prevEnvelope: DualEnvelope,
  onProgress?: (pct: number) => void,
): Promise<{ file: File; envelope: DualEnvelope; signature: string; plainSha256: string }> {
  const sealed = await sealFileForRole(file, role, certPublicKey, admin.publicKey, onProgress)
  const envelope: DualEnvelope = {
    ...prevEnvelope,
    certSn,
    adminCertId: admin.adminCertId,
    files: { ...prevEnvelope.files, [role]: sealed.entry },
    sealedFields: prevEnvelope.sealedFields,
    fieldsCommit: prevEnvelope.fieldsCommit,
  }
  const signature = await ukey.sign(certSn, await canonicalEnvelopeHash(envelope))
  return { file: sealed.file, envelope, signature, plainSha256: sealed.plainSha256 }
}
