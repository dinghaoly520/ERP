import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';

async function loginAs(app: INestApplication, username: string, password: string): Promise<string[]> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .set('X-Portal', 'web')
    .send({ username, password });
  const cookie = res.headers['set-cookie'];
  return Array.isArray(cookie) ? cookie : cookie ? [cookie] : [];
}

/**
 * 文档审查只收上传记录 id（审计第 3 处，2026-11-25）。
 * 此前 POST /tender-review/review/execute 裸收 objectKey 并原样写进 ReviewTask，之后的下载、备份、
 * 覆盖写、回滚都作用于这个键——任何内部角色都能借它读写对象存储里的任意对象。
 */
describe('文档审查上传记录（审计第 3 处）(e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let staff: string[];
  let leader: string[];
  let admin: string[];
  let staffUserId: string;
  let kbId: string;
  const createdTaskIds: string[] = [];
  const createdAssetIds: string[] = [];

  const BODY = '纯文本审查正文';
  const upload = (cookie: string[], filename: string) =>
    request(app.getHttpServer())
      .post('/api/tender-review/review/upload')
      .set('Cookie', cookie)
      .set('X-Portal', 'web')
      .attach('file', Buffer.from(BODY), { filename, contentType: 'text/plain' });

  const execute = (cookie: string[], body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/tender-review/review/execute')
      .set('Cookie', cookie)
      .set('X-Portal', 'web')
      .send({ knowledgeBaseId: kbId, reviewMode: 'general', documentContent: 'x', documentName: 'x.txt', ...body });

  const track = async (res: request.Response) => {
    if (res.body?.fileId) createdAssetIds.push(res.body.fileId);
    if (res.body?.taskId) createdTaskIds.push(res.body.taskId);
    return res;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    staff = await loginAs(app, 'Swhi-CGZX-05', 'Swhi-CGZX-05@2026');
    leader = await loginAs(app, 'Swhi-CGZX-01', 'Swhi-CGZX-01@2026');
    admin = await loginAs(app, 'Swhi-CGZX-admin', 'Swhi-CGZX-admin@2026');
    staffUserId = (await prisma.user.findFirst({ where: { username: 'Swhi-CGZX-05' } }))!.id;
    kbId = (await prisma.knowledgeBase.findFirst())!.id;
  });

  afterAll(async () => {
    await prisma.reviewTask.deleteMany({ where: { id: { in: createdTaskIds } } });
    await prisma.fileAsset.deleteMany({ where: { id: { in: createdAssetIds } } });
    await app.close();
  });

  it('上传即登记为本人名下的文件记录；响应不给对象键，键不含用户文件名', async () => {
    const res = await track(await upload(staff, 'e2e-审查源文件.txt'));
    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('objectKey');
    expect(typeof res.body.fileId).toBe('string');

    const asset = await prisma.fileAsset.findUnique({ where: { id: res.body.fileId } });
    expect(asset?.category).toBe('tender_review_source');
    expect(asset?.uploaderId).toBe(staffUserId);
    expect(asset?.originalName).toBe('e2e-审查源文件.txt');
    expect(asset?.key).toMatch(/^review\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{32}\.txt$/);
  });

  it('带 fileId 执行审查 → 任务的 objectKey 是资产行里的键', async () => {
    const up = await track(await upload(staff, 'e2e-执行用.txt'));
    const res = await track(await execute(staff, { fileId: up.body.fileId }));
    expect(res.status).toBe(201);
    const asset = await prisma.fileAsset.findUnique({ where: { id: up.body.fileId } });
    const task = await prisma.reviewTask.findUnique({ where: { id: res.body.taskId } });
    expect(task?.objectKey).toBe(asset?.key);
  });

  it('别人的上传记录 → 403 REVIEW_FILE_FORBIDDEN，不建任务', async () => {
    const up = await track(await upload(staff, 'e2e-他人工号.txt'));
    const before = await prisma.reviewTask.count();
    const res = await execute(leader, { fileId: up.body.fileId });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('REVIEW_FILE_FORBIDDEN');
    expect(await prisma.reviewTask.count()).toBe(before);
  });

  it('指向别的类目的资产 → 400 REVIEW_FILE_INVALID，不建任务', async () => {
    const other = await prisma.fileAsset.create({
      data: { key: 'uploads/e2e/other-category.bin', originalName: 'o.bin', mimeType: 'application/octet-stream', size: 1, sha256: 'e2e', category: 'general', uploaderId: staffUserId },
    });
    createdAssetIds.push(other.id);
    const before = await prisma.reviewTask.count();
    const res = await execute(staff, { fileId: other.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('REVIEW_FILE_INVALID');
    expect(await prisma.reviewTask.count()).toBe(before);
  });

  it('请求体继续带旧的 objectKey 字段 → 被忽略，任务 objectKey 为空串', async () => {
    const res = await track(await execute(staff, { objectKey: '../.env' }));
    expect(res.status).toBe(201);
    const task = await prisma.reviewTask.findUnique({ where: { id: res.body.taskId } });
    expect(task?.objectKey).toBe('');
  });

  it('审查源文件：别的内部角色下不了，上传者本人与 admin 能下', async () => {
    const up = await track(await upload(staff, 'e2e-下载授权.txt'));
    const denied = await request(app.getHttpServer()).get(`/api/upload/files/${up.body.fileId}`).set('Cookie', leader).set('X-Portal', 'web');
    expect(denied.status).toBe(403);
    for (const cookie of [staff, admin]) {
      const ok = await request(app.getHttpServer()).get(`/api/upload/files/${up.body.fileId}`).set('Cookie', cookie).set('X-Portal', 'web');
      expect(ok.status).toBe(200);
      expect(ok.text).toBe(BODY);
    }
  });

  const removeTask = (cookie: string[], taskId: string) =>
    request(app.getHttpServer())
      .delete(`/api/tender-review/review/tasks/${taskId}`)
      .set('Cookie', cookie)
      .set('X-Portal', 'web');

  const fileStatus = async (cookie: string[], fileId: string) =>
    (await request(app.getHttpServer()).get(`/api/upload/files/${fileId}`).set('Cookie', cookie).set('X-Portal', 'web')).status;

  it('删除任务且这份上传没有别的任务在用 → 对象、备份与文件记录一并清掉', async () => {
    const up = await track(await upload(staff, 'e2e-删除清理.txt'));
    const key = (await prisma.fileAsset.findUnique({ where: { id: up.body.fileId } }))!.key;
    // 模拟一次「接受修改」留下的备份对象
    const storage = app.get(StorageService);
    await storage.upload(`${key}.original`, Buffer.from(BODY), 'application/octet-stream');
    const res = await track(await execute(staff, { fileId: up.body.fileId }));

    expect((await removeTask(staff, res.body.taskId)).status).toBe(200);

    expect(await prisma.fileAsset.findUnique({ where: { id: up.body.fileId } })).toBeNull();
    await expect(storage.download(key)).rejects.toBeDefined();
    await expect(storage.download(`${key}.original`)).rejects.toBeDefined();
    expect(await fileStatus(staff, up.body.fileId)).toBe(404);
  });

  it('同一份上传还被另一个任务在用 → 只删任务、文件留着；最后一个任务删掉后才清', async () => {
    const up = await track(await upload(staff, 'e2e-共用清理.txt'));
    const first = await track(await execute(staff, { fileId: up.body.fileId }));
    const second = await track(await execute(staff, { fileId: up.body.fileId }));

    expect((await removeTask(staff, first.body.taskId)).status).toBe(200);
    expect(await prisma.fileAsset.findUnique({ where: { id: up.body.fileId } })).not.toBeNull();
    expect(await fileStatus(staff, up.body.fileId)).toBe(200);

    expect((await removeTask(staff, second.body.taskId)).status).toBe(200);
    expect(await prisma.fileAsset.findUnique({ where: { id: up.body.fileId } })).toBeNull();
    expect(await fileStatus(staff, up.body.fileId)).toBe(404);
  });
});
