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
  wrapDekJson,
} from '@water-erp/ukey';
import type { DualEnvelope, SealedFields } from '@water-erp/ukey';
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

/** 生产侧双层加密：明文 M → C_inner(SM4/DEK_S) → C_outer(SM4/DEK_A)，附带两把密封件。 */
function buildDualLayerSample(
  adminKp: Pick<Kp, 'publicKey'>,
  supplierKp: Pick<Kp, 'publicKey'>,
  plaintext: Buffer,
  dekA?: Dek,
): DualLayerSample {
  const keyA: Dek = dekA ?? { keyHex: randomHex(16), ivHex: randomHex(16) };
  const dekS: Dek = { keyHex: randomHex(16), ivHex: randomHex(16) };
  const cInnerHex = sm4Encrypt(dekS.keyHex, dekS.ivHex, plaintext.toString('hex')); // C_inner = SM4(DEK_S, M)
  const cOuterHex = sm4Encrypt(keyA.keyHex, keyA.ivHex, cInnerHex); // C_outer = SM4(DEK_A, C_inner)
  return {
    dekA: keyA,
    dekS,
    cInner: Buffer.from(cInnerHex, 'hex'),
    cOuter: Buffer.from(cOuterHex, 'hex'),
    kself: sm2EncryptHex(supplierKp.publicKey, Buffer.from(wrapDekJson(dekS), 'utf8').toString('hex')),
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

/** 断言同步抛 BadRequestException 且 getResponse() 形如 { error, code }（Nest 11 对象入参原样透出）。 */
function expectBizError(fn: () => unknown, error: string, code: string): void {
  try {
    fn();
    fail(`应抛 BadRequestException ${code}`);
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    expect((e as BadRequestException).getResponse()).toMatchObject({ error, code });
  }
}

async function expectBizErrorAsync(fn: () => Promise<unknown>, error: string, code: string): Promise<void> {
  try {
    await fn();
    fail(`应抛 BadRequestException ${code}`);
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    expect((e as BadRequestException).getResponse()).toMatchObject({ error, code });
  }
}

const OUTER_FAILED = { error: '外层解密失败（管理方私钥不匹配或信封损坏）', code: 'OUTER_DECRYPT_FAILED' };
const INCOMPLETE = { error: '信封缺少角色密封件或哈希不符', code: 'ENVELOPE_INCOMPLETE' };

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
      Buffer.from('技术标投标文件（正本）—智慧水发·蜀水云采', 'utf8'),
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

    it('kadmin 解出的不是合法 DEK JSON → 400 OUTER_DECRYPT_FAILED', async () => {
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

    it('C_outer 损坏（sm4Decrypt padding 抛错收口）→ 400 OUTER_DECRYPT_FAILED', async () => {
      // 固定 DEK/明文使损坏结果确定（随机 DEK 下 padding 偶然合法概率约 1%，会引入偶发绿）
      const fixedPlaintext = Buffer.from('feedbeefcafebabe', 'hex');
      const fixedDekA: Dek = {
        keyHex: '0123456789abcdeffedcba9876543210',
        ivHex: '00112233445566778899aabbccddeeff',
      };
      const fixed = buildDualLayerSample(adminKp, supplierKp, fixedPlaintext, fixedDekA);
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
