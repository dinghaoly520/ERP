import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TenderClarificationService } from './tender-clarification.service';

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
    };
    const svc = makeService(prisma);
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
