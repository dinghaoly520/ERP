import { createHash } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { TenderReviewController } from './tender-review.controller';
import { computeDraftFingerprint } from './services/draft-fingerprint.util';

function buildController(prisma: any, pdfSvc: any = {} as any) {
  const controller = new TenderReviewController(
    prisma, {} as any, {} as any, {} as any, {} as any, {} as any,
    {} as any, {} as any, {} as any, {} as any, pdfSvc,
  );
  jest.spyOn(controller as any, 'runReview').mockResolvedValue(undefined);
  return controller;
}

/** 第 3 处用：需要真实的 storage / parser 桩（构造函数第 2、3 个参数） */
function buildControllerWith(prisma: any, storage: any = {}, parser: any = {}) {
  const controller = new TenderReviewController(
    prisma, storage, parser, {} as any, {} as any, {} as any,
    {} as any, {} as any, {} as any, {} as any, {} as any,
  );
  jest.spyOn(controller as any, 'runReview').mockResolvedValue(undefined);
  jest.spyOn((controller as any).logger, 'error').mockImplementation(() => undefined);
  jest.spyOn((controller as any).logger, 'warn').mockImplementation(() => undefined);
  return controller;
}

const USER = { sub: 'u1', role: 'staff' } as any;
const KB = { id: 'kb-1', ownerId: 'u1', isShared: true };

describe('TenderReviewController.executeReview（项目扩展）', () => {
  it('带 projectId 时校验项目存在，不存在抛 404', async () => {
    const prisma: any = {
      knowledgeBase: { findUnique: jest.fn().mockResolvedValue(KB) },
      projectManagementItem: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const controller = buildController(prisma);
    await expect(
      controller.executeReview(
        { knowledgeBaseId: 'kb-1', reviewMode: 'general', documentContent: 'c', documentName: 'n.docx', projectId: 'p-nope', fingerprint: 'f' } as any,
        'c', 'n.docx', USER,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('带 projectId 时落库关联+指纹并记忆默认知识库', async () => {
    const prisma: any = {
      knowledgeBase: { findUnique: jest.fn().mockResolvedValue(KB) },
      projectManagementItem: { findUnique: jest.fn().mockResolvedValue({ id: 'p-1' }) },
      reviewTask: { create: jest.fn().mockResolvedValue({ id: 't-1' }) },
      userSettings: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const controller = buildController(prisma);
    const res = await controller.executeReview(
      { knowledgeBaseId: 'kb-1', reviewMode: 'general', documentContent: 'c', documentName: 'n.docx', projectId: 'p-1', fingerprint: 'fp-1' } as any,
      'c', 'n.docx', USER,
    );
    expect(res).toEqual({ taskId: 't-1', status: 'running' });
    expect(prisma.reviewTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: 'p-1', draftFingerprint: 'fp-1' }),
    });
    expect(prisma.userSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { defaultReviewKbId: 'kb-1' } }),
    );
  });

  it('不带 projectId 时不查项目、不写默认库记忆', async () => {
    const prisma: any = {
      knowledgeBase: { findUnique: jest.fn().mockResolvedValue(KB) },
      projectManagementItem: { findUnique: jest.fn() },
      reviewTask: { create: jest.fn().mockResolvedValue({ id: 't-2' }) },
      userSettings: { upsert: jest.fn() },
    };
    const controller = buildController(prisma);
    await controller.executeReview(
      { knowledgeBaseId: 'kb-1', reviewMode: 'general', documentContent: 'c', documentName: 'n.docx' } as any,
      'c', 'n.docx', USER,
    );
    expect(prisma.projectManagementItem.findUnique).not.toHaveBeenCalled();
    expect(prisma.userSettings.upsert).not.toHaveBeenCalled();
    expect(prisma.reviewTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: null, draftFingerprint: null }),
    });
  });
});

describe('TenderReviewController.projectStatus（四态）', () => {
  const ANSWERS = { a: '1' };
  // 指纹用真实 util 算期望值，防硬编码漂移
  const FP = computeDraftFingerprint('OPEN', ANSWERS);

  it('无任务 → none', async () => {
    const prisma: any = { reviewTask: { findFirst: jest.fn().mockResolvedValue(null) } };
    const controller = buildController(prisma);
    const res = await controller.projectStatus({ projectId: 'p-1', documentType: 'OPEN', answers: ANSWERS } as any);
    expect(res.state).toBe('none');
    expect(res.fingerprint).toBe(FP);
    expect(res.task).toBeUndefined();
  });

  it('最新任务 running → running', async () => {
    const task = { id: 't-1', status: 'running' };
    const prisma: any = { reviewTask: { findFirst: jest.fn().mockResolvedValue(task) } };
    const controller = buildController(prisma);
    const res = await controller.projectStatus({ projectId: 'p-1', documentType: 'OPEN', answers: ANSWERS } as any);
    expect(res.state).toBe('running');
    expect(res.task).toBe(task);
  });

  it('completed 且指纹一致 → matching', async () => {
    const task = { id: 't-1', status: 'completed', draftFingerprint: FP };
    const prisma: any = { reviewTask: { findFirst: jest.fn().mockResolvedValue(task) } };
    const controller = buildController(prisma);
    const res = await controller.projectStatus({ projectId: 'p-1', documentType: 'OPEN', answers: ANSWERS } as any);
    expect(res.state).toBe('matching');
  });

  it('completed 但指纹不符 / 最新为 failed → stale（前端按 task.status 细分）', async () => {
    const mismatch = { id: 't-1', status: 'completed', draftFingerprint: 'other' };
    const prisma: any = { reviewTask: { findFirst: jest.fn().mockResolvedValue(mismatch) } };
    const controller = buildController(prisma);
    expect((await controller.projectStatus({ projectId: 'p-1', documentType: 'OPEN', answers: ANSWERS } as any)).state).toBe('stale');

    const failed = { id: 't-2', status: 'failed', draftFingerprint: FP };
    const prisma2: any = { reviewTask: { findFirst: jest.fn().mockResolvedValue(failed) } };
    const controller2 = buildController(prisma2);
    expect((await controller2.projectStatus({ projectId: 'p-1', documentType: 'OPEN', answers: ANSWERS } as any)).state).toBe('stale');
  });
});

describe('TenderReviewController.downloadReportDocx', () => {
  it('未完成任务 → 400；非属主 → 403；成功 → PDF 响应头', async () => {
    const { BadRequestException, ForbiddenException } = await import('@nestjs/common');
    const task: any = { id: 't-1', userId: 'u1', status: 'running', knowledgeBaseId: null, projectId: null };
    const prisma: any = {
      reviewTask: { findUnique: jest.fn().mockResolvedValue(task) },
    };
    const pdfSvc = { generate: jest.fn().mockResolvedValue({ buffer: Buffer.from('pdf'), fileName: 'a.pdf' }) };
    const controller = buildController(prisma, pdfSvc);
    const res = { setHeader: jest.fn(), send: jest.fn() } as any;

    await expect(controller.downloadReportDocx('t-1', USER, res)).rejects.toBeInstanceOf(BadRequestException);

    task.status = 'completed';
    task.userId = 'someone-else';
    await expect(controller.downloadReportDocx('t-1', USER, res)).rejects.toBeInstanceOf(ForbiddenException);

    task.userId = 'u1';
    await controller.downloadReportDocx('t-1', USER, res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(res.send).toHaveBeenCalledWith(Buffer.from('pdf'));
  });
});

describe('TenderReviewController — 审查任务的对象键守卫（审计第 3 处）', () => {
  const BAD_KEYS = ['../.env', '/etc/passwd', 'knowledge/x.docx', 'sealed-backup/k', 'review/../x'];

  const taskWith = (objectKey: string) => ({ id: 't1', objectKey, documentName: 'd.docx', userId: 'u1' });

  it.each(BAD_KEYS)('任务键 %s：下载、改写、批注、重建、备份一律 400 INVALID_REVIEW_OBJECT_KEY，不触任何存储调用', async (badKey) => {
    const storage = { upload: jest.fn(), download: jest.fn(), delete: jest.fn() };
    const controller = buildControllerWith({ reviewTask: { findUnique: jest.fn().mockResolvedValue(taskWith(badKey)) } }, storage);
    const task = taskWith(badKey);
    const code = { response: { code: 'INVALID_REVIEW_OBJECT_KEY' } };

    await expect((controller as any).downloadModifiedDocument('t1', USER, { setHeader: jest.fn(), send: jest.fn() })).rejects.toMatchObject(code);
    await expect((controller as any).applyModificationToFile(task, { originalText: 'a', replacementText: 'b', operation: 'replace' })).rejects.toMatchObject(code);
    await expect((controller as any).applyManualCommentToFile(task, '锚文本', '批注')).rejects.toMatchObject(code);
    await expect((controller as any).rebuildDocxFromAccepted(task, 0)).rejects.toMatchObject(code);
    await expect((controller as any).ensureOriginalBackup(task)).rejects.toMatchObject(code);

    expect(storage.upload).not.toHaveBeenCalled();
    expect(storage.download).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('存量格式的键照常可用：下载读的就是任务键', async () => {
    const legacyKey = 'review/1732452000000_采购文件（终版） #2.docx';
    const bytes = Buffer.from('PK\u0003\u0004 旧任务文件');
    const storage = { download: jest.fn().mockResolvedValue(bytes), upload: jest.fn(), delete: jest.fn() };
    const controller = buildControllerWith({ reviewTask: { findUnique: jest.fn().mockResolvedValue(taskWith(legacyKey)) } }, storage);
    const res = { setHeader: jest.fn(), send: jest.fn() };

    await (controller as any).downloadModifiedDocument('t1', USER, res);

    expect(storage.download).toHaveBeenCalledWith(legacyKey);
    expect(res.send).toHaveBeenCalledWith(bytes);
  });

  it('没有关联文件的任务（纯文本审查）：接受建议只落状态，不碰存储', async () => {
    const storage = { upload: jest.fn(), download: jest.fn(), delete: jest.fn() };
    const prisma: any = {
      reviewTask: {
        findUnique: jest.fn().mockResolvedValue({
          id: 't1', objectKey: '', userId: 'u1',
          results: { criticalIssues: [{ ruleId: 'r1', suggestion: '把「甲方」改为「采购人」', status: 'pending', modificationApplied: false }], warnings: [], passedChecks: [] },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const controller = buildControllerWith(prisma, storage);

    await controller.resolveIssue('t1', { issueIndex: 0, action: 'accept' }, USER);

    // 既有行为（不在本次修复范围）：没有文件时改写函数提前返回、不抛错，调用方照样把
    // modificationApplied 置真。这里只保护两件事——状态照常落库、不碰任何存储。
    const saved = prisma.reviewTask.update.mock.calls[0][0].data.results;
    expect(saved.criticalIssues[0].status).toBe('accepted');
    expect(storage.upload).not.toHaveBeenCalled();
    expect(storage.download).not.toHaveBeenCalled();
  });

  it('任务键越界时接受建议：请求照常完成（不抛错），问题状态落库、modificationApplied 不置真', async () => {
    const storage = { upload: jest.fn(), download: jest.fn().mockRejectedValue(new Error('不该走到这里')), delete: jest.fn() };
    const prisma: any = {
      reviewTask: {
        findUnique: jest.fn().mockResolvedValue({
          id: 't1', objectKey: '../.env', userId: 'u1',
          results: { criticalIssues: [{ ruleId: 'r1', suggestion: '把「甲方」改为「采购人」', status: 'pending', modificationApplied: false }], warnings: [], passedChecks: [] },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const controller = buildControllerWith(prisma, storage);

    await expect(controller.resolveIssue('t1', { issueIndex: 0, action: 'accept' }, USER)).resolves.toBeDefined();

    const saved = prisma.reviewTask.update.mock.calls[0][0].data.results;
    expect(saved.criticalIssues[0].status).toBe('accepted');
    expect(saved.criticalIssues[0].modificationApplied).toBe(false);
    expect(storage.download).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });
});

describe('TenderReviewController.uploadDocument — 上传即登记为文件记录（审计第 3 处）', () => {
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  it('登记一条审查源文件：键不含用户文件名、属主是登录人；响应给 fileId，不再给 objectKey', async () => {
    const prisma: any = { fileAsset: { create: jest.fn().mockResolvedValue({ id: 'fa-1' }) } };
    const storage = { upload: jest.fn().mockResolvedValue(undefined) };
    const parser = { parse: jest.fn().mockResolvedValue('正文') };
    const controller = buildControllerWith(prisma, storage, parser);
    const buffer = Buffer.from('%PDF-1.4 x');
    // 文件名带反引号与 shell 载荷：此前它被原样拼进对象键
    const file = { buffer, mimetype: 'application/pdf', originalname: 'a.`>poc-marker`.pdf', size: buffer.length } as any;

    const out = await controller.uploadDocument(file, USER);

    expect(out).toEqual({ fileId: 'fa-1', documentName: 'a.`>poc-marker`.pdf', content: '正文', contentLength: 2 });
    expect(out).not.toHaveProperty('objectKey');

    expect(storage.upload).toHaveBeenCalledTimes(1);
    const [storedKey] = storage.upload.mock.calls[0];
    expect(storedKey).toMatch(/^review\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{32}\.pdf$/);
    expect(prisma.fileAsset.create).toHaveBeenCalledWith({
      data: {
        key: storedKey,
        originalName: 'a.`>poc-marker`.pdf',
        mimeType: 'application/pdf',
        size: buffer.length,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        category: 'tender_review_source',
        uploaderId: 'u1',
      },
    });
  });

  it('声明类型不是四种但后缀是 → 登记为后缀对应的类型', async () => {
    const prisma: any = { fileAsset: { create: jest.fn().mockResolvedValue({ id: 'fa-2' }) } };
    const storage = { upload: jest.fn().mockResolvedValue(undefined) };
    const controller = buildControllerWith(prisma, storage, { parse: jest.fn().mockResolvedValue('') });
    await controller.uploadDocument(
      { buffer: Buffer.from('x'), mimetype: 'application/octet-stream', originalname: '采购文件.docx', size: 1 } as any,
      USER,
    );
    expect(prisma.fileAsset.create.mock.calls[0][0].data.mimeType).toBe(DOCX);
    expect(storage.upload.mock.calls[0][0]).toMatch(/\.docx$/);
  });

  it('类型与后缀都不是四种之一 → 400，不落存储也不建记录', async () => {
    const prisma: any = { fileAsset: { create: jest.fn() } };
    const storage = { upload: jest.fn() };
    const controller = buildControllerWith(prisma, storage, { parse: jest.fn() });
    await expect(
      controller.uploadDocument({ buffer: Buffer.from('x'), mimetype: 'application/zip', originalname: 'a.zip', size: 1 } as any, USER),
    ).rejects.toMatchObject({ response: { code: 'REVIEW_FILE_TYPE_INVALID' } });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(prisma.fileAsset.create).not.toHaveBeenCalled();
  });

  it('对象已落存储但登记记录失败 → 删掉刚上传的对象（不留孤儿），错误原样抛出', async () => {
    const prisma: any = { fileAsset: { create: jest.fn().mockRejectedValue(new Error('db down')) } };
    const storage = { upload: jest.fn().mockResolvedValue(undefined), delete: jest.fn().mockResolvedValue(undefined) };
    const controller = buildControllerWith(prisma, storage, { parse: jest.fn().mockResolvedValue('') });

    await expect(
      controller.uploadDocument({ buffer: Buffer.from('%PDF-1.4'), mimetype: 'application/pdf', originalname: 'a.pdf', size: 8 } as any, USER),
    ).rejects.toThrow('db down');

    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith(storage.upload.mock.calls[0][0]);
  });
});

describe('TenderReviewController.executeReview — 只收上传记录 id（审计第 3 处）', () => {
  const KB_MOCK = { id: 'kb-1', ownerId: 'u1', isShared: true };
  const BASE = { knowledgeBaseId: 'kb-1', reviewMode: 'general' as const, documentContent: 'c', documentName: 'n.docx' };

  const arrange = (asset: unknown) => ({
    knowledgeBase: { findUnique: jest.fn().mockResolvedValue(KB_MOCK) },
    fileAsset: { findUnique: jest.fn().mockResolvedValue(asset) },
    reviewTask: { create: jest.fn().mockResolvedValue({ id: 't-1' }) },
    userSettings: { upsert: jest.fn() },
  });
  const OWN_UPLOAD = { id: 'fa-1', key: 'review/2026-11-25/0123456789abcdef0123456789abcdef.docx', category: 'tender_review_source', uploaderId: 'u1' };

  it('带 fileId：任务的 objectKey 取的是资产行里的键', async () => {
    const prisma: any = arrange(OWN_UPLOAD);
    const controller = buildControllerWith(prisma);
    await controller.executeReview({ ...BASE, fileId: 'fa-1' } as any, 'c', 'n.docx', USER);
    expect(prisma.reviewTask.create).toHaveBeenCalledWith({ data: expect.objectContaining({ objectKey: OWN_UPLOAD.key }) });
    expect(prisma.fileAsset.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'fa-1' } }));
  });

  it('不带 fileId（纯文本审查）：任务的 objectKey 是空串，不查文件记录', async () => {
    const prisma: any = arrange(null);
    const controller = buildControllerWith(prisma);
    await controller.executeReview({ ...BASE } as any, 'c', 'n.docx', USER);
    expect(prisma.reviewTask.create).toHaveBeenCalledWith({ data: expect.objectContaining({ objectKey: '' }) });
    expect(prisma.fileAsset.findUnique).not.toHaveBeenCalled();
  });

  it('fileId 是别人的上传 → 403 REVIEW_FILE_FORBIDDEN，不建任务', async () => {
    const prisma: any = arrange({ ...OWN_UPLOAD, uploaderId: 'u2' });
    const controller = buildControllerWith(prisma);
    await expect(controller.executeReview({ ...BASE, fileId: 'fa-1' } as any, 'c', 'n.docx', USER)).rejects.toMatchObject({ response: { code: 'REVIEW_FILE_FORBIDDEN' } });
    expect(prisma.reviewTask.create).not.toHaveBeenCalled();
  });

  it('admin 可以用别人的上传；任务的属主是发起审查的 admin', async () => {
    const prisma: any = arrange({ ...OWN_UPLOAD, uploaderId: 'u2' });
    const controller = buildControllerWith(prisma);
    const ADMIN = { sub: 'u-admin', role: 'admin' } as any;
    await controller.executeReview({ ...BASE, fileId: 'fa-1' } as any, 'c', 'n.docx', ADMIN);
    expect(prisma.reviewTask.create).toHaveBeenCalledWith({ data: expect.objectContaining({ objectKey: OWN_UPLOAD.key, userId: 'u-admin' }) });
  });

  it.each([
    ['记录不存在', null],
    ['类目不是审查源文件', { id: 'fa-9', key: 'uploads/2026-11-25/abc.docx', category: 'general', uploaderId: 'u1' }],
    ['类目对但键不在审查命名空间', { id: 'fa-9', key: 'uploads/2026-11-25/abc.docx', category: 'tender_review_source', uploaderId: 'u1' }],
    ['键越界', { id: 'fa-9', key: 'review/../sealed-backup/k', category: 'tender_review_source', uploaderId: 'u1' }],
  ])('%s → 400 REVIEW_FILE_INVALID，不建任务', async (_label, asset) => {
    const prisma: any = arrange(asset);
    const controller = buildControllerWith(prisma);
    await expect(controller.executeReview({ ...BASE, fileId: 'fa-9' } as any, 'c', 'n.docx', USER)).rejects.toMatchObject({ response: { code: 'REVIEW_FILE_INVALID' } });
    expect(prisma.reviewTask.create).not.toHaveBeenCalled();
  });
});

describe('TenderReviewController.deleteTask — 连带清理源文件（审计第 3 处跟进）', () => {
  const KEY = 'review/2026-11-25/0123456789abcdef0123456789abcdef.docx';
  const taskWith = (objectKey: string) => ({ id: 't1', objectKey, userId: 'u1' });

  const REGISTERED = { id: 'fa-1', category: 'tender_review_source' };
  const arrange = (objectKey: string, overrides: Record<string, any> = {}) => ({
    reviewTask: {
      findUnique: jest.fn().mockResolvedValue(taskWith(objectKey)),
      delete: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    fileAsset: {
      findUnique: jest.fn().mockResolvedValue(REGISTERED),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    ...overrides,
  });

  it('没有别的任务在用这份文件 → 先删任务，再删对象、备份与文件记录', async () => {
    const storage = { delete: jest.fn().mockResolvedValue(undefined) };
    const prisma: any = arrange(KEY);
    const controller = buildControllerWith(prisma, storage);

    await expect(controller.deleteTask('t1', USER)).resolves.toEqual({ deleted: true });

    expect(prisma.reviewTask.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    // 引用计数必须在任务行删掉之后做，否则会把自己数进去
    expect(prisma.reviewTask.delete.mock.invocationCallOrder[0]).toBeLessThan(prisma.reviewTask.count.mock.invocationCallOrder[0]);
    expect(prisma.fileAsset.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { key: KEY } }));
    expect(prisma.reviewTask.count).toHaveBeenCalledWith({ where: { objectKey: KEY } });
    expect(storage.delete).toHaveBeenNthCalledWith(1, KEY);
    expect(storage.delete).toHaveBeenNthCalledWith(2, `${KEY}.original`);
    expect(prisma.fileAsset.deleteMany).toHaveBeenCalledWith({ where: { id: 'fa-1', category: 'tender_review_source' } });
  });

  it('同一份文件还被别的任务引用 → 只删任务，不碰存储与文件记录', async () => {
    const storage = { delete: jest.fn() };
    const prisma: any = arrange(KEY, {
      reviewTask: {
        findUnique: jest.fn().mockResolvedValue(taskWith(KEY)),
        delete: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(2),
      },
    });
    const controller = buildControllerWith(prisma, storage);

    await expect(controller.deleteTask('t1', USER)).resolves.toEqual({ deleted: true });

    expect(storage.delete).not.toHaveBeenCalled();
    expect(prisma.fileAsset.deleteMany).not.toHaveBeenCalled();
  });

  it('没有文件的任务 → 不查引用、不碰存储与文件记录', async () => {
    const storage = { delete: jest.fn() };
    const prisma: any = arrange('');
    const controller = buildControllerWith(prisma, storage);

    await controller.deleteTask('t1', USER);

    expect(prisma.reviewTask.delete).toHaveBeenCalledTimes(1);
    expect(prisma.reviewTask.count).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
    expect(prisma.fileAsset.deleteMany).not.toHaveBeenCalled();
  });

  it('任务键不在审查命名空间内 → 照常删任务，存储一律不碰', async () => {
    const storage = { delete: jest.fn() };
    const prisma: any = arrange('../.env');
    const controller = buildControllerWith(prisma, storage);

    await expect(controller.deleteTask('t1', USER)).resolves.toEqual({ deleted: true });

    expect(prisma.reviewTask.delete).toHaveBeenCalledTimes(1);
    expect(prisma.reviewTask.count).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
    expect(prisma.fileAsset.deleteMany).not.toHaveBeenCalled();
  });

  it('对象删除失败 → 请求照常成功，文件记录保留', async () => {
    const storage = { delete: jest.fn().mockRejectedValue(new Error('minio down')) };
    const prisma: any = arrange(KEY);
    const controller = buildControllerWith(prisma, storage);

    await expect(controller.deleteTask('t1', USER)).resolves.toEqual({ deleted: true });

    expect(storage.delete).toHaveBeenCalledWith(KEY);
    expect(prisma.fileAsset.deleteMany).not.toHaveBeenCalled();
  });

  it('非属主且非 admin → 403，任务不删、文件不碰', async () => {
    const storage = { delete: jest.fn() };
    const prisma: any = arrange(KEY);
    const controller = buildControllerWith(prisma, storage);

    await expect(controller.deleteTask('t1', { sub: 'u2', role: 'staff' } as any)).rejects.toMatchObject({ status: 403 });

    expect(prisma.reviewTask.delete).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  // 终审 Important 1：存量任务的 objectKey 在修复前可由任意内部角色写入，命名空间守卫拦不住
  // 指向「他人任务键.original」这类键——只清理有审查源文件记录的文件，存量对象一律不碰
  it('存量任务：键在审查命名空间内但没有审查源文件记录 → 照常删任务，存储与文件记录都不碰', async () => {
    const plantedKey = 'review/1732452000000_他人文档.docx.original';
    const storage = { delete: jest.fn() };
    const prisma: any = arrange(plantedKey, {
      fileAsset: { findUnique: jest.fn().mockResolvedValue(null), deleteMany: jest.fn() },
    });
    const controller = buildControllerWith(prisma, storage);

    await expect(controller.deleteTask('t1', USER)).resolves.toEqual({ deleted: true });

    expect(prisma.reviewTask.delete).toHaveBeenCalledTimes(1);
    expect(prisma.reviewTask.count).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
    expect(prisma.fileAsset.deleteMany).not.toHaveBeenCalled();
  });

  it('同键的文件记录是别的类目 → 同样不清理', async () => {
    const storage = { delete: jest.fn() };
    const prisma: any = arrange(KEY, {
      fileAsset: { findUnique: jest.fn().mockResolvedValue({ id: 'fa-9', category: 'bid_document' }), deleteMany: jest.fn() },
    });
    const controller = buildControllerWith(prisma, storage);

    await controller.deleteTask('t1', USER);

    expect(prisma.reviewTask.count).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
    expect(prisma.fileAsset.deleteMany).not.toHaveBeenCalled();
  });

  it('查文件记录或统计引用时数据库出错 → 请求照常成功（任务已删），不清理存储', async () => {
    const brokenCases = [
      arrange(KEY, { fileAsset: { findUnique: jest.fn().mockRejectedValue(new Error('db down')), deleteMany: jest.fn() } }),
      arrange(KEY, {
        reviewTask: {
          findUnique: jest.fn().mockResolvedValue(taskWith(KEY)),
          delete: jest.fn().mockResolvedValue({}),
          count: jest.fn().mockRejectedValue(new Error('db down')),
        },
      }),
    ];
    for (const prisma of brokenCases) {
      const storage = { delete: jest.fn() };
      const controller = buildControllerWith(prisma, storage);

      await expect(controller.deleteTask('t1', USER)).resolves.toEqual({ deleted: true });

      expect(storage.delete).not.toHaveBeenCalled();
      expect(prisma.fileAsset.deleteMany).not.toHaveBeenCalled();
    }
  });

  it('主对象已删、备份对象删除出错（备份可能本就不存在）→ 照常删文件记录', async () => {
    const storage = {
      delete: jest.fn().mockImplementation((k: string) =>
        k.endsWith('.original') ? Promise.reject(new Error('NoSuchKey')) : Promise.resolve(undefined),
      ),
    };
    const prisma: any = arrange(KEY);
    const controller = buildControllerWith(prisma, storage);

    await expect(controller.deleteTask('t1', USER)).resolves.toEqual({ deleted: true });

    expect(storage.delete).toHaveBeenCalledWith(KEY);
    expect(prisma.fileAsset.deleteMany).toHaveBeenCalledWith({ where: { id: 'fa-1', category: 'tender_review_source' } });
  });
});
