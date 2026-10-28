import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';

async function loginAs(app: INestApplication, username: string, password: string, portal: string): Promise<string[]> {
  const res = await request(app.getHttpServer()).post('/api/auth/login').set('X-Portal', portal).send({ username, password });
  const cookie = res.headers['set-cookie'];
  return Array.isArray(cookie) ? cookie : cookie ? [cookie] : [];
}

describe('System Health (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string[];
  let leaderCookie: string[];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    adminCookie = await loginAs(app, 'Swhi-CGZX-admin', 'Swhi-CGZX-admin@2026', 'web');
    leaderCookie = await loginAs(app, 'Swhi-CGZX-01', 'Swhi-CGZX-01@2026', 'web');
  });

  afterAll(async () => { await app.close(); });

  it('admin 读 health：返回形状契约（组件实质指标/全量口径/Top 榜/队列快照/心跳）', async () => {
    const res = await request(app.getHttpServer()).get('/api/system-config/health').set('X-Portal', 'web').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.components.db).toEqual(expect.objectContaining({ activeConns: expect.any(Number), maxConns: expect.any(Number), sizeBytes: expect.any(Number) }));
    expect(res.body.components.redis.usedMemoryBytes).toEqual(expect.any(Number));
    expect(Array.isArray(res.body.api24h.series)).toBe(true);
    expect(res.body.api24h.series).toHaveLength(24);
    expect(Array.isArray(res.body.topErrors)).toBe(true);
    expect(Array.isArray(res.body.topSlow)).toBe(true);
    expect(res.body.queues).toHaveProperty('tenderProcessing');
    expect(res.body.worker).toEqual(expect.objectContaining({ alive: expect.any(Boolean) }));
  });

  it('指标层在计数：两次 health 调用后 total 至少 +1（health 路由自身被计入全量）', async () => {
    const t1 = (await request(app.getHttpServer()).get('/api/system-config/health').set('X-Portal', 'web').set('Cookie', adminCookie)).body.api24h.total;
    const t2 = (await request(app.getHttpServer()).get('/api/system-config/health').set('X-Portal', 'web').set('Cookie', adminCookie)).body.api24h.total;
    expect(t2).toBeGreaterThanOrEqual(t1 + 1);
  });

  it('leader 可读 health 与 recent-errors，但写操作 403', async () => {
    const h = await request(app.getHttpServer()).get('/api/system-config/health').set('X-Portal', 'web').set('Cookie', leaderCookie);
    expect(h.status).toBe(200);
    const re = await request(app.getHttpServer()).get('/api/system-config/recent-errors').set('X-Portal', 'web').set('Cookie', leaderCookie);
    expect(re.status).toBe(200);
    const retry = await request(app.getHttpServer()).post('/api/system-config/queue/tender/retry-failed').set('X-Portal', 'web').set('Cookie', leaderCookie);
    expect(retry.status).toBe(403);
  });

  it('未知队列名 400', async () => {
    const res = await request(app.getHttpServer()).post('/api/system-config/queue/nope/retry-failed').set('X-Portal', 'web').set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });
});
