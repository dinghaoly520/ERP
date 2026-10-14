/* =================================================================
   dual-v3 — SCCA 双信封 v3 类型、canonical 与严格校验器
   阶段2 Task1（附录 §5.A）

   与 v2 差异：
   - kself 从 raw SM2 hex → GM/T 0010 P7 base64（scca-pkcs7-base64）
   - sealedFields 无 kadmin、无 fieldsSha256（v3 禁止无盐唱标摘要）
   - context 含 submissionId/revision/signingBindingId/signingCertFingerprint
   - fields 固定 {price, amountUnit:'万元', currency:'CNY', deliveryPeriod, qualityCommitment}
   - nonce 16B CSPRNG（32 hex），fieldsCommit = sha256(canonicalJson(fields)+':'+nonce)
   ================================================================= */

import { canonicalJson, sha256Hex } from './canonical';

export type V3Role = 'technical' | 'business' | 'coverLetter' | 'bond';

export interface V3Fields {
  price: string;
  amountUnit: '万元';
  currency: 'CNY';
  deliveryPeriod: string;
  qualityCommitment: string;
}

export interface V3KeyWrapP7 {
  format: 'scca-pkcs7-base64';
  recipientCertFingerprint: string; // 加密证书 sha256
  value: string;                    // P7 Base64
}

export interface V3KeyWrapSM2 {
  format: 'sm2-c1c3c2-hex';
  adminCertId: string;
  value: string; // SM2 C1C3C2 hex
}

export interface DualV3FileEntry {
  assetId: string;
  plainSha256: string; plainBytes: number;
  innerSha256: string; innerBytes: number;
  outerSha256: string; outerBytes: number;
  kself: V3KeyWrapP7;
  kadmin: V3KeyWrapSM2;
}

export interface DualV3SealedFields {
  cipherFormat: 'sm4-cbc-pkcs7-hex';
  cipher: string;
  cipherSha256: string;
  cipherBytes: number;
  kself: V3KeyWrapP7;
}

export interface DualV3Envelope {
  version: 'dual-v3';
  canonicalVersion: 'erp-json-v1';
  provider: 'scca';
  context: {
    projectId: string; supplierId: string;
    submissionId: string; revision: number;
    signingBindingId: string; signingCertFingerprint: string;
  };
  files: Partial<Record<V3Role, DualV3FileEntry>>;
  sealedFields: DualV3SealedFields;
  fieldsCommit: string;
}

export interface BuildV3Input {
  context: DualV3Envelope['context'];
  files: Partial<Record<V3Role, DualV3FileEntry>>;
  sealedFields: DualV3SealedFields;
  fieldsCommit: string;
}

// ─── canonical ───

export async function computeV3FieldsCommit(fields: V3Fields, nonceHex: string): Promise<string> {
  return sha256Hex(`${canonicalJson(fields)}:${nonceHex}`);
}

export function buildV3Envelope(input: BuildV3Input): DualV3Envelope {
  return {
    version: 'dual-v3',
    canonicalVersion: 'erp-json-v1',
    provider: 'scca',
    context: input.context,
    files: input.files,
    sealedFields: input.sealedFields,
    fieldsCommit: input.fieldsCommit,
  };
}

/** keyWrapJson——两种密钥包装共用的内部序列化（键排序 canonicalJson） */
export function keyWrapJson(dek: { keyHex: string; ivHex: string }): string {
  return canonicalJson({ k: dek.keyHex, iv: dek.ivHex });
}

// ─── 严格校验 ───

const HEX32 = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const PRICE_RE = /^(0|[1-9]\d{0,11})(\.\d{1,4})?$/;
const VALID_ROLES = new Set(['technical', 'business', 'coverLetter', 'bond']);

export function validateV3Envelope(env: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!env || typeof env !== 'object') return { ok: false, errors: ['信封非对象'] };
  const e = env as Record<string, unknown>;

  if (e.version !== 'dual-v3') errors.push(`version 应为 'dual-v3'，实际 '${e.version}'`);
  if (e.canonicalVersion !== 'erp-json-v1') errors.push(`canonicalVersion 应为 'erp-json-v1'`);
  if (e.provider !== 'scca') errors.push(`provider 应为 'scca'`);
  if ('fieldsSha256' in e) errors.push('v3 禁止 fieldsSha256（无盐唱标摘要）');

  // context
  const ctx = e.context as Record<string, unknown> | undefined;
  if (!ctx || typeof ctx !== 'object') errors.push('context 缺失');
  else {
    // submissionId 允许空串——首次投递时 submission 尚不存在（服务端 COMMIT 时分配 id）；
    // 其余四键必须非空字符串
    for (const k of ['projectId', 'supplierId', 'signingBindingId', 'signingCertFingerprint'] as const) {
      if (typeof ctx[k] !== 'string' || !ctx[k]) errors.push(`context.${k} 缺失或非字符串`);
    }
    if (typeof ctx.submissionId !== 'string') errors.push('context.submissionId 缺失或非字符串');
    if (typeof ctx.revision !== 'number' || !Number.isInteger(ctx.revision) || ctx.revision < 1) errors.push('context.revision 须正整数');
  }

  // files
  const files = e.files as Record<string, unknown> | undefined;
  if (!files || typeof files !== 'object') errors.push('files 缺失');
  else {
    for (const role of Object.keys(files)) {
      if (!VALID_ROLES.has(role)) { errors.push(`files 含未知角色 '${role}'`); continue; }
      const f = files[role] as Record<string, unknown> | undefined;
      if (!f || typeof f !== 'object') { errors.push(`files.${role} 非对象`); continue; }
      if (typeof f.assetId !== 'string') errors.push(`files.${role}.assetId 缺失`);
      if (typeof f.plainSha256 !== 'string' || !HEX64.test(f.plainSha256)) errors.push(`files.${role}.plainSha256 非 64 hex`);
      if (typeof f.innerSha256 !== 'string' || !HEX64.test(f.innerSha256)) errors.push(`files.${role}.innerSha256 非 64 hex`);
      if (typeof f.outerSha256 !== 'string' || !HEX64.test(f.outerSha256)) errors.push(`files.${role}.outerSha256 非 64 hex`);
      validateKeyWrapP7(f.kself, `files.${role}.kself`, errors);
      validateKeyWrapSM2(f.kadmin, `files.${role}.kadmin`, errors);
    }
  }

  // sealedFields
  const sf = e.sealedFields as Record<string, unknown> | undefined;
  if (!sf || typeof sf !== 'object') errors.push('sealedFields 缺失');
  else {
    if (sf.cipherFormat !== 'sm4-cbc-pkcs7-hex') errors.push('sealedFields.cipherFormat 应为 sm4-cbc-pkcs7-hex');
    if (typeof sf.cipher !== 'string') errors.push('sealedFields.cipher 非字符串');
    if (typeof sf.cipherSha256 !== 'string' || !HEX64.test(sf.cipherSha256)) errors.push('sealedFields.cipherSha256 非 64 hex');
    if ('kadmin' in sf) errors.push('sealedFields 不应含 kadmin（供应商单层密封）');
    if ('fieldsSha256' in sf) errors.push('sealedFields 不应含 fieldsSha256');
    validateKeyWrapP7(sf.kself, 'sealedFields.kself', errors);
  }

  // fieldsCommit
  if (typeof e.fieldsCommit !== 'string' || !HEX64.test(e.fieldsCommit)) errors.push('fieldsCommit 非 64 hex');

  return { ok: errors.length === 0, errors };
}

function validateKeyWrapP7(kw: unknown, path: string, errors: string[]): void {
  if (!kw || typeof kw !== 'object') { errors.push(`${path} 缺失`); return; }
  const o = kw as Record<string, unknown>;
  if (o.format !== 'scca-pkcs7-base64') errors.push(`${path}.format 应为 scca-pkcs7-base64`);
  if (typeof o.recipientCertFingerprint !== 'string' || !HEX64.test(o.recipientCertFingerprint)) errors.push(`${path}.recipientCertFingerprint 非 64 hex`);
  if (typeof o.value !== 'string' || o.value.length < 100) errors.push(`${path}.value 非字符串或过短`);
}

function validateKeyWrapSM2(kw: unknown, path: string, errors: string[]): void {
  if (!kw || typeof kw !== 'object') { errors.push(`${path} 缺失`); return; }
  const o = kw as Record<string, unknown>;
  if (o.format !== 'sm2-c1c3c2-hex') errors.push(`${path}.format 应为 sm2-c1c3c2-hex`);
  if (typeof o.adminCertId !== 'string' || !o.adminCertId) errors.push(`${path}.adminCertId 缺失`);
  if (typeof o.value !== 'string') errors.push(`${path}.value 非字符串`);
}

// ─── price 校验 ───

export function validateV3Price(price: string): boolean {
  return PRICE_RE.test(price);
}
