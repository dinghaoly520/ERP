import { ProcurementsService } from './procurements.service';

const mockAdminUser = { sub: 'admin-id', username: 'admin', role: 'admin' as const };

describe('ProcurementsService recycle bin', () => {
  const makeService = () => {
    const prisma = {
      procurementRound: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    return {
      prisma,
      service: new ProcurementsService(prisma as any),
    };
  };

  it('excludes recycled procurement rounds from the default database list', async () => {
    const { prisma, service } = makeService();

    await service.findAll({ page: 1, pageSize: 12 }, mockAdminUser);

    expect(prisma.procurementRound.count).toHaveBeenCalledWith({
      where: { isRecycled: false },
    });
    expect(prisma.procurementRound.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isRecycled: false } }),
    );
  });

  it('lists only recycled procurement rounds when status is RECYCLED', async () => {
    const { prisma, service } = makeService();

    await service.findAll({ page: 1, pageSize: 12, recycleStatus: 'RECYCLED' }, mockAdminUser);

    expect(prisma.procurementRound.count).toHaveBeenCalledWith({
      where: { isRecycled: true },
    });
    expect(prisma.procurementRound.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isRecycled: true } }),
    );
  });

  it('moves a procurement round into the database recycle bin', async () => {
    const { prisma, service } = makeService();
    prisma.procurementRound.findUnique.mockResolvedValue({ id: 'round-01', createdById: 'admin-id' });
    prisma.procurementRound.update.mockResolvedValue({ id: 'round-01', isRecycled: true });

    await expect(service.moveToRecycleBin('round-01', mockAdminUser)).resolves.toMatchObject({
      id: 'round-01',
      isRecycled: true,
    });

    expect(prisma.procurementRound.update).toHaveBeenCalledWith({
      where: { id: 'round-01' },
      data: { isRecycled: true },
    });
  });

  it('restores a procurement round from the database recycle bin', async () => {
    const { prisma, service } = makeService();
    prisma.procurementRound.findUnique.mockResolvedValue({ id: 'round-01', createdById: 'admin-id' });
    prisma.procurementRound.update.mockResolvedValue({ id: 'round-01', isRecycled: false });

    await expect(service.restoreFromRecycleBin('round-01', mockAdminUser)).resolves.toMatchObject({
      id: 'round-01',
      isRecycled: false,
    });

    expect(prisma.procurementRound.update).toHaveBeenCalledWith({
      where: { id: 'round-01' },
      data: { isRecycled: false },
    });
  });
});
