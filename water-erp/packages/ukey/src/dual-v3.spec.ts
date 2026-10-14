import {
  DualV3Envelope, V3Fields, computeV3FieldsCommit, buildV3Envelope,
  validateV3Envelope, keyWrapJson, validateV3Price,
} from './dual-v3';
import { canonicalJson, sha256Hex } from './canonical';

const TEST_NONCE = 'a'.repeat(32);
const TEST_FIELDS: V3Fields = {
  price: '100', amountUnit: '万元', currency: 'CNY',
  deliveryPeriod: '30天', qualityCommitment: '合格',
};

function makeTestFileEntry(role: string): { assetId: string; plainSha256: string; plainBytes: number; innerSha256: string; innerBytes: number; outerSha256: string; outerBytes: number; kself: { format: 'scca-pkcs7-base64'; recipientCertFingerprint: string; value: string }; kadmin: { format: 'sm2-c1c3c2-hex'; adminCertId: string; value: string } } {
  return {
    assetId: `asset-${role}`,
    plainSha256: 'aa'.repeat(32), plainBytes: 1024,
    innerSha256: 'bb'.repeat(32), innerBytes: 1040,
    outerSha256: 'cc'.repeat(32), outerBytes: 1056,
    kself: { format: 'scca-pkcs7-base64', recipientCertFingerprint: 'dd'.repeat(32), value: 'MII'.padEnd(200, 'X') },
    kadmin: { format: 'sm2-c1c3c2-hex', adminCertId: 'admin-cert-1', value: '04' + 'ab'.repeat(64) },
  };
}

async function makeTestEnvelope(): Promise<DualV3Envelope> {
  return buildV3Envelope({
    context: {
      projectId: 'proj-1', supplierId: 'sup-1', submissionId: 'sub-1', revision: 1,
      signingBindingId: 'binding-1', signingCertFingerprint: 'ee'.repeat(32),
    },
    files: { technical: makeTestFileEntry('technical') },
    sealedFields: {
      cipherFormat: 'sm4-cbc-pkcs7-hex', cipher: 'ff'.repeat(32), cipherSha256: '11'.repeat(32), cipherBytes: 128,
      kself: { format: 'scca-pkcs7-base64', recipientCertFingerprint: 'dd'.repeat(32), value: 'MII'.padEnd(200, 'X') },
    },
    fieldsCommit: await computeV3FieldsCommit(TEST_FIELDS, TEST_NONCE),
  });
}

describe('dual-v3（阶段2 Task1）', () => {
  describe('computeV3FieldsCommit', () => {
    test('与手动计算一致', async () => {
      const manual = await sha256Hex(`${canonicalJson(TEST_FIELDS)}:${TEST_NONCE}`);
      expect(await computeV3FieldsCommit(TEST_FIELDS, TEST_NONCE)).toBe(manual);
    });

    test('不同 nonce 产生不同 commit', async () => {
      const c1 = await computeV3FieldsCommit(TEST_FIELDS, 'a'.repeat(32));
      const c2 = await computeV3FieldsCommit(TEST_FIELDS, 'b'.repeat(32));
      expect(c1).not.toBe(c2);
    });
  });

  describe('keyWrapJson', () => {
    test('键排序——iv 在 k 前', async () => {
      const result = keyWrapJson({ keyHex: '0123456789abcdef0123456789abcdef', ivHex: 'fedcba9876543210fedcba9876543210' });
      expect(result).toBe('{"iv":"fedcba9876543210fedcba9876543210","k":"0123456789abcdef0123456789abcdef"}');
    });
  });

  describe('validateV3Price', () => {
    test('合法：整数、最多 4 位小数', async () => {
      expect(validateV3Price('100')).toBe(true);
      expect(validateV3Price('100.5')).toBe(true);
      expect(validateV3Price('100.1234')).toBe(true);
    });
    test('非法：指数/逗号/前导零/超精度', async () => {
      expect(validateV3Price('1e2')).toBe(false);
      expect(validateV3Price('1,000')).toBe(false);
      expect(validateV3Price('0100')).toBe(false);
      expect(validateV3Price('100.12345')).toBe(false);
      expect(validateV3Price('-100')).toBe(false);
      expect(validateV3Price('')).toBe(false);
    });
  });

  describe('validateV3Envelope', () => {
    test('合法信封通过', async () => {
      const result = validateV3Envelope(await makeTestEnvelope());
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('拒绝 v2 形态——kself hex 而非 P7 base64', async () => {
      const env = await makeTestEnvelope();
      // 模拟 v2 的 kself 是 raw hex
      (env.files.technical!.kself as any).value = '04' + 'ab'.repeat(64);
      (env.files.technical!.kself as any).format = 'sm2-c1c3c2-hex';
      const result = validateV3Envelope(env);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e: string) => e.includes('scca-pkcs7-base64'))).toBe(true);
    });

    test('拒绝 fieldsSha256 残留', async () => {
      const env = await makeTestEnvelope() as any;
      env.fieldsSha256 = 'xx'.repeat(32);
      const result = validateV3Envelope(env);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e: string) => e.includes('fieldsSha256'))).toBe(true);
    });

    test('拒绝未知角色', async () => {
      const env = await makeTestEnvelope();
      (env.files as any).other = makeTestFileEntry('other');
      const result = validateV3Envelope(env);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e: string) => e.includes('未知角色'))).toBe(true);
    });

    test('拒绝 sealedFields 中的 kadmin', async () => {
      const env = await makeTestEnvelope() as any;
      env.sealedFields.kadmin = { format: 'sm2-c1c3c2-hex', adminCertId: 'x', value: 'y' };
      const result = validateV3Envelope(env);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e: string) => e.includes('kadmin'))).toBe(true);
    });

    test('拒绝非 64 hex 的 sha256', async () => {
      const env = await makeTestEnvelope();
      env.files.technical!.plainSha256 = 'zz';
      const result = validateV3Envelope(env);
      expect(result.ok).toBe(false);
    });

    test('拒绝 context.revision 非正整数', async () => {
      const env = await makeTestEnvelope();
      env.context.revision = 0;
      const result = validateV3Envelope(env);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e: string) => e.includes('revision'))).toBe(true);
    });

    test('拒绝 version 非 dual-v3', async () => {
      const env = await makeTestEnvelope() as any;
      env.version = 'dual-v2';
      const result = validateV3Envelope(env);
      expect(result.ok).toBe(false);
    });
  });
});
