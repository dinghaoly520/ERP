import { BadRequestException } from '@nestjs/common';
import { BidOpeningRecordService } from './bid-opening-record.service';

/* ── P1-1（第三波）：解密成功但拒不/无法确认唱标 → 开标永久卡死的主持人出口——
 *    overrideDispute 扩 PENDING→CONFIRMED「缺席视为无异议」通道（admin/leader+书面理由+高风险留痕） ── */
describe('BidOpeningRecordService — overrideDispute 缺席视为确认通道', () => {
  let svc: any;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'OPENING', name: 'P' }) },
      bidSupplier: {
        findFirst: jest.fn().mockResolvedValue({ id: 'bs1', supplierName: '甲公司', confirmStatus: 'PENDING', decryptStatus: 'SUCCESS' }),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      bidOpeningRecord: {
        findFirst: jest.fn().mockResolvedValue({ id: 'r1', confirmStatus: '待供应商确认' }),
        update: jest.fn().mockResolvedValue({}),
      },
      bidOpeningSession: { update: jest.fn().mockResolvedValue({}) },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    svc = Object.create(BidOpeningRecordService.prototype);
    svc.prisma = prisma;
    svc.gateway = { notifySupervisionLog: jest.fn() };
  });

  it('SUCCESS+PENDING target=confirmed → 置 CONFIRMED、记录「缺席视为确认」、高风险监督日志', async () => {
    const r = await svc.overrideDispute('p1', 'bs1', '电话三次未接、现场离席，视为无异议', 'u-admin', 'confirmed');
    expect(r.confirmStatus).toBe('CONFIRMED');
    expect(prisma.bidSupplier.update).toHaveBeenCalledWith({
      where: { id: 'bs1' },
      data: { confirmStatus: 'CONFIRMED' },
    });
    expect(prisma.bidOpeningRecord.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: expect.objectContaining({ confirmStatus: '缺席视为确认' }),
    });
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ riskFlag: '高风险', action: expect.stringContaining('缺席视为确认') }),
    });
    expect(svc.gateway.notifySupervisionLog).toHaveBeenCalled();
  });

  it('SUCCESS+PENDING target=exception → 400 ABSENT_CONFIRM_ONLY（缺席只能视为无异议，不得定性异常）', async () => {
    await expect(svc.overrideDispute('p1', 'bs1', '理由', 'u-admin', 'exception'))
      .rejects.toMatchObject({ response: { code: 'ABSENT_CONFIRM_ONLY' } });
    expect(prisma.bidSupplier.update).not.toHaveBeenCalled();
  });

  it('解密未成功的 PENDING 家仍不可走本通道（NOT_OVERRIDABLE 原语义保持）', async () => {
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs2', supplierName: '乙公司', confirmStatus: 'PENDING', decryptStatus: 'PENDING' });
    await expect(svc.overrideDispute('p1', 'bs2', '理由', 'u-admin', 'confirmed'))
      .rejects.toMatchObject({ response: { code: 'NOT_OVERRIDABLE' } });
  });
});
