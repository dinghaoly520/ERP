import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { BidBondService } from './bid-bond.service';

/** 保证金域（F1a）——自 bid.service.spec.ts「保证金逐家退还 (A-105)」describe 迁出（纯移动；断言与 mock 序列逐字保留） */
describe('BidBondService — 保证金逐家退还 (A-105)', () => {
  let service: BidBondService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn() },
      bidSupplier: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      bidOpeningRecord: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
      bidEvaluationResult: { findFirst: jest.fn() },
      // C2 三写事务化：事务直通（tx 即 prisma mock）；兼容 batch 模式（同 bid.service.spec 共享骨架双模式口径）
      $transaction: jest.fn(async (callbackOrOps: any) => {
        if (typeof callbackOrOps === 'function') {
          // Callback-based: pass a tx client (which is the prisma mock itself)
          return callbackOrOps(prisma);
        }
        // Batch-based: execute all ops sequentially
        return Promise.all(callbackOrOps);
      }),
    };
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        BidBondService,
      ],
    }).compile();
    service = module.get(BidBondService);
  });

  it('逐家退还三写：BidSupplier 退还态 + 开标记录 bondStatus=已退还 + 监督日志（riskFlag 无）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', name: '测试项目', bondRequired: true });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司' });
    prisma.bidSupplier.update.mockResolvedValue({ supplierName: '甲公司', bondReturnedAt: new Date(), bondReturnReason: null });

    await expect(service.markSupplierBondReturned('p1', { supplierName: '甲公司', returned: true }))
      .resolves.toEqual({ success: true }); // C2：返回契约 { success: true }（:3005 仅按 resolve 判成功）
    expect(prisma.$transaction).toHaveBeenCalled(); // 三写同事务

    expect(prisma.bidSupplier.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'bs1' }, data: { bondReturnedAt: expect.any(Date), bondReturnReason: null } }),
    );
    expect(prisma.bidOpeningRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'p1', supplierName: '甲公司' }, data: { bondStatus: '已退还' } }),
    );
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ projectId: 'p1', action: '响应担保退还（逐家）', riskFlag: '无' }) }),
    );
  });

  it('C2 三写原子：第二写（开标记录同步）抛错 → 整体抛出（事务回滚语义），监督日志未达', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', name: '测试项目', bondRequired: true });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司' });
    prisma.bidSupplier.update.mockResolvedValue({ supplierName: '甲公司', bondReturnedAt: new Date(), bondReturnReason: null });
    prisma.bidOpeningRecord.updateMany.mockRejectedValue(new Error('db down'));

    await expect(service.markSupplierBondReturned('p1', { supplierName: '甲公司', returned: true }))
      .rejects.toThrow('db down');

    // mock 直通下 reject 传播 = $transaction 整体拒绝（真实库中第一写随之回滚）；第三写未被触达
    expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
  });

  it('不予退还无理由 → 400 REASON_REQUIRED 且零写入', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', name: '测试项目', bondRequired: true });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司' });
    await expect(service.markSupplierBondReturned('p1', { supplierName: '甲公司', returned: false }))
      .rejects.toMatchObject({ response: { code: 'REASON_REQUIRED' } });
    expect(prisma.bidSupplier.update).not.toHaveBeenCalled();
    expect(prisma.bidOpeningRecord.updateMany).not.toHaveBeenCalled();
    expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
  });

  it('不予退还（附理由）：开标记录同步「不予退还」+ 监督日志高风险留痕', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', name: '测试项目', bondRequired: true });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司' });
    prisma.bidSupplier.update.mockResolvedValue({ supplierName: '甲公司', bondReturnedAt: null, bondReturnReason: '弄虚作假' });

    await service.markSupplierBondReturned('p1', { supplierName: '甲公司', returned: false, reason: '弄虚作假' });

    expect(prisma.bidSupplier.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { bondReturnedAt: null, bondReturnReason: '弄虚作假' } }),
    );
    expect(prisma.bidOpeningRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { bondStatus: '不予退还' } }),
    );
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: '响应担保不予退还（逐家）', riskFlag: '高' }) }),
    );
  });

  it('项目未要求响应担保 → 400 NO_BOND；供应商不在花名册 → 400 SUPPLIER_NOT_IN_ROSTER', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', name: '测试项目', bondRequired: false });
    await expect(service.markSupplierBondReturned('p1', { supplierName: '甲公司', returned: true }))
      .rejects.toMatchObject({ response: { code: 'NO_BOND' } });

    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', name: '测试项目', bondRequired: true });
    prisma.bidSupplier.findFirst.mockResolvedValue(null);
    await expect(service.markSupplierBondReturned('p1', { supplierName: '外来公司', returned: true }))
      .rejects.toMatchObject({ response: { code: 'SUPPLIER_NOT_IN_ROSTER' } });
    expect(prisma.bidSupplier.update).not.toHaveBeenCalled();
  });

  it('listBondReturns：唱标状态映射 + isWinner 标识（无开标记录行 bondStatus=null）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', bondRequired: true });
    prisma.bidSupplier.findMany.mockResolvedValue([
      { supplierName: '中标公司', bondReturnedAt: null, bondReturnReason: null },
      { supplierName: '乙公司', bondReturnedAt: new Date('2026-09-01T08:00:00Z'), bondReturnReason: null },
      { supplierName: '丙公司', bondReturnedAt: null, bondReturnReason: '弄虚作假' },
    ]);
    prisma.bidOpeningRecord.findMany.mockResolvedValue([{ supplierName: '乙公司', bondStatus: '足额到账' }]);
    prisma.bidEvaluationResult.findFirst.mockResolvedValue({ supplierName: '中标公司' });

    const res = await service.listBondReturns('p1');
    expect(res.rows).toHaveLength(3);
    expect(res.rows[0]).toMatchObject({ supplierName: '中标公司', bondStatus: null, bondReturnedAt: null, isWinner: true });
    expect(res.rows[1]).toMatchObject({ supplierName: '乙公司', bondStatus: '足额到账', bondReturnedAt: new Date('2026-09-01T08:00:00Z'), isWinner: false });
    expect(res.rows[2]).toMatchObject({ supplierName: '丙公司', bondReturnReason: '弄虚作假', isWinner: false });
  });
});
