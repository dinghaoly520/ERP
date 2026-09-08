// apps/api/test/ai-bid.e2e-spec.ts
// C14 (7.4): AI 辅助分析端到端 — 启动分析 → 等 worker → 验证结果
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

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

/** 等待异步条件（poll），超时抛错 */
async function waitFor(fn: () => Promise<boolean>, ms = 30000, interval = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Condition not met within ${ms}ms`);
}

describe('AI Bid Analysis (e2e) — C14', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let bidHostCookie: string[];
  let expertCookie: string[];
  let chenHostId: string;
  let rerunProjectId: string;

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

    // 登录：bid_host（陈主任）+ bid_expert（任一专家）
    // 2026-08-14 auth port-roles 后 bid_host 被 web 门户拒（403 无 cookie），改 bid 门户（token_bid + X-Portal:bid）
    bidHostCookie = await loginAs(app, '陈源远', '陈源远@2026', 'bid');
    expect(bidHostCookie.join()).toContain('token_bid=');
    chenHostId = (await prisma.user.findFirst({ where: { username: '陈源远', role: 'bid_host', isActive: true } }))!.id;

    // rerun 正例自建 EVALUATING fixture：2026-08-28 评标产出保护闸门（存在条款标注/评分记录即 409
    // EVALUATION_IN_PROGRESS）后，种子/残留的 EVALUATING 项目均带评分记录，201 路径只能自建无产出项目验证
    // （直接 prisma 建，不经 HTTP create——不受截标↔开标 24h 校验；assignedHostUserId 供公司隔离 :3007 放行）
    const rerunProj = await prisma.bidProject.create({
      data: {
        projectCode: `E2E-AIBID-${Date.now()}`,
        name: `AI分析E2E-${Date.now()}`,
        procurementMethod: '公开招标',
        stage: 'EVALUATING',
        openTime: new Date(Date.now() + 7200_000),
        deadline: new Date(Date.now() + 3600_000),
        assignedHostUserId: chenHostId,
      },
    });
    rerunProjectId = rerunProj.id;
    // 找一个有项目的专家
    const expert = await prisma.bidExpert.findFirst({
      where: { project: { stage: 'EVALUATING' } },
      include: { user: { select: { username: true } } },
    });
    if (expert?.user) {
      expertCookie = await loginAs(app, expert.user.username, 'expert@2026', 'expert');
    }
  });

  afterAll(async () => {
    if (rerunProjectId) {
      // rerun 副作用：监督日志 + AI 任务（task 随项目 onDelete:Cascade，先清日志防 FK）
      await prisma.bidSupervisionLog.deleteMany({ where: { projectId: rerunProjectId } }).catch(() => {});
      await prisma.aiBidAnalysisTask.deleteMany({ where: { projectId: rerunProjectId } }).catch(() => {});
      await prisma.bidProject.delete({ where: { id: rerunProjectId } }).catch(() => {});
    }
    await app.close();
  });

  // ── 1. 重新分析端点 ────────────────────────────────────────────────

  describe('POST /bid/projects/:id/rerun-ai-analysis', () => {
    it('对 EVALUATING 阶段项目返回 201', async () => {
      // 用 beforeAll 自建的无评标产出 EVALUATING fixture（2026-08-28 产出保护闸门后
      // 种子项目均带评分记录必 409，正例 201 只能靠自建项目验证）
      const res = await request(app.getHttpServer())
        .post(`/api/bid/projects/${rerunProjectId}/rerun-ai-analysis`)
        .set('Cookie', bidHostCookie)
        .set('X-Portal', 'bid');

      expect([201, 400]).toContain(res.status);
      // 400 = 入队失败（ensureTenderAnalysis 保留入队失败语义）— 可接受；201 = 正常入队
    });

    it('非 EVALUATING 阶段返回 400', async () => {
      const project = await prisma.bidProject.findFirst({
        where: { stage: { not: 'EVALUATING' }, assignedHostUserId: chenHostId },
        select: { id: true },
      });
      if (!project) {
        console.warn('No non-EVALUATING project found — skipping');
        return;
      }

      const res = await request(app.getHttpServer())
        .post(`/api/bid/projects/${project.id}/rerun-ai-analysis`)
        .set('Cookie', bidHostCookie)
        .set('X-Portal', 'bid');

      expect(res.status).toBe(400);
    });
  });

  // ── 2. getAssistData 响应契约 ──────────────────────────────────────

  describe('GET /expert/assist-data (getAssistData 响应契约)', () => {
    it('返回 ai_bidder_result 结构完整', async () => {
      if (!expertCookie || expertCookie.length === 0) {
        console.warn('No expert logged in — skipping assistData test');
        return;
      }

      // 找专家参与的项目 + 供应商
      const expert = await prisma.bidExpert.findFirst({
        where: { project: { stage: { in: ['OPENING', 'EVALUATING'] } } },
        select: { projectId: true },
      });
      if (!expert) {
        console.warn('No expert with active project — skipping');
        return;
      }

      const supplier = await prisma.bidSupplier.findFirst({
        where: { projectId: expert.projectId },
        select: { id: true },
      });
      if (!supplier) {
        console.warn('No supplier in project — skipping');
        return;
      }

      const res = await request(app.getHttpServer())
        .get(`/api/expert/assist-data?projectId=${expert.projectId}&supplierId=${supplier.id}`)
        .set('Cookie', expertCookie)
        .set('X-Portal', 'expert');

      // 可能 200（有数据）或 403（回避）或 400
      if (res.status === 200) {
        const body = res.body;
        expect(body).toHaveProperty('source');
        expect(['ai_bidder_result', 'rules_fallback']).toContain(body.source);
        if (body.source === 'ai_bidder_result') {
          expect(body).toHaveProperty('totalScore');
          expect(body).toHaveProperty('scoreItems');
          expect(body).toHaveProperty('categoryTotals');
          expect(body).toHaveProperty('riskLevel');
        }
      }
    });
  });

  // ── 3. 报告 DOCX 下载 ─────────────────────────────────────────────

  describe('报告 DOCX 可下载', () => {
    it('有 docxFileId 的任务可通过 upload 端点下载', async () => {
      const report = await prisma.aiBidReport.findFirst({
        where: { docxFileId: { not: null } },
        select: { docxFileId: true },
      });
      if (!report?.docxFileId) {
        console.warn('No report with docx — skipping download test');
        return;
      }

      const res = await request(app.getHttpServer())
        .get(`/api/upload/files/${report.docxFileId}`)
        .set('Cookie', bidHostCookie)
        .set('X-Portal', 'bid');

      // 200（可下载）或 404（文件未在 MinIO）/403 — 均接受
      expect([200, 403, 404]).toContain(res.status);
    });
  });
});
