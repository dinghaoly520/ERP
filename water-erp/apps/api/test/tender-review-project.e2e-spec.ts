import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { computeDraftFingerprint } from '../src/tender-review/services/draft-fingerprint.util';

async function loginAs(app: INestApplication, username: string, password: string): Promise<string[]> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .set('X-Portal', 'web')
    .send({ username, password });
  const cookie = res.headers['set-cookie'];
  return Array.isArray(cookie) ? cookie : cookie ? [cookie] : [];
}

describe('项目管理采购文件审查流 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookie: string[];
  let projectId: string;
  let kbId: string;
  const answers = { chapter1: '正文内容甲', budget: '100' };
  const fingerprint = computeDraftFingerprint('OPEN', answers);
  let originalKbPref: string | null | undefined;
  let staffUserId: string;
  let createdTaskIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    cookie = await loginAs(app, 'Swhi-CGZX-05', 'Swhi-CGZX-05@2026');
    // username 为 [username, role] 复合唯一（不再单列唯一），须 findFirst
    staffUserId = (await prisma.user.findFirst({ where: { username: 'Swhi-CGZX-05' } }))!.id;

    const project = await prisma.projectManagementItem.findFirst();
    expect(project).toBeTruthy();
    projectId = project!.id;
    // 清理该项目历史任务，保证 none 态可测（dev 库可能有残留）
    await prisma.reviewTask.deleteMany({ where: { projectId } });

    const kb = await prisma.knowledgeBase.findFirst();
    expect(kb).toBeTruthy();
    kbId = kb!.id;

    const settings = await prisma.userSettings.findUnique({ where: { userId: staffUserId } });
    originalKbPref = settings?.defaultReviewKbId ?? null;
  });

  afterAll(async () => {
    await prisma.reviewTask.deleteMany({ where: { id: { in: createdTaskIds } } });
    if (staffUserId) {
      await prisma.userSettings.upsert({
        where: { userId: staffUserId },
        create: { userId: staffUserId, theme: 'light', defaultReviewKbId: originalKbPref ?? null },
        update: { defaultReviewKbId: originalKbPref ?? null },
      });
    }
    await app.close();
  });

  it('未审查 → none', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/tender-review/review/project-status')
      .set('Cookie', cookie)
      .set('X-Portal', 'web')
      .send({ projectId, documentType: 'OPEN', answers });
    expect(res.status).toBe(201);
    expect(res.body.state).toBe('none');
    expect(res.body.fingerprint).toBe(fingerprint);
  });

  it('execute 带项目关联 → running + 默认库记忆', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/tender-review/review/execute')
      .set('Cookie', cookie)
      .set('X-Portal', 'web')
      .send({
        knowledgeBaseId: kbId,
        reviewMode: 'general',
        documentContent: '测试正文',
        documentName: 'e2e-采购文件.docx',
        objectKey: 'review/e2e-test',
        projectId,
        fingerprint,
      });
    expect(res.status).toBe(201);
    createdTaskIds.push(res.body.taskId);

    const task = await prisma.reviewTask.findUnique({ where: { id: res.body.taskId } });
    expect(task?.projectId).toBe(projectId);
    expect(task?.draftFingerprint).toBe(fingerprint);

    const settings = await prisma.userSettings.findUnique({ where: { userId: staffUserId } });
    expect(settings?.defaultReviewKbId).toBe(kbId);
  });

  it('运行中 → running（防重复）', async () => {
    // execute 建的任务会被进程内 runner 秒级跑完，running 态用直建任务钉住（无 runner 翻转）
    const running = await prisma.reviewTask.create({
      data: {
        documentName: 'running.docx', objectKey: 'review/running', documentContent: 'c',
        knowledgeBaseId: kbId, userId: staffUserId, reviewMode: 'general',
        status: 'running', projectId, draftFingerprint: fingerprint,
        createdAt: new Date(Date.now() + 1000), // 晚于 execute 任务，成为「最新」
      },
    });
    createdTaskIds.push(running.id);
    const res = await request(app.getHttpServer())
      .post('/api/tender-review/review/project-status')
      .set('Cookie', cookie)
      .set('X-Portal', 'web')
      .send({ projectId, documentType: 'OPEN', answers });
    expect(res.status).toBe(201);
    expect(res.body.state).toBe('running');
    // 立即删除，避免其作为「最新任务」干扰后续 matching/stale 判定
    await prisma.reviewTask.delete({ where: { id: running.id } });
    createdTaskIds = createdTaskIds.filter((id) => id !== running.id);
  });

  it('完成且指纹一致 → matching；报告 PDF 可下载或明确失败', async () => {
    const taskId = createdTaskIds[0];
    await prisma.reviewTask.update({
      where: { id: taskId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        results: { summary: { totalChecks: 1, passed: 1, failed: 0, warnings: 0 }, criticalIssues: [], warnings: [], passedChecks: [{ ruleId: 'r1', ruleName: '签章', severity: 'info', details: 'ok', passed: true }] },
      },
    });
    const st = await request(app.getHttpServer())
      .post('/api/tender-review/review/project-status')
      .set('Cookie', cookie)
      .set('X-Portal', 'web')
      .send({ projectId, documentType: 'OPEN', answers });
    expect(st.body.state).toBe('matching');

    const pdf = await request(app.getHttpServer())
      .get(`/api/tender-review/review/tasks/${taskId}/report.pdf`)
      .set('Cookie', cookie)
      .set('X-Portal', 'web');
    // 本机装了 LibreOffice → 200 + pdf；CI 无 LibreOffice → 500 + 明确 message（spec §10）
    if (pdf.status === 200) {
      expect(pdf.headers['content-type']).toBe('application/pdf');
    } else {
      expect(pdf.status).toBe(500);
    }
  });

  it('草稿变更 → stale', async () => {
    const changed = { ...answers, budget: '200' };
    const res = await request(app.getHttpServer())
      .post('/api/tender-review/review/project-status')
      .set('Cookie', cookie)
      .set('X-Portal', 'web')
      .send({ projectId, documentType: 'OPEN', answers: changed });
    expect(res.body.state).toBe('stale');
    expect(res.body.task.status).toBe('completed');
  });

  it('未完成任务请求报告 → 400；不存在项目 execute → 404', async () => {
    const pending = await prisma.reviewTask.create({
      data: {
        documentName: 'x.docx', objectKey: 'review/x', documentContent: 'c',
        knowledgeBaseId: kbId, userId: staffUserId, reviewMode: 'general', status: 'running',
      },
    });
    createdTaskIds.push(pending.id);
    const bad = await request(app.getHttpServer())
      .get(`/api/tender-review/review/tasks/${pending.id}/report.pdf`)
      .set('Cookie', cookie)
      .set('X-Portal', 'web');
    expect(bad.status).toBe(400);

    const noProj = await request(app.getHttpServer())
      .post('/api/tender-review/review/execute')
      .set('Cookie', cookie)
      .set('X-Portal', 'web')
      .send({
        knowledgeBaseId: kbId, reviewMode: 'general', documentContent: 'c',
        documentName: 'n.docx', objectKey: 'k', projectId: 'pmi-not-exist', fingerprint: 'f',
      });
    expect(noProj.status).toBe(404);
  });
});
