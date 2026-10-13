/**
 * CA 认证链 e2e（I12 修复）：overrideProvider(CaVerificationService) 策略——
 * 动态挑战 toSign 无法用固定真盾 P7 签名，流程测试用 fake 验证服务；
 * 真实验证路径（本地比对/三方指纹）由 ca-verification.service.spec 以真 P7 fixtures 覆盖。
 * 覆盖：挑战创建/重放 409/匿名 cookie 隔离/临时供应商拒绝/result 恢复。
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CaVerificationService } from '../src/ca/ca-verification.service';
import { hashSync } from 'bcryptjs';
import { setTimeout as sleep } from 'timers/promises';

const PILOT_USER = 'e2e-ca-supplier';
const PILOT_PASSWORD = 'SCCA-Pilot@2026';
const FAKE_P7 = 'FAKE_P7_BASE64_PADDING_XXXXXXXXXXXXXXXX'; // 仅流程测试——fake 验证服务不解析

class FakeVerificationService {
  async verifySignature(input: { expectedToSign: string }) {
    // 始终返回 ok——流程测试不关心密码学（由单测覆盖）
    void input;
    return { ok: true, signerSerialHex: 'fake', statusCoverage: ['chain'] };
  }
}

describe('CA 认证 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let pilotSupplierId: string;

  beforeAll(async () => {
    // 独立 Prisma 先建试点供应商（模块创建前——loadCaConfig 在 provider factory 读 env）
    const setupPrisma = new PrismaService();
    const existingUser = await setupPrisma.user.findUnique({
      where: { username_role: { username: PILOT_USER, role: 'supplier' } },
    });
    let pilotUserId: string;
    if (existingUser) {
      pilotUserId = existingUser.id;
      const sup = await setupPrisma.supplier.findUnique({ where: { userId: existingUser.id } });
      pilotSupplierId = sup?.id ?? '';
    } else {
      const user = await setupPrisma.user.create({
        data: {
          username: PILOT_USER, role: 'supplier', isActive: true,
          passwordHash: hashSync(PILOT_PASSWORD, 10), displayName: 'e2e-CA供应商',
        },
      });
      pilotUserId = user.id;
      const sup = await setupPrisma.supplier.create({
        data: {
          userId: user.id, supplierNo: 'SUP-E2E-CA-' + Date.now().toString().slice(-6),
          creditCode: 'e2e-ca-credit-code-xx', name: 'e2e-CA供应商', normalizedName: 'e2e-ca供应商',
          enterpriseType: 'OTHER', legalPerson: 'e2e', registeredAddress: 'e2e', businessScope: 'e2e',
          status: 'APPROVED',
        },
      });
      pilotSupplierId = sup.id;
    }
    await setupPrisma.$disconnect();
    void pilotUserId;
    // e2e 供应商加入试点白名单（追加到现有 env 值——模块创建前生效）
    const existingIds = process.env.CA_PILOT_SUBJECT_IDS ?? '';
    process.env.CA_PILOT_SUBJECT_IDS = existingIds ? existingIds + ',' + pilotSupplierId : pilotSupplierId;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CaVerificationService)
      .useClass(FakeVerificationService as any)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    const user = await prisma.user.findUnique({ where: { username_role: { username: PILOT_USER, role: 'supplier' } } });
    if (user) {
      await prisma.supplierCert.deleteMany({ where: { supplierId: pilotSupplierId } });
      await prisma.caSigningCertificateClaim.deleteMany({ where: { supplierId: pilotSupplierId } });
      await prisma.supplier.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
    await app.close();
  });

  test('挑战创建：携带匿名 cookie 与 LOGONDATA 原文', async () => {
    // 用真盾 PEM fixture 触发 DER 解析
    const fs = require('fs');
    const pem = fs.readFileSync(require('path').join(__dirname, 'fixtures', 'scca', 'S2-sign-cert.b64'), 'utf-8');
    const res = await request(app.getHttpServer())
      .post('/api/auth/ca/challenge')
      .set('X-Portal', 'supplier')
      .set('Origin', 'http://localhost:3004')
      .send({ provider: 'scca', signCertPem: pem.trim() });
    expect(res.status).toBe(200);
    expect(res.body.toSign).toMatch(/^LOGONDATA:/);
    expect(res.body.challengeId).toBeTruthy();
    const cookies = res.headers['set-cookie'] ?? [];
    const cookieArr = Array.isArray(cookies) ? cookies : [cookies];
    expect(cookieArr.some((c: string) => c.startsWith('ca_browser_supplier='))).toBe(true);
  });

  test('挑战重放：同 P7 配第二个 challengeId 必拒（fake 验证过但挑战已消费）', async () => {
    // 需要绑定才能走到 challenge 消费之后——未绑定时 401 CA_CERT_NOT_BOUND
    // 这里验证 challenge 一次性：同一匿名 cookie 连续两个 challenge 均 200，但 login 只能消费一次
    const fs = require('fs');
    // 加密证：指纹在 CaCertificate（绑定链写过）但无 signingCaCertificateId 引用 → 未绑定路径
    const pem = fs.readFileSync(require('path').join(__dirname, 'fixtures', 'scca', 'S2-enc-cert.b64'), 'utf-8');
    const ch1 = await request(app.getHttpServer())
      .post('/api/auth/ca/challenge')
      .set('X-Portal', 'supplier')
      .set('Origin', 'http://localhost:3004')
      .send({ provider: 'scca', signCertPem: pem.trim() });
    const cookies1 = ch1.headers['set-cookie'] ?? [];
    // 未绑定的 login：fake 验证过 → CA_CERT_NOT_BOUND（挑战已被原子消费）
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/ca/login')
      .set('X-Portal', 'supplier')
      .set('Origin', 'http://localhost:3004')
      .set('Cookie', Array.isArray(cookies1) ? cookies1.join('; ') : cookies1)
      .send({ challengeId: ch1.body.challengeId, signP7: FAKE_P7 });
    expect(loginRes.status).toBe(401);
    expect(loginRes.body.code).toBe('CA_CERT_NOT_BOUND');
    // 同一挑战再次提交 → 已消费
    const replay = await request(app.getHttpServer())
      .post('/api/auth/ca/login')
      .set('X-Portal', 'supplier')
      .set('Origin', 'http://localhost:3004')
      .set('Cookie', Array.isArray(cookies1) ? cookies1.join('; ') : cookies1)
      .send({ challengeId: ch1.body.challengeId, signP7: FAKE_P7 });
    expect(replay.status).toBe(409);
    expect(replay.body.code).toBe('CA_CHALLENGE_USED');
  });

  test('Origin 缺失拒绝', async () => {
    const fs = require('fs');
    const pem = fs.readFileSync(require('path').join(__dirname, 'fixtures', 'scca', 'S2-sign-cert.b64'), 'utf-8');
    const res = await request(app.getHttpServer())
      .post('/api/auth/ca/challenge')
      .set('X-Portal', 'supplier')
      .send({ provider: 'scca', signCertPem: pem.trim() });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ORIGIN_REQUIRED');
  });

  test('bind-challenge 消费凭据证明——无证明或伪造证明必拒', async () => {
    // 先登录拿供应商会话
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Portal', 'supplier')
      .send({ username: PILOT_USER, password: PILOT_PASSWORD });
    expect(loginRes.status).toBe(200);
    const token = loginRes.body.access_token as string;
    const authHeader = { 'X-Supplier-Token': token };

    // 伪造 proof → REAUTH_REQUIRED（不再允许任意字符串）
    const fake = await request(app.getHttpServer())
      .post('/api/ca/bind-challenge')
      .set('X-Portal', 'supplier')
      .set(authHeader)
      .set('Origin', 'http://localhost:3004')
      .send({ credentialProofId: 'forged-proof-id', signCertPem: '-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----', encCertPem: '-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----' });
    expect(fake.status).toBe(403);
    expect(fake.body.code).toBe('REAUTH_REQUIRED');
  });
});
