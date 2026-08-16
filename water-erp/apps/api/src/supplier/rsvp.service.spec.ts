import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RsvpService } from './rsvp.service';

/** P0-1 回执 respond() 单测：PMI id→真实 BidProject 解析 + 同事务 + 半成功防护。
 *  （extract 前置：InvitationRsvp.projectId 是邀请页写入的 ProjectManagementItem id。） */
describe('RsvpService.respond（P0-1）', () => {
  let service: RsvpService;
  let prisma: any;
  const futureDate = new Date(Date.now() + 3600_000);
  const baseRow = {
    id: 'rsvp1', token: 't1', projectId: 'PMI-ID', supplierId: 's1',
    supplierName: '供应商A', status: 'PENDING', expiresAt: futureDate,
  };

  beforeEach(() => {
    prisma = {
      invitationRsvp: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({ id: 'rsvp1', status: 'ACCEPTED', respondedAt: new Date() }) },
      bidProject: { findFirst: jest.fn() },
      bidSupplier: { upsert: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockImplementation(async (fn: any) => fn(prisma)),
    };
    service = new RsvpService(prisma);
  });

  it('ACCEPTED：以 rsvp.projectId（PMI id）解析 BidProject 后用真实项目 id upsert 候选', async () => {
    prisma.invitationRsvp.findUnique.mockResolvedValue(baseRow);
    prisma.bidProject.findFirst.mockResolvedValue({ id: 'BP-1' });

    const r = await service.respond('t1', { status: 'ACCEPTED' });

    expect(r.success).toBe(true);
    expect(prisma.bidProject.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectManagementItemId: 'PMI-ID' } }),
    );
    expect(prisma.bidSupplier.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId_supplierName: { projectId: 'BP-1', supplierName: '供应商A' } },
        create: expect.objectContaining({ projectId: 'BP-1', supplierId: 's1' }),
      }),
    );
  });

  it('ACCEPTED 但 BidProject 尚未懒创建：回执仍成功，不 upsert 不抛错', async () => {
    prisma.invitationRsvp.findUnique.mockResolvedValue(baseRow);
    prisma.bidProject.findFirst.mockResolvedValue(null);

    const r = await service.respond('t1', { status: 'ACCEPTED' });

    expect(r.success).toBe(true);
    expect(prisma.bidSupplier.upsert).not.toHaveBeenCalled();
  });

  it('回执状态更新与候选 upsert 在同一事务内（防半成功）', async () => {
    prisma.invitationRsvp.findUnique.mockResolvedValue(baseRow);
    prisma.bidProject.findFirst.mockResolvedValue({ id: 'BP-1' });

    await service.respond('t1', { status: 'ACCEPTED' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // 两个写操作都应经 tx（mock 中 tx===prisma，断言二者都被调用即证明进了事务回调）
    expect(prisma.invitationRsvp.update).toHaveBeenCalled();
    expect(prisma.bidSupplier.upsert).toHaveBeenCalled();
  });

  it('DECLINED：只更新回执状态，不动候选名单', async () => {
    prisma.invitationRsvp.findUnique.mockResolvedValue(baseRow);

    await service.respond('t1', { status: 'DECLINED' });

    expect(prisma.bidSupplier.upsert).not.toHaveBeenCalled();
  });

  it('不存在/过期的 token 语义保留', async () => {
    prisma.invitationRsvp.findUnique.mockResolvedValue(null);
    await expect(service.respond('bad', { status: 'ACCEPTED' })).rejects.toBeInstanceOf(NotFoundException);

    prisma.invitationRsvp.findUnique.mockResolvedValue({ ...baseRow, expiresAt: new Date(Date.now() - 1000) });
    await expect(service.respond('t1', { status: 'ACCEPTED' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
