import { SupplierService } from './supplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { VerificationService } from '../verification/verification.service';
import { LlmService } from '../local-ai/llm.service';
import { CompanyScopeService } from '../company/company-scope';

/**
 * performances 变更审批（2026-10-30 稳健性修正）：A-213 奖惩记录（recordType=reward/punishment）
 * 与供应商自报业绩同表共存（:3005 管理端录入）——审批整表替换只许动业绩行，
 * 此前 deleteMany({supplierId}) 全表删除会把奖惩行随一次业绩变更审批静默抹掉。
 */
describe('SupplierService.approveChange(performances)——奖惩行保留', () => {
  let service: SupplierService;
  let prisma: any;

  beforeEach(async () => {
    const tx = {
      supplierChangeRecord: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      supplierPerformance: {
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
        create: jest.fn().mockResolvedValue({}),
      },
      supplier: { update: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue(null) },
      user: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      supplierChangeRecord: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cr1', supplierId: 's1', fieldName: 'performances', status: 'PENDING',
          newValue: JSON.stringify([{ projectName: '甲项目', proofFiles: [{ name: '证明.pdf', url: '/f/1' }] }]),
        }),
      },
      supplierPerformance: tx.supplierPerformance,
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const { Test } = await import('@nestjs/testing');
    const module = await Test.createTestingModule({
      providers: [
        { provide: CompanyScopeService, useValue: { resolveScope: jest.fn().mockResolvedValue({ all: true }), filter: jest.fn().mockReturnValue({}), assertInScope: jest.fn(), stampFor: jest.fn().mockResolvedValue({}) } },
        SupplierService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn().mockResolvedValue({}), sendToRole: jest.fn(), sendToUser: jest.fn(), resolveActionable: jest.fn().mockResolvedValue({}) } },
        { provide: 'REDIS_CLIENT', useValue: {} },
        { provide: LlmService, useValue: {} },
        { provide: VerificationService, useValue: {} },
      ],
    }).compile();
    service = module.get(SupplierService);
  });

  it('审批通过只删业绩行（recordType=performance），奖惩行不动', async () => {
    const res = await service.approveChange('cr1', 'u-admin');
    expect(res).toEqual({ success: true });
    expect(prisma.supplierPerformance.deleteMany).toHaveBeenCalledWith({
      where: { supplierId: 's1', recordType: 'performance' },
    });
  });

  it('草稿行缺失项目名或证明材料 → 400 INVALID_PERFORMANCES（事务回滚，不产生半套用）', async () => {
    (prisma.supplierChangeRecord.findUnique as jest.Mock).mockResolvedValue({
      id: 'cr2', supplierId: 's1', fieldName: 'performances', status: 'PENDING',
      newValue: JSON.stringify([{ projectName: '乙项目', proofFiles: [] }]),
    });
    await expect(service.approveChange('cr2', 'u-admin')).rejects.toMatchObject({
      response: { code: 'INVALID_PERFORMANCES' },
    });
    expect(prisma.supplierPerformance.create).not.toHaveBeenCalled();
  });
});
