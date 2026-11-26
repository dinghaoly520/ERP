import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { createHash } from 'crypto';
import * as JSZip from 'jszip';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';
import { ReviewSourceCleanupService } from '../src/scheduler/review-source-cleanup.service';

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

  it('通用上传口不再收审查源文件类目 → 400 INVALID_CATEGORY，不登记；上传者角色与 admin 都一样', async () => {
    // 登记成 FileAsset 之后，这条路对内部角色是开的：登出来的记录键在 uploads/ 下，执行审查不认（键不在命名空间），
    // 清理也不认——是一条永远清不掉的孤儿。审查源文件只能经 POST /tender-review/review/upload 登记
    for (const cookie of [staff, leader, admin]) {
      const before = await prisma.fileAsset.count();
      const res = await request(app.getHttpServer())
        .post('/api/upload?category=tender_review_source')
        .set('Cookie', cookie)
        .set('X-Portal', 'web')
        .attach('file', Buffer.from('%PDF-1.4\n'), { filename: 'e2e-通用上传口.pdf', contentType: 'application/pdf' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_CATEGORY');
      expect(await prisma.fileAsset.count()).toBe(before);
    }
  });

  it('存量脏记录（类目是审查源文件、键却不在命名空间）→ 执行审查 400；每日清理不列为候选、不碰它的对象', async () => {
    // 通用上传口收口之前登出来的记录。执行审查不能只认类目，还要认键的命名空间；清理不能据它去删对象
    const dirtyKey = 'uploads/e2e/dirty-review-source.pdf';
    const storage = app.get(StorageService);
    await storage.upload(dirtyKey, Buffer.from('脏记录的对象'), 'application/pdf');
    plantedObjects.push(dirtyKey);
    const dirty = await prisma.fileAsset.create({
      data: {
        key: dirtyKey, originalName: 'e2e-脏记录.pdf', mimeType: 'application/pdf', size: 1, sha256: 'e2e',
        category: 'tender_review_source', uploaderId: staffUserId, createdAt: AGE_25H(),
      },
    });
    createdAssetIds.push(dirty.id);

    const before = await prisma.reviewTask.count();
    const exec = await track(await execute(staff, { fileId: dirty.id }));
    expect(exec.status).toBe(400);
    expect(exec.body.code).toBe('REVIEW_FILE_INVALID');
    expect(await prisma.reviewTask.count()).toBe(before);

    const janitor = app.get(ReviewSourceCleanupService);
    await janitor.cleanupOnce(); // 先把库里别的遗留清掉，下面这一次的计数只反映本用例造的数据
    expect(await janitor.cleanupOnce()).toEqual({ removed: 0, kept: 0 });
    expect((await prisma.fileAsset.findUnique({ where: { id: dirty.id } }))?.category).toBe('tender_review_source');
    expect((await storage.download(dirtyKey)).toString()).toBe('脏记录的对象');
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
  /** 上传时间拨到 25 小时前（超过每日清理的 24 小时保留期） */
  const AGE_25H = () => new Date(Date.now() - 25 * 3600 * 1000);

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

  it('通用删除口删不了审查源文件：上传者本人、admin 都是 409 FILE_PROTECTED，记录与对象都还在', async () => {
    // 这条路不看有没有审查任务在用，也不删 .original 备份——删完任务会指向一个不存在的文件。清理只走审查模块
    const up = await track(await upload(staff, 'e2e-通用删除口.txt'));
    const key = (await prisma.fileAsset.findUnique({ where: { id: up.body.fileId } }))!.key;
    plantedObjects.push(key);
    for (const cookie of [staff, admin]) {
      const res = await request(app.getHttpServer())
        .delete(`/api/upload/${encodeURIComponent(key)}`)
        .set('Cookie', cookie)
        .set('X-Portal', 'web');
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('FILE_PROTECTED');
    }
    expect((await prisma.fileAsset.findUnique({ where: { id: up.body.fileId } }))?.category).toBe('tender_review_source');
    expect((await app.get(StorageService).download(key)).toString()).toBe(BODY);
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

  // ── 2026-11-26 跟进：清理分两步，建任务与清理都先锁文件记录行 ──

  /** 从测试进程里锁住这份上传的文件记录行，直到 release()——用来验证接口确实在等这把锁 */
  async function holdSourceRowLock(fileId: string) {
    const holder = new PrismaClient({ log: [] });
    let release!: () => void;
    let acquired!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const got = new Promise<void>((resolve) => { acquired = resolve; });
    const tx = holder.$transaction(async (cx) => {
      await cx.$queryRaw`SELECT "id" FROM "FileAsset" WHERE "id" = ${fileId} FOR UPDATE`;
      acquired();
      await gate;
    }, { timeout: 15_000 });
    await got;
    return { release, done: tx.finally(() => holder.$disconnect()) };
  }
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('删掉最后一个用它的任务后，再用同一个上传记录执行审查 → 400 REVIEW_FILE_INVALID，不建任务', async () => {
    const up = await track(await upload(staff, 'e2e-清理后复用.txt'));
    const first = await track(await execute(staff, { fileId: up.body.fileId }));
    expect((await removeTask(staff, first.body.taskId)).status).toBe(200);

    const before = await prisma.reviewTask.count();
    const again = await track(await execute(staff, { fileId: up.body.fileId }));
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('REVIEW_FILE_INVALID');
    expect(await prisma.reviewTask.count()).toBe(before);
  });

  it('执行审查要拿文件记录行的锁：行被别的事务锁着时它等着，锁放开后才建任务', async () => {
    const up = await track(await upload(staff, 'e2e-行锁-执行.txt'));
    const lock = await holdSourceRowLock(up.body.fileId);
    let settled = false;
    const pending = execute(staff, { fileId: up.body.fileId }).then((res) => {
      settled = true;
      return track(res);
    });
    try {
      await sleep(700);
      expect(settled).toBe(false);
    } finally {
      lock.release();
    }
    const res = await pending;
    await lock.done;
    expect(res.status).toBe(201);
    expect(await prisma.reviewTask.findUnique({ where: { id: res.body.taskId } })).not.toBeNull();
  });

  it('删任务后的清理也要拿这把锁：等锁期间不动文件记录，锁放开后才清', async () => {
    const up = await track(await upload(staff, 'e2e-行锁-清理.txt'));
    const key = (await prisma.fileAsset.findUnique({ where: { id: up.body.fileId } }))!.key;
    plantedObjects.push(key);
    const res = await track(await execute(staff, { fileId: up.body.fileId }));
    const lock = await holdSourceRowLock(up.body.fileId);
    let settled = false;
    const pending = removeTask(staff, res.body.taskId).then((r) => {
      settled = true;
      return r;
    });
    try {
      await sleep(700);
      expect(settled).toBe(false);
      const waiting = await prisma.fileAsset.findUnique({ where: { id: up.body.fileId } });
      expect(waiting?.category).toBe('tender_review_source');
    } finally {
      lock.release();
    }
    expect((await pending).status).toBe(200);
    await lock.done;
    expect(await prisma.fileAsset.findUnique({ where: { id: up.body.fileId } })).toBeNull();
  });

  it('对象删不掉 → 请求照常成功，文件记录与对象都留着（记录标成待清，等下一次清理接着清）', async () => {
    const storage = app.get(StorageService);
    const up = await track(await upload(staff, 'e2e-清理没做完.txt'));
    const key = (await prisma.fileAsset.findUnique({ where: { id: up.body.fileId } }))!.key;
    plantedObjects.push(key);
    const res = await track(await execute(staff, { fileId: up.body.fileId }));
    const spy = jest.spyOn(storage, 'delete').mockRejectedValueOnce(new Error('minio down'));

    expect((await removeTask(staff, res.body.taskId)).status).toBe(200);
    spy.mockRestore();

    const asset = await prisma.fileAsset.findUnique({ where: { id: up.body.fileId } });
    expect(asset?.category).toBe('tender_review_source_purging');
    expect((await storage.download(key)).toString()).toBe(BODY);
  });

  // ── 每日清理（scheduler/review-source-cleanup.service.ts）：与删任务后的清理是同一份规则 ──

  const keyOf = async (fileId: string) => (await prisma.fileAsset.findUnique({ where: { id: fileId } }))!.key;

  it('每日清理：没建成任务的上传满 24 小时才清；没满的、还有任务在用的不动', async () => {
    const janitor = app.get(ReviewSourceCleanupService);
    const storage = app.get(StorageService);
    const expired = await track(await upload(staff, 'e2e-孤儿-满24小时.txt'));
    const fresh = await track(await upload(staff, 'e2e-孤儿-未满24小时.txt'));
    const inUse = await track(await upload(staff, 'e2e-孤儿-仍有任务.txt'));
    const used = await track(await execute(staff, { fileId: inUse.body.fileId }));
    const expiredKey = await keyOf(expired.body.fileId);
    const inUseKey = await keyOf(inUse.body.fileId);
    for (const fileId of [expired.body.fileId, inUse.body.fileId]) {
      await prisma.fileAsset.update({ where: { id: fileId }, data: { createdAt: AGE_25H() } });
    }

    const result = await janitor.cleanupOnce();

    // 库里可能还有本轮其它用例留下的待清记录，所以只断言「至少」与具体行
    expect(result.removed).toBeGreaterThanOrEqual(1);
    expect(await prisma.fileAsset.findUnique({ where: { id: expired.body.fileId } })).toBeNull();
    await expect(storage.download(expiredKey)).rejects.toBeDefined();
    expect((await prisma.fileAsset.findUnique({ where: { id: fresh.body.fileId } }))?.category).toBe('tender_review_source');
    expect((await prisma.fileAsset.findUnique({ where: { id: inUse.body.fileId } }))?.category).toBe('tender_review_source');
    expect((await storage.download(inUseKey)).toString()).toBe(BODY);
    expect(await prisma.reviewTask.findUnique({ where: { id: used.body.taskId } })).not.toBeNull();
  });

  it('每日清理接着清上次没做完的：待清状态的记录不看上传时间', async () => {
    const janitor = app.get(ReviewSourceCleanupService);
    const storage = app.get(StorageService);
    const up = await track(await upload(staff, 'e2e-待清重试.txt'));
    const key = await keyOf(up.body.fileId);
    plantedObjects.push(key);
    const res = await track(await execute(staff, { fileId: up.body.fileId }));
    const spy = jest.spyOn(storage, 'delete').mockRejectedValueOnce(new Error('minio down'));
    expect((await removeTask(staff, res.body.taskId)).status).toBe(200);
    spy.mockRestore();
    expect((await prisma.fileAsset.findUnique({ where: { id: up.body.fileId } }))?.category).toBe('tender_review_source_purging');
    expect((await storage.download(key)).toString()).toBe(BODY);

    const result = await janitor.cleanupOnce();

    expect(result.removed).toBeGreaterThanOrEqual(1);
    expect(await prisma.fileAsset.findUnique({ where: { id: up.body.fileId } })).toBeNull();
    await expect(storage.download(key)).rejects.toBeDefined();
  });
});
