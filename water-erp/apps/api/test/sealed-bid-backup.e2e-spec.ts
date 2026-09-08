import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { minioClient, MINIO_BUCKET, ensureBucket } from '../src/upload/minio.client';

async function loginAs(app: INestApplication, username: string, password: string, portal: string): Promise<string[]> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login').set('X-Portal', portal).send({ username, password });
  const cookie = res.headers['set-cookie'];
  return Array.isArray(cookie) ? cookie : cookie ? [cookie] : [];
}

async function readAll(stream: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}

describe('Sealed Bid Backup (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminCookie: string[];
  let supplierCookie: string[];
  let projectId: string;
  let supplierId: string;
  let assetId: string;

  const plaintext = Buffer.from('E2E 投标文件内容 ' + Date.now(), 'utf-8');
  const plainSha = crypto.createHash('sha256').update(plaintext).digest('hex');
  const assetKey = `e2e/bid-${Date.now()}.txt`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await ensureBucket();

    prisma = app.get(PrismaService);
    adminCookie = await loginAs(app, 'Swhi-CGZX-admin', 'Swhi-CGZX-admin@2026', 'web');       // web 门户 admin 会话
    expect(adminCookie.join()).toContain('token_web=');
    supplierCookie = await loginAs(app, '重庆蜀通岩土工程有限公司', 'supplier@2026', 'supplier');

    const user = await prisma.user.findFirst({ where: { username: '重庆蜀通岩土工程有限公司', role: 'supplier' } });
    const supplier = await prisma.supplier.findUnique({ where: { userId: user!.id } });
    supplierId = supplier!.id;

    // 建项目并强制进入 SUBMIT 阶段、截止时间设为未来
    // 2026-08-21 起截标↔开标 24h 规则：创建时 deadline 必须 = openTime−24h（align 模式 ±60s）
    const pres = await request(app.getHttpServer())
      .post('/api/bid/projects').set('Cookie', adminCookie).set('X-Portal', 'web')
      .send({ name: `E2E备份-${Date.now()}`, procurementMethod: '公开招标', openTime: '2099-12-31T09:00:00Z', deadline: '2099-12-30T09:00:00Z' })
      .expect(201);
    projectId = pres.body.id;
    await prisma.bidProject.update({ where: { id: projectId }, data: { stage: 'SUBMIT', deadline: new Date('2099-12-30T17:00:00Z') } });

    // G3 权威兜底（C3 起投递时校验已发布招标公告）：补一条关联公告，否则 submit 被拒
    await prisma.announcement.create({
      data: { title: `E2E备份公告-${Date.now()}`, content: '<p>x</p>', type: 'BID_NOTICE', status: 'PUBLISHED', relatedProjectCode: pres.body.projectCode, aiSummary: 'x' },
    });

    // 造一个 supplier1 名下的 bid_document FileAsset，并把明文写入 MinIO（供 submit 读取加密）
    const asset = await prisma.fileAsset.create({
      data: { key: assetKey, originalName: 'bid.txt', mimeType: 'text/plain', size: plaintext.length, sha256: plainSha, category: 'bid_document', uploaderId: user!.id, encrypted: false },
    });
    assetId = asset.id;
    await minioClient.putObject(MINIO_BUCKET, assetKey, plaintext, plaintext.length, { 'Content-Type': 'text/plain' });
  });

  afterAll(async () => {
    if (projectId) {
      const proj = await prisma.bidProject.findUnique({ where: { id: projectId }, select: { projectCode: true } }).catch(() => null);
      if (proj?.projectCode) await prisma.announcement.deleteMany({ where: { relatedProjectCode: proj.projectCode } }).catch(() => {});
      await prisma.bidFileBackup.deleteMany({ where: { projectId } }).catch(() => {});
      await prisma.supplierBidSubmission.deleteMany({ where: { projectId } }).catch(() => {});
      await prisma.bidSupervisionLog.deleteMany({ where: { projectId } }).catch(() => {});
      await prisma.bidSupplier.deleteMany({ where: { projectId } }).catch(() => {});
      await prisma.bidProject.delete({ where: { id: projectId } }).catch(() => {});
    }
    if (assetId) await prisma.fileAsset.deleteMany({ where: { id: assetId } }).catch(() => {});
    await minioClient.removeObject(MINIO_BUCKET, assetKey).catch(() => {});
    await app.close();
  });

  it('非 admin/bid_host（supplier）调用核验端点 → 403', async () => {
    await request(app.getHttpServer())
      .get(`/api/bid/projects/${projectId}/backup-verify/${supplierId}`)
      .set('Cookie', supplierCookie).set('X-Portal', 'supplier')
      .expect(403);
  });

  it('供应商提交后生成未解密备份行（密文 + sha256 + wrappedDek）', async () => {
    await request(app.getHttpServer())
      .post(`/api/supplier-portal/bid-submissions/${projectId}/submit`)
      .set('Cookie', supplierCookie).set('X-Portal', 'supplier')
      // P1-1 旧轨投递闸门：须勾选代解密授权（hostDecryptAuthorized=true，办法第30条留痕）
      .send({ technicalFileAssetId: assetId, bidPrice: '1000000', deliveryPeriod: '90天', hostDecryptAuthorized: true })
      .expect(201);

    const submission = await prisma.supplierBidSubmission.findUnique({ where: { supplierId_projectId: { supplierId, projectId } } });
    expect(submission!.status).toBe('submitted');
    expect(submission!.technicalSealedKey).toBeTruthy();

    const backup = await prisma.bidFileBackup.findUnique({ where: { supplierId_projectId_fileRole: { supplierId, projectId, fileRole: 'technical' } } });
    expect(backup).toBeTruthy();
    expect(backup!.backupSource).toBe('submission');
    expect(backup!.sealedPath).toBeTruthy();
    expect(backup!.wrappedDek).toBe(submission!.technicalSealedKey);

    // 备份对象确实存在于 MinIO，且 sha256 与入库记录一致
    const buf = await readAll(await minioClient.getObject(MINIO_BUCKET, backup!.backupKey));
    expect(crypto.createHash('sha256').update(buf).digest('hex')).toBe(backup!.ciphertextSha256);
  });

  it('核验端点：提交后 overall=consistent，sealed 与备份密文一致', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/bid/projects/${projectId}/backup-verify/${supplierId}`)
      .set('Cookie', adminCookie).set('X-Portal', 'web')
      .expect(200);
    expect(res.body.overall).toBe('consistent');
    const tech = res.body.perFile.find((f: any) => f.fileRole === 'technical');
    expect(tech.backupIntact).toBe(true);
    expect(tech.sealedMatchesBackup).toBe(true);
  });

  it('篡改 sealedPath 密文后核验 → tampered', async () => {
    const backup = await prisma.bidFileBackup.findUnique({ where: { supplierId_projectId_fileRole: { supplierId, projectId, fileRole: 'technical' } } });
    await minioClient.putObject(MINIO_BUCKET, backup!.sealedPath, Buffer.from('tampered'), 8, { 'Content-Type': 'application/octet-stream' });
    const res = await request(app.getHttpServer())
      .get(`/api/bid/projects/${projectId}/backup-verify/${supplierId}`)
      .set('Cookie', adminCookie).set('X-Portal', 'web')
      .expect(200);
    expect(res.body.overall).toBe('tampered');
    expect(res.body.perFile.find((f: any) => f.fileRole === 'technical').sealedMatchesBackup).toBe(false);
  });
});
