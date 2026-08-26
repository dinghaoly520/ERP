/* =================================================================
   双层加密信封 v2 — 上传侧编排（浏览器入口）
   纯加密/组信封逻辑在 dual-envelope-core.ts；本文件仅组合 upload api client。
   ================================================================= */

import type { EnvelopeFileEntry, EnvelopeRole } from '@water-erp/ukey'
import { uploadFile, type FileAssetResponse } from '@/lib/api/upload'
import { sealFileForRole, type AdminCertRef, type DualCertRef } from './dual-envelope-core'

export * from './dual-envelope-core'

export interface DualUploadResult {
  assetId: string
  role: EnvelopeRole
  entry: EnvelopeFileEntry
  upload: FileAssetResponse
}

/**
 * 双层加密并上传单文件（M → SM4×2 → C_outer → /api/upload?clientEncrypted=true）。
 * 返回 envelope.files[role] 条目（sha256/kself/kadmin），由提交侧组入信封。
 * 上传阶段仅需证书公钥（kself SM2 加密），私钥签名发生在提交时的 buildEnvelope。
 */
export async function encryptAndUploadFile(
  file: File,
  role: EnvelopeRole,
  cert: DualCertRef,
  admin: AdminCertRef,
  onProgress?: (pct: number) => void,
): Promise<DualUploadResult> {
  // 0-50：哈希+双层加密（SM4 同步阻塞，进度仅在真实阶段推进）
  const sealed = await sealFileForRole(file, role, cert.publicKey, admin.publicKey, (p) => onProgress?.(p * 0.5))
  // 50-100：真实上传进度
  const upload = await uploadFile(
    sealed.file,
    'bid_document',
    (p) => onProgress?.(50 + p * 0.5),
    true,
    sealed.plainSha256,
  )
  return { assetId: upload.id, role, entry: sealed.entry, upload }
}
