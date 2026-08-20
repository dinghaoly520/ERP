/* =================================================================
   双层加密信封 — 前后端口径对称性自验（Task 11 交付证据）

   用与前端同一份 dual-envelope-core.ts 生产函数跑完整链路，
   再按服务端 DualEnvelopeService / submitBid 的口径反向解密/验签：
   ① 服务端 decryptOuterFile（管理方私钥：kadmin→DEK_A→C_inner）
   ② 供应商介质解密（certSn 私钥：kself→DEK_S→明文，与①合账还原原始字节）
   ③ 唱标字段密封件（kself→DEK_F→SM4→{fields,nonce}，fieldsSha256/fieldsCommit 双闸）
   ④ canonicalEnvelopeHash → verifyEnvelopeMsg（submitBid 验签链）
   ⑤ reupload-dual 重封（sealedFields/fieldsCommit 逐字保留 + 新条目哈希锚点）

   运行：cd apps/supplier-portal && ../api/node_modules/.bin/tsx scripts/dual-selfcheck.ts
   ================================================================= */

import { createRequire } from 'node:module'
import { strict as assert } from 'node:assert'
import {
  MockUKeyAdapter,
  type StorageLike,
  canonicalEnvelopeHash,
  canonicalJson,
  computeFieldsCommit,
  sha256Hex,
  sm2DecryptHex,
  sm4Decrypt,
  unwrapDekJson,
  verifyEnvelopeMsg,
} from '@water-erp/ukey'
import {
  sealFileForRole,
  buildEnvelope,
  reencryptDualFile,
  utf8ToHex,
  hexToUtf8,
  bytesToHex,
} from '../src/utils/dual-envelope-core'

const require = createRequire(import.meta.url)
const { sm2 } = require('sm-crypto')

function memStorage(): StorageLike {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v) },
    removeItem: (k) => { m.delete(k) },
  }
}

/** 含无效 utf8 字节序列的明文——证明 hex 通道字节精确透传（无 U+FFFD 有损替换） */
function rawBytes(seed: string): Uint8Array {
  const head = new TextEncoder().encode(seed)
  const out = new Uint8Array(head.length + 4)
  out.set(head, 0)
  out.set([0xff, 0x80, 0x00, 0x01], head.length)
  return out
}

async function main() {
  const ADMIN_CERT_ID = 'ADMIN-CERT-1'
  // 管理方加密证书密钥对（服务端 AdminKeyService 持有私钥）
  const adminKp = sm2.generateKeyPairHex()
  // 供应商 U盾介质（内存存储，口令 123456）
  const ukey = await MockUKeyAdapter.open({ storage: memStorage(), password: '123456' })
  const cert = await ukey.createCertificate('四川水发建设有限公司')
  console.log(`[ukey] certSn=${cert.certSn} certDn=${cert.certDn}`)

  // ═══ ① 单文件双层密封 + 全链路还原 ═══
  const raw = rawBytes('技术标书正文：实施方案与质量控制 —— 引大济岷')
  const file = new File([raw as BlobPart], '技术标.pdf')
  const sealed = await sealFileForRole(file, 'technical', cert.publicKey, adminKp.publicKey)

  assert.equal(sealed.plainSha256, await sha256Hex(raw), '明文哈希锚点一致')
  // 注意：arrayBuffer() 返回 ArrayBuffer（无 .length/索引），须先包 Uint8Array 再喂 bytesToHex
  const cOuterBytes = new Uint8Array(await sealed.file.arrayBuffer())
  assert.notEqual(bytesToHex(cOuterBytes), bytesToHex(raw), '上传的是密文')

  // 服务端：管理方私钥剥外层（镜像 DualEnvelopeService.decryptOuterFile）
  const wrapAHex = sm2DecryptHex(adminKp.privateKey, sealed.entry.kadmin)
  assert.ok(wrapAHex, 'kadmin SM2 解密成功')
  const dekA = unwrapDekJson(hexToUtf8(wrapAHex))
  const cInnerHex = sm4Decrypt(dekA.keyHex, dekA.ivHex, bytesToHex(cOuterBytes))

  // 供应商：介质内私钥解 kself → DEK_S → 明文（与①合账）
  const wrapSHex = await ukey.decrypt(cert.certSn, sealed.entry.kself)
  const dekS = unwrapDekJson(hexToUtf8(wrapSHex))
  const plainHex = sm4Decrypt(dekS.keyHex, dekS.ivHex, cInnerHex)
  assert.equal(plainHex, bytesToHex(raw), '双层解封还原原始明文（含无效 utf8 字节）')
  console.log('[seal] M→C_inner→C_outer 与 kself/kadmin 解封链路 OK')

  // ═══ ② 整体信封 + 验签 + 唱标字段密封件 ═══
  const fields = { price: '1260', deliveryPeriod: '120日历天', qualityCommitment: '一次验收合格' }
  const { envelope, signature } = await buildEnvelope({
    entries: { technical: sealed.entry },
    fields,
    ukey,
    certSn: cert.certSn,
    certPublicKey: cert.publicKey,
    adminCertId: ADMIN_CERT_ID,
  })
  assert.equal(envelope.version, 'dual-v2')
  assert.equal(envelope.certSn, cert.certSn)
  assert.equal(envelope.adminCertId, ADMIN_CERT_ID)

  const hash = await canonicalEnvelopeHash(envelope)
  assert.ok(verifyEnvelopeMsg(hash, signature, cert.publicKey), '服务端验签（canonicalEnvelopeHash → verifyEnvelopeMsg）')
  assert.ok(!verifyEnvelopeMsg(hash + '00', signature, cert.publicKey), '篡改哈希验签必须失败')

  // 主持端开标口径：kself → DEK_F → SM4 解出 {fields, nonce} → 双闸校验
  const wrapFHex = await ukey.decrypt(cert.certSn, envelope.sealedFields.kself)
  const dekF = unwrapDekJson(hexToUtf8(wrapFHex))
  const payload = JSON.parse(hexToUtf8(sm4Decrypt(dekF.keyHex, dekF.ivHex, envelope.sealedFields.cipher)))
  assert.deepEqual(payload.fields, fields, 'sealedFields 解密出唱标字段')
  assert.equal(envelope.sealedFields.fieldsSha256, await sha256Hex(canonicalJson(fields)), 'fieldsSha256 闸')
  assert.equal(envelope.fieldsCommit, await computeFieldsCommit(fields, payload.nonce), 'fieldsCommit 闸（nonce 参与）')
  console.log('[envelope] 签名验签 + fieldsSha256/fieldsCommit 双闸 OK')

  // ═══ ③ reupload-dual 重封（补传：sealedFields/fieldsCommit 逐字保留）═══
  const raw2 = rawBytes('商务标书正文：报价明细与业绩案例')
  const file2 = new File([raw2 as BlobPart], '商务标.pdf')
  const r = await reencryptDualFile(
    file2, 'business', ukey, cert.certSn, cert.publicKey,
    { adminCertId: ADMIN_CERT_ID, publicKey: adminKp.publicKey },
    envelope,
  )
  assert.equal(r.envelope.files.business?.sha256, await sha256Hex(raw2), '补传角色新条目哈希锚点')
  assert.equal(r.envelope.files.technical?.sha256, sealed.plainSha256, '他角色条目保留')
  assert.equal(r.envelope.sealedFields.fieldsSha256, envelope.sealedFields.fieldsSha256, '唱标字段密封件不得变更（服务端 FIELDS_COMMIT_CHANGED 闸）')
  assert.equal(r.envelope.fieldsCommit, envelope.fieldsCommit, 'fieldsCommit 逐字保留')
  assert.ok(verifyEnvelopeMsg(await canonicalEnvelopeHash(r.envelope), r.signature, cert.publicKey), '重封信封验签')
  console.log('[reupload] 单角色重封 + 密封件保留 + 重签 OK')

  // ═══ ④ hex↔utf8 工具 ═══
  assert.equal(hexToUtf8(utf8ToHex('中文报价 1260 万元')), '中文报价 1260 万元', 'utf8↔hex 往返')

  console.log('\nALL DUAL-ENVELOPE SYMMETRY CHECKS PASSED ✅')
}

main().catch((e) => {
  console.error('\nSELFCHECK FAILED ❌')
  console.error(e)
  process.exit(1)
})
