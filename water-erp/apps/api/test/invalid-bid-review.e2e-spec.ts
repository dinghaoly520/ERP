import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { hashSync } from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/** 废标复议表决（B+D，2026-11-12）e2e：
 *  过半废标 → 组长 getProject 兜底载荷 → 发起复议动议（双发409 + B4 冻结闸）
 *  → 委员会投票 → close rejected（推翻恢复参评）与 approved（维持留痕）两路。
 *  spec: docs/superpowers/specs/2026-11-12-invalid-bid-review-motion-design.md */

async function loginAs(app: INestApplication, username: string, password: string, portal: string): Promise<string[]> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .set('X-Portal', portal)
    .send({ username, password });
  const cookie = res.headers['set-cookie'];
  return Array.isArray(cookie) ? cookie : cookie ? [cookie] : [];
}

describe('Invalid Bid Review Motion (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const PW = 'IbrSpec@2026';
  const U = {
    lead: 'IBR-LEAD-2026',
    e2: 'IBR-E2-2026',
    e3: 'IBR-E3-2026',
  };
  let projectIdA: string; // rejected（推翻）路
  let projectIdB: string; // approved（维持）路
  let supplierIdA: string;
  let supplierIdB: string;
  let itemA: string;
  let itemB: string;
  let invalidBidA: string;
  let leadCookie: string[];
  let e2Cookie: string[];
  let e3Cookie: string[];

  const mkUser = (username: string) =>
    prisma.user.upsert({
      where: { username_role: { username, role: 'bid_expert' } },
      update: { isActive: true, passwordHash: hashSync(PW, 10) },
      create: {
        username, displayName: username, passwordHash: hashSync(PW, 10), role: 'bid_expert', isActive: true,
        expertProfile: { create: { specialty: '造价', availability: '可用', entryStatus: 'ACTIVE' } },
      },
    });

  const mkProjectWithPanel = async (code: string, supplierName: string) => {
    const proj = await prisma.bidProject.create({
      data: {
        projectCode: code, name: `复议表决测试-${code}`, procurementMethod: '公开招标',
        openTime: new Date(Date.now() - 7200_000), deadline: new Date(Date.now() - 3600_000),
        stage: 'EVALUATING',
      },
    });
    const sup = await prisma.bidSupplier.create({
      data: { projectId: proj.id, supplierName, decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED', submitStatus: '已提交', bidValidity: 'valid' },
    });
    const item = await prisma.bidScoreItem.create({
      data: { projectId: proj.id, name: '资格性审查', category: 'QUALIFICATION', maxScore: 0 },
    });
    const [lead, e2, e3] = await Promise.all([mkUser(U.lead), mkUser(U.e2), mkUser(U.e3)]);
    const base = {
      projectId: proj.id, major: '造价', expertRole: '正选' as const, invitationStatus: 'confirmed' as const,
      signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true,
      confidentialityAgreed: true, disciplineAgreed: true, reportConfirmed: false,
    };
    await prisma.bidExpert.create({ data: { ...base, userId: lead.id, expertName: '组长·复议', isLead: true } });
    await prisma.bidExpert.create({ data: { ...base, userId: e2.id, expertName: '专家二' } });
    await prisma.bidExpert.create({ data: { ...base, userId: e3.id, expertName: '专家三' } });
    return { projectId: proj.id, supplierId: sup.id, itemId: item.id };
  };

  const submitFail = (cookie: string[], projectId: string, itemId: string, supplierId: string, reason: string) =>
    request(app.getHttpServer())
      .post(`/api/expert/projects/${projectId}/scores`)
      .set('Cookie', cookie).set('X-Portal', 'expert')
      .send({ supplierName: '复议测试供应商', scores: [{ scoreItemId: itemId, supplierId, passed: false, reason }] });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const fixtureA = await mkProjectWithPanel(`IBR-RJ-${Date.now()}`, '复议推翻测试供应商');
    projectIdA = fixtureA.projectId; supplierIdA = fixtureA.supplierId; itemA = fixtureA.itemId;
    const fixtureB = await mkProjectWithPanel(`IBR-AP-${Date.now()}`, '复议维持测试供应商');
    projectIdB = fixtureB.projectId; supplierIdB = fixtureB.supplierId; itemB = fixtureB.itemId;

    [leadCookie, e2Cookie, e3Cookie] = await Promise.all([
      loginAs(app, U.lead, PW, 'expert'),
      loginAs(app, U.e2, PW, 'expert'),
      loginAs(app, U.e3, PW, 'expert'),
    ]);
  });

  afterAll(async () => {
    for (const pid of [projectIdA, projectIdB]) {
      if (!pid) continue;
      await prisma.bidProject.delete({ where: { id: pid } }).catch(() => {});
    }
    await prisma.user.deleteMany({ where: { username: { in: [U.lead, U.e2, U.e3] } } }).catch(() => {});
    await app.close();
  });

  it('两票不通过（严格过半·计已投票）→ 自动废标 + 组长 getProject 兜底载荷（记名票面）', async () => {
    await submitFail(e2Cookie, projectIdA, itemA, supplierIdA, '资质证明材料缺失').expect(201);
    // 既有渐进过半语义：evaluateInvalidBid 只统计已投票——首票 1/1 即严格过半、当场废标
    // （后续票可推翻回 revoked，决策 B 接受跳变）。此处验证安全网先落。
    let sup = await prisma.bidSupplier.findUnique({ where: { id: supplierIdA } });
    expect(sup?.bidValidity).toBe('invalid');

    await submitFail(e3Cookie, projectIdA, itemA, supplierIdA, '社保缴纳不连续').expect(201);
    // 第二票维持废标（2/2）
    sup = await prisma.bidSupplier.findUnique({ where: { id: supplierIdA } });
    expect(sup?.bidValidity).toBe('invalid');

    const res = await request(app.getHttpServer())
      .get(`/api/expert/projects/${projectIdA}`)
      .set('Cookie', leadCookie).set('X-Portal', 'expert')
      .expect(200);
    const pending = (res.body as { pendingInvalidReviews?: any[] }).pendingInvalidReviews;
    expect(pending).toHaveLength(1);
    expect(pending![0]).toMatchObject({
      supplierName: '复议推翻测试供应商', scoreItemName: '资格性审查',
      category: 'QUALIFICATION', failCount: 2, totalCount: 2,
      hasOpenMotion: false, canRemotion: true,
    });
    expect(pending![0].votes).toHaveLength(2);
    expect(pending![0].votes.map((v: any) => v.reason).sort()).toEqual(['社保缴纳不连续', '资质证明材料缺失']);
    invalidBidA = pending![0].invalidBidId;

    // 非组长不下发（保密口径）
    const nonLead = await request(app.getHttpServer())
      .get(`/api/expert/projects/${projectIdA}`)
      .set('Cookie', e2Cookie).set('X-Portal', 'expert')
      .expect(200);
    expect((nonLead.body as any).pendingInvalidReviews).toBeUndefined();
  });

  it('组长发起复议动议 → 真并发双发恰成一单（条件写占位）+ B4 冻结闸（该项改票被拒）', async () => {
    const create = (cookie: string[]) =>
      request(app.getHttpServer())
        .post(`/api/expert/projects/${projectIdA}/invalid-bid-reviews`)
        .set('Cookie', cookie).set('X-Portal', 'expert')
        .send({ invalidBidId: invalidBidA, description: '请复核资格条款依据' });

    // 非组长 403
    await create(e2Cookie).expect(403);
    // 真并发双发（READ COMMITTED 竞态）：事务内条件写占位 → 恰好一单成功
    const results = await Promise.allSettled([
      create(leadCookie),
      create(leadCookie),
    ]);
    const statuses = results.map(r => (r.status === 'fulfilled' ? r.value.status : -1)).sort();
    expect(statuses).toEqual([201, 409]);
    const votingMotions = await prisma.bidMotion.count({ where: { projectId: projectIdA, type: 'invalid_bid', status: 'voting' } });
    expect(votingMotions).toBe(1);

    const linked = await prisma.bidInvalidBid.findUnique({ where: { id: invalidBidA } });
    expect(linked?.motionId).toBeTruthy();
    // 顺序双发 → 外层判重 409
    await create(leadCookie).expect(409).expect(r => expect(r.body).toMatchObject({ code: 'RULING_ALREADY_OPEN' }));

    // B4：表决期间该项评分投票冻结（专家二改票恢复的尝试被暂停闸挡下）
    await request(app.getHttpServer())
      .post(`/api/expert/projects/${projectIdA}/scores`)
      .set('Cookie', e2Cookie).set('X-Portal', 'expert')
      .send({ supplierName: '复议推翻测试供应商', scores: [{ scoreItemId: itemA, supplierId: supplierIdA, passed: true, reason: '复核后改为通过' }] })
      .expect(400)
      .expect(r => expect(r.body).toMatchObject({ code: 'RULING_IN_PROGRESS' }));
  });

  it('投票 → close rejected（推翻废标）→ revoked + bidValidity 恢复 valid + 监督日志', async () => {
    const motionId = (await prisma.bidInvalidBid.findUnique({ where: { id: invalidBidA } }))!.motionId!;
    const vote = (cookie: string[], v: string) =>
      request(app.getHttpServer())
        .post(`/api/expert/motions/${motionId}/vote`)
        .set('Cookie', cookie).set('X-Portal', 'expert')
        .send({ vote: v });

    await vote(leadCookie, 'reject').expect(201);  // 推翻废标
    await vote(e2Cookie, 'reject').expect(201);
    await vote(e3Cookie, 'approve').expect(201);   // 维持废标

    await request(app.getHttpServer())
      .post(`/api/expert/motions/${motionId}/close`)
      .set('Cookie', leadCookie).set('X-Portal', 'expert')
      .expect(201)
      .expect(r => expect(r.body).toMatchObject({ status: 'closed', result: 'rejected' }));

    const invalidBid = await prisma.bidInvalidBid.findUnique({ where: { id: invalidBidA } });
    expect(invalidBid?.status).toBe('revoked');
    const sup = await prisma.bidSupplier.findUnique({ where: { id: supplierIdA } });
    expect(sup?.bidValidity).toBe('valid');
    const log = await prisma.bidSupervisionLog.findFirst({
      where: { projectId: projectIdA, action: { contains: '推翻废标' } },
    });
    expect(log).toBeTruthy();
    expect(log!.result).toContain('赞成 1/反对 2/弃权 0');

    // 裁定终局锁：该项再投票 → RULING_FINAL
    await request(app.getHttpServer())
      .post(`/api/expert/projects/${projectIdA}/scores`)
      .set('Cookie', e2Cookie).set('X-Portal', 'expert')
      .send({ supplierName: '复议推翻测试供应商', scores: [{ scoreItemId: itemA, supplierId: supplierIdA, passed: false, reason: '再投不通过' }] })
      .expect(400)
      .expect(r => expect(r.body).toMatchObject({ code: 'RULING_FINAL' }));
  });

  it('approved（维持废标）对称路：过半 → 复议 → 维持 → invalid 保持 + motionId 回写 + 留痕', async () => {
    await submitFail(e2Cookie, projectIdB, itemB, supplierIdB, '业绩证明不满足最低要求').expect(201);
    await submitFail(e3Cookie, projectIdB, itemB, supplierIdB, '项目负责人无有效证书').expect(201);

    const get = await request(app.getHttpServer())
      .get(`/api/expert/projects/${projectIdB}`)
      .set('Cookie', leadCookie).set('X-Portal', 'expert')
      .expect(200);
    const invalidBidB = get.body.pendingInvalidReviews[0].invalidBidId as string;

    const res = await request(app.getHttpServer())
      .post(`/api/expert/projects/${projectIdB}/invalid-bid-reviews`)
      .set('Cookie', leadCookie).set('X-Portal', 'expert')
      .send({ invalidBidId: invalidBidB })
      .expect(201);
    const motionId = res.body.id as string;

    await request(app.getHttpServer())
      .post(`/api/expert/motions/${motionId}/vote`)
      .set('Cookie', leadCookie).set('X-Portal', 'expert')
      .send({ vote: 'approve' }).expect(201);
    await request(app.getHttpServer())
      .post(`/api/expert/motions/${motionId}/vote`)
      .set('Cookie', e2Cookie).set('X-Portal', 'expert')
      .send({ vote: 'approve' }).expect(201);

    await request(app.getHttpServer())
      .post(`/api/expert/motions/${motionId}/close`)
      .set('Cookie', leadCookie).set('X-Portal', 'expert')
      .expect(201)
      .expect(r => expect(r.body).toMatchObject({ result: 'approved' }));

    const invalidBid = await prisma.bidInvalidBid.findUnique({ where: { id: invalidBidB } });
    expect(invalidBid?.status).toBe('invalid');
    expect(invalidBid?.motionId).toBe(motionId);
    const sup = await prisma.bidSupplier.findUnique({ where: { id: supplierIdB } });
    expect(sup?.bidValidity).toBe('invalid');
    const log = await prisma.bidSupervisionLog.findFirst({
      where: { projectId: projectIdB, action: { contains: '维持废标' } },
    });
    expect(log).toBeTruthy();
  });
});
