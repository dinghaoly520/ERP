import { BadRequestException, ConflictException } from '@nestjs/common';
import { NonTenderDealService } from './non-tender-deal.service';

/** C3 转非招标方式成交登记（CTS-EBS01 A-199）：流标→非招标成交→入归档链 */
describe('NonTenderDealService（C3 A-199）', () => {
  const aborted = { id: 'bp-1', stage: 'ABORTED', projectManagementItemId: 'pmi-1', round: 1, name: '水厂滤料采购' };
  const dto = { method: '竞争性谈判', winnerName: '华西物资', dealAmount: 128000, note: '两家有效报价转谈判' };

  const mk = (over: Record<string, any> = {}) => ({
    bidProject: { findUnique: jest.fn().mockResolvedValue(aborted) },
    nonTenderDealRecord: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'nd-1', ...dto }) },
    fileAsset: { findUnique: jest.fn() },
    projectManagementStage: { findFirst: jest.fn().mockResolvedValue({ id: 'st-award' }) },
    attachment: { create: jest.fn().mockResolvedValue({ id: 'att-1' }) },
    bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
    ...over,
  });

  it('流标项目登记成功：结构化记录 + 成交文件挂定标阶段附件 + 监督日志', async () => {
    const prisma = mk({ fileAsset: { findUnique: jest.fn().mockResolvedValue({ id: 'fa-1', key: 'uploads/x.pdf', originalName: '成交记录.pdf', mimeType: 'application/pdf', size: 1024 }) } });
    const r = await new NonTenderDealService(prisma as any).register('bp-1', { ...dto, fileAssetId: 'fa-1' } as any, 'u-1');
    expect(r.id).toBe('nd-1');
    expect(r.attachmentId).toBe('att-1');
    expect(prisma.attachment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        attachmentType: 'AWARD_NOTICE', objectKey: 'uploads/x.pdf',
        projectManagementItemId: 'pmi-1', projectManagementStageId: 'st-award',
      }),
    });
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: '转非招标方式成交登记', result: '竞争性谈判 → 华西物资' }),
    });
  });

  it('未流标项目被拒 NOT_ABORTED', async () => {
    const prisma = mk({ bidProject: { findUnique: jest.fn().mockResolvedValue({ ...aborted, stage: 'EVALUATING' }) } });
    await expect(new NonTenderDealService(prisma as any).register('bp-1', dto as any)).rejects.toMatchObject({
      response: { code: 'NOT_ABORTED' },
    });
  });

  it('非三类方式被拒 BAD_METHOD', async () => {
    const prisma = mk();
    await expect(new NonTenderDealService(prisma as any).register('bp-1', { ...dto, method: '公开招标' } as any))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('重复登记被拒 ALREADY_REGISTERED', async () => {
    const prisma = mk({ nonTenderDealRecord: { findUnique: jest.fn().mockResolvedValue({ id: 'nd-0' }), create: jest.fn() } });
    await expect(new NonTenderDealService(prisma as any).register('bp-1', dto as any)).rejects.toMatchObject({
      response: { code: 'ALREADY_REGISTERED' },
    });
  });

  it('无成交文件时不建附件；无 PMI 归属时同样安全', async () => {
    const prisma = mk({ bidProject: { findUnique: jest.fn().mockResolvedValue({ ...aborted, projectManagementItemId: null }) } });
    const r = await new NonTenderDealService(prisma as any).register('bp-1', dto as any);
    expect(r.attachmentId).toBeNull();
    expect(prisma.attachment.create).not.toHaveBeenCalled();
  });
});