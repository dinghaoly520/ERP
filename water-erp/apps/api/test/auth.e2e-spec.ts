import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashSync } from 'bcryptjs';

/** 解出 JWT 载荷（不验签），供断言 sid 是否随 token 下发 */
function decodeJwt(token: string): Record<string, any> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
}

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

    // 单设备登录测试用户（自建，不依赖 seed 账号）
    for (const [username, role] of [
      ['e2e-single-supplier', 'supplier'],
      ['e2e-single-staff', 'staff'],
      ['e2e-single-mall', 'mall'],
    ] as const) {
      await prisma.user.upsert({
        where: { username_role: { username, role } },
        update: { isActive: true, passwordHash: hashSync('Single@2026', 10) },
        create: {
          username,
          displayName: `单设备登录测试-${role}`,
          passwordHash: hashSync('Single@2026', 10),
          role,
          isActive: true,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ['e2e-disabled-user', 'e2e-single-supplier', 'e2e-single-staff', 'e2e-single-mall'] } },
    });
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

  it('/api/auth/login (POST) — 正确凭证应返回 200 + access_token（bid_host 走 bid 门户）', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/login')
      .set('X-Portal', 'bid').send({ username: '陈源远', password: '陈源远@2026' }).expect(200);
    const setCookie = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'].join(';') : String(res.headers['set-cookie']);
    expect(setCookie).toContain('token_bid=');
    expect(res.body).toHaveProperty('access_token');
  });

  it('/api/auth/login (POST) — bid_host 登录 web 门户应 403 PORT_ROLE_MISMATCH（port-roles 根因回归负例）', async () => {
    // 2026-08-14 auth port-roles 重构根因：bid_host ∉ PORT_ALLOWED_ROLES.web → L3 拒收、无 Set-Cookie
    const res = await request(app.getHttpServer()).post('/api/auth/login')
      .set('X-Portal', 'web').send({ username: '陈源远', password: '陈源远@2026' }).expect(403);
    expect(res.body).toMatchObject({ code: 'PORT_ROLE_MISMATCH' });
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

  /* ── 单设备登录（2026-09-18：supplier 扩展 + web 回归）── */

  describe('单设备登录', () => {
    const loginWith = (username: string, portal: string) =>
      request(app.getHttpServer())
        .post('/api/auth/login')
        .set('X-Portal', portal)
        .send({ username, password: 'Single@2026' });

    it('supplier 重复登录：后登者顶掉先登者（旧 token 401 SESSION_REPLACED，新 token 200）', async () => {
      const first = await loginWith('e2e-single-supplier', 'supplier').expect(200);
      const second = await loginWith('e2e-single-supplier', 'supplier').expect(200);
      const oldToken = first.body.access_token as string;
      const newToken = second.body.access_token as string;

      // supplier 登录签发的 token 应带 sid（会话轮换）
      expect(decodeJwt(newToken).sid).toBeTruthy();

      // 旧 token 被顶下线
      const kicked = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', `token_supplier=${oldToken}`)
        .set('X-Portal', 'supplier');
      expect(kicked.status).toBe(401);
      expect(kicked.body.code).toBe('SESSION_REPLACED');

      // 新 token 正常使用
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', `token_supplier=${newToken}`)
        .set('X-Portal', 'supplier')
        .expect(200);
    });

    it('supplier 无 sid 存量 token（token_supplier cookie）应 401 强制重登', async () => {
      // 模拟本功能上线前的存量会话：同密钥手工签发不带 sid 的 token
      const user = await prisma.user.findUnique({
        where: { username_role: { username: 'e2e-single-supplier', role: 'supplier' } },
        select: { id: true },
      });
      const legacyToken = app.get(JwtService).sign({
        sub: user!.id,
        username: 'e2e-single-supplier',
        role: 'supplier',
      });

      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', `token_supplier=${legacyToken}`)
        .set('X-Portal', 'supplier');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('SESSION_REPLACED');
    });

    it('web 回归：staff 重复登录旧 token 401（:3005 既有行为不受 supplier 扩展影响）', async () => {
      const first = await loginWith('e2e-single-staff', 'web').expect(200);
      const second = await loginWith('e2e-single-staff', 'web').expect(200);

      const kicked = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', `token_web=${first.body.access_token}`)
        .set('X-Portal', 'web');
      expect(kicked.status).toBe(401);
      expect(kicked.body.code).toBe('SESSION_REPLACED');

      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', `token_web=${second.body.access_token}`)
        .set('X-Portal', 'web')
        .expect(200);
    });

    it('mall 登录不轮换（token 无 sid，其他命名空间不受影响）', async () => {
      const res = await loginWith('e2e-single-mall', 'mall').expect(200);
      expect(decodeJwt(res.body.access_token).sid).toBeUndefined();
    });
  });
});
