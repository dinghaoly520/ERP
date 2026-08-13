import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashSync } from 'bcryptjs';

/**
 * 登录指定用户并返回 cookie。
 * 后端按门户命名 cookie（token_web / token_supplier / token_expert），
 * 因此登录与后续请求都需带上 X-Portal 头，后端才能读到对应 cookie。
 */
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

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

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

    // 创建禁用用户用于测试
    await prisma.user.upsert({
      where: { username_role: { username: 'e2e-disabled-user', role: 'admin' } },
      update: { isActive: false, passwordHash: hashSync('123456', 10) },
      create: {
        username: 'e2e-disabled-user',
        displayName: '已禁用测试用户',
        passwordHash: hashSync('123456', 10),
        role: 'admin',
        isActive: false,
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: 'e2e-disabled-user' } });
    await app.close();
  });

  it('/api/auth/me (GET) — 未认证应返回 401', () => {
    return request(app.getHttpServer())
      .get('/api/auth/me')
      .expect(401);
  });

  it('/api/announcements/public (GET) — 公开接口无需认证', () => {
    return request(app.getHttpServer())
      .get('/api/announcements/public')
      .expect(200)
      .expect(res => {
        expect(res.body).toHaveProperty('items');
        expect(res.body).toHaveProperty('total');
        expect(Array.isArray(res.body.items)).toBe(true);
      });
  });

  it('/api/auth/login (POST) — 无效凭证应返回 401', () => {
    return request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Portal', 'web')
      .send({ username: 'nonexistent', password: 'wrong' })
      .expect(401);
  });

  it('/api/auth/login (POST) — 正确凭证应返回 200 + access_token', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Portal', 'web')
      .send({ username: '陈源远', password: '陈源远@2026' })
      .expect(200);

    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.body).toHaveProperty('access_token');
  });

  it('/api/auth/login (POST) — 禁用用户应返回 401', () => {
    return request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Portal', 'web')
      .send({ username: 'e2e-disabled-user', password: '123456' })
      .expect(401);
  });

  it('/api/auth/logout (POST) — 登出应清除 token cookie', async () => {
    // 用 seed 中存在的供应商（公司名登录；原 supplier1 → 重庆蜀通岩土工程有限公司）
    const cookie = await loginAs(app, '重庆蜀通岩土工程有限公司', 'supplier@2026', 'supplier');
    const res = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .set('X-Portal', 'supplier');

    expect(res.status).toBe(200);
    // clearCookie 会以空值 + 过去时间下发，浏览器据此删除
    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : setCookie;
    expect(cookieStr).toMatch(/token_supplier=;/);
    expect(cookieStr.toLowerCase()).toMatch(/expires=thu, 01 jan 1970/);
  });

  /* ── 角色权限隔离 ── */

  describe('角色权限隔离', () => {
    it('供应商不能访问招标管理接口', async () => {
      const cookie = await loginAs(app, '重庆蜀通岩土工程有限公司', 'supplier@2026', 'supplier');

      await request(app.getHttpServer())
        .post('/api/bid/projects')
        .set('Cookie', cookie)
        .set('X-Portal', 'supplier')
        .send({ name: '非法项目', procurementMethod: '公开招标', openTime: '2026-07-01T09:00:00Z', deadline: '2026-07-01T08:30:00Z' })
        .expect(403);
    });

    it('供应商不能访问专家接口', async () => {
      // /expert/profile 为自作用域路由（无 @Roles，任意登录用户只取本人资料），
      // 角色隔离用 expert-admin 管理端点验证（@Roles('admin','bid_host','leader','staff')）
      const cookie = await loginAs(app, '重庆蜀通岩土工程有限公司', 'supplier@2026', 'supplier');

      await request(app.getHttpServer())
        .get('/api/expert-admin')
        .set('Cookie', cookie)
        .set('X-Portal', 'supplier')
        .expect(403);
    });

    it('专家不能创建招标项目', async () => {
      const cookie = await loginAs(app, '刘苡池', 'expert@2026', 'expert');

      await request(app.getHttpServer())
        .post('/api/bid/projects')
        .set('Cookie', cookie)
        .set('X-Portal', 'expert')
        .send({ name: '非法项目', procurementMethod: '公开招标', openTime: '2026-07-01T09:00:00Z', deadline: '2026-07-01T08:30:00Z' })
        .expect(403);
    });

    it('专家不能访问 AI 管理端接口', async () => {
      const cookie = await loginAs(app, '刘苡池', 'expert@2026', 'expert');

      await request(app.getHttpServer())
        .get('/api/ai/projects/fake-id/anomalies')
        .set('Cookie', cookie)
        .set('X-Portal', 'expert')
        .expect(403);
    });
  });
});
