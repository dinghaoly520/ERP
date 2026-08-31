// A-153 监督推送 e2e（2026-08-28）
// 流程：配置（启用+mock 平台端点+回读）→ 推送（成功路径：SUCCESS→停服 FAILED→凭证导出下载；
//       seed 无签字闭环+回流项目时闸门兜底：409）→ 未实现载荷类型 400 → 配置还原禁用。
// 惯例（app 启动/loginAs）与 bid.e2e-spec.ts 同源。mock 平台为套件内临时 HTTP server（127.0.0.1 随机端口）。
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as http from 'http';
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

/** EVALUATION_REPORT 闸门 409 业务码（supervision-push.service loadEvaluationReport） */
const GATE_CODES = ['SIGN_PACKET_NOT_GENERATED', 'SIGN_NOT_CLOSED', 'HANDOVER_NOT_GENERATED'];

describe('A-153 监督推送 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminCookie: string[];
  let mockServer: http.Server | null = null;

  const closeMock = () =>
    mockServer
      ? new Promise<void>((r) => mockServer!.close(() => { mockServer = null; r(); }))
      : Promise.resolve();

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
    adminCookie = await loginAs(app, 'Swhi-CGZX-admin', 'Swhi-CGZX-admin@2026', 'web');
  });

  afterAll(async () => {
    await closeMock();
    // 兜底卫生（失败中途退出也复原）：删配置行 = 回到缺省禁用态（getConfig enabled ?? false）
    await prisma.systemConfig.deleteMany({ where: { key: 'supervision_push_config' } }).catch(() => {});
    await app.close();
  });

  it('配置→（成功路径 或 闸门 409 兜底）→凭证→配置禁用', async () => {
    // 确定性先禁用（防上一轮失败残留 enabled 状态串扰本用例前置断言）
    await request(app.getHttpServer())
      .post('/api/supervision-push/config')
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .send({ enabled: false })
      .expect(201);

    // 找项目（hero/引大济岷演示项目等 EVALUATING）
    const projects = await request(app.getHttpServer())
      .get('/api/bid/projects?stage=EVALUATING')
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .expect(200);
    const project = (projects.body as Array<{ id: string; stage: string }>)[0];
    expect(project).toBeTruthy();

    // 未启用推送 → 400 SUPERVISION_PUSH_DISABLED（闸门前置）
    await request(app.getHttpServer())
      .post(`/api/supervision-push/projects/${project.id}/push`)
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .send({})
      .expect(400)
      .expect((res) => expect(res.body.code).toBe('SUPERVISION_PUSH_DISABLED'));

    // 本地 mock 公共服务平台
    const received: string[] = [];
    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        received.push(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    await new Promise<void>((r) => mockServer!.listen(0, '127.0.0.1', r));
    const port = (mockServer.address() as { port: number }).port;
    const endpoint = `http://127.0.0.1:${port}/supervision`;

    // 启用配置（enabled + mock 端点）
    const saved = await request(app.getHttpServer())
      .post('/api/supervision-push/config')
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .send({ enabled: true, endpoint, timeoutMs: 3000, platformCode: 'E2E-PLATFORM' })
      .expect(201);
    expect(saved.body.enabled).toBe(true);

    // 配置回读（GET config）
    const cfg = await request(app.getHttpServer())
      .get('/api/supervision-push/config')
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .expect(200);
    expect(cfg.body).toMatchObject({ enabled: true, endpoint, platformCode: 'E2E-PLATFORM' });

    // 闸门状态
    const gate = await request(app.getHttpServer())
      .get(`/api/supervision-push/projects/${project.id}/status`)
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .expect(200);
    expect(gate.body.gate).toHaveProperty('ready');
    expect(gate.body.config).toMatchObject({ enabled: true });

    if (!gate.body.gate.ready) {
      // seed 无「签字闭环+回流已生成」项目：推送被闸门阻断 → 409（业务码三选一）+ reason 有值
      expect(gate.body.gate.reason).toBeTruthy();
      await request(app.getHttpServer())
        .post(`/api/supervision-push/projects/${project.id}/push`)
        .set('Cookie', adminCookie)
        .set('X-Portal', 'web')
        .send({})
        .expect(409)
        .expect((res) => expect(GATE_CODES).toContain(res.body.code));
    } else {
      // 推送成功（201 ≠ 业务成功——读 log.status）
      const log1 = await request(app.getHttpServer())
        .post(`/api/supervision-push/projects/${project.id}/push`)
        .set('Cookie', adminCookie)
        .set('X-Portal', 'web')
        .send({})
        .expect(201);
      expect(log1.body.status).toBe('SUCCESS');
      expect(log1.body.endpoint).toBe(endpoint);
      const firstAttempt = log1.body.attemptNo as number;
      expect(typeof firstAttempt).toBe('number');
      // mock 平台收到信封+签名
      expect(received).toHaveLength(1);
      expect(received[0]).toContain('SUPERVISION_PUSH');
      expect(received[0]).toContain('"signature"');

      // 停服 → 推送失败（业务结果 FAILED，接口仍 201）
      await closeMock();
      const log2 = await request(app.getHttpServer())
        .post(`/api/supervision-push/projects/${project.id}/push`)
        .set('Cookie', adminCookie)
        .set('X-Portal', 'web')
        .send({})
        .expect(201);
      expect(log2.body.status).toBe('FAILED');
      expect(log2.body.attemptNo).toBe(firstAttempt + 1);
      expect(log2.body.errorMessage).toBeTruthy();

      // 凭证导出 + 下载（cookie 认证，路径 /api/upload/files/:id）
      const voucher = await request(app.getHttpServer())
        .post(`/api/supervision-push/projects/${project.id}/voucher`)
        .set('Cookie', adminCookie)
        .set('X-Portal', 'web')
        .send({})
        .expect(201);
      expect(voucher.body.voucherAssetId).toBeTruthy();
      expect(voucher.body.downloadUrl).toContain('/api/upload/files/');
      await request(app.getHttpServer())
        .get(voucher.body.downloadUrl)
        .set('Cookie', adminCookie)
        .set('X-Portal', 'web')
        .expect(200);
    }

    // 还原配置（禁用，避免污染后续 e2e；endpoint 省略 → 服务端置空）
    const off = await request(app.getHttpServer())
      .post('/api/supervision-push/config')
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .send({ enabled: false })
      .expect(201);
    expect(off.body.enabled).toBe(false);
    const cfgAfter = await request(app.getHttpServer())
      .get('/api/supervision-push/config')
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .expect(200);
    expect(cfgAfter.body.enabled).toBe(false);
  });

  it('未实现载荷类型 → 400 PAYLOAD_TYPE_NOT_READY', async () => {
    const projects = await request(app.getHttpServer())
      .get('/api/bid/projects?stage=EVALUATING')
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .expect(200);
    const project = (projects.body as Array<{ id: string }>)[0];
    expect(project).toBeTruthy();
    await request(app.getHttpServer())
      .post(`/api/supervision-push/projects/${project.id}/voucher`)
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .send({ payloadType: 'OPENING_RECORD' })
      .expect(400)
      .expect((res) => expect(res.body.code).toBe('PAYLOAD_TYPE_NOT_READY'));
  });
});
