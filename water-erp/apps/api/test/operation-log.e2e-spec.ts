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

describe('OperationLog (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let expertCookie: string[];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    // 动态取一个 bid_expert 账号（口令统一 expert@2026，见 CLAUDE.md 种子表），避免硬编码姓名
    const expert = await prisma.user.findFirst({ where: { role: 'bid_expert', isActive: true } });
    expect(expert).not.toBeNull();
    expertCookie = await loginAs(app, expert!.username, 'expert@2026', 'expert');
  });

  afterAll(async () => {
    await app.close();
  });

  it('已认证请求被记录、body 已脱敏', async () => {
    // 触发一次会落库的请求（/auth/me 带 cookie）
    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', expertCookie).set('X-Portal', 'expert').expect(200);

    // 等待 fire-and-forget 落库
    await new Promise((r) => setTimeout(r, 300));

    const found = await prisma.operationLog.findFirst({
      where: { path: '/api/auth/me', method: 'GET' },
      orderBy: { createdAt: 'desc' },
    });
    expect(found).not.toBeNull();
    expect(found!.role).toBe('bid_expert');
    expect(found!.portal).toBe('expert');
    expect(found!.statusCode).toBe(200);
  });

  it('login 请求 password 被脱敏', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Portal', 'expert')
      .send({ username: '刘苡池', password: 'expert@2026' })
      .expect(200);
    await new Promise((r) => setTimeout(r, 300));

    const found = await prisma.operationLog.findFirst({
      where: { path: '/api/auth/login', method: 'POST' },
      orderBy: { createdAt: 'desc' },
    });
    expect(found).not.toBeNull();
    // body 里的 password 必须是 ***
    expect(JSON.stringify(found!.body)).not.toContain('expert@2026');
    expect(JSON.stringify(found!.body)).toContain('***');
    expect(found!.role).toBe('anonymous'); // login 时 req.user 尚不存在
  });

  it('/my 仅返回当前用户记录', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/operation-log/my?limit=5')
      .set('Cookie', expertCookie)
      .set('X-Portal', 'expert')
      .expect(200);
    expect(res.body.items).toBeInstanceOf(Array);
    expect(res.body.items.every((i: any) => i.userId !== null)).toBe(true);
  });

  it('/operation-log 全量接口对非 admin/bid_host 拒绝', async () => {
    await request(app.getHttpServer())
      .get('/api/operation-log?limit=5')
      .set('Cookie', expertCookie)
      .set('X-Portal', 'expert')
      .expect(403);
  });
});
