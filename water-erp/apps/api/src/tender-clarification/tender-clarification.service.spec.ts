import { Readable } from 'node:stream';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TenderClarificationService } from './tender-clarification.service';

jest.mock('../upload/minio.client', () => ({
  minioClient: { getObject: jest.fn() },
  MINIO_BUCKET: 'test-bucket',
}));

const { minioClient } = require('../upload/minio.client');

const DAY = 24 * 3_600_000;

function makeService(prisma: any) {
  return new TenderClarificationService(prisma, {} as any, {} as any);
}

describe('TenderClarificationService.askQuestion（A-80/B-011）', () => {
  const supplier = { id: 'sup-1', name: '重庆蜀通岩土工程有限公司' };
  const dto = { question: '招标文件第 3.2 条资质要求是否含安全生产许可证？' };

  it('已下载供应商在窗口内提问成功', async () => {
    const prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', stage: 'SUBMIT', deadline: new Date(Date.now() + 30 * DAY) }) },
      bidSupplier: { findFirst: jest.fn().mockResolvedValue({ downloadStatus: '已下载' }) },
      tenderClarification: { create: jest.fn().mockResolvedValue({ id: 'q1', status: '待答复' }) },
    };
    const created = await makeService(prisma).askQuestion('p1', supplier, dto);
    expect(created.id).toBe('q1');
    expect(prisma.tenderClarification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: 'p1', supplierId: 'sup-1', question: dto.question }),
    });
  });

  it('未下载招标文件的供应商被拒 NOT_DOWNLOADED', async () => {
    const prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', stage: 'SUBMIT', deadline: new Date(Date.now() + 30 * DAY) }) },
      bidSupplier: { findFirst: jest.fn().mockResolvedValue({ downloadStatus: '待下载' }) },
      tenderClarification: { create: jest.fn() },
    };
    await expect(makeService(prisma).askQuestion('p1', supplier, dto)).rejects.toMatchObject({
      response: { code: 'NOT_DOWNLOADED' },
    });
  });

  it('截止前 9 日被拒 CLARIFY_ASK_LATE（B-011）', async () => {
    const prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', stage: 'SUBMIT', deadline: new Date(Date.now() + 9 * DAY) }) },
      bidSupplier: { findFirst: jest.fn().mockResolvedValue({ downloadStatus: '已下载' }) },
      tenderClarification: { create: jest.fn() },
    };
    await expect(makeService(prisma).askQuestion('p1', supplier, dto)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('评标阶段提问被拒 STAGE_INVALID', async () => {
    const prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', stage: 'EVALUATING', deadline: new Date(Date.now() + 30 * DAY) }) },
      bidSupplier: { findFirst: jest.fn() },
      tenderClarification: { create: jest.fn() },
    };
    await expect(makeService(prisma).askQuestion('p1', supplier, dto)).rejects.toMatchObject({
      response: { code: 'STAGE_INVALID' },
    });
  });
});

describe('TenderClarificationService.answer（A-81）', () => {
  it('待答复问题答复成功并留痕', async () => {
    const prisma = {
      tenderClarification: {
        findUnique: jest.fn().mockResolvedValue({ id: 'q1', projectId: 'p1', status: '待答复' }),
        update: jest.fn().mockResolvedValue({ id: 'q1', status: '已答复', answer: '含安全生产许可证' }),
      },
    };
    const r = await makeService(prisma).answer('p1', 'q1', '含安全生产许可证', 'user-9');
    expect(r.status).toBe('已答复');
    expect(prisma.tenderClarification.update).toHaveBeenCalledWith({
      where: { id: 'q1' },
      data: expect.objectContaining({ answeredBy: 'user-9', answer: '含安全生产许可证' }),
    });
  });

  it('非本项目或已答复的问题被拒 NOT_FOUND / 幂等返回', async () => {
    const prisma = {
      tenderClarification: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: 'q2', projectId: 'other', status: '待答复' })
          .mockResolvedValueOnce({ id: 'q1', projectId: 'p1', status: '已答复', answer: 'a' }),
        update: jest.fn(),
      },
    };
    await expect(makeService(prisma).answer('p1', 'q2', 'x', 'u')).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
    const again = await makeService(prisma).answer('p1', 'q1', 'x', 'u');
    expect(again.status).toBe('已答复');
    expect(prisma.tenderClarification.update).not.toHaveBeenCalled();
  });
});

describe('TenderClarificationService 版本化澄清文件（A-82/A-83/B-012）', () => {
  const dto = { title: '关于第 3.2 条资质要求的澄清', content: '资质要求含安全生产许可证。' };

  it('createDoc 版本号从上一版递增', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'd2', version: 2 });
    const prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'p1' }) },
      $transaction: jest.fn((fn: any) => fn({
        tenderClarificationDoc: { findFirst: jest.fn().mockResolvedValue({ version: 1 }), create },
      })),
    };
    const r = await makeService(prisma).createDoc('p1', dto, 'u1');
    expect(r.version).toBe(2);
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ version: 2, title: dto.title }) });
  });

  it('publishDoc：截止前 14 日被拒 CLARIFY_ISSUE_LATE', async () => {
    const prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', projectCode: 'PC-1', name: 'n', deadline: new Date(Date.now() + 14 * DAY) }) },
      tenderClarificationDoc: { findUnique: jest.fn().mockResolvedValue({ id: 'd1', projectId: 'p1', status: '草稿', version: 1, title: 't', content: 'c' }) },
    };
    await expect(makeService(prisma).publishDoc('p1', 'd1')).rejects.toMatchObject({
      response: { code: 'CLARIFY_ISSUE_LATE' },
    });
  });

  it('publishDoc：窗口内发布置为已发布且幂等', async () => {
    const prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', projectCode: 'PC-1', name: 'n', deadline: new Date(Date.now() + 20 * DAY) }) },
      tenderClarificationDoc: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: 'd1', projectId: 'p1', status: '草稿', version: 1, title: 't', content: 'c' })
          .mockResolvedValueOnce({ id: 'd1', projectId: 'p1', status: '已发布', version: 1, title: 't', content: 'c' }),
        update: jest.fn().mockResolvedValue({ id: 'd1', status: '已发布', publishedAt: new Date() }),
      },
      bidSupplier: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new TenderClarificationService(prisma as any, {} as any, { create: jest.fn().mockResolvedValue({}) } as any);
    const first = await svc.publishDoc('p1', 'd1');
    expect(first.status).toBe('已发布');
    const again = await svc.publishDoc('p1', 'd1');
    expect(prisma.tenderClarificationDoc.update).toHaveBeenCalledTimes(1);
    expect(again.id).toBe('d1');
  });

  it('updateDoc/deleteDoc：草稿可改删、已发布 DOC_LOCKED', async () => {
    const prisma = {
      tenderClarificationDoc: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: 'd1', projectId: 'p1', status: '草稿' })
          .mockResolvedValueOnce({ id: 'd1', projectId: 'p1', status: '已发布' })
          .mockResolvedValueOnce({ id: 'd1', projectId: 'p1', status: '已发布' }),
        update: jest.fn().mockResolvedValue({ id: 'd1', title: '新标题' }),
        delete: jest.fn(),
      },
    };
    const svc = makeService(prisma);
    await expect(svc.updateDoc('p1', 'd1', { title: '新标题' })).resolves.toMatchObject({ title: '新标题' });
    await expect(svc.updateDoc('p1', 'd1', { title: 'x' })).rejects.toMatchObject({ response: { code: 'DOC_LOCKED' } });
    await expect(svc.deleteDoc('p1', 'd1')).rejects.toMatchObject({ response: { code: 'DOC_LOCKED' } });
  });
});

describe('publishDoc 副作用（B-013/B-014）', () => {
  it('通知所有已下载供应商并发布 CLARIFY_NOTICE 置顶公告（带公司归属戳）', async () => {
    const notifications = { create: jest.fn().mockResolvedValue({}) };
    const announcements = { create: jest.fn().mockResolvedValue({ id: 'a1' }) };
    const prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', projectCode: 'PC-1', name: '水厂设备', deadline: new Date(Date.now() + 20 * DAY) }) },
      tenderClarificationDoc: {
        findUnique: jest.fn().mockResolvedValue({ id: 'd1', projectId: 'p1', status: '草稿', version: 1, title: '澄清一', content: '正文' }),
        update: jest.fn().mockResolvedValue({ id: 'd1', projectId: 'p1', status: '已发布', version: 1, title: '澄清一', content: '正文', publishedAt: new Date() }),
      },
      bidSupplier: { findMany: jest.fn().mockResolvedValue([
        { supplier: { userId: 'u1' } },
        { supplier: { userId: 'u2' } },
      ]) },
    };
    const svc = new TenderClarificationService(prisma as any, notifications as any, announcements as any);
    const r = await svc.publishDoc('p1', 'd1', 'staff-1', { companyId: 'c1', companyName: '采购中心' });
    expect(r.notifiedCount).toBe(2);
    expect(notifications.create).toHaveBeenCalledTimes(2);
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', type: 'CLARIFICATION' }));
    expect(announcements.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CLARIFY_NOTICE', status: 'PUBLISHED', isTop: true, relatedProjectCode: 'PC-1' }),
      'staff-1',
      { companyId: 'c1', companyName: '采购中心' },
    );
  });
});

describe('TenderClarificationService 供应商侧（A-85/A-86）', () => {
  const supplier = { id: 'sup-1', name: '供应商A' };
  const published = { id: 'd1', projectId: 'p1', status: '已发布', version: 1, title: '澄清一', content: 'c', fileAssetId: 'fa-1' };

  it('listForSupplier 只见已发布文件并带本人回执', async () => {
    const prisma = {
      tenderClarification: { findMany: jest.fn().mockResolvedValue([{ id: 'q1' }]) },
      tenderClarificationDoc: { findMany: jest.fn().mockResolvedValue([published]) },
      tenderClarificationReceipt: { findMany: jest.fn().mockResolvedValue([{ docId: 'd1', downloadedAt: new Date(), receiptedAt: new Date() }]) },
    };
    const r = await makeService(prisma).listForSupplier('p1', 'sup-1');
    expect(r.questions).toHaveLength(1);
    expect(r.docs[0].receipt).not.toBeNull();
    expect(prisma.tenderClarificationDoc.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'p1', status: '已发布' } }),
    );
  });

  it('downloadDoc：已下载供应商下载成功并 upsert 回执', async () => {
    const prisma = {
      tenderClarificationDoc: { findUnique: jest.fn().mockResolvedValue(published) },
      bidSupplier: { findFirst: jest.fn().mockResolvedValue({ downloadStatus: '已下载' }) },
      tenderClarificationReceipt: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const r = await makeService(prisma).downloadDoc('p1', 'd1', supplier);
    expect(r.fileUrl).toBe('/api/upload/files/fa-1');
    expect(prisma.tenderClarificationReceipt.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { docId_supplierId: { docId: 'd1', supplierId: 'sup-1' } } }),
    );
  });

  it('downloadDoc：未下载招标文件者被拒 NOT_DOWNLOADED', async () => {
    const prisma = {
      tenderClarificationDoc: { findUnique: jest.fn().mockResolvedValue(published) },
      bidSupplier: { findFirst: jest.fn().mockResolvedValue({ downloadStatus: '待下载' }) },
      tenderClarificationReceipt: { upsert: jest.fn() },
    };
    await expect(makeService(prisma).downloadDoc('p1', 'd1', supplier)).rejects.toMatchObject({
      response: { code: 'NOT_DOWNLOADED' },
    });
  });
});

describe('A-136 专家端澄清修改文件', () => {
  it('listDocsForExpert：仅已发布、按 version 升序', async () => {
    const prisma = {
      bidExpert: { findFirst: jest.fn().mockResolvedValue({ expertName: '刘苡池' }) },
      tenderClarificationDoc: { findMany: jest.fn().mockResolvedValue([{ id: 'd1', version: 1 }]) },
    };
    await makeService(prisma).listDocsForExpert('p1', 'u1');
    expect(prisma.tenderClarificationDoc.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId: 'p1', status: '已发布' },
      orderBy: { version: 'asc' },
    }));
  });

  it('listDocsForExpert：非本项目评委 → 403 NOT_PROJECT_EXPERT（与 download 对称门控）', async () => {
    const prisma = {
      bidExpert: { findFirst: jest.fn().mockResolvedValue(null) },
      tenderClarificationDoc: { findMany: jest.fn() },
    };
    await expect(makeService(prisma).listDocsForExpert('p1', 'u9')).rejects.toThrow(ForbiddenException);
  });

  it('downloadDocForExpert：非本项目评委 → 403 NOT_PROJECT_EXPERT', async () => {
    const prisma = {
      tenderClarificationDoc: { findUnique: jest.fn().mockResolvedValue({ id: 'd1', projectId: 'p1', status: '已发布', fileAssetId: null }) },
      bidExpert: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    await expect(makeService(prisma).downloadDocForExpert('p1', 'd1', 'u9')).rejects.toThrow(ForbiddenException);
  });

  it('downloadDocForExpert：未发布/不存在 → 400 NOT_FOUND', async () => {
    const prisma = {
      tenderClarificationDoc: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    await expect(makeService(prisma).downloadDocForExpert('p1', 'dX', 'u1')).rejects.toThrow(BadRequestException);
  });

  it('downloadDocForExpert：附件命中 → minio 直出 buffer 与元信息', async () => {
    (minioClient.getObject as jest.Mock).mockResolvedValue(Readable.from([Buffer.from('clarification-pdf')]));
    const prisma = {
      tenderClarificationDoc: { findUnique: jest.fn().mockResolvedValue({ id: 'd1', projectId: 'p1', status: '已发布', version: 2, title: '澄清二', content: '正文', fileAssetId: 'fa-1' }) },
      bidExpert: { findFirst: jest.fn().mockResolvedValue({ expertName: '刘苡池' }) },
      fileAsset: { findUnique: jest.fn().mockResolvedValue({ key: 'clar/d1.pdf', originalName: '澄清二.pdf', mimeType: 'application/pdf' }) },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const r = await makeService(prisma).downloadDocForExpert('p1', 'd1', 'u1');
    expect(minioClient.getObject).toHaveBeenCalledWith('test-bucket', 'clar/d1.pdf');
    expect(r.buffer?.equals(Buffer.from('clarification-pdf'))).toBe(true);
    expect(r).toMatchObject({ fileName: '澄清二.pdf', mimeType: 'application/pdf', title: '澄清二', version: 2, content: '正文' });
  });

  it('downloadDocForExpert：下载写监督日志（评审专家 / 下载澄清修改文件 / v{version} title）', async () => {
    (minioClient.getObject as jest.Mock).mockResolvedValue(Readable.from([Buffer.from('x')]));
    const prisma = {
      tenderClarificationDoc: { findUnique: jest.fn().mockResolvedValue({ id: 'd1', projectId: 'p1', status: '已发布', version: 2, title: '澄清二', content: '正文', fileAssetId: 'fa-1' }) },
      bidExpert: { findFirst: jest.fn().mockResolvedValue({ expertName: '刘苡池' }) },
      fileAsset: { findUnique: jest.fn().mockResolvedValue({ key: 'clar/d1.pdf', originalName: '澄清二.pdf', mimeType: 'application/pdf' }) },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
    };
    await makeService(prisma).downloadDocForExpert('p1', 'd1', 'u1');
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 'p1', role: '评审专家', target: '刘苡池',
        action: '下载澄清修改文件', result: 'v2 澄清二', riskFlag: '无',
      }),
    });
  });
});
