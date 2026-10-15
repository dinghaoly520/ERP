/* =================================================================
   dual-v3-client.ts — dual-v3 投标信封浏览器端组装（阶段2 Task11）
   流程：逐角色双层加密（SM4 DEK_S → C_inner；SM4 DEK_A → C_outer）→
        C_outer 暂存上传（服务端实算哈希）→ kself=盾 P7 封装 / kadmin=SM2 管理方公钥 →
        sealedFields（DEK_F）+ fieldsCommit → buildV3Envelope
   原语全部来自 @water-erp/ukey（前后端同源 sm-crypto 字节通道）
   ================================================================= */
import {
  randomHex, sm4Encrypt, sm4Decrypt, sm2EncryptHex, sha256Hex, canonicalJson,
  buildV3Envelope, computeV3FieldsCommit, keyWrapJson,
} from '@water-erp/ukey';
import type { DualV3Envelope, DualV3SealedFields, V3Fields, V3Role } from '@water-erp/ukey';

export interface V3FileInput { role: V3Role; file: File }

export interface V3UploadResult {
  fileAssetId: string;
  outerSha256: string; // 服务端实算（附录 §5.B——不信客户端自报）
  outerBytes: number;
}

export interface V3WrapAdapter {
  /** SCCA 盾 P7 封装（GM/T 0010 attached，加密证书收件人） */
  wrapKeyToEncCert(encCertPem: string, json: string): Promise<string>;
}

export interface V3UploadDeps {
  /** C_outer 密文暂存上传（Task5 encrypted-assets 端点） */
  uploadOuter(role: V3Role, blob: Blob, filename: string): Promise<V3UploadResult>;
}

/** PEM 甲剥除 → DER 字节（供加密证指纹） */
export function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 加密证书 DER sha256（kself.recipientCertFingerprint） */
export async function pemDerSha256(pem: string): Promise<string> {
  return sha256Hex(pemToDer(pem));
}

/** hex 串 → 二进制字节（加密产物上传/哈希统一走二进制——哈希口径与服务端实算一致） */
const hexToBytes = (h: string): Uint8Array =>
  Uint8Array.from((h.match(/.{2}/g) ?? []).map((x) => parseInt(x, 16)));

const utf8Hex = (s: string): string =>
  Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('');

const hexBytes = (h: string): number => h.length / 2;

/**
 * dual-v3 投标组装（附录 §5.C 投递数据流）：
 * 返回完整信封 + 上传资产清单 + 密封字段 + 承诺随机数。
 * 上传走注入的 deps.uploadOuter（默认不注入——由卡片层传 supplierApi 封装，便于测试替换）。
 */
export async function encryptAndUploadV3(
  projectId: string,
  files: V3FileInput[],
  fields: V3Fields,
  encCertPem: string,
  adapter: V3WrapAdapter,
  adminCert: { adminCertId: string; publicKey: string },
  deps: V3UploadDeps,
  context: { supplierId: string; submissionId: string; revision: number; signingBindingId: string; signingCertFingerprint: string },
  reuseNonce?: string,
): Promise<{
  envelope: DualV3Envelope;
  uploadedAssets: Array<{ role: V3Role; fileAssetId: string }>;
  sealedFields: DualV3SealedFields;
  fieldsCommit: string;
  nonceHex: string;
}> {
  const encCertFingerprint = await pemDerSha256(encCertPem);
  const uploadedAssets: Array<{ role: V3Role; fileAssetId: string }> = [];
  const entries: Partial<Record<V3Role, DualV3Envelope['files'][V3Role]>> = {};

  // ── 逐角色：明文 → C_inner（DEK_S）→ C_outer（DEK_A）→ 暂存上传 ──
  for (const { role, file } of files) {
    const plain = new Uint8Array(await file.arrayBuffer());
    const plainHex = Array.from(plain, (b) => b.toString(16).padStart(2, '0')).join('');
    const plainSha256 = await sha256Hex(plain);

    const dekS = { keyHex: randomHex(16), ivHex: randomHex(16) };
    const innerHex = sm4Encrypt(dekS.keyHex, dekS.ivHex, plainHex);
    const innerBin = hexToBytes(innerHex);
    // 哈希口径=二进制（真盾 E2E 实证：hex 字符串哈希 ≠ 服务端实算二进制哈希——跨校验必炸）
    const innerSha256 = await sha256Hex(innerBin);

    const dekA = { keyHex: randomHex(16), ivHex: randomHex(16) };
    const outerHex = sm4Encrypt(dekA.keyHex, dekA.ivHex, innerHex);
    const outerBin = hexToBytes(outerHex);
    const outerSha256Local = await sha256Hex(outerBin);

    const outerBlob = new Blob([new Uint8Array(outerBin)], {
      type: 'application/octet-stream',
    });
    const uploaded = await deps.uploadOuter(role, outerBlob, `${file.name}.outer`);
    if (uploaded.outerSha256 && uploaded.outerSha256 !== outerSha256Local) {
      throw new Error(`outerSha256 不一致（服务端实算 ${uploaded.outerSha256.slice(0, 8)}… ≠ 本地 ${outerSha256Local.slice(0, 8)}…）——传输损坏或截断，请重试`);
    }

    // kself=盾 P7 封装 DEK_S（供应商加密证书收件人）；kadmin=SM2 封装 DEK_A（管理方公钥+证书 id）
    const kself = {
      format: 'scca-pkcs7-base64' as const,
      recipientCertFingerprint: encCertFingerprint,
      value: await adapter.wrapKeyToEncCert(encCertPem, keyWrapJson(dekS)),
    };
    const kadmin = {
      format: 'sm2-c1c3c2-hex' as const,
      adminCertId: adminCert.adminCertId,
      value: sm2EncryptHex(adminCert.publicKey, utf8Hex(keyWrapJson(dekA))),
    };

    entries[role] = {
      assetId: uploaded.fileAssetId,
      plainSha256, plainBytes: plain.length,
      innerSha256, innerBytes: hexBytes(innerHex),
      outerSha256: uploaded.outerSha256 || outerSha256Local, outerBytes: uploaded.outerBytes || outerBlob.size,
      kself, kadmin,
    };
    uploadedAssets.push({ role, fileAssetId: uploaded.fileAssetId });
  }

  // ── sealedFields：canonical {fields, nonce} → SM4（DEK_F）→ 盾 P7 封装 DEK_F ──
  // Ruling（Task12 补）：cipher 须同时携带 nonce——供应商开标解密时从密文反解 nonce，
  // 方可回传 decrypt-upload 重验 fieldsCommit（服务端对 cipher 零知识，仅比对承诺）。
  // 补传（阶段2.5 T3）：复用原 nonce——fieldsCommit 与原版一致（服务端改价闸比对通过）
  const nonceHex = reuseNonce ?? randomHex(16);
  const dekF = { keyHex: randomHex(16), ivHex: randomHex(16) };
  const fieldsJson = canonicalJson({ fields, nonce: nonceHex });
  const cipherHex = sm4Encrypt(dekF.keyHex, dekF.ivHex, utf8Hex(fieldsJson));
  const sealedFields: DualV3SealedFields = {
    cipherFormat: 'sm4-cbc-pkcs7-hex',
    cipher: cipherHex,
    cipherSha256: await sha256Hex(hexToBytes(cipherHex)),
    cipherBytes: hexBytes(cipherHex),
    kself: {
      format: 'scca-pkcs7-base64',
      recipientCertFingerprint: encCertFingerprint,
      value: await adapter.wrapKeyToEncCert(encCertPem, keyWrapJson(dekF)),
    },
  };

  // ── fieldsCommit + 信封 ──
  const fieldsCommit = await computeV3FieldsCommit(fields, nonceHex);
  const envelope = buildV3Envelope({
    context: { projectId, ...context },
    files: entries,
    sealedFields,
    fieldsCommit,
  });

  return { envelope, uploadedAssets, sealedFields, fieldsCommit, nonceHex };
}

/** 信封 context revision 契约（C-1 复审修复）：信封声明的 revision = 服务端即将分配的
 *  新版本（当前 baseRevision + 1）——服务端 submitBidV3 按 ctx.revision === newRev 硬校验。
 *  baseRevision（CAS 基线）保持当前值不变。 */
export function nextRevisionContext(context: { supplierId: string; submissionId: string; revision: number; signingBindingId: string; signingCertFingerprint: string }) {
  return { ...context, revision: context.revision + 1 };
}

/** decrypt-upload P7 证明 canonical（Task12）——与服务端 Task9 构建逐字一致：
 *  plainSha256ByRole=各角色明文 sha256（诚实客户端==信封声明值），服务端验签即交叉比对。 */
export function buildDecryptProofCanonical(input: {
  openingSessionId: string;
  revision: number;
  plainSha256ByRole: Record<string, string>;
  fieldsCommit: string;
}): string {
  return canonicalJson({
    version: 1,
    purpose: 'decrypt-upload',
    openingSessionId: input.openingSessionId,
    revision: input.revision,
    plainSha256ByRole: input.plainSha256ByRole,
    fieldsCommit: input.fieldsCommit,
  });
}

/** 补传方盾复原（阶段2.5 T3）：盾 unwrapKey 得 DEK_F json → 解 sealedFields.cipher
 *  → {fields, nonce}。与 encryptAndUploadV3 密封侧闭环（单测互证）。 */
export async function unwrapSealedFields(
  dekJson: string,
  sealedFields: { cipher: string },
): Promise<{ fields: V3Fields; nonce: string }> {
  const dek = JSON.parse(dekJson) as { k: string; iv: string };
  const plainHex = sm4Decrypt(dek.k, dek.iv, sealedFields.cipher);
  const bytes = Uint8Array.from((plainHex.match(/.{2}/g) ?? []).map((h) => parseInt(h, 16)));
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { fields: V3Fields; nonce: string };
  return { fields: parsed.fields, nonce: parsed.nonce };
}
