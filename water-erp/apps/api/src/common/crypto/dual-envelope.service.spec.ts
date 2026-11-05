/* DualEnvelopeService —— 服务端验签/解外层/fieldsCommit 双闸（双信封 v2 · Phase 2）
   加密样本按生产侧语义构造（spec §4 与 Task 11 encryptAndUploadFile 同款）：
     M → C_inner = SM4(DEK_S, M) → C_outer = SM4(DEK_A, C_inner)
     kself  = sm2EncryptHex(供应商证书公钥, hex(wrapDekJson(DEK_S)))
     kadmin = sm2EncryptHex(管理方加密证书公钥, hex(wrapDekJson(DEK_A)))
   加密 helper 全部复用 @water-erp/ukey 生产函数（非被测服务自身），杜绝自证循环。 */
import { BadRequestException } from '@nestjs/common';
import {
  canonicalEnvelopeHash,
  canonicalJson,
  computeFieldsCommit,
  randomHex,
  sha256Hex,
  signEnvelopeMsg,
  sm2EncryptHex,
  sm4Decrypt,
  sm4Encrypt,
  SM4_CHUNK_BYTES,
  wrapDekJson,
} from '@water-erp/ukey';
import type { DualEnvelope, DualV3FileEntry, SealedFields } from '@water-erp/ukey';
import { DualEnvelopeService } from './dual-envelope.service';
import { SignatureService } from './signature.service';

const sm2 = require('sm-crypto').sm2;

interface Kp {
  publicKey: string;
  privateKey: string;
}
interface Dek {
  keyHex: string;
  ivHex: string;
}
interface DualLayerSample {
  dekA: Dek;
  dekS: Dek;
  cInner: Buffer;
  cOuter: Buffer;
  kself: string;
  kadmin: string;
}

/** 生产侧双层加密：明文 M → C_inner(SM4/DEK_S) → C_outer(SM4/DEK_A)，附带两把密封件。
 *  dekA/dekS 可传固定值（确定性损坏用例需要：C_outer 尾块明文依赖 C_inner 尾字节，而 C_inner 随 DEK_S 变）。 */
function buildDualLayerSample(
  adminKp: Pick<Kp, 'publicKey'>,
  supplierKp: Pick<Kp, 'publicKey'>,
  plaintext: Buffer,
  dekA?: Dek,
  dekS?: Dek,
): DualLayerSample {
  const keyA: Dek = dekA ?? { keyHex: randomHex(16), ivHex: randomHex(16) };
  const keyS: Dek = dekS ?? { keyHex: randomHex(16), ivHex: randomHex(16) };
  const cInnerHex = sm4Encrypt(keyS.keyHex, keyS.ivHex, plaintext.toString('hex')); // C_inner = SM4(DEK_S, M)
  const cOuterHex = sm4Encrypt(keyA.keyHex, keyA.ivHex, cInnerHex); // C_outer = SM4(DEK_A, C_inner)
  return {
    dekA: keyA,
    dekS: keyS,
    cInner: Buffer.from(cInnerHex, 'hex'),
    cOuter: Buffer.from(cOuterHex, 'hex'),
    kself: sm2EncryptHex(supplierKp.publicKey, Buffer.from(wrapDekJson(keyS), 'utf8').toString('hex')),
    kadmin: sm2EncryptHex(adminKp.publicKey, Buffer.from(wrapDekJson(keyA), 'utf8').toString('hex')),
  };
}

/** 真实 canonical 结构 envelope：六字段齐备，sealedFields 也按 spec §4 真加密。 */
async function buildEnvelope(
  sample: DualLayerSample,
  plaintext: Buffer,
  fields: SealedFields,
  nonce: string,
  supplierKp: Pick<Kp, 'publicKey'>,
): Promise<DualEnvelope> {
  const dekF: Dek = { keyHex: randomHex(16), ivHex: randomHex(16) };
  return {
    version: 'dual-v2',
    certSn: 'MOCK-CERT-8801',
    adminCertId: 'cert-admin-1',
    files: {
      technical: { sha256: await sha256Hex(plaintext), kself: sample.kself, kadmin: sample.kadmin },
    },
    sealedFields: {
      cipher: sm4Encrypt(
        dekF.keyHex,
        dekF.ivHex,
        Buffer.from(canonicalJson({ fields, nonce }), 'utf8').toString('hex'),
      ),
      kself: sm2EncryptHex(supplierKp.publicKey, Buffer.from(wrapDekJson(dekF), 'utf8').toString('hex')),
      fieldsSha256: await sha256Hex(canonicalJson(fields)),
    },
    fieldsCommit: await computeFieldsCommit(fields, nonce),
  };
}

/** 断言同步抛 BadRequestException 且 getResponse() 形如 { error, code }（Nest 11 对象入参原样透出）。
 *  threw 标志模式：jest-circus（Jest 30 默认）无全局 fail()，且 try 内自抛会被本 catch 吞掉。 */
function expectBizError(fn: () => unknown, error: string, code: string): void {
  let err: unknown = null;
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    err = e;
  }
  expect(threw).toBe(true);
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as BadRequestException).getResponse()).toMatchObject({ error, code });
}

async function expectBizErrorAsync(fn: () => Promise<unknown>, error: string, code: string): Promise<void> {
  let err: unknown = null;
  let threw = false;
  try {
    await fn();
  } catch (e) {
    threw = true;
    err = e;
  }
  expect(threw).toBe(true);
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as BadRequestException).getResponse()).toMatchObject({ error, code });
}

const OUTER_FAILED = { error: '外层解密失败（管理方私钥不匹配或信封损坏）', code: 'OUTER_DECRYPT_FAILED' };
const INCOMPLETE = { error: '信封缺少角色密封件或哈希不符', code: 'ENVELOPE_INCOMPLETE' };
// 与 bid-decrypt.service.ts pass1 前置闸同码同文案（pass2 源字节再散列闸 · 终审二轮）
const OUTER_HASH_MISMATCH = { error: '外层密文哈希与信封声明不符（疑似暂存件被调包）', code: 'OUTER_HASH_MISMATCH' };

const FIELDS: SealedFields = { price: '15800000.00', deliveryPeriod: '540', qualityCommitment: '合格' };
const NONCE = 'n-20260820-0001';

describe('DualEnvelopeService', () => {
  let svc: DualEnvelopeService;
  let adminKp: Kp;
  let supplierKp: Kp;
  let plaintext: Buffer;
  let sample: DualLayerSample;
  let envelope: DualEnvelope;

  beforeAll(async () => {
    svc = new DualEnvelopeService(new SignatureService());
    adminKp = sm2.generateKeyPairHex();
    supplierKp = sm2.generateKeyPairHex();
    // 混入无效 utf8 序列字节——钉住 hex 字节通道精确性（sm-crypto 字符串通道对无效序列 U+FFFD 有损）
    plaintext = Buffer.concat([
      Buffer.from('技术标投标文件（正本）—蜀水云采·智慧水发', 'utf8'),
      Buffer.from([0xff, 0x80, 0x00, 0x42]),
    ]);
    sample = buildDualLayerSample(adminKp, supplierKp, plaintext);
    envelope = await buildEnvelope(sample, plaintext, FIELDS, NONCE, supplierKp);
  });

  describe('decryptOuterFile', () => {
    it('剥掉管理方外层还原 C_inner（真实双层 roundtrip：再以 DEK_S 解内层得原文）', async () => {
      const cInner = await svc.decryptOuterFile(envelope, 'technical', sample.cOuter, adminKp.privateKey);
      expect(cInner).toEqual(sample.cInner);
      // C_inner 仍是供应商密文——平台解外层拿不到明文（保密屏障在内层）
      expect(cInner.equals(plaintext)).toBe(false);
      // 供应商侧 kself 解出 DEK_S 再解 C_inner → 原文（全链路真实往返）
      expect(
        Buffer.from(sm4Decrypt(sample.dekS.keyHex, sample.dekS.ivHex, cInner.toString('hex')), 'hex'),
      ).toEqual(plaintext);
    });

    it('缺角色条目 → 400 OUTER_DECRYPT_FAILED', async () => {
      await expectBizErrorAsync(
        () => svc.decryptOuterFile(envelope, 'business', sample.cOuter, adminKp.privateKey),
        OUTER_FAILED.error,
        OUTER_FAILED.code,
      );
    });

    it('管理方私钥不匹配（sm2DecryptHex 返回 \'\'）→ 400 OUTER_DECRYPT_FAILED', async () => {
      const wrongKp: Kp = sm2.generateKeyPairHex();
      await expectBizErrorAsync(
        () => svc.decryptOuterFile(envelope, 'technical', sample.cOuter, wrongKp.privateKey),
        OUTER_FAILED.error,
        OUTER_FAILED.code,
      );
    });

    it('kadmin 损坏（垃圾 hex）→ 400 OUTER_DECRYPT_FAILED', async () => {
      const bad: DualEnvelope = {
        ...envelope,
        files: { technical: { ...envelope.files.technical!, kadmin: 'deadbeefdeadbeef' } },
      };
      await expectBizErrorAsync(
        () => svc.decryptOuterFile(bad, 'technical', sample.cOuter, adminKp.privateKey),
        OUTER_FAILED.error,
        OUTER_FAILED.code,
      );
    });

    it('kadmin 解出的不是合法 DEK JSON（语法非法 → JSON.parse 抛错）→ 400 OUTER_DECRYPT_FAILED', async () => {
      const bad: DualEnvelope = {
        ...envelope,
        files: {
          technical: {
            ...envelope.files.technical!,
            kadmin: sm2EncryptHex(adminKp.publicKey, Buffer.from('not-json', 'utf8').toString('hex')),
          },
        },
      };
      await expectBizErrorAsync(
        () => svc.decryptOuterFile(bad, 'technical', sample.cOuter, adminKp.privateKey),
        OUTER_FAILED.error,
        OUTER_FAILED.code,
      );
    });

    it('kadmin 解出合法 JSON 但缺 k/iv 字段（unwrapDekJson 返回 undefined 字段、不抛）→ 守卫拦截 400 OUTER_DECRYPT_FAILED', async () => {
      const bad: DualEnvelope = {
        ...envelope,
        files: {
          technical: {
            ...envelope.files.technical!,
            kadmin: sm2EncryptHex(adminKp.publicKey, Buffer.from('{"k":"0011"}', 'utf8').toString('hex')),
          },
        },
      };
      await expectBizErrorAsync(
        () => svc.decryptOuterFile(bad, 'technical', sample.cOuter, adminKp.privateKey),
        OUTER_FAILED.error,
        OUTER_FAILED.code,
      );
    });

    it('C_outer 损坏（sm4Decrypt padding 抛错收口）→ 400 OUTER_DECRYPT_FAILED', async () => {
      // 固定 DEK_A+DEK_S+明文使损坏结果完全确定：C_outer 尾块明文依赖 C_inner 尾字节，而
      // C_inner 随 DEK_S 变——只固定 DEK_A 时篡改结果仍伪随机（padding 偶然合法 ~1/256 → 偶发红）
      const fixedPlaintext = Buffer.from('feedbeefcafebabe', 'hex');
      const fixedDekA: Dek = {
        keyHex: '0123456789abcdeffedcba9876543210',
        ivHex: '00112233445566778899aabbccddeeff',
      };
      const fixedDekS: Dek = {
        keyHex: '00112233445566778899aabbccddeeff',
        ivHex: 'ffeeddccbbaa99887766554433221100',
      };
      const fixed = buildDualLayerSample(adminKp, supplierKp, fixedPlaintext, fixedDekA, fixedDekS);
      const env = await buildEnvelope(fixed, fixedPlaintext, FIELDS, NONCE, supplierKp);
      const tampered = Buffer.from(fixed.cOuter);
      tampered[tampered.length - 1] ^= 0x5a; // 破坏最后一个密文块 → padding 校验失败
      await expectBizErrorAsync(
        () => svc.decryptOuterFile(env, 'technical', tampered, adminKp.privateKey),
        OUTER_FAILED.error,
        OUTER_FAILED.code,
      );
    });
  });

  /* ═══ dual-v3 流式解外层（unwrapOuterDekV3 / decryptOuterStreamV3 · Task 11）
     C_outer 按 AsyncIterable 分块喂入（minio getObject 流形态），输出经 onPlainChunk
     外送——与整读版 decryptOuterFileV3 逐字节同源（Sm4CbcChunkedDecryptor 一致性闸）。 ═══ */
  describe('dual-v3 流式解外层（Task 11 分块化）', () => {
    const dekA: Dek = { keyHex: randomHex(16), ivHex: randomHex(16) };
    // webcrypto getRandomValues 单次上限 64KB——分段取随机再拼接
    const rand = (n: number): Buffer => {
      const parts: Buffer[] = [];
      for (let left = n; left > 0; ) {
        const take = Math.min(left, 65536);
        parts.push(Buffer.from(randomHex(take), 'hex'));
        left -= take;
      }
      return Buffer.concat(parts);
    };
    // >2MB 随机 C_inner（跨 2MB 标准块边界）+ 无效 utf8 序列尾——外层解密的输出即 C_inner
    const cInner = Buffer.concat([
      rand(SM4_CHUNK_BYTES + 256 * 1024),
      Buffer.from([0xff, 0x80, 0x00, 0x42]),
    ]);
    const cOuter = Buffer.from(sm4Encrypt(dekA.keyHex, dekA.ivHex, cInner.toString('hex')), 'hex');
    const v3Entry = (): DualV3FileEntry => ({
      assetId: 'fa-v3-1',
      plainSha256: 'p'.repeat(64), plainBytes: 1,
      innerSha256: 'i'.repeat(64), innerBytes: 2,
      outerSha256: 'o'.repeat(64), outerBytes: cOuter.length,
      kself: { format: 'scca-pkcs7-base64', recipientCertFingerprint: 'f'.repeat(64), value: 'MIIB.' },
      kadmin: {
        format: 'sm2-c1c3c2-hex', adminCertId: 'cert-admin-1',
        value: sm2EncryptHex(adminKp.publicKey, Buffer.from(wrapDekJson(dekA), 'utf8').toString('hex')),
      },
    });
    /** 按固定 64KB 分块喂入 C_outer（AsyncIterable 契约；末段为非对齐余量） */
    async function* feedCOuter(chunkSize = 64 * 1024): AsyncGenerator<Buffer> {
      for (let i = 0; i < cOuter.length; i += chunkSize) {
        yield cOuter.subarray(i, Math.min(i + chunkSize, cOuter.length));
      }
    }

    it('unwrapOuterDekV3：v3 对象形态 kadmin 解封 → { keyHex, ivHex }（既有 SM2 密钥对闭环）', async () => {
      await expect(svc.unwrapOuterDekV3(v3Entry(), adminKp.privateKey)).resolves.toEqual(dekA);
    });

    it('unwrapOuterDekV3：错私钥（sm2DecryptHex 返回 \'\'）→ 400 OUTER_DECRYPT_FAILED（与整读版同语义）', async () => {
      await expectBizErrorAsync(
        () => svc.unwrapOuterDekV3(v3Entry(), sm2.generateKeyPairHex().privateKey),
        OUTER_FAILED.error,
        OUTER_FAILED.code,
      );
    });

    it('unwrapOuterDekV3：kadmin.value 缺失 → 400 OUTER_DECRYPT_FAILED', async () => {
      const bad = { ...v3Entry(), kadmin: { ...v3Entry().kadmin, value: '' } } as DualV3FileEntry;
      await expectBizErrorAsync(
        () => svc.unwrapOuterDekV3(bad, adminKp.privateKey),
        OUTER_FAILED.error,
        OUTER_FAILED.code,
      );
    });

    it('decryptOuterStreamV3：>2MB 跨块分块喂入 → onPlainChunk 拼接 == C_inner、plainBytes/plainSha256 与整算一致（源哈希闸诚实放行）', async () => {
      const pieces: Buffer[] = [];
      // 第 4 参=源字节真实哈希（诚实件）——末尾比对通过，正常返回（TOCTOU 闸不误伤）
      const r = await svc.decryptOuterStreamV3(feedCOuter(), dekA, (b) => pieces.push(b), await sha256Hex(cOuter));
      expect(Buffer.concat(pieces)).toEqual(cInner);
      expect(r.plainBytes).toBe(cInner.length);
      expect(r.plainSha256).toBe(await sha256Hex(cInner)); // 整算独立口径（Node 全量哈希，非被测增量实现）
    });

    it('decryptOuterStreamV3 与整读版 decryptOuterFileV3 输出逐字节一致（两轨同源）', async () => {
      const whole = await svc.decryptOuterFileV3(v3Entry(), cOuter, adminKp.privateKey);
      const pieces: Buffer[] = [];
      await svc.decryptOuterStreamV3(feedCOuter(), dekA, (b) => pieces.push(b), await sha256Hex(cOuter));
      expect(Buffer.concat(pieces)).toEqual(whole);
    });

    it('decryptOuterStreamV3：源字节哈希 ≠ 信封声明（两遍读之间被调包但仍是合法密文）→ 末尾比对拒 400 OUTER_HASH_MISMATCH（TOCTOU 闭合）', async () => {
      // 喂真实合法 C_outer（解密本身成功、final() 正常）——失配只可能来自源哈希闸，
      // 钉死「闸在解密完成之后比对源字节」的语义（区别于解密失败的 OUTER_DECRYPT_FAILED）
      await expectBizErrorAsync(
        () => svc.decryptOuterStreamV3(feedCOuter(), dekA, () => {}, 'e'.repeat(64)),
        OUTER_HASH_MISMATCH.error,
        OUTER_HASH_MISMATCH.code,
      );
    });

    it('decryptOuterStreamV3：密文翻转一字节（末块，固定 DEK+固定件保证确定性）→ 400 OUTER_DECRYPT_FAILED', async () => {
      // 随机件有微小概率伪合法填充 → 偶发红；镜像 decryptOuterFile 损坏用例的固定值手法
      const fixedDekA: Dek = {
        keyHex: '0123456789abcdeffedcba9876543210',
        ivHex: '00112233445566778899aabbccddeeff',
      };
      const fixedInner = Buffer.from('feedbeefcafebabe', 'hex');
      const fixedOuter = Buffer.from(
        sm4Encrypt(fixedDekA.keyHex, fixedDekA.ivHex, fixedInner.toString('hex')),
        'hex',
      );
      const tampered = Buffer.from(fixedOuter);
      tampered[tampered.length - 1] ^= 0x5a; // 破坏最后一个密文块 → PKCS#7 校验失败
      async function* feed(): AsyncGenerator<Buffer> {
        yield tampered.subarray(0, 16);
        yield tampered.subarray(16);
      }
      const fedSha = await sha256Hex(tampered); // 第 4 参=所喂字节的真哈希——本用例只钉解密失败路径，源哈希闸不背锅
      await expectBizErrorAsync(
        () => svc.decryptOuterStreamV3(feed(), fixedDekA, () => {}, fedSha),
        OUTER_FAILED.error,
        OUTER_FAILED.code,
      );
    });

    it('decryptOuterStreamV3：密文截断（非 16B 对齐）→ 400 OUTER_DECRYPT_FAILED', async () => {
      const truncated = cOuter.subarray(0, cOuter.length - 1);
      async function* feed(): AsyncGenerator<Buffer> {
        yield truncated;
      }
      const fedSha = await sha256Hex(truncated); // 解密失败先于源哈希比对收口（两闸互不背锅）
      await expectBizErrorAsync(
        () => svc.decryptOuterStreamV3(feed(), dekA, () => {}, fedSha),
        OUTER_FAILED.error,
        OUTER_FAILED.code,
      );
    });
  });

  describe('verifySignature', () => {
    it('供应商证书私钥对规范哈希签名 → 验签通过', async () => {
      const sig = signEnvelopeMsg(await canonicalEnvelopeHash(envelope), supplierKp.privateKey);
      await expect(svc.verifySignature(envelope, sig, supplierKp.publicKey)).resolves.toBe(true);
    });

    it('错公钥（管理方证书公钥）→ 验签失败', async () => {
      const sig = signEnvelopeMsg(await canonicalEnvelopeHash(envelope), supplierKp.privateKey);
      await expect(svc.verifySignature(envelope, sig, adminKp.publicKey)).resolves.toBe(false);
    });

    it('篡改信封（fieldsCommit 被换）→ 验签失败', async () => {
      const sig = signEnvelopeMsg(await canonicalEnvelopeHash(envelope), supplierKp.privateKey);
      const tampered: DualEnvelope = { ...envelope, fieldsCommit: 'a'.repeat(64) };
      await expect(svc.verifySignature(tampered, sig, supplierKp.publicKey)).resolves.toBe(false);
    });

    it('公钥格式非法（非 04 前缀 130 hex）→ false 不进入验签', async () => {
      const sig = signEnvelopeMsg(await canonicalEnvelopeHash(envelope), supplierKp.privateKey);
      await expect(svc.verifySignature(envelope, sig, supplierKp.publicKey.slice(2))).resolves.toBe(false);
    });
  });

  describe('assertEnvelopeIntact', () => {
    it('角色条目齐全且哈希相符 → 不抛', () => {
      expect(() =>
        svc.assertEnvelopeIntact(envelope, [
          { role: 'technical', sha256: envelope.files.technical!.sha256 },
        ]),
      ).not.toThrow();
    });

    it('信封缺角色条目 → 400 ENVELOPE_INCOMPLETE', () => {
      expectBizError(
        () => svc.assertEnvelopeIntact(envelope, [{ role: 'business', sha256: 'ab'.repeat(32) }]),
        INCOMPLETE.error,
        INCOMPLETE.code,
      );
    });

    it('声明哈希与信封不符 → 400 ENVELOPE_INCOMPLETE', () => {
      expectBizError(
        () => svc.assertEnvelopeIntact(envelope, [{ role: 'technical', sha256: 'cd'.repeat(32) }]),
        INCOMPLETE.error,
        INCOMPLETE.code,
      );
    });
  });

  describe('verifyFieldsCommit', () => {
    it('正确 fields+nonce → true', async () => {
      await expect(svc.verifyFieldsCommit(FIELDS, NONCE, envelope.fieldsCommit)).resolves.toBe(true);
    });

    it('篡改 fields（price）→ false', async () => {
      await expect(
        svc.verifyFieldsCommit({ ...FIELDS, price: '1.00' }, NONCE, envelope.fieldsCommit),
      ).resolves.toBe(false);
    });

    it('篡改 nonce → false', async () => {
      await expect(svc.verifyFieldsCommit(FIELDS, 'n-20260820-9999', envelope.fieldsCommit)).resolves.toBe(false);
    });
  });
});
