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
