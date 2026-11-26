import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { createHash } from 'crypto';
import * as JSZip from 'jszip';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** 最小可用的 docx（只有正文）：够上传时解析、也够接受修改时就地改写 */
async function buildDocx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('')}<w:sectPr /></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

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
  const plantedObjects: string[] = [];

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
    const storage = app.get(StorageService);
    for (const key of plantedObjects) await storage.delete(key).catch(() => undefined);
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

  it('经通用上传口传成审查源文件类目的记录 → 键不在审查命名空间，拿去执行审查 400', async () => {
    // 通用上传口对内部角色开放、类目名自报——所以执行审查不能只认类目，还要认键的命名空间
    const res = await request(app.getHttpServer())
      .post('/api/upload?category=tender_review_source')
      .set('Cookie', staff)
      .set('X-Portal', 'web')
      .attach('file', Buffer.from('%PDF-1.4\n'), { filename: 'e2e-通用上传口.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    createdAssetIds.push(res.body.id);
    const asset = await prisma.fileAsset.findUnique({ where: { id: res.body.id } });
    expect(asset?.category).toBe('tender_review_source');
    expect(asset?.key).toMatch(/^uploads\//);
    if (asset?.key) plantedObjects.push(asset.key);

    const before = await prisma.reviewTask.count();
    const exec = await track(await execute(staff, { fileId: res.body.id }));
    expect(exec.status).toBe(400);
    expect(exec.body.code).toBe('REVIEW_FILE_INVALID');
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

  it('存量任务的键在审查命名空间内但没有文件记录（例如指向别人的备份键）→ 只删任务，存储不碰', async () => {
    // 修复前 objectKey 可由任意内部角色写入；这种存量键不可信，删除任务时不能据它去删对象
    const storage = app.get(StorageService);
    const othersBackup = 'review/1732452000000_他人文档.docx.original';
    await storage.upload(othersBackup, Buffer.from('他人的原始备份'), 'application/octet-stream');
    plantedObjects.push(othersBackup);
    const legacy = await prisma.reviewTask.create({
      data: { documentName: '他人文档.docx', objectKey: othersBackup, documentContent: 'x', knowledgeBaseId: kbId, userId: staffUserId, reviewMode: 'general' },
    });
    createdTaskIds.push(legacy.id);

    expect((await removeTask(staff, legacy.id)).status).toBe(200);

    expect((await storage.download(othersBackup)).toString()).toBe('他人的原始备份');
  });

  it('接受修改把文件改写后，文件记录的大小与校验值跟着变——通用下载不再被截断', async () => {
    const original = await buildDocx(['第一条 甲方应按合同约定支付预付款。', '第二条 乙方应按期交付。']);
    const up = await track(await request(app.getHttpServer())
      .post('/api/tender-review/review/upload')
      .set('Cookie', staff)
      .set('X-Portal', 'web')
      .attach('file', original, { filename: 'e2e-改写同步.docx', contentType: DOCX }));
    expect(up.status).toBe(201);
    const key = (await prisma.fileAsset.findUnique({ where: { id: up.body.fileId } }))!.key;
    plantedObjects.push(key, `${key}.original`);
    // 不经大模型：直接给任务挂一条结构化修改建议
    const task = await prisma.reviewTask.create({
      data: {
        documentName: 'e2e-改写同步.docx', objectKey: key, knowledgeBaseId: kbId, userId: staffUserId, reviewMode: 'general', status: 'completed',
        results: {
          criticalIssues: [{ ruleId: 'r1', status: 'pending', modificationApplied: false, suggestion: { description: '把「甲方」改为「采购人」', operation: 'replace', originalText: '甲方', replacementText: '采购人' } }],
          warnings: [], passedChecks: [],
        },
      },
    });
    createdTaskIds.push(task.id);

    const accepted = await request(app.getHttpServer())
      .patch(`/api/tender-review/review/tasks/${task.id}/issues/resolve`)
      .set('Cookie', staff)
      .set('X-Portal', 'web')
      .send({ issueIndex: 0, action: 'accept' });
    expect(accepted.status).toBe(200);
    expect(accepted.body.results.criticalIssues[0].modificationApplied).toBe(true);

    // 对象已改写（长度变了）；文件记录必须跟上，否则通用下载按旧长度发 Content-Length
    const stored = await app.get(StorageService).download(key);
    expect(stored.length).not.toBe(original.length);
    const asset = await prisma.fileAsset.findUnique({ where: { id: up.body.fileId } });
    expect(asset?.size).toBe(stored.length);
    expect(asset?.sha256).toBe(createHash('sha256').update(stored).digest('hex'));

    const dl = await request(app.getHttpServer())
      .get(`/api/upload/files/${up.body.fileId}`)
      .set('Cookie', staff)
      .set('X-Portal', 'web')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(dl.status).toBe(200);
    expect(Number(dl.headers['content-length'])).toBe(stored.length);
    expect(Buffer.compare(dl.body as Buffer, stored)).toBe(0);
  });
});
