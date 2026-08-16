import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

async function loginAs(app: INestApplication, username: string, password: string, portal: string): Promise<string[]> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .set('X-Portal', portal)
    .send({ username, password });
  const cookie = res.headers['set-cookie'];
  return Array.isArray(cookie) ? cookie : cookie ? [cookie] : [];
}

describe('评标签字包全流程 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hostCookie: string[];   // 陈源远 bid_host（:3007 主持人）
  let leaderCookie: string[]; // Swhi-CGZX-01（:3005 归档）
  let projectId: string;
  let supplierId: string;
  const expertIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    hostCookie = await loginAs(app, '陈源远', '陈源远@2026', 'web');
    leaderCookie = await loginAs(app, 'Swhi-CGZX-01', 'Swhi-CGZX-01@2026', 'web');

    // 建项目（对齐 bid.e2e 模式：openTime 在 deadline 之后，均远未来）
    const proj = await request(app.getHttpServer())
      .post('/api/bid/projects')
      .set('Cookie', hostCookie)
      .set('X-Portal', 'web')
      .send({ name: `签字E2E项目-${Date.now()}`, procurementMethod: '公开招标', openTime: '2099-12-31T09:00:00Z', deadline: '2099-12-30T17:00:00Z' })
      .expect(201);
    projectId = proj.body.id;

    // fixture：供应商已解密确认（跳过开标流程，直接评标前置）
    // 注意：BidSupplier.supplierId 外键指向 Supplier.id（非 User.id）——取 Supplier 行，勿用 user 表 id（否则 P2003）
    const supplierRec = await prisma.supplier.findFirst();
    const supplier = await prisma.bidSupplier.create({
      data: {
        projectId, supplierId: supplierRec?.id ?? null, supplierName: supplierRec?.name ?? 'E2E供应商',
        submitStatus: '已提交', decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED',
      },
    });
    supplierId = supplier.id;

    // fixture：开标唱标记录（归档闸门 OPENING_RECORDS_MISSING 依赖，full/opening 双 scope 校验）
    await prisma.bidOpeningRecord.create({
      data: {
        projectId, supplierName: supplierRec?.name ?? 'E2E供应商', amount: '4800000', period: '90日历天',
        qualityTarget: '合格', bondStatus: '已缴纳', decryptResult: '解密成功', confirmStatus: 'CONFIRMED',
        bidSupplierId: supplierId, confirmedAt: new Date(),
      },
    });

    // fixture：评分标准（满足生成结果所需数据）+ 3 名正选专家（1 组长）全部确认 + 末签
    await prisma.bidScoreItem.createMany({
      data: [
        { projectId, category: 'QUALIFICATION', name: '资格性审查', maxScore: 0 },
        { projectId, category: 'RESPONSIVE', name: '符合性审查', maxScore: 0 },
        { projectId, category: 'BUSINESS', name: '商务评分', maxScore: 20 },
        { projectId, category: 'TECHNICAL', name: '技术评分', maxScore: 50 },
        { projectId, category: 'PRICE', name: '价格评分', maxScore: 30 },
      ],
    });
    const items = await prisma.bidScoreItem.findMany({ where: { projectId, maxScore: { gt: 0 } } });
    for (const it of items) {
      await prisma.bidScorePoint.create({ data: { scoreItemId: it.id, name: `${it.name}-要点1`, fullScore: Number(it.maxScore), seq: 1 } });
    }
    const expertUsers = await prisma.user.findMany({ where: { role: 'bid_expert' }, take: 3 });
    for (let i = 0; i < expertUsers.length; i++) {
      const expert = await prisma.bidExpert.create({
        data: {
          projectId, userId: expertUsers[i].id, expertName: expertUsers[i].username, major: '综合',
          isLead: i === 0, expertRole: '正选', signedIn: true, reportConfirmed: true,
          reportConfirmedAt: new Date(),
        },
      });
      expertIds.push(expert.id);
      for (const it of items) {
        await prisma.bidScoreRecord.create({ data: { expertId: expert.id, supplierId, scoreItemId: it.id, score: 18, passed: true } });
      }
    }
    await prisma.bidProject.update({ where: { id: projectId }, data: { stage: 'EVALUATING', leaderCoSigned: true, leaderCoSignedAt: new Date() } });

    // 生成评标结果（前置全绿）
    await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectId}/evaluation-results/generate`)
      .set('Cookie', hostCookie)
      .set('X-Portal', 'web')
      .expect(201);
  });

  afterAll(async () => {
    if (projectId) {
      await prisma.bidScorePoint.deleteMany({ where: { scoreItem: { projectId } } }).catch(() => {});
      await prisma.bidScoreRecord.deleteMany({ where: { expertId: { in: expertIds } } }).catch(() => {});
      await prisma.bidExpert.deleteMany({ where: { projectId } }).catch(() => {});
      await prisma.bidScoreItem.deleteMany({ where: { projectId } }).catch(() => {});
      await prisma.bidSupplier.deleteMany({ where: { projectId } }).catch(() => {});
      await prisma.bidOpeningRecord.deleteMany({ where: { projectId } }).catch(() => {});
      await prisma.fileAsset.deleteMany({ where: { key: { startsWith: `bid-evaluation-handover/${projectId}` } } }).catch(() => {});
      await prisma.fileAsset.deleteMany({ where: { key: { startsWith: `bid-sign-packet/${projectId}` } } }).catch(() => {});
      await prisma.fileAsset.deleteMany({ where: { key: { startsWith: `bid-sign-handover/${projectId}` } } }).catch(() => {});
      await prisma.bidSignPacket.deleteMany({ where: { projectId } }).catch(() => {});
      await prisma.bidProject.delete({ where: { id: projectId } }).catch(() => {});
    }
    await app.close();
  });

  it('未生成签字包时 GET 返回 canGenerate=true、packet=null', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/bid/projects/${projectId}/sign-packet`)
      .set('Cookie', hostCookie).set('X-Portal', 'web').expect(200);
    expect(res.body.resultsGenerated).toBe(true);
    expect(res.body.packet).toBeNull();
    expect(res.body.experts).toHaveLength(3);
  });

  it('生成签字包 → 包与指纹存在，全员 PENDING', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectId}/sign-packet/generate`)
      .set('Cookie', hostCookie).set('X-Portal', 'web').expect(201);
    expect(res.body.packet.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.experts.every((e: any) => e.signStatus === 'PENDING')).toBe(true);
  });

  it('扫描上传 → 闭环前撤销回 PENDING → 重登视为同意（spec §11 扫描回传链路）', async () => {
    // 上传专家签字扫描件（multipart 字段名 'file'，与 Task 5 FileInterceptor('file') 一致；走 MinIO，需 infra up——与 upload e2e 同前提）
    const up = await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectId}/sign-packet/experts/${expertIds[2]}/scan`)
      .set('Cookie', hostCookie).set('X-Portal', 'web')
      .attach('file', Buffer.from('fake-scan-bytes'), { filename: 'sign.png', contentType: 'image/png' })
      .expect(201);
    // 专家扫描落 BidExpert.signScanFileId，响应中对应 experts[].signScanUrl（signPageScanFileId 是主报告签字页字段，勿混用）
    expect(up.body.experts.find((e: any) => e.expertId === expertIds[2])?.signScanUrl).toBeTruthy();

    // 先登记为已签（撤销登记要求存在登记记录；扫描上传本身不改变 signStatus）
    await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectId}/sign-packet/experts/${expertIds[2]}/register`)
      .set('Cookie', hostCookie).set('X-Portal', 'web')
      .send({ status: 'SIGNED' }).expect(201);

    // 闭环前撤销：状态回 PENDING
    const un = await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectId}/sign-packet/experts/${expertIds[2]}/unregister`)
      .set('Cookie', hostCookie).set('X-Portal', 'web').expect(201);
    expect(un.body.allClosed).toBe(false);

    // 重登：拒绝且未陈述理由 → 视为同意（§43）
    await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectId}/sign-packet/experts/${expertIds[2]}/register`)
      .set('Cookie', hostCookie).set('X-Portal', 'web')
      .send({ status: 'DEEMED_AGREED' }).expect(201);
  });

  it('§43：拒绝不填意见 → 400 SIGN_DISSENT_REQUIRED', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectId}/sign-packet/experts/${expertIds[1]}/register`)
      .set('Cookie', hostCookie).set('X-Portal', 'web')
      .send({ status: 'REFUSED_DISSENT' }).expect(400);
    expect(res.body.code).toBe('SIGN_DISSENT_REQUIRED');
  });

  it('逐专家登记：已签 / 拒绝附意见 / 视为同意；撤销后重登仍闭环', async () => {
    const sign = (expertId: string, body: any) =>
      request(app.getHttpServer())
        .post(`/api/bid/projects/${projectId}/sign-packet/experts/${expertId}/register`)
        .set('Cookie', hostCookie).set('X-Portal', 'web').send(body);

    await sign(expertIds[0], { status: 'SIGNED' }).expect(201);
    await sign(expertIds[1], { status: 'REFUSED_DISSENT', dissentingOpinion: '对价格分计算有异议', dissentingReason: '公式系数与实际不符' }).expect(201);
    // expertIds[2] 已在上一用例以 DEEMED_AGREED 登记——本轮登记 expertIds[1] 后全员终局，触发闭环

    const closedRes = await request(app.getHttpServer())
      .get(`/api/bid/projects/${projectId}/sign-packet`)
      .set('Cookie', hostCookie).set('X-Portal', 'web').expect(200);
    expect(closedRes.body.allClosed).toBe(true);
    expect(closedRes.body.packet.closed).toBe(true);

    // 闭环后撤销 → 409
    await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectId}/sign-packet/experts/${expertIds[0]}/unregister`)
      .set('Cookie', hostCookie).set('X-Portal', 'web').expect(409);
  });

  it('闭环后回流缺失 → 归档 409 HANDOVER_NOT_GENERATED；生成回流包后归档成功', async () => {
    // 上一用例已全员闭环、回流未生成：完整归档应 409 HANDOVER_NOT_GENERATED（闸门顺序：签字包已生成→闭环✓→回流✗）
    const blocked = await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectId}/archive-all`)
      .set('Cookie', leaderCookie).set('X-Portal', 'web')
      .send({ scope: 'full' }).expect(409);
    expect(blocked.body.code).toBe('HANDOVER_NOT_GENERATED');

    const ho = await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectId}/sign-packet/handover`)
      .set('Cookie', hostCookie).set('X-Portal', 'web').expect(201);
    expect(ho.body.packet.handoverFileAssetId).toBeTruthy();

    // 幂等：再次生成直接返回既有包
    await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectId}/sign-packet/handover`)
      .set('Cookie', hostCookie).set('X-Portal', 'web').expect(201);

    const archived = await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectId}/archive-all`)
      .set('Cookie', leaderCookie).set('X-Portal', 'web')
      .send({ scope: 'full' }).expect(201);
    const names = archived.body.archiveItems.map((i: any) => i.name);
    expect(names).toContain('评标签字包');
  });

  it('供应商角色访问签字包端点 → 403', async () => {
    const supplierCookie = await loginAs(app, '重庆蜀通岩土工程有限公司', 'supplier@2026', 'supplier');
    await request(app.getHttpServer())
      .get(`/api/bid/projects/${projectId}/sign-packet`)
      .set('Cookie', supplierCookie).set('X-Portal', 'supplier').expect(403);
  });
});
