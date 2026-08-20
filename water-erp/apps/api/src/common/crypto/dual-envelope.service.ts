import { BadRequestException, Injectable } from '@nestjs/common';
import {
  canonicalEnvelopeHash,
  computeFieldsCommit,
  sm2DecryptHex,
  sm4Decrypt,
  unwrapDekJson,
  verifyEnvelopeMsg,
} from '@water-erp/ukey';
import type { DualEnvelope, EnvelopeRole, SealedFields } from '@water-erp/ukey';
import { SignatureService } from './signature.service';

/* =================================================================
   DualEnvelopeService — 双信封 v2 服务端原语
   （纯组合 @water-erp/ukey 生产函数；无状态、无 prisma 依赖）

   消费方：submitBid 验签（T9）、主持端 decrypt-outer（T12）、
   供应商 decrypt-upload 双闸（T13）。

   失败语义（Task 2 实测契约）：
   - sm2DecryptHex 解密失败返回 ''（sm-crypto 从不抛错）→ 必须判 ''；
   - sm4Decrypt 密文损坏抛错（padding invalid）→ 链内 try/catch 收口。
   decryptOuterFile 把两者连同缺条目/坏 JSON 统一转为同一 400，
   调用方（开标现场）无需区分具体断点。
   ================================================================= */
@Injectable()
export class DualEnvelopeService {
  constructor(private readonly signature: SignatureService) {}

  /** 供应商证书私钥对 envelope 规范哈希的 SM2 签名验签（canonicalEnvelopeHash → verifyEnvelopeMsg）。 */
  async verifySignature(envelope: DualEnvelope, signature: string, certPublicKey: string): Promise<boolean> {
    // 公钥格式先按 SignatureService.isValidPublicKey 收口——与 bindCert 同一正则口径，杜绝复制漂移
    if (!signature || !this.signature.isValidPublicKey(certPublicKey)) return false;
    const msg = await canonicalEnvelopeHash(envelope);
    return verifyEnvelopeMsg(msg, signature, certPublicKey);
  }

  /**
   * 逐角色核对信封密封件：envelope.files[role] 须有条目，且 sha256（明文哈希）
   * 与投递声明一致。缺失/不符同码（ENVELOPE_INCOMPLETE），调用方无需区分。
   */
  assertEnvelopeIntact(envelope: DualEnvelope, declared: Array<{ role: EnvelopeRole; sha256: string }>): void {
    for (const { role, sha256 } of declared) {
      const entry = envelope.files[role];
      if (!entry || entry.sha256 !== sha256) {
        throw new BadRequestException(INCOMPLETE);
      }
    }
  }

  /**
   * 剥掉管理方外层：SM2 解 kadmin → DEK_A → SM4 解 C_outer → C_inner（Buffer）。
   * 只剥外层——C_inner 仍是供应商密文，平台开标前不可读内容（保密屏障在内层）。
   */
  async decryptOuterFile(
    envelope: DualEnvelope,
    role: EnvelopeRole,
    outerBuf: Buffer,
    adminPrivateKey: string,
  ): Promise<Buffer> {
    const entry = envelope.files[role];
    if (!entry?.kadmin) throw new BadRequestException(OUTER_FAILED);
    try {
      const wrapDekHex = sm2DecryptHex(adminPrivateKey, entry.kadmin);
      if (!wrapDekHex) throw new Error('sm2 decrypt failed'); // ''=失败（sm-crypto 从不抛错）
      const dek = unwrapDekJson(Buffer.from(wrapDekHex, 'hex').toString('utf8')); // 坏 JSON 抛错
      if (!dek.keyHex || !dek.ivHex) throw new Error('bad dek');
      const cInnerHex = sm4Decrypt(dek.keyHex, dek.ivHex, outerBuf.toString('hex')); // 密文损坏抛错
      if (!cInnerHex) throw new Error('sm4 decrypt empty');
      return Buffer.from(cInnerHex, 'hex');
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(OUTER_FAILED);
    }
  }

  /** fieldsCommit 双闸：sha256(canonicalJson(fields) + ':' + nonce) 比对（防开标时篡改报价字段/重放 nonce）。 */
  async verifyFieldsCommit(fields: SealedFields, nonce: string, commit: string): Promise<boolean> {
    return (await computeFieldsCommit(fields, nonce)) === commit;
  }
}

const INCOMPLETE = { error: '信封缺少角色密封件或哈希不符', code: 'ENVELOPE_INCOMPLETE' } as const;
const OUTER_FAILED = { error: '外层解密失败（管理方私钥不匹配或信封损坏）', code: 'OUTER_DECRYPT_FAILED' } as const;
