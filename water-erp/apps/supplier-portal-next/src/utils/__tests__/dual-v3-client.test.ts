/**
 * dual-v3 客户端组装单测（Task11；Task 6 改造——加密数据面走注入 CryptoEngine）
 * Node 同源跑 ukey 原语——fieldsCommit 与服务端公式一致 + 信封结构/哈希/密封件闭环
 * + C_outer 字节锚（one-shot 双层手工期望值，信封字节级零变化）+ 多角色 DEK 独立/进度序
 */
import assert from 'node:assert/strict';
import * as nodeCrypto from 'node:crypto';
import { test } from 'node:test';
import { canonicalJson, sha256Hex, sm4Decrypt, sm4Encrypt } from '@water-erp/ukey';
import type { V3Fields } from '@water-erp/ukey';
import { createLocalCryptoEngine } from '../crypto-engine';
import type { CryptoEngine } from '../crypto-engine';
import { encryptAndUploadV3, pemDerSha256 } from '../dual-v3-client';

const FIELDS: V3Fields = {
  price: '153.95', amountUnit: '万元', currency: 'CNY',
  deliveryPeriod: '90 日历天', qualityCommitment: '合格',
};

const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

/** 探针引擎：包一层 local 引擎——记录每次 encryptFile 的文件名与 DEK 入参
 *  （kadmin 走 SM2 不可逆，引擎入参是 DEK_A 唯一明文观测点）。onProgress 第 4 参
 *  原样透传（Task 9 起 client 经 deps.onProgress 注入——进度序观测已迁至 client 通道，
 *  不再自挂引擎侧探针）。 */
interface EngineCall { file: string; dekS: { keyHex: string; ivHex: string }; dekA: { keyHex: string; ivHex: string } }
function spyLocalEngine(sink: { calls: EngineCall[] }): CryptoEngine {
  const base = createLocalCryptoEngine();
  return {
    encryptFile: (file, dekS, dekA, onProgress) => {
      sink.calls.push({ file: file.name, dekS, dekA });
      return base.encryptFile(file, dekS, dekA, onProgress);
    },
    decryptUrl: (url, dek, onProgress) => base.decryptUrl(url, dek, onProgress),
    terminate: () => base.terminate(),
  };
}

const ENC_CERT_PEM = '-----BEGIN CERTIFICATE-----\nQUJDREVG\n-----END CERTIFICATE-----'; // DER = "ABCDEF"
const ADMIN = { adminCertId: 'ac-1', publicKey: '04' + 'ab'.repeat(64) };

test('pemDerSha256：PEM 甲剥除后取 DER 哈希', async () => {
  // DER = bytes of "ABCDEF"
  const expected = await sha256Hex(new TextEncoder().encode('ABCDEF'));
  assert.equal(await pemDerSha256(ENC_CERT_PEM), expected);
});

test('encryptAndUploadV3：信封结构/哈希锚点/双密封件/fieldsCommit 闭环（走注入 CryptoEngine）', async () => {
  const capturedWrapJsons: string[] = [];
  const fakeAdapter = {
    // 捕获被封装的 keyWrapJson——测试据此反解 DEK 做密封件闭环
    wrapKeyToEncCert: async (_pem: string, json: string) => {
      capturedWrapJsons.push(json);
      return 'TURJWA==.' + capturedWrapJsons.length; // 假 P7（base64 'MIIx.'）
    },
  };
  const uploads: Array<{ role: string; filename: string; bytes: Uint8Array }> = [];
  const plainBytes = new TextEncoder().encode('technical-plaintext-pdf-bytes');
  const probe = { calls: [] as EngineCall[] };

  const result = await encryptAndUploadV3(
    'proj-1',
    [{ role: 'technical', file: new File([plainBytes], 'tech.pdf') }],
    FIELDS,
    ENC_CERT_PEM,
    fakeAdapter as any,
    ADMIN,
    {
      uploadOuter: async (role, blob, filename) => {
        uploads.push({ role, filename, bytes: new Uint8Array(await blob.arrayBuffer()) });
        return { fileAssetId: `fa-${role}`, outerSha256: '', outerBytes: blob.size };
      },
      cryptoEngine: spyLocalEngine(probe), // 注入 local 引擎（Node 无 Worker，默认链路同轨）
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
  assert.equal(entry.outerBytes, uploads[0]?.bytes.length, '上传密文字节数=信封声明');
  assert.equal(uploads[0]?.filename, 'tech.pdf.outer', '上传文件名=原名+.outer');
  assert.equal(entry.kadmin.adminCertId, 'ac-1');
  assert.match(entry.kadmin.value, /^[0-9a-f]{190,}$/, 'SM2 密文=hex（C1C3C2，sm-crypto 无 04 前缀）');
  assert.equal(entry.kself.recipientCertFingerprint, await sha256Hex(new TextEncoder().encode('ABCDEF')), 'kself 指纹=加密证 DER sha256');
  assert.match(entry.kself.value, /^TURJWA==\.\d+$/, 'kself 走 adapter P7 封装');

  // 注入引擎被实走（整读旧路径不触引擎——本断言是重构的 RED 锚点）
  assert.equal(probe.calls.length, 1, 'deps.cryptoEngine 注入引擎被逐角色调用');
  // 闭环①（字节锚）：DEK_S 取 fake adapter 捕获的 kself wrapJson（封装的就是加密用钥），
  // DEK_A 取引擎入参（kadmin 走 SM2 不可逆）——重组 one-shot 双层密文应逐字节等于上传的 C_outer
  // （Task 2 一致性闸的推论：分块 == one-shot，信封字节级零变化）
  const dekSJson = JSON.parse(capturedWrapJsons[0]!) as { k: string; iv: string };
  assert.equal(probe.calls[0]?.dekS.keyHex, dekSJson.k, 'kself 封装的 DEK_S 即引擎加密用钥');
  assert.equal(probe.calls[0]?.dekS.ivHex, dekSJson.iv, 'kself 封装的 DEK_S IV 同源');
  const expectedOuterHex = sm4Encrypt(
    probe.calls[0]!.dekA.keyHex, probe.calls[0]!.dekA.ivHex,
    sm4Encrypt(dekSJson.k, dekSJson.iv, toHex(plainBytes)),
  );
  assert.equal(toHex(uploads[0]!.bytes), expectedOuterHex, 'C_outer 字节 == one-shot sm4Encrypt(dekA, sm4Encrypt(dekS, plain)) 手工期望值');

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

test('多角色（technical+coverLetter）：逐角色 DEK 独立、engine 按文件序、进度回调按文件序', async () => {
  const capturedWrapJsons: string[] = [];
  const fakeAdapter = {
    wrapKeyToEncCert: async (_pem: string, json: string) => {
      capturedWrapJsons.push(json);
      return 'TURJWA==.' + capturedWrapJsons.length;
    },
  };
  const uploads: Array<{ role: string; bytes: Uint8Array }> = [];
  const probe = { calls: [] as EngineCall[] };
  // client 进度通道（Task 9 迁移）：deps.onProgress ← engine.encryptFile 第 4 参透传
  const clientProgress: string[] = [];
  const techPlain = new TextEncoder().encode('technical-role-plain-bytes');
  const coverPlain = new TextEncoder().encode('cover-letter-role-plain-bytes-longer');

  const result = await encryptAndUploadV3(
    'proj-2',
    [
      { role: 'technical', file: new File([techPlain], 'tech.pdf') },
      { role: 'coverLetter', file: new File([coverPlain], 'cover.pdf') },
    ],
    FIELDS,
    ENC_CERT_PEM,
    fakeAdapter as any,
    ADMIN,
    {
      onProgress: (done, total) => clientProgress.push(`${done}/${total}`),
      uploadOuter: async (role, blob) => {
        uploads.push({ role, bytes: new Uint8Array(await blob.arrayBuffer()) });
        return { fileAssetId: `fa-${role}`, outerSha256: '', outerBytes: blob.size };
      },
      cryptoEngine: spyLocalEngine(probe),
    },
    { supplierId: 'sup-2', submissionId: '', revision: 1, signingBindingId: 'b-2', signingCertFingerprint: 'cf-2' },
  );

  // 注入引擎逐角色实走、按文件序（整读旧路径 calls 为空 / 不保证逐文件串行）
  assert.equal(probe.calls.length, 2, '每角色恰一次 engine.encryptFile');
  assert.deepEqual(probe.calls.map((c) => c.file), ['tech.pdf', 'cover.pdf'], 'engine 调用按文件序');

  // 逐角色 DEK 独立（DEK_S/DEK_A 各自新生成，不跨角色复用）
  assert.notEqual(probe.calls[0]!.dekS.keyHex, probe.calls[1]!.dekS.keyHex, 'DEK_S 逐角色独立');
  assert.notEqual(probe.calls[0]!.dekA.keyHex, probe.calls[1]!.dekA.keyHex, 'DEK_A 逐角色独立');

  // 字节锚×2：各角色用**各自** DEK 重组 one-shot 双层密文 == 各自上传的 C_outer
  // （kself 封装即加密用钥：wrapJson 反解的 DEK_S == 引擎入参）
  const dekS0 = JSON.parse(capturedWrapJsons[0]!) as { k: string; iv: string };
  const dekS1 = JSON.parse(capturedWrapJsons[1]!) as { k: string; iv: string };
  assert.equal(dekS0.k, probe.calls[0]!.dekS.keyHex);
  assert.equal(dekS1.k, probe.calls[1]!.dekS.keyHex);
  assert.equal(
    toHex(uploads[0]!.bytes),
    sm4Encrypt(probe.calls[0]!.dekA.keyHex, probe.calls[0]!.dekA.ivHex, sm4Encrypt(dekS0.k, dekS0.iv, toHex(techPlain))),
    'technical C_outer 字节锚（独立 DEK 成立）',
  );
  assert.equal(
    toHex(uploads[1]!.bytes),
    sm4Encrypt(probe.calls[1]!.dekA.keyHex, probe.calls[1]!.dekA.ivHex, sm4Encrypt(dekS1.k, dekS1.iv, toHex(coverPlain))),
    'coverLetter C_outer 字节锚（独立 DEK 成立）',
  );

  // 进度回调按文件序（client 通道）：technical 全部档先于 coverLetter，各文件终档=自身明文长（不跨文件累计）。
  // total 即当前文件明文 size——两文件长度不同（26 vs 36B），total 值即文件判别键。
  const isTechTick = (t: string) => t.endsWith(`/${techPlain.length}`);
  const lastTech = clientProgress.map(isTechTick).lastIndexOf(true);
  const firstCover = clientProgress.findIndex((t) => t.endsWith(`/${coverPlain.length}`));
  assert.ok(lastTech >= 0 && firstCover >= 0, '两文件均有进度档（deps.onProgress 收到 engine 透传）');
  assert.ok(lastTech < firstCover, 'technical 进度全部先于 coverLetter（逐文件串行）');
  assert.ok(clientProgress.includes(`${techPlain.length}/${techPlain.length}`), 'technical 终档=自身 size');
  assert.ok(clientProgress.includes(`${coverPlain.length}/${coverPlain.length}`), 'coverLetter 终档=自身 size');

  // 信封两角色各自落位（捕获序 wrapJson[0/1]=两角色 DEK_S、[2]=DEK_F）
  assert.equal(result.envelope.files.technical?.assetId, 'fa-technical');
  assert.equal(result.envelope.files.coverLetter?.assetId, 'fa-coverLetter');
  assert.equal(result.envelope.files.technical?.plainSha256, await sha256Hex(techPlain));
  assert.equal(result.envelope.files.coverLetter?.plainSha256, await sha256Hex(coverPlain));
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
      // 负例专用：故意返回错误哈希（真值跨校验由正例用例覆盖——二进制口径回归钉）
      { uploadOuter: async () => ({ fileAssetId: 'fa-x', outerSha256: 'deadbeef'.padEnd(64, '0'), outerBytes: 1 }) },
      { supplierId: 'sup-1', submissionId: '', revision: 1, signingBindingId: 'b', signingCertFingerprint: 'c' },
    ),
    /outerSha256/,
  );
});

test('非安全上下文（浏览器禁用 crypto.subtle，http 局域网访问）→ 中文指引而非裸 TypeError', async () => {
  // 复现线上形态：http://192.168.x:3004 等非安全上下文里 crypto.subtle 为 undefined，
  // sha256Hex 首触即抛 "Cannot read properties of undefined (reading 'digest')"（2026-10-16 02盾投递实录）
  const orig = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues: (orig.get!.call(globalThis) as Crypto).getRandomValues },
  });
  try {
    await assert.rejects(
      encryptAndUploadV3(
        'proj-1',
        [{ role: 'technical', file: new File([new TextEncoder().encode('x')], 'a.pdf') }],
        FIELDS,
        ENC_CERT_PEM,
        {} as any,
        ADMIN,
        { uploadOuter: async () => ({ fileAssetId: 'fa', outerSha256: '', outerBytes: 1 }) },
        { supplierId: 'sup-1', submissionId: '', revision: 1, signingBindingId: 'b', signingCertFingerprint: 'c' },
      ),
      (e: Error) => e.message.includes('安全上下文') && e.message.includes('https'),
      'LAN http 下须给出 https/localhost 指引，而非 reading (digest) 裸 TypeError',
    );
  } finally {
    Object.defineProperty(globalThis, 'crypto', orig);
  }
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
      uploadOuter: async (role: string, blob: Blob) => {
        const buf = Buffer.from(await blob.arrayBuffer());
        return { fileAssetId: `fa-${role}`, outerSha256: nodeCrypto.createHash('sha256').update(buf).digest('hex'), outerBytes: buf.length };
      },
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

/* ── pickShieldByFingerprint：错盾当场点名（2026-10-22 世纪远景三盾混插实录：
   盲取 certs[0] → SOF_DecryptData 184549377「密钥解封失败（错盾/错钥？）」）── */
const PEM_ENC_A = '-----BEGIN CERTIFICATE-----\nQUJDREVG\n-----END CERTIFICATE-----'; // DER="ABCDEF"
const PEM_ENC_B = '-----BEGIN CERTIFICATE-----\nUVdFUlRZ\n-----END CERTIFICATE-----'; // DER="QWERTY"
const mkShieldCerts = () => [
  { container: 'USB0', displayName: '盾甲(测试机床有限公司)', enc: { pem: PEM_ENC_A } },
  { container: 'USB1', displayName: '盾乙(测试环保技术装备有限公司)', enc: { pem: PEM_ENC_B } },
];

test('pickShieldByFingerprint：按收件证书指纹选中对应盾容器', async () => {
  const { pickShieldByFingerprint } = await import('../dual-v3-client');
  const fpB = await sha256Hex(new TextEncoder().encode('QWERTY'));
  const picked = await pickShieldByFingerprint(mkShieldCerts(), fpB);
  assert.equal(picked.container, 'USB1');
});

test('pickShieldByFingerprint：指纹全不匹配 → 抛「插错盾」并点名当前盾', async () => {
  const { pickShieldByFingerprint } = await import('../dual-v3-client');
  const fpOther = await sha256Hex(new TextEncoder().encode('OTHER'));
  await assert.rejects(
    pickShieldByFingerprint(mkShieldCerts(), fpOther),
    /插错盾.*盾甲.*盾乙/,
  );
});

test('pickShieldByFingerprint：指纹缺省（旧包未携带）→ 回退第一个容器', async () => {
  const { pickShieldByFingerprint } = await import('../dual-v3-client');
  const picked = await pickShieldByFingerprint(mkShieldCerts(), undefined);
  assert.equal(picked.container, 'USB0');
});

test('pickShieldByFingerprint：无证书 → 保留原文案提示插盾', async () => {
  const { pickShieldByFingerprint } = await import('../dual-v3-client');
  await assert.rejects(pickShieldByFingerprint([], 'ab'.repeat(32)), /U盾内未找到证书/);
});
