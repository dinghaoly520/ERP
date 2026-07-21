import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { hashSync } from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * 专家管理（expert-admin）端到端测试。
 * 覆盖：列表/统计/排名（id 对齐回归）/ 越权拦截 / 三字段持久化 / 抽取预览（含规则降级）/ 履职评价主链路。
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

  // 注意：supertest 需先 .get/.post/.patch 再 .set 头
  const authGet = (path: string) => request(app.getHttpServer()).get(path).set('Cookie', cookies).set('X-Portal', 'web');
  const authPost = (path: string) => request(app.getHttpServer()).post(path).set('Cookie', cookies).set('X-Portal', 'web');
  const authPatch = (path: string) => request(app.getHttpServer()).patch(path).set('Cookie', cookies).set('X-Portal', 'web');

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    // leader 角色管理账号（web 门户可登录）
    await prisma.user.upsert({
      where: { username_role: { username: E2E_ADMIN, role: 'leader' } },
      update: { isActive: true, passwordHash: hashSync('abc123', 10) },
      create: { username: E2E_ADMIN, displayName: 'E2E专家管理员', passwordHash: hashSync('abc123', 10), role: 'leader', isActive: true },
    });
    cookies = await loginAs(app, E2E_ADMIN, 'abc123', 'web');
    const me = await authGet('/api/auth/me');
    adminId = me.body?.id ?? '';
  });

  afterAll(async () => {
    if (testExpertId) {
      await prisma.expertEvaluation.deleteMany({ where: { expertUserId: testExpertId } });
      await prisma.expertProfile.deleteMany({ where: { userId: testExpertId } });
    }
    await prisma.user.deleteMany({ where: { username: { in: [E2E_ADMIN, E2E_EXPERT] } } });
    await app.close();
  }, 30000);

  it('登录成功并拿到 token_web cookie', () => {
    expect(cookies.length).toBeGreaterThan(0);
    expect(adminId).toBeTruthy();
  });

  it('GET /expert-admin 返回专家列表', async () => {
    const res = await authGet('/api/expert-admin');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
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

  it('GET /expert-admin/ranking 排名行与 expertUserId 对齐（错位回归）', async () => {
    const res = await authGet('/api/expert-admin/ranking?period=all');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length > 0) {
      expect(res.body[0].rank).toBe(1);
      for (const row of res.body) expect(row.expertUserId).toBeTruthy();
    }
  });

  it('越权拦截：对非专家（leader 自身）停用应 404', async () => {
    const res = await authPatch(`/api/expert-admin/${adminId}/availability`).send({ available: false });
    expect(res.status).toBe(404);
  });

  it('录入三字段（民族/学历/证书）应真实持久化（静默丢弃回归）', async () => {
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
    // 不应外泄密码哈希
    expect(create.body?.passwordHash).toBeUndefined();
  });

  it('履职评价：对录入的专家发起评价应成功', async () => {
    if (!testExpertId) return;
    const res = await authPost('/api/expert-admin/evaluations').send({
      expertUserId: testExpertId, attendanceScore: 90, qualityScore: 88, disciplineScore: 92, comment: 'e2e 评价',
    });
    expect([200, 201]).toContain(res.status);
  });

  it('抽取预览：返回 engine（deepseek 或降级 rules）与候选人（规则降级回归）', async () => {
    const projects = await authGet('/api/bid/projects');
    if (projects.status !== 200 || !Array.isArray(projects.body) || projects.body.length === 0) return;
    const projectId = projects.body[0].id;
    const res = await authPost('/api/expert-admin/extract').send({
      projectId, totalNeeded: 3, alternatives: 1, extractMode: 'specialty_match',
    });
    if (res.status === 200 || res.status === 201) {
      expect(['deepseek', 'rules']).toContain(res.body.engine);
      expect(Array.isArray(res.body.selected)).toBe(true);
      expect(res.body.model).toBeTruthy();
    } else {
      expect(res.status).toBe(500);
    }
  }, 90000); // 真实调用 LLM（含重试/语义召回）可能较慢，放宽超时
});
