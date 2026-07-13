import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/** 登录并返回 cookie；需带 X-Portal 以匹配按门户命名的 cookie */
async function loginAs(
  app: INestApplication,
  username: string,
  password: string,
  portal: string,
): Promise<string[]> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .set('X-Portal', portal)
    .send({ username, password });
  const cookie = res.headers['set-cookie'];
  return Array.isArray(cookie) ? cookie : cookie ? [cookie] : [];
}

describe('Bid Lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminCookie: string[];
  let supplierCookie: string[];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);

    adminCookie = await loginAs(app, '陈主任', 'czr@2026', 'web');
    supplierCookie = await loginAs(app, 'supplier1', 'supplier1@2026', 'supplier');
  });

  afterAll(async () => {
    if (createdProjectId) {
      await prisma.bidSupervisionLog.deleteMany({ where: { projectId: createdProjectId } });
      await prisma.bidScoreItem.deleteMany({ where: { projectId: createdProjectId } });
      await prisma.bidExpert.deleteMany({ where: { projectId: createdProjectId } });
      await prisma.aiBidAnalysisTask.deleteMany({ where: { projectId: createdProjectId } }).catch(() => {});
      await prisma.bidSupplier.deleteMany({ where: { projectId: createdProjectId } });
      await prisma.bidProject.delete({ where: { id: createdProjectId } }).catch(() => {});
    }
    await app.close();
  });

  let createdProjectId: string;
  let createdProjectCode: string;
  let createdSupplierId: string;

  it('管理员可创建招标项目', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/bid/projects')
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .send({
        name: `E2E测试项目-${Date.now()}`,
        procurementMethod: '公开招标',
        openTime: '2099-12-31T09:00:00Z',
        deadline: '2099-12-30T17:00:00Z',
      })
      .expect(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('projectCode');
    expect(res.body.stage).toBe('DOWNLOAD');
    createdProjectId = res.body.id;
    createdProjectCode = res.body.projectCode;

    // G3：开放投递（DOWNLOAD→SUBMIT）前必须先发布关联的招标公示，否则 openSubmission 抛 409
    await request(app.getHttpServer())
      .post('/api/announcements')
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .send({
        title: `E2E招标公示-${Date.now()}`,
        content: '<p>E2E 测试招标公示</p>',
        type: 'BID_NOTICE',
        status: 'PUBLISHED',
        relatedProjectCode: createdProjectCode,
        aiSummary: 'E2E 测试摘要', // 给定 aiSummary 跳过 LLM 摘要调用
      })
      .expect(201);
  });

  it('管理员可推进阶段 DOWNLOAD → SUBMIT', () => {
    return request(app.getHttpServer())
      .post(`/api/bid/projects/${createdProjectId}/open-submission`)
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .expect(201);
  });

  it('重复推进同阶段幂等成功', () => {
    return request(app.getHttpServer())
      .post(`/api/bid/projects/${createdProjectId}/open-submission`)
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .expect(201);
  });

  it('跳级推进 DOWNLOAD → EVALUATING 返回 409', () => {
    return request(app.getHttpServer())
      .post(`/api/bid/projects/${createdProjectId}/start-evaluation`)
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .expect(409);
  });

  it('供应商通过供应商门户提交投标（SUBMIT 阶段，真实路径）', async () => {
    // 真实投标统一走供应商门户（管理员代投路径已移除）
    await request(app.getHttpServer())
      .post(`/api/supplier-portal/bid-submissions/${createdProjectId}/submit`)
      .set('Cookie', supplierCookie)
      .set('X-Portal', 'supplier')
      .send({ bidPrice: '100' })
      .expect(201);

    // 投标后管理端可见该供应商，取 BidSupplier.id 供后续解密
    const res = await request(app.getHttpServer())
      .get(`/api/bid/projects/${createdProjectId}/suppliers`)
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .expect(200);
    const supplier = (res.body as any[]).find((s: any) => s.supplierName);
    expect(supplier).toBeDefined();
    createdSupplierId = supplier.id;
  });

  it('管理员可启动开标 SUBMIT → OPENING', async () => {
    // P1：开标要求截标时间已过（DEADLINE_NOT_PASSED）；而供应商提交要求未过——
    // 故提交后用 prisma 把 deadline 改到过去，再开标。
    await prisma.bidProject.update({
      where: { id: createdProjectId },
      data: { deadline: new Date(Date.now() - 3600_000) },
    });
    // 解密窗口设为「当前开启」(start 已过、end 未到)，否则后续解密报 DECRYPT_WINDOW_NOT_OPEN
    const decryptWindowStart = new Date(Date.now() - 3600_000).toISOString();
    const decryptWindowEnd = new Date(Date.now() + 3600_000).toISOString();
    await request(app.getHttpServer())
      .post(`/api/bid/projects/${createdProjectId}/open`)
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .send({ host: '主持人', supervisor: '监督员', decryptWindowStart, decryptWindowEnd })
      .expect(201);
  });

  it('空 body 解密供应商不应触发校验错误（开标记录字段可选，201）', () => {
    // 开标记录字段（amount/period/qualityTarget/bondStatus）为可选：
    // 不提供时仅推进解密状态，不创建开标记录，且不得返回 400 校验错误
    return request(app.getHttpServer())
      .post(`/api/bid/projects/${createdProjectId}/decrypt/${createdSupplierId}`)
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .send({})
      .expect(201);
  });

  it('管理员可启动评标 OPENING → EVALUATING', async () => {
    // P2/G4/G9 前置：真实解密需 MinIO 加密投标文件 + AES-GCM/SHA-256 校验（属独立单测范畴），
    // 此流程测试用 prisma 直接 setup 评标前置——≥1 解密成功供应商(G4)、≥1 评审专家(P2)、≥1 评分项(G9)
    await prisma.bidSupplier.update({ where: { id: createdSupplierId }, data: { decryptStatus: 'SUCCESS' } });
    const expertUser = await prisma.user.findFirst({ where: { role: 'bid_expert' } });
    expect(expertUser).toBeTruthy();
    await prisma.bidExpert.create({
      data: { projectId: createdProjectId, userId: expertUser!.id, expertName: expertUser!.username, major: '综合' },
    });
    await prisma.bidScoreItem.create({
      data: { projectId: createdProjectId, category: 'TECHNICAL', name: '技术方案', maxScore: 10 },
    });

    await request(app.getHttpServer())
      .post(`/api/bid/projects/${createdProjectId}/start-evaluation`)
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .expect(201);
  });

  it('供应商不能访问招标管理接口（403）', async () => {
    await request(app.getHttpServer())
      .post('/api/bid/projects')
      .set('Cookie', supplierCookie)
      .set('X-Portal', 'supplier')
      .send({ name: '非法项目', procurementMethod: '公开招标', openTime: '2099-12-31T09:00:00Z', deadline: '2099-12-30T17:00:00Z' })
      .expect(403);
  });

  it('管理员可查看监督日志', () => {
    return request(app.getHttpServer())
      .get(`/api/bid/projects/${createdProjectId}/supervision-logs`)
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .expect(200)
      .expect(res => {
        expect(Array.isArray(res.body)).toBe(true);
        // 应至少有 open-submission、open、start-evaluation 三条日志
        expect(res.body.length).toBeGreaterThanOrEqual(3);
      });
  });

  it('已开标项目空 body 重复开标幂等成功（201）', async () => {
    // 当前规则：首次 SUBMIT→OPENING 必须提供完整会话字段（OPENING_SESSION_REQUIRED），
    // 原「空 body 首次开标」前提已不成立。这里验证「已 OPENING 后空 body 重复开标」幂等 201。
    const past = new Date(Date.now() - 3600_000).toISOString();
    const res = await request(app.getHttpServer())
      .post('/api/bid/projects')
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .send({ name: `幂等开标测试-${Date.now()}`, procurementMethod: '公开招标', openTime: past, deadline: past })
      .expect(201);
    const tmpId = res.body.id;
    const tmpCode = res.body.projectCode;

    // G3：先发布招标公示，否则 open-submission 抛 409
    await request(app.getHttpServer())
      .post('/api/announcements')
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .send({
        title: `E2E招标公示-${Date.now()}`,
        content: '<p>x</p>',
        type: 'BID_NOTICE',
        status: 'PUBLISHED',
        relatedProjectCode: tmpCode,
        aiSummary: 'x',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/bid/projects/${tmpId}/open-submission`)
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .expect(201);

    // 首次开标（带会话字段）→ OPENING
    await request(app.getHttpServer())
      .post(`/api/bid/projects/${tmpId}/open`)
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .send({
        host: '主持人',
        supervisor: '监督员',
        decryptWindowStart: new Date(Date.now() - 3600_000).toISOString(),
        decryptWindowEnd: new Date(Date.now() + 3600_000).toISOString(),
      })
      .expect(201);

    // 再以空 body 开标：非 transitioning，跳过会话校验，幂等 201
    await request(app.getHttpServer())
      .post(`/api/bid/projects/${tmpId}/open`)
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .send({})
      .expect(201);

    // 清理临时项目
    await prisma.bidOpeningSession.deleteMany({ where: { projectId: tmpId } }).catch(() => {});
    await prisma.bidSupervisionLog.deleteMany({ where: { projectId: tmpId } }).catch(() => {});
    await prisma.bidProject.delete({ where: { id: tmpId } }).catch(() => {});
  });
});
