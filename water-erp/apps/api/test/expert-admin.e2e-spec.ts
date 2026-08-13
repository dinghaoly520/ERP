import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { hashSync } from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ExpertExtractionAiService } from '../src/expert/expert-extraction-ai.service';

/**
 * 专家管理（expert-admin）端到端测试。
 * 覆盖：列表/统计/排名（单调+降序回归）/ 越权拦截 / 三字段持久化（含回读落库）/ 履职评价定级 /
 *       抽取预览（AI 不可用时确定性降级规则引擎）。
 * 关键修正（消除"假置信"）：
 *  - override ExpertExtractionAiService 强制 analyzeAndScore reject → 抽取必走 engine='rules'，不依赖真实 LLM/库状态；
 *  - 空库时自建最小项目，保证抽取链路一定被执行（不再 `return` 静默跳过）；
 *  - 删除"500 也算过"的 else 逃生门——抽取预览必须成功；
 *  - beforeAll 幂等清理上次 --forceExit 可能遗留的 e2e 账号，避免撞 DUPLICATE 造成级联静默跳过。
 * 用 leader 角色账号登录（web 门户，cookie=token_web，需带 X-Portal: web）。
 */

const E2E_ADMIN = 'e2e-expert-admin';
const E2E_EXPERT = 'e2e-expert-target';

async function loginAs(app: INestApplication, username: string, password: string, portal: string): Promise<string[]> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .set('X-Portal', portal)
    .send({ username, password });
  const cookie = res.headers['set-cookie'];
  return Array.isArray(cookie) ? cookie : cookie ? [cookie] : [];
}

describe('专家管理 ExpertAdmin (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookies: string[] = [];
  let adminId = '';
  let testExpertId = '';
  const createdProjectIds: string[] = [];

  // 注意：supertest 需先 .get/.post/.patch 再 .set 头
  const authGet = (path: string) => request(app.getHttpServer()).get(path).set('Cookie', cookies).set('X-Portal', 'web');
  const authPost = (path: string) => request(app.getHttpServer()).post(path).set('Cookie', cookies).set('X-Portal', 'web');
  const authPatch = (path: string) => request(app.getHttpServer()).patch(path).set('Cookie', cookies).set('X-Portal', 'web');

  beforeAll(async () => {
    // override AI 抽取引擎：强制 analyzeAndScore reject，使抽取预览确定性地走规则降级路径
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ExpertExtractionAiService)
      .useValue({
        analyzeAndScore: jest.fn().mockRejectedValue(new Error('e2e 强制降级到规则引擎')),
        generateNotification: jest.fn().mockResolvedValue(null),
        getMetrics: jest.fn().mockReturnValue({ llmCalls: 0, llmErrors: 0, fallbackCount: 0, lastLatencyMs: null, lastModel: null }),
        recordFallback: jest.fn(),
      })
      .compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    // 幂等清理上次 --forceExit 可能遗留的 e2e 账号（按外键顺序），避免撞 DUPLICATE_USERNAME
    await prisma.expertEvaluation.deleteMany({ where: { expertUser: { username: { in: [E2E_ADMIN, E2E_EXPERT] } } } });
    await prisma.expertProfile.deleteMany({ where: { user: { username: { in: [E2E_ADMIN, E2E_EXPERT] } } } });
    await prisma.user.deleteMany({ where: { username: { in: [E2E_ADMIN, E2E_EXPERT] } } });

    // 幂等清理他套件崩溃（--forceExit）遗留的悬空评审分配：project 已删的 BidExpert 会让
    // listExperts 的 project relation select 抛 Inconsistent query result → 全量回归 500
    const dangling = await prisma.bidExpert.findMany({ select: { id: true, projectId: true } });
    const liveProjectIds = new Set((await prisma.bidProject.findMany({ select: { id: true } })).map((p) => p.id));
    const danglingIds = dangling.filter((e) => !liveProjectIds.has(e.projectId)).map((e) => e.id);
    if (danglingIds.length > 0) {
      await prisma.bidExpert.deleteMany({ where: { id: { in: danglingIds } } });
    }

    // leader 角色管理账号（web 门户可登录）
    await prisma.user.upsert({
      where: { username_role: { username: E2E_ADMIN, role: 'leader' } },
      update: { isActive: true, passwordHash: hashSync('abc123', 10) },
      create: { username: E2E_ADMIN, displayName: 'E2E专家管理员', passwordHash: hashSync('abc123', 10), role: 'leader', isActive: true },
    });
    cookies = await loginAs(app, E2E_ADMIN, 'abc123', 'web');
    const me = await authGet('/api/auth/me');
    adminId = me.body?.id ?? '';
  }, 30000);

  afterAll(async () => {
    if (testExpertId) {
      await prisma.expertEvaluation.deleteMany({ where: { expertUserId: testExpertId } });
      await prisma.bidExpert.deleteMany({ where: { userId: testExpertId } }); // 评价用例创建的评审分配
      await prisma.expertProfile.deleteMany({ where: { userId: testExpertId } });
    }
    await prisma.user.deleteMany({ where: { username: { in: [E2E_ADMIN, E2E_EXPERT] } } });
    for (const pid of createdProjectIds) {
      await prisma.bidProject.delete({ where: { id: pid } }).catch(() => {});
    }
    await app.close();
  }, 30000);

  it('登录成功并拿到 token_web cookie', () => {
    expect(cookies.length).toBeGreaterThan(0);
    expect(adminId).toBeTruthy();
  });

  it('GET /expert-admin 返回分页专家列表', async () => {
    const res = await authGet('/api/expert-admin');
    expect(res.status).toBe(200);
    // listExperts 分页返回 { total, page, pageSize, items }
    expect(typeof res.body.total).toBe('number');
    expect(res.body.page).toBe(1);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('GET /expert-admin/specialties 返回专业数组', async () => {
    const res = await authGet('/api/expert-admin/specialties');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /expert-admin/statistics 返回态势统计', async () => {
    const res = await authGet('/api/expert-admin/statistics');
    expect(res.status).toBe(200);
    expect(typeof res.body.totalExperts).toBe('number');
  });

  it('GET /expert-admin/ranking 排名单调且 A 级数降序（错位/乱序回归）', async () => {
    const res = await authGet('/api/expert-admin/ranking?period=all');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length > 0) {
      expect(res.body[0].rank).toBe(1);
      for (let i = 0; i < res.body.length; i++) {
        const row = res.body[i];
        expect(row.expertUserId).toBeTruthy();
        expect(Number.isFinite(row.aCount)).toBe(true);
        expect(Number.isFinite(row.evalCount)).toBe(true);
        expect(row.gradeCounts).toBeTruthy(); // 等级分布 {A,B,C,D,E}
        if (i > 0) {
          // 排序口径：加权得分降序（同分按评价次数降序），非 A 级数降序
          expect(row.weightedScore).toBeLessThanOrEqual(res.body[i - 1].weightedScore);
          expect(row.rank).toBeGreaterThanOrEqual(res.body[i - 1].rank); // 名次单调
        }
      }
    }
  });

  it('越权拦截：对非专家（leader 自身）停用应 404', async () => {
    const res = await authPatch(`/api/expert-admin/${adminId}/availability`).send({ available: false });
    expect(res.status).toBe(404);
  });

  it('录入三字段（民族/学历/证书）应真实持久化并回读一致（静默丢弃回归）', async () => {
    const create = await authPost('/api/expert-admin').send({
      username: E2E_EXPERT, displayName: 'E2E测试专家', password: 'test@2026',
      specialty: '水利工程', title: '高级工程师', employer: 'E2E测试单位',
      ethnicity: '汉族', education: '硕士', licenseNo: 'ZS-E2E-001',
    });
    expect([200, 201]).toContain(create.status);
    testExpertId = create.body?.id ?? '';
    expect(testExpertId).toBeTruthy();
    expect(create.body?.expertProfile?.ethnicity).toBe('汉族');
    expect(create.body?.expertProfile?.education).toBe('硕士');
    expect(create.body?.expertProfile?.licenseNo).toBe('ZS-E2E-001');
    expect(create.body?.passwordHash).toBeUndefined();

    // 回读确认真实落库（返回值对 ≠ 落库对）
    const detail = await authGet(`/api/expert-admin/${testExpertId}`);
    expect(detail.status).toBe(200);
    expect(detail.body?.expertProfile?.ethnicity).toBe('汉族');
    expect(detail.body?.expertProfile?.education).toBe('硕士');
    expect(detail.body?.expertProfile?.licenseNo).toBe('ZS-E2E-001');
    expect(detail.body?.passwordHash).toBeUndefined();
  });

  it('履职评价：对录入的专家发起评价应成功并正确定级', async () => {
    if (!testExpertId) throw new Error('前置失败：测试专家未创建');
    // DTO 要求评价必须关联真实项目（projectId 必填），且该专家须在项目中任评审：
    // 自建最小项目并把测试专家分配为 BidExpert，再发起评价
    const project = await prisma.bidProject.create({
      data: {
        projectCode: `E2E-EVAL-${Date.now()}`,
        name: 'E2E评价测试项目',
        procurementMethod: '公开招标',
        openTime: new Date(Date.now() + 7 * 864e5),
        deadline: new Date(Date.now() + 14 * 864e5),
        scope: '水利枢纽施工',
      },
    });
    createdProjectIds.push(project.id);
    await prisma.bidExpert.create({
      data: { projectId: project.id, userId: testExpertId, expertName: 'E2E测试专家', major: '水利工程' },
    });
    const res = await authPost('/api/expert-admin/evaluations').send({
      expertUserId: testExpertId, projectId: project.id,
      attendanceGrade: 'A', qualityGrade: 'A', disciplineGrade: 'A', comment: 'e2e 评价',
    });
    expect([200, 201]).toContain(res.status);
    // 三维全 A → 综合等级 A（quality×0.5 + discipline×0.3 + attendance×0.2 = 5 → A）
    expect(res.body.overallGrade).toBe('A');
    expect(res.body.attendanceGrade).toBe('A');
    expect(res.body.qualityGrade).toBe('A');
    expect(res.body.disciplineGrade).toBe('A');
  });

  it('抽取预览：AI 不可用时确定性降级规则引擎（engine=rules，无 500 逃生门）', async () => {
    let projectId = '';
    const projects = await authGet('/api/bid/projects');
    if (projects.status === 200 && Array.isArray(projects.body) && projects.body.length > 0) {
      projectId = projects.body[0].id;
    } else {
      // 空库自建最小项目，保证抽取链路一定被执行（不再静默跳过）
      const created = await prisma.bidProject.create({
        data: {
          projectCode: `E2E-EXTRACT-${Date.now()}`,
          name: 'E2E抽取测试项目',
          procurementMethod: '公开招标',
          openTime: new Date(Date.now() + 7 * 864e5),
          deadline: new Date(Date.now() + 14 * 864e5),
          scope: '水利枢纽施工',
        },
      });
      projectId = created.id;
      createdProjectIds.push(created.id);
    }
    const res = await authPost('/api/expert-admin/extract').send({
      projectId, totalNeeded: 3, alternatives: 1, extractMode: 'specialty_match',
    });
    // 抽取预览必须成功（删除了"500 也算过"的逃生门）
    expect([200, 201]).toContain(res.status);
    expect(res.body.engine).toBe('rules'); // AI provider 已 override 强制 reject
    expect(Array.isArray(res.body.selected)).toBe(true);
    expect(res.body.model).toContain('Rules Engine');
  });
});
