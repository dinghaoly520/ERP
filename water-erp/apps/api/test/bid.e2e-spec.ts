import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/** 登录指定用户并返回 cookie */
async function loginAs(app: INestApplication, username: string, password: string): Promise<string[]> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
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

    adminCookie = await loginAs(app, 'admin', 'admin123');
    supplierCookie = await loginAs(app, 'supplier1', '123456');
  });

  afterAll(async () => {
    await app.close();
  });

  let createdProjectId: string;

  it('管理员可创建招标项目', () => {
    return request(app.getHttpServer())
      .post('/api/bid/projects')
      .set('Cookie', adminCookie)
      .send({
        name: `E2E测试项目-${Date.now()}`,
        procurementMethod: '公开招标',
        openTime: '2099-12-31T09:00:00Z',
        deadline: '2099-12-30T17:00:00Z',
      })
      .expect(201)
      .expect(res => {
        expect(res.body).toHaveProperty('id');
        expect(res.body).toHaveProperty('projectCode');
        expect(res.body.stage).toBe('DOWNLOAD');
        createdProjectId = res.body.id;
      });
  });

  it('管理员可推进阶段 DOWNLOAD → SUBMIT', () => {
    return request(app.getHttpServer())
      .post(`/api/bid/projects/${createdProjectId}/open-submission`)
      .set('Cookie', adminCookie)
      .expect(201);
  });

  it('重复推进同阶段幂等成功', async () => {
    // 再次 open-submission（DOWNLOAD→SUBMIT 幂等）
    await request(app.getHttpServer())
      .post(`/api/bid/projects/${createdProjectId}/open-submission`)
      .set('Cookie', adminCookie)
      .expect(201);
  });

  it('跳级推进 DOWNLOAD → EVALUATING 返回 409', () => {
    return request(app.getHttpServer())
      .post(`/api/bid/projects/${createdProjectId}/start-evaluation`)
      .set('Cookie', adminCookie)
      .expect(409);
  });

  it('管理员可提交投标（SUBMIT 阶段）', () => {
    return request(app.getHttpServer())
      .post(`/api/bid/projects/${createdProjectId}/suppliers`)
      .set('Cookie', adminCookie)
      .send({ supplierName: 'E2E测试供应商' })
      .expect(201)
      .expect(res => {
        expect(res.body).toHaveProperty('id');
        expect(res.body.submitStatus).toBe('已提交');
      });
  });

  it('重复提交同一供应商返回 400', () => {
    return request(app.getHttpServer())
      .post(`/api/bid/projects/${createdProjectId}/suppliers`)
      .set('Cookie', adminCookie)
      .send({ supplierName: 'E2E测试供应商' })
      .expect(400);
  });

  it('管理员可启动开标 SUBMIT → OPENING', () => {
    return request(app.getHttpServer())
      .post(`/api/bid/projects/${createdProjectId}/open`)
      .set('Cookie', adminCookie)
      .send({
        host: '主持人',
        supervisor: '监督员',
        decryptWindowStart: '2099-12-31T09:00:00Z',
        decryptWindowEnd: '2099-12-31T12:00:00Z',
      })
      .expect(201);
  });

  it('管理员可启动评标 OPENING → EVALUATING', () => {
    return request(app.getHttpServer())
      .post(`/api/bid/projects/${createdProjectId}/start-evaluation`)
      .set('Cookie', adminCookie)
      .expect(201);
  });

  it('供应商不能访问招标管理接口（403）', async () => {
    await request(app.getHttpServer())
      .post('/api/bid/projects')
      .set('Cookie', supplierCookie)
      .send({ name: '非法项目', procurementMethod: '公开招标', openTime: '2099-12-31T09:00:00Z', deadline: '2099-12-30T17:00:00Z' })
      .expect(403);
  });

  it('管理员可查看监督日志', () => {
    return request(app.getHttpServer())
      .get(`/api/bid/projects/${createdProjectId}/supervision-logs`)
      .set('Cookie', adminCookie)
      .expect(200)
      .expect(res => {
        expect(Array.isArray(res.body)).toBe(true);
        // 应至少有 open-submission、open、start-evaluation 三条日志
        expect(res.body.length).toBeGreaterThanOrEqual(3);
      });
  });

  // 清理
  afterAll(async () => {
    if (createdProjectId) {
      await prisma.bidSupervisionLog.deleteMany({ where: { projectId: createdProjectId } });
      await prisma.bidSupplier.deleteMany({ where: { projectId: createdProjectId } });
      await prisma.bidProject.delete({ where: { id: createdProjectId } }).catch(() => {});
    }
  });
});
