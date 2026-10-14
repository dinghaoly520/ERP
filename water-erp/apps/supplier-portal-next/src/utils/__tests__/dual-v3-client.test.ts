/**
 * dual-v3 客户端组装单测（Task11）
 * Node 同源跑 ukey 原语——fieldsCommit 与服务端公式一致 + 信封结构/哈希/密封件闭环
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalJson, sha256Hex, sm4Decrypt } from '@water-erp/ukey';
import type { V3Fields } from '@water-erp/ukey';
import { encryptAndUploadV3, pemDerSha256 } from '../dual-v3-client';

const FIELDS: V3Fields = {
  price: '153.95', amountUnit: '万元', currency: 'CNY',
  deliveryPeriod: '90 日历天', qualityCommitment: '合格',
};

const ENC_CERT_PEM = '-----BEGIN CERTIFICATE-----\nQUJDREVG\n-----END CERTIFICATE-----'; // DER = "ABCDEF"
const ADMIN = { adminCertId: 'ac-1', publicKey: '04' + 'ab'.repeat(64) };

test('pemDerSha256：PEM 甲剥除后取 DER 哈希', async () => {
  // DER = bytes of "ABCDEF"
  const expected = await sha256Hex(new TextEncoder().encode('ABCDEF'));
  assert.equal(await pemDerSha256(ENC_CERT_PEM), expected);
});

test('encryptAndUploadV3：信封结构/哈希锚点/双密封件/fieldsCommit 闭环', async () => {
  const capturedWrapJsons: string[] = [];
  const fakeAdapter = {
    // 捕获被封装的 keyWrapJson——测试据此反解 DEK 做密封件闭环
    wrapKeyToEncCert: async (_pem: string, json: string) => {
      capturedWrapJsons.push(json);
      return 'TURJWA==.' + capturedWrapJsons.length; // 假 P7（base64 'MIIx.'）
    },
  };
  const uploads: Array<{ role: string; bytes: number }> = [];
  const plainBytes = new TextEncoder().encode('technical-plaintext-pdf-bytes');

  const result = await encryptAndUploadV3(
    'proj-1',
    [{ role: 'technical', file: new File([plainBytes], 'tech.pdf') }],
    FIELDS,
    ENC_CERT_PEM,
    fakeAdapter as any,
    ADMIN,
    {
      uploadOuter: async (role, blob) => {
        uploads.push({ role, bytes: blob.size });
        return { fileAssetId: `fa-${role}`, outerSha256: '', outerBytes: blob.size };
      },
    },
    { supplierId: 'sup-1', submissionId: '', revision: 1, signingBindingId: 'b-1', signingCertFingerprint: 'cf-1' },
  );

  const { envelope } = result;
  assert.equal(envelope.version, 'dual-v3');
  assert.equal(envelope.context.projectId, 'proj-1');
  assert.equal(envelope.fieldsCommit, await sha256Hex(`${canonicalJson(FIELDS)}:${result.nonceHex}`), 'fieldsCommit 与服务端公式一致');
  assert.match(result.nonceHex, /^[0-9a-f]{32}$/, 'nonce=16B CSPRNG hex');

  const entry = envelope.files.technical!;
  assert.equal(entry.assetId, 'fa-technical');
  assert.equal(entry.plainSha256, await sha256Hex(plainBytes), '明文哈希锚点');
  assert.equal(entry.outerBytes, uploads[0]?.bytes, '上传密文字节数=信封声明');
  assert.equal(entry.kadmin.adminCertId, 'ac-1');
  assert.match(entry.kadmin.value, /^[0-9a-f]{190,}$/, 'SM2 密文=hex（C1C3C2，sm-crypto 无 04 前缀）');
  assert.equal(entry.kself.recipientCertFingerprint, await sha256Hex(new TextEncoder().encode('ABCDEF')), 'kself 指纹=加密证 DER sha256');
  assert.match(entry.kself.value, /^TURJWA==\.\d+$/, 'kself 走 adapter P7 封装');

  // 闭环①：文件密封件——首个 wrapJson 是 technical 的 DEK_S；用其 SM4 解 C_inner 不在本测试
  // （C_inner 未上传），改验 plainSha256 已由 sha256Hex 直接锚定（上断言）。
  // 闭环②：sealedFields——第二个 wrapJson 是 DEK_F；解 cipher 应还原 canonicalJson(fields)
  const dekF = JSON.parse(capturedWrapJsons[1]!);
  const plainFieldsHex = sm4Decrypt(dekF.k, dekF.iv, envelope.sealedFields.cipher);
  const restored = new TextDecoder().decode(
    Uint8Array.from(plainFieldsHex.match(/.{2}/g)!.map((h: string) => parseInt(h, 16))),
  );
  // Ruling（Task12）：cipher 内容=canonicalJson({fields, nonce})——供应商解密后可取回 nonce
  assert.equal(restored, canonicalJson({ fields: FIELDS, nonce: result.nonceHex }), 'sealedFields 密文可由 DEK_F 还原 fields+nonce');
  assert.equal(envelope.sealedFields.kself.format, 'scca-pkcs7-base64');
});

test('服务端实算 outerSha256 与本地不一致 → 抛错（防传输损坏静默入信封）', async () => {
  const fakeAdapter = { wrapKeyToEncCert: async () => 'TURJWA==.1' };
  await assert.rejects(
    encryptAndUploadV3(
      'proj-1',
      [{ role: 'technical', file: new File([new TextEncoder().encode('x')], 'a.pdf') }],
      FIELDS,
      ENC_CERT_PEM,
      fakeAdapter as any,
      ADMIN,
      { uploadOuter: async (role) => ({ fileAssetId: `fa-${role}`, outerSha256: 'deadbeef', outerBytes: 1 }) },
      { supplierId: 'sup-1', submissionId: '', revision: 1, signingBindingId: 'b', signingCertFingerprint: 'c' },
    ),
    /outerSha256/,
  );
});

test('C-1 契约：nextRevisionContext——信封 revision = base+1（服务端 ctx.revision===newRev 硬校验）', async () => {
  const { nextRevisionContext } = await import('../dual-v3-client');
  const ctx = { supplierId: 'sup-1', submissionId: '', revision: 0, signingBindingId: 'b', signingCertFingerprint: 'f'.repeat(64) };
  const next = nextRevisionContext(ctx);
  assert.equal(next.revision, 1, '首投 0→1（validator 也要 ≥1）');
  assert.equal(ctx.revision, 0, '原 context 不被改动（baseRevision 语义）');
  const next5 = nextRevisionContext({ ...ctx, revision: 5 });
  assert.equal(next5.revision, 6, '撤回重投 N→N+1');
});

test('T3 补传契约：reuseNonce——复用原 nonce 则 fieldsCommit 与首投一致', async () => {
  const { encryptAndUploadV3 } = await import('../dual-v3-client');
  const { computeV3FieldsCommit } = await import('@water-erp/ukey');
  const F = { price: '88.8', amountUnit: '万元', currency: 'CNY', deliveryPeriod: '60 日历天', qualityCommitment: '合格' } as any;
  const REUSED = 'cd'.repeat(16);
  const mk = async () => {
    const captured: string[] = [];
    const adapter = { wrapKeyToEncCert: async (_p: string, json: string) => { captured.push(json); return 'TURJWA==.' + captured.length; } };
    return { captured, r: await encryptAndUploadV3('p1', [{ role: 'technical', file: new File([new TextEncoder().encode('reupload-plain')], 't.pdf') }], F, ENC_CERT_PEM, adapter as any, ADMIN, {
      uploadOuter: async (role: string) => ({ fileAssetId: `fa-${role}`, outerSha256: '', outerBytes: 1 }),
    }, { supplierId: 'sup-1', submissionId: 'sub-1', revision: 1, signingBindingId: 'b', signingCertFingerprint: 'f'.repeat(64) }, REUSED) };
  };
  const { captured, r } = await mk();
  assert.equal(r.nonceHex, REUSED, 'nonce 复用不自生成');
  assert.equal(r.fieldsCommit, await computeV3FieldsCommit(F, REUSED), 'fieldsCommit 按复用 nonce 计算——服务端改价闸比对通过');
  // 闭环：unwrapSealedFields 用捕获的 DEK_F 解回 fields+nonce
  const { unwrapSealedFields } = await import('../dual-v3-client');
  const restored = await unwrapSealedFields(captured[1]!, r.sealedFields);
  assert.deepEqual(restored, { fields: F, nonce: REUSED }, '补传方盾复原 fields+nonce 闭环');
});
