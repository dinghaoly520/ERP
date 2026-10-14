/**
 * dual-v3 全链 e2e（阶段2 Task14）
 * overrideProvider(CaVerificationService) 策略（同 auth-ca.e2e——动态挑战无法用固定真盾 P7；
 * 真实密码学路径由 ca-verification.service.spec 以真 P7 fixtures 覆盖）。
 * 覆盖：登录→encrypted-assets→prepare→signing-payload→submit v3→receipt v3→
 *      opening-package v3→decrypt-upload v3（P7 证明）→opening-confirm v3；旧轨回执 unsigned-legacy。
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CaVerificationService } from '../src/ca/ca-verification.service';
import { OutboxDispatchService } from '../src/scheduler/outbox-dispatch.service';
import { hashSync } from 'bcryptjs';
import { canonicalJson, computeV3FieldsCommit, sha256Hex } from '@water-erp/ukey';
import type { V3Fields } from '@water-erp/ukey';

const USER = 'e2e-v3-supplier';
const PASSWORD = 'SCCA-V3@2026';

class FakeVerificationService {
  async verifySignature(input: { expectedToSign: string }) {
    void input;
    return { ok: true, signerSerialHex: 'fake', statusCoverage: ['chain'], evidenceId: 'e2e-ev' };
  }
}

const FIELDS: V3Fields = { price: '153.95', amountUnit: '万元', currency: 'CNY', deliveryPeriod: '90 日历天', qualityCommitment: '合格' };
const NONCE = 'ab'.repeat(16);
const PLAIN = Buffer.from('e2e-v3-technical-plaintext');
const B64 = (s: string) => Buffer.from(s).toString('base64');
const P7VAL = B64('kself-p7-'.repeat(12)); // ≥100 chars（validator 长度闸）
const FP = 'e'.repeat(64); // 合法 hex 指纹

describe('dual-v3 全链 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookie: string[];
  let supplierId: string;
  let projectId: string;
  let submissionId: string;
  let envelope: any;
  let fieldsCommit: string;

  beforeAll(async () => {
    const setup = new PrismaService();
    let user = await setup.user.findUnique({ where: { username_role: { username: USER, role: 'supplier' } } });
    if (!user) {
      user = await setup.user.create({
        data: { username: USER, role: 'supplier', isActive: true, passwordHash: hashSync(PASSWORD, 10), displayName: 'e2e-v3供应商' },
      });
      const sup = await setup.supplier.create({
        data: {
          userId: user.id, supplierNo: 'SUP-E2E-V3-' + Date.now().toString().slice(-6),
          creditCode: 'e2e-v3-credit-code', name: 'e2e-v3供应商', normalizedName: 'e2e-v3供应商',
          enterpriseType: 'OTHER', legalPerson: 'v3', registeredAddress: 'v3', businessScope: 'v3',
          status: 'APPROVED',
        },
      });
      supplierId = sup.id;
    } else {
      const sup = await setup.supplier.findUnique({ where: { userId: user.id } });
      supplierId = sup!.id;
    }
    // SCCA 绑定（scca-pkcs7 ACTIVE + 签名证挂 CaCertificate）
    const certFp = 'e'.repeat(64);
    const existingCert = await setup.supplierCert.findFirst({ where: { supplierId } });
    if (!existingCert) {
      const caCert = await setup.caCertificate.upsert({
        where: { sha256Fingerprint: certFp },
        create: {
          derBase64: B64('der-e2e-sign-cert'), sha256Fingerprint: certFp, serialHex: 'e2eserial',
          issuerNameDerHash: 'i'.repeat(64), issuerDisplay: 'SCCA Test CA', subjectDisplay: 'e2e-v3供应商',
          spkiAlgorithmOid: '1.2.840.10045.2.1', keyUsage: ['DigitalSignature'], extendedKeyUsage: [],
          unknownExtensionOids: [], notBefore: new Date('2026-01-01'), notAfter: new Date('2030-01-01'),
        },
        update: {},
      });
      await setup.supplierCert.create({
        data: {
          supplierId, certSn: 'E2E-V3-SN', certDn: 'CN=e2e-v3供应商', publicKey: '04' + 'ab'.repeat(64),
          credentialScheme: 'scca-pkcs7', bindingStatus: 'ACTIVE', signingCaCertificateId: caCert.id,
        },
      });
    }
    await setup.$disconnect();

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CaVerificationService)
      .useClass(FakeVerificationService as any)
      .compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const login = await request(app.getHttpServer()).post('/api/auth/login').set('X-Portal', 'supplier')
      .send({ username: USER, password: PASSWORD });
    cookie = login.headers['set-cookie'] as unknown as string[];
    expect(cookie?.length).toBeGreaterThan(0);
  });

  it('① 项目+名册就绪 → ② encrypted-assets 暂存', async () => {
    const proj = await prisma.bidProject.create({
      data: {
        projectCode: `BID-V3-${Date.now()}`, name: 'v3全链测试', stage: 'SUBMIT', procurementMethod: '直接采购',
        openTime: new Date(Date.now() + 3600_000), deadline: new Date(Date.now() + 24 * 3600_000),
      },
    });
    projectId = proj.id;
    // G3 闸门要求在册（直接采购=邀请域）；submitStatus 故意不置「已提交」——
    // 名册翻牌由 submit v3 事务完成（C2 真实断言，不再预置掩盖）
    await prisma.bidSupplier.create({
      data: { projectId, supplierId, supplierName: 'e2e-v3供应商', submitStatus: '未递交' },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/supplier-portal/bid-submissions/${projectId}/encrypted-assets`)
      .set('Cookie', cookie).set('X-Portal', 'supplier')
      .attach('file', PLAIN, { filename: 'tech.outer', contentType: 'application/octet-stream' })
      .expect(200);
    const outerAsset = res.body;
    expect(outerAsset.outerSha256).toBe(await sha256Hex(PLAIN)); // 暂存即明文（outer 未真加密——流程测试）
    // C1 真实断言：密文对象在 MinIO 在位（decryptOuterOneV3 读取锚点——不再被 mock 掩盖）
    const { minioClient, MINIO_BUCKET } = await import('../src/upload/minio.client');
    const staged = await prisma.fileAsset.findUnique({ where: { id: outerAsset.fileAssetId } });
    await expect(minioClient.statObject(MINIO_BUCKET, staged!.key)).resolves.toBeTruthy();

    // 组装 v3 信封（innerSha256 与稍后创建的 C_inner 资产对齐）
    fieldsCommit = await computeV3FieldsCommit(FIELDS, NONCE);
    envelope = {
      version: 'dual-v3', canonicalVersion: 'erp-json-v1', provider: 'scca',
      context: { projectId, supplierId, submissionId: '', revision: 1, signingBindingId: 'e2e-b', signingCertFingerprint: 'f'.repeat(64) },
      files: {
        technical: {
          assetId: outerAsset.fileAssetId,
          plainSha256: await sha256Hex(PLAIN), plainBytes: PLAIN.length,
          innerSha256: await sha256Hex(Buffer.from('e2e-inner-cipher')), innerBytes: 48,
          outerSha256: outerAsset.outerSha256, outerBytes: outerAsset.outerBytes,
          kself: { format: 'scca-pkcs7-base64', recipientCertFingerprint: FP, value: P7VAL },
          kadmin: { format: 'sm2-c1c3c2-hex', adminCertId: 'ac-e2e', value: '04' + 'ab'.repeat(32) },
        },
      },
      sealedFields: {
        cipherFormat: 'sm4-cbc-pkcs7-hex', cipher: 'deadbeef01', cipherSha256: 'c'.repeat(64), cipherBytes: 6,
        kself: { format: 'scca-pkcs7-base64', recipientCertFingerprint: FP, value: P7VAL },
      },
      fieldsCommit,
    };
  });

  it('③ prepare → signing-payload → submit v3 → revision=1 快照落库', async () => {
    const prep = await request(app.getHttpServer())
      .post(`/api/supplier-portal/bid-submissions/${projectId}/operations/prepare`)
      .set('Cookie', cookie).set('X-Portal', 'supplier')
      .send({ action: 'submit', baseRevision: 0 })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/supplier-portal/bid-submissions/${projectId}/operations/${prep.body.operationId}/signing-payload`)
      .set('Cookie', cookie).set('X-Portal', 'supplier')
      .send({ envelope })
      .expect(200);
    const res = await request(app.getHttpServer())
      .post(`/api/supplier-portal/bid-submissions/${projectId}/submit`)
      .set('Cookie', cookie).set('X-Portal', 'supplier')
      .send({ operationId: prep.body.operationId, signatureFormat: 'scca-pkcs7-base64', signP7: B64('e2e-submit-p7'), baseRevision: 0 })
      .expect(201);
    submissionId = res.body.submissionId;
    expect(res.body.revision).toBe(1);
    // C2 真实断言：名册翻牌+serverSubmittedAt（不再预置掩盖）
    const roster = await prisma.bidSupplier.findFirst({ where: { projectId, supplierId } });
    expect(roster?.submitStatus).toBe('已提交');
    expect(roster?.encryptStatus).toBe('双层信封已验签');
    const submittedRow = await prisma.supplierBidSubmission.findUnique({ where: { id: submissionId } });
    expect(submittedRow?.serverSubmittedAt).toBeTruthy();
    const version = await prisma.submissionVersion.findUnique({
      where: { submissionId_revision: { submissionId, revision: 1 } },
    });
    expect(version?.envelopeHash).toBeTruthy();
  });

  it('④ 回执 v3：payload 含 revision/envelopeHash → P7 签署存档', async () => {
    const payload = await request(app.getHttpServer())
      .get(`/api/supplier-portal/bid-submissions/${submissionId}/receipt-payload`)
      .set('Cookie', cookie).set('X-Portal', 'supplier')
      .expect(200);
    expect(payload.body.payload).toMatchObject({ revision: 1, purpose: 'submission-receipt', envelopeHash: expect.any(String) });
    const prep = await request(app.getHttpServer())
      .post(`/api/supplier-portal/bid-submissions/${projectId}/operations/prepare`)
      .set('Cookie', cookie).set('X-Portal', 'supplier')
      .send({ action: 'receipt' })
      .expect(200);
    const res = await request(app.getHttpServer())
      .post(`/api/supplier-portal/bid-submissions/${submissionId}/receipt-signature`)
      .set('Cookie', cookie).set('X-Portal', 'supplier')
      .send({ operationId: prep.body.operationId, signatureFormat: 'scca-pkcs7-base64', signP7: B64('e2e-receipt-p7') })
      .expect(201);
    expect(res.body).toMatchObject({ success: true, revision: 1 });
  });

  it('⑤ OPENING+会话+外层已解（DB 模拟主持端）→ opening-package v3', async () => {
    await prisma.bidSupplier.updateMany({ where: { projectId, supplierId }, data: { checkInAt: new Date() } }); // quorum 签到
    await prisma.bidProject.update({ where: { id: projectId }, data: { stage: 'OPENING' } });
    await prisma.bidOpeningSession.create({
      data: { projectId, host: '陈源远', decryptWindowStart: new Date(), decryptWindowEnd: new Date(Date.now() + 3600_000) },
    }).catch(() => {}); // 幂等
    const innerAsset = await prisma.fileAsset.create({
      data: {
        key: `bid-inner-e2e/${projectId}/${Date.now()}.inner`, originalName: 'technical.inner',
        mimeType: 'application/octet-stream', size: 48, sha256: await sha256Hex(Buffer.from('e2e-inner-cipher')),
        category: 'bid_inner_ciphertext', clientEncrypted: false, encrypted: true,
      },
    });
    await prisma.supplierBidSubmission.update({
      where: { id: submissionId },
      data: { outerDecryptedAt: new Date(), innerAssets: { technical: innerAsset.id } as any },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/supplier-portal/bid-submissions/${projectId}/opening-package`)
      .set('Cookie', cookie).set('X-Portal', 'supplier')
      .expect(200);
    expect(res.body.revision).toBe(1);
    expect(res.body.files[0]).toMatchObject({ role: 'technical', innerAsset: innerAsset.id });
    expect(res.body.sealedFields.kself.format).toBe('scca-pkcs7-base64');
  });

  it('⑥ decrypt-upload v3：P7 证明 → SUCCESS + 唱标预填万元', async () => {
    const prep = await request(app.getHttpServer())
      .post(`/api/supplier-portal/bid-submissions/${projectId}/operations/prepare`)
      .set('Cookie', cookie).set('X-Portal', 'supplier')
      .send({ action: 'decrypt-upload' })
      .expect(200);
    const res = await request(app.getHttpServer())
      .post(`/api/supplier-portal/bid-submissions/${projectId}/decrypt-upload`)
      .set('Cookie', cookie).set('X-Portal', 'supplier')
      .field('fieldsJson', canonicalJson(FIELDS))
      .field('nonce', NONCE)
      .field('operationId', prep.body.operationId)
      .field('signatureFormat', 'scca-pkcs7-base64')
      .field('signP7', B64('e2e-decrypt-proof'))
      .attach('file_technical', PLAIN, { filename: 'technical.plain', contentType: 'application/octet-stream' })
      .expect(201);
    expect(res.body).toMatchObject({ decryptStatus: 'SUCCESS', confirmStatus: 'PENDING' });
    const record = await prisma.bidOpeningRecord.findFirst({ where: { projectId } });
    expect(record?.amount).toBe('153.95');
    expect(record?.amountUnit).toBe('万元');
  });

  it('⑦ opening-confirm v3：payload v2 无金额明文 → P7 确认成功', async () => {
    const payload = await request(app.getHttpServer())
      .get(`/api/supplier-portal/bid-submissions/${projectId}/opening-confirm-payload`)
      .set('Cookie', cookie).set('X-Portal', 'supplier')
      .expect(200);
    expect(payload.body.canonical).not.toContain('153.95');
    expect(payload.body.payload).toMatchObject({ version: 2, purpose: 'confirm' });
    const prep = await request(app.getHttpServer())
      .post(`/api/supplier-portal/bid-submissions/${projectId}/operations/prepare`)
      .set('Cookie', cookie).set('X-Portal', 'supplier')
      .send({ action: 'opening-confirm' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/supplier-portal/bid-submissions/${projectId}/opening-confirm`)
      .set('Cookie', cookie).set('X-Portal', 'supplier')
      .send({ operationId: prep.body.operationId, signatureFormat: 'scca-pkcs7-base64', signP7: B64('e2e-confirm-p7') })
      .expect(201);
    const record = await prisma.bidOpeningRecord.findFirst({ where: { projectId } });
    expect(record?.confirmStatus).toBe('供应商已确认');
    expect((record?.confirmSignature as any)?.algorithm).toBe('scca-pkcs7-base64');
  });

  it('⑧ 旧轨兼容：legacy 投递行 → 回执空签 unsigned-legacy 照走', async () => {
    const legacyProj = await prisma.bidProject.create({
      data: { projectCode: `BID-V3-L-${Date.now()}`, name: 'v3旧轨兼容', stage: 'SUBMIT', procurementMethod: '直接采购', openTime: new Date(Date.now() + 3600_000), deadline: new Date(Date.now() + 24 * 3600_000) },
    });
    const legacy = await prisma.supplierBidSubmission.create({
      data: { supplierId, projectId: legacyProj.id, status: 'submitted', submittedAt: new Date(), serverSubmittedAt: new Date(), fileHash: 'legacy-hash' } as any,
    });
    const res = await request(app.getHttpServer())
      .post(`/api/supplier-portal/bid-submissions/${legacy.id}/receipt-signature`)
      .set('Cookie', cookie).set('X-Portal', 'supplier')
      .send({ signature: '' })
      .expect(201);
    expect((res.body.receiptSignature as any)?.algorithm).toBe('unsigned-legacy');
    await prisma.supplierBidSubmission.delete({ where: { id: legacy.id } });
    await prisma.bidProject.delete({ where: { id: legacyProj.id } }).catch(() => {});
  });

  it('⑨ 补传链：DANGER→reupload-context→重封（reuseNonce/锚点同版）→reupload-v3→rev2+备份→重解 SUCCESS', async () => {
    const PLAIN2 = Buffer.from('e2e-v3-reupload-plain');
    const proj = await prisma.bidProject.create({
      data: { projectCode: `BID-V3-R-${Date.now()}`, name: 'v3补传链测试', stage: 'SUBMIT', procurementMethod: '直接采购',
        openTime: new Date(Date.now() + 3600_000), deadline: new Date(Date.now() + 24 * 3600_000) },
    });
    await prisma.bidSupplier.create({ data: { projectId: proj.id, supplierId, supplierName: 'e2e-v3供应商', submitStatus: '未递交' } });
    const mkEnvFor = async (assetId: string, rev: number) => ({
      version: 'dual-v3', canonicalVersion: 'erp-json-v1', provider: 'scca',
      context: { projectId: proj.id, supplierId, submissionId: '', revision: rev, signingBindingId: 'e2e-b', signingCertFingerprint: 'f'.repeat(64) },
      files: { technical: { assetId, plainSha256: await sha256Hex(PLAIN2), plainBytes: PLAIN2.length,
        innerSha256: 'd'.repeat(64), innerBytes: 64, outerSha256: 'f'.repeat(64), outerBytes: 80,
        kself: { format: 'scca-pkcs7-base64', recipientCertFingerprint: FP, value: P7VAL },
        kadmin: { format: 'sm2-c1c3c2-hex', adminCertId: 'ac-e2e', value: '04' + 'ab'.repeat(32) } } },
      sealedFields: { cipherFormat: 'sm4-cbc-pkcs7-hex', cipher: 'aa', cipherSha256: 'c'.repeat(64), cipherBytes: 1,
        kself: { format: 'scca-pkcs7-base64', recipientCertFingerprint: FP, value: P7VAL } },
      fieldsCommit,
    });
    // 首投 rev1
    const up1 = await request(app.getHttpServer()).post(`/api/supplier-portal/bid-submissions/${proj.id}/encrypted-assets`)
      .set('Cookie', cookie).set('X-Portal', 'supplier').attach('file', PLAIN2, { filename: 'a.outer' }).expect(200);
    const p1 = await request(app.getHttpServer()).post(`/api/supplier-portal/bid-submissions/${proj.id}/operations/prepare`)
      .set('Cookie', cookie).set('X-Portal', 'supplier').send({ action: 'submit' }).expect(200);
    const env1 = await mkEnvFor(up1.body.fileAssetId, 1);
    await request(app.getHttpServer()).post(`/api/supplier-portal/bid-submissions/${proj.id}/operations/${p1.body.operationId}/signing-payload`)
      .set('Cookie', cookie).set('X-Portal', 'supplier').send({ envelope: env1 }).expect(200);
    const s1 = await request(app.getHttpServer()).post(`/api/supplier-portal/bid-submissions/${proj.id}/submit`)
      .set('Cookie', cookie).set('X-Portal', 'supplier')
      .send({ operationId: p1.body.operationId, signatureFormat: 'scca-pkcs7-base64', signP7: B64('e2e-r-p7'), baseRevision: 0 }).expect(201);
    const subId = s1.body.submissionId;
    // 开标态 + 外层已解 → 坏明文 DANGER
    await prisma.bidSupplier.updateMany({ where: { projectId: proj.id, supplierId }, data: { checkInAt: new Date() } });
    await prisma.bidProject.update({ where: { id: proj.id }, data: { stage: 'OPENING' } });
    await prisma.bidOpeningSession.create({ data: { projectId: proj.id, host: '陈源远', decryptWindowStart: new Date(), decryptWindowEnd: new Date(Date.now() + 3600_000) } });
    const innerA = await prisma.fileAsset.create({ data: { key: `bid-inner-e2e/r-${Date.now()}.inner`, originalName: 't.inner', mimeType: 'application/octet-stream', size: 64, sha256: 'd'.repeat(64), category: 'bid_inner_ciphertext', clientEncrypted: false, encrypted: true } });
    await prisma.supplierBidSubmission.update({ where: { id: subId }, data: { outerDecryptedAt: new Date(), innerAssets: { technical: innerA.id } as any } });
    await request(app.getHttpServer()).post(`/api/supplier-portal/bid-submissions/${proj.id}/decrypt-upload`)
      .set('Cookie', cookie).set('X-Portal', 'supplier')
      .field('fieldsJson', canonicalJson(FIELDS)).field('nonce', NONCE)
      .attach('file_technical', Buffer.from('tampered!'), { filename: 't.plain' })
      .expect(201).expect((r) => expect(r.body.decryptStatus).toBe('DANGER'));
    // 补传：锚点下发 → 重封（同 plain/fieldsCommit，新 assetId，ctx rev2）
    const rc = await request(app.getHttpServer()).get(`/api/supplier-portal/bid-submissions/${proj.id}/reupload-context`)
      .set('Cookie', cookie).set('X-Portal', 'supplier').expect(200);
    expect(rc.body.baseRevision).toBe(1);
    expect(rc.body.fieldsCommit).toBe(fieldsCommit);
    const up2 = await request(app.getHttpServer()).post(`/api/supplier-portal/bid-submissions/${proj.id}/encrypted-assets`)
      .set('Cookie', cookie).set('X-Portal', 'supplier').attach('file', PLAIN2, { filename: 'a2.outer' }).expect(200);
    const p2 = await request(app.getHttpServer()).post(`/api/supplier-portal/bid-submissions/${proj.id}/operations/prepare`)
      .set('Cookie', cookie).set('X-Portal', 'supplier').send({ action: 'reupload' }).expect(200);
    const env2 = await mkEnvFor(up2.body.fileAssetId, 2);
    (env2.files.technical as any).outerSha256 = up2.body.outerSha256; // staged 实算对齐
    await request(app.getHttpServer()).post(`/api/supplier-portal/bid-submissions/${proj.id}/operations/${p2.body.operationId}/signing-payload`)
      .set('Cookie', cookie).set('X-Portal', 'supplier').send({ envelope: env2 }).expect(200);
    const ru = await request(app.getHttpServer()).post(`/api/supplier-portal/bid-submissions/${proj.id}/reupload-v3`)
      .set('Cookie', cookie).set('X-Portal', 'supplier')
      .send({ operationId: p2.body.operationId, signatureFormat: 'scca-pkcs7-base64', signP7: B64('e2e-ru-p7'), baseRevision: 1 }).expect(201);
    expect(ru.body.revision).toBe(2);
    const roster = await prisma.bidSupplier.findFirst({ where: { projectId: proj.id, supplierId } });
    expect(roster?.decryptStatus).toBe('PENDING');
    const bk2 = await prisma.bidFileBackup.findFirst({ where: { projectId: proj.id, supplierId, fileRole: 'technical', revision: 2 } });
    expect(bk2?.cryptoVersion).toBe('dual-envelope-v3');
    // 重解：外层重解（DB 模拟）→ 正确明文 SUCCESS
    const innerB = await prisma.fileAsset.create({ data: { key: `bid-inner-e2e/r2-${Date.now()}.inner`, originalName: 't.inner', mimeType: 'application/octet-stream', size: 64, sha256: 'd'.repeat(64), category: 'bid_inner_ciphertext', clientEncrypted: false, encrypted: true } });
    await prisma.supplierBidSubmission.update({ where: { id: subId }, data: { outerDecryptedAt: new Date(), innerAssets: { technical: innerB.id } as any } });
    await prisma.bidSupplier.updateMany({ where: { projectId: proj.id, supplierId }, data: { decryptStatus: 'PENDING' } });
    await request(app.getHttpServer()).post(`/api/supplier-portal/bid-submissions/${proj.id}/decrypt-upload`)
      .set('Cookie', cookie).set('X-Portal', 'supplier')
      .field('fieldsJson', canonicalJson(FIELDS)).field('nonce', NONCE)
      .attach('file_technical', PLAIN2, { filename: 't.plain' })
      .expect(201).expect((r) => expect(r.body.decryptStatus).toBe('SUCCESS'));
    // 清场（本项目前缀）
    await prisma.bidSupervisionLog.deleteMany({ where: { projectId: proj.id } }).catch(() => {});
    await prisma.supplierBidSubmission.deleteMany({ where: { projectId: proj.id } }).catch(() => {});
    await prisma.bidOpeningRecord.deleteMany({ where: { projectId: proj.id } }).catch(() => {});
    await prisma.bidSupplier.deleteMany({ where: { projectId: proj.id } }).catch(() => {});
    await prisma.bidOpeningSession.deleteMany({ where: { projectId: proj.id } }).catch(() => {});
    await prisma.decryptExecution.deleteMany({ where: { submissionId: subId } }).catch(() => {});
    await prisma.outbox.deleteMany({ where: { topic: 'bid.submitted.v3', payload: { path: ['projectId'], equals: proj.id } as any } }).catch(() => {});
    await prisma.fileAsset.deleteMany({ where: { OR: [{ key: { startsWith: `v3-staging/${proj.id}/` } }, { key: { startsWith: 'bid-inner-e2e/' } }] } }).catch(() => {});
    await prisma.bidProject.delete({ where: { id: proj.id } }).catch(() => {});
  });

  it('⑩ Outbox：dispatchOnce→通知主持人→SENT（恰一条）', async () => {
    // 自建确定性 PENDING 事件（③ 的事件可能已被 EVERY_30_SECONDS cron 自动消费——不依赖时序）
    const me = await prisma.user.findUnique({ where: { username_role: { username: USER, role: 'supplier' } } });
    await prisma.bidProject.update({ where: { id: projectId }, data: { assignedHostUserId: me!.id } }).catch(() => {});
    const ob = await prisma.outbox.create({ data: { topic: 'bid.submitted.v3', payload: { projectId, submissionId: 'e2e-evt', revision: 99, operationId: 'e2e-evt' } as any } });
    const dispatcher = app.get(OutboxDispatchService);
    const r = await dispatcher.dispatchOnce();
    expect(r.sent).toBeGreaterThanOrEqual(1);
    const evt = await prisma.outbox.findUnique({ where: { id: ob.id } });
    expect(evt?.status).toBe('SENT');
    expect(evt?.publishedAt).toBeTruthy();
    const notice = await prisma.notification.findFirst({ where: { userId: me!.id, type: 'BID_SUBMITTED_V3' } });
    expect(notice?.link).toBe('/bid');
    await prisma.notification.deleteMany({ where: { userId: me!.id, type: 'BID_SUBMITTED_V3' } }).catch(() => {});
  });

  afterAll(async () => {
    if (projectId) {
      await prisma.bidSupervisionLog.deleteMany({ where: { projectId } }).catch(() => {});
      await prisma.supplierBidSubmission.deleteMany({ where: { projectId } }).catch(() => {});
      await prisma.bidOpeningRecord.deleteMany({ where: { projectId } }).catch(() => {});
      await prisma.bidSupplier.deleteMany({ where: { projectId } }).catch(() => {});
      await prisma.bidOpeningSession.deleteMany({ where: { projectId } }).catch(() => {});
      await prisma.caOperation.deleteMany({ where: { subjectId: supplierId } }).catch(() => {});
      await prisma.decryptExecution.deleteMany({ where: { submissionId } }).catch(() => {});
      await prisma.outbox.deleteMany({ where: { topic: 'bid.submitted.v3' } }).catch(() => {});
      await prisma.bidProject.delete({ where: { id: projectId } }).catch(() => {});
    }
    // 落库的外层暂存/内层资产清理（v3-staging/bid-inner-e2e 前缀）
    // I-A（复审）：v3-staging/ 是生产端点真实前缀——共享库上全局删会误删他人在途暂存；
    // 收窄到本项目前缀（bid-inner-e2e/ 为测试专属前缀保持全局）
    if (projectId) {
      await prisma.fileAsset.deleteMany({ where: { OR: [
        { key: { startsWith: `v3-staging/${projectId}/` } }, { key: { startsWith: 'bid-inner-e2e/' } },
      ] } }).catch(() => {});
    }
    await app.close();
  });
});
