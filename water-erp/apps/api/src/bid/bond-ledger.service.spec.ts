import { BondLedgerService } from './bond-ledger.service';

/** A-102：保证金到账台账——登记幂等/名册校验/错登删除（mock prisma 对象字面量，风格同 bid.service.spec.ts） */
describe('BondLedgerService（A-102）', () => {
  let service: BondLedgerService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      bidProject: { findUnique: jest.fn() },
      bidSupplier: { findFirst: jest.fn() },
      bidBondLedger: { upsert: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), delete: jest.fn().mockResolvedValue({}) },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
    };
    service = new BondLedgerService(prisma);
  });

  const dto = {
    supplierName: '四川水发建设有限公司',
    amount: 500000,
    arrivedAt: '2026-09-01T02:00:00.000Z',
    account: '蜀水采专户(6228)',
    payMethod: '转账',
  };

  it('upsert 成功——建行 + 到账登记监督日志（riskFlag 无）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ name: '测试项目', bondRequired: true });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'sup-1' });

    const row = await service.upsert('proj-1', dto, 'user-1');

    expect(row).toEqual({});
    expect(prisma.bidBondLedger.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId_supplierName: { projectId: 'proj-1', supplierName: dto.supplierName } },
        create: expect.objectContaining({ projectId: 'proj-1', supplierName: dto.supplierName, amount: 500000, arrivedAt: new Date(dto.arrivedAt), account: dto.account, payMethod: '转账', createdBy: 'user-1' }),
      }),
    );
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ projectId: 'proj-1', target: dto.supplierName, action: '保证金到账登记', riskFlag: '无' }),
      }),
    );
  });

  it('upsert——项目未要求保证金 400 NO_BOND', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ name: '测试项目', bondRequired: false });

    await expect(service.upsert('proj-1', dto)).rejects.toMatchObject({ response: { code: 'NO_BOND' } });
    expect(prisma.bidBondLedger.upsert).not.toHaveBeenCalled();
  });

  it('upsert——名册外供应商 400 SUPPLIER_NOT_IN_ROSTER', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ name: '测试项目', bondRequired: true });
    prisma.bidSupplier.findFirst.mockResolvedValue(null);

    await expect(service.upsert('proj-1', dto)).rejects.toMatchObject({ response: { code: 'SUPPLIER_NOT_IN_ROSTER' } });
    expect(prisma.bidBondLedger.upsert).not.toHaveBeenCalled();
  });

  it('remove——他项目台账 400 NOT_FOUND（不得误删他项目记录）', async () => {
    prisma.bidBondLedger.findUnique.mockResolvedValue({ id: 'led-1', projectId: 'proj-other', supplierName: '某公司', amount: 100, arrivedAt: new Date(dto.arrivedAt) });

    await expect(service.remove('proj-1', 'led-1')).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
    expect(prisma.bidBondLedger.delete).not.toHaveBeenCalled();
  });

  it('remove——删除成功且记高风险监督日志', async () => {
    prisma.bidBondLedger.findUnique.mockResolvedValue({ id: 'led-1', projectId: 'proj-1', supplierName: '某公司', amount: 100, arrivedAt: new Date(dto.arrivedAt) });

    const res = await service.remove('proj-1', 'led-1');

    expect(res).toEqual({ success: true });
    expect(prisma.bidBondLedger.delete).toHaveBeenCalledWith({ where: { id: 'led-1' } });
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ projectId: 'proj-1', action: '保证金到账台账删除', riskFlag: '高风险' }),
      }),
    );
  });
});
