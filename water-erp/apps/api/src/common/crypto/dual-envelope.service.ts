import { BadRequestException, Injectable } from '@nestjs/common';
import {
  canonicalEnvelopeHash,
  computeFieldsCommit,
  Sha256Incremental,
  Sm4CbcChunkedDecryptor,
  sm2DecryptHex,
  sm4Decrypt,
  unwrapDekJson,
  verifyEnvelopeMsg,
} from '@water-erp/ukey';
import type { DualEnvelope, EnvelopeRole, SealedFields, DualV3FileEntry } from '@water-erp/ukey';
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
      // unwrapDekJson 失败两态：语法非法 JSON → JSON.parse 抛错（落入外层 catch）；
      // 合法 JSON 但缺 k/iv 字段 → 不抛、返回 undefined 字段——由下方守卫拦截，勿删
      const dek = unwrapDekJson(Buffer.from(wrapDekHex, 'hex').toString('utf8'));
      if (!dek?.keyHex || !dek?.ivHex) throw new Error('bad dek');
      const cInnerHex = sm4Decrypt(dek.keyHex, dek.ivHex, outerBuf.toString('hex')); // 密文损坏抛错
      if (!cInnerHex) throw new Error('sm4 decrypt empty');
      return Buffer.from(cInnerHex, 'hex');
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(OUTER_FAILED);
    }
  }

  /**
   * dual-v3 剥外层（Task10）：kadmin 为对象形态（V3KeyWrapSM2{format,adminCertId,value}），
   * SM2 解 kadmin.value → DEK_A → SM4 解 C_outer → C_inner。与 decryptOuterFile 同原语，
   * 差异仅 kadmin 取值路径（v2=裸 hex 字符串，v3=对象.value）。
   */
  async decryptOuterFileV3(entry: DualV3FileEntry, outerBuf: Buffer, adminPrivateKey: string): Promise<Buffer> {
    if (!entry?.kadmin?.value) throw new BadRequestException(OUTER_FAILED);
    try {
      const wrapDekHex = sm2DecryptHex(adminPrivateKey, entry.kadmin.value);
      if (!wrapDekHex) throw new Error('sm2 decrypt failed');
      const dek = unwrapDekJson(Buffer.from(wrapDekHex, 'hex').toString('utf8'));
      if (!dek?.keyHex || !dek?.ivHex) throw new Error('bad dek');
      const cInnerHex = sm4Decrypt(dek.keyHex, dek.ivHex, outerBuf.toString('hex'));
      if (!cInnerHex) throw new Error('sm4 decrypt empty');
      return Buffer.from(cInnerHex, 'hex');
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(OUTER_FAILED);
    }
  }

  /**
   * dual-v3 外层 DEK_A 解封（Task 11）：SM2 解 kadmin.value → unwrapDekJson → { keyHex, ivHex }。
   * decryptOuterFileV3 前半段独立成方法，供两遍流式解密（先哈希闸后解密）的 pass2 复用；
   * 失败语义与整读版完全一致（''、坏 JSON、缺 k/iv 字段统一收口 OUTER_FAILED）。
   */
  async unwrapOuterDekV3(entry: DualV3FileEntry, adminPrivateKey: string): Promise<{ keyHex: string; ivHex: string }> {
    if (!entry?.kadmin?.value) throw new BadRequestException(OUTER_FAILED);
    try {
      const wrapDekHex = sm2DecryptHex(adminPrivateKey, entry.kadmin.value);
      if (!wrapDekHex) throw new Error('sm2 decrypt failed'); // ''=失败（sm-crypto 从不抛错）
      // unwrapDekJson 失败两态与 decryptOuterFile 同：语法非法 → JSON.parse 抛错（落入 catch）；
      // 合法 JSON 缺 k/iv 字段 → 返回 undefined 字段——由下方守卫拦截，勿删
      const dek = unwrapDekJson(Buffer.from(wrapDekHex, 'hex').toString('utf8'));
      if (!dek?.keyHex || !dek?.ivHex) throw new Error('bad dek');
      return { keyHex: dek.keyHex, ivHex: dek.ivHex };
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(OUTER_FAILED);
    }
  }

  /**
   * dual-v3 外层流式解密（Task 11）：AsyncIterable<Buffer> 喂 Sm4CbcChunkedDecryptor（滚动
   * IV 续链，累计输出与 one-shot sm4Decrypt 逐字节一致），解出的明文段（=C_inner 密文）经
   * onPlainChunk 外送，同时增量哈希+计数。全程只持分块缓冲——500MB C_outer 不整驻内存。
   * PKCS#7 非法/密文截断 → OUTER_FAILED（与整读版同语义）；流自身的读错误不在此收口——
   * 存储故障保持原始错误（解密失败归因链路据此判定 BIDDER/PLATFORM，勿伪装）。
   */
  async decryptOuterStreamV3(
    outerStream: AsyncIterable<Buffer>,
    dek: { keyHex: string; ivHex: string },
    onPlainChunk: (b: Buffer) => void,
  ): Promise<{ plainBytes: number; plainSha256: string }> {
    const decryptor = new Sm4CbcChunkedDecryptor(dek);
    const hasher = new Sha256Incremental();
    let plainBytes = 0;
    const emit = (run: () => Uint8Array): void => {
      let plain: Uint8Array;
      try {
        plain = run();
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
        throw new BadRequestException(OUTER_FAILED);
      }
      if (plain.length === 0) return;
      hasher.update(plain);
      plainBytes += plain.length;
      // 解密器返回段恒为新分配（无缓冲复用）——视图包装零拷贝移交回调持有
      onPlainChunk(Buffer.from(plain.buffer, plain.byteOffset, plain.byteLength));
    };
    for await (const chunk of outerStream) {
      emit(() => decryptor.update(chunk));
    }
    emit(() => decryptor.final());
    return { plainBytes, plainSha256: hasher.finalHex() };
  }

  /** fieldsCommit 双闸：sha256(canonicalJson(fields) + ':' + nonce) 比对（防开标时篡改报价字段/重放 nonce）。 */
  async verifyFieldsCommit(fields: SealedFields, nonce: string, commit: string): Promise<boolean> {
    return (await computeFieldsCommit(fields, nonce)) === commit;
  }
}

const INCOMPLETE = { error: '信封缺少角色密封件或哈希不符', code: 'ENVELOPE_INCOMPLETE' } as const;
const OUTER_FAILED = { error: '外层解密失败（管理方私钥不匹配或信封损坏）', code: 'OUTER_DECRYPT_FAILED' } as const;
