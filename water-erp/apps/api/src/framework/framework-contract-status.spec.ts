import { FrameworkService } from './framework.service';
import { ContractService } from '../contract/contract.service';

describe('FrameworkService — 二阶段订单合同签署证据', () => {
  it('无签署件的二阶段订单只能生成为待签署，不得伪造已签署状态', async () => {
    const fa = {
      id: 'fa-1',
      faCode: 'FA-202609-0001',
      projectManagementItemId: 'pmi-1',
      status: 'active',
      validUntil: new Date('2099-01-01T00:00:00.000Z'),
      variant: 'supplier_price',
      secondStageRule: '按协议规则选定',
      companyId: 'company-a',
      companyName: '采购人甲',
      changeLog: [],
      entries: [{
        id: 'entry-1', supplierId: 'supplier-1', supplierName: '供应商甲', status: 'active',
      }],
    };
    let createdContract: any;
    const prisma: any = {
      contract: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => (
          where?.id === 'contract-1' ? Promise.resolve(createdContract) : Promise.resolve(null)
        )),
        findUnique: jest.fn().mockImplementation(() => Promise.resolve({
          ...createdContract, status: 'signed', signedAssetId: 'signed-file', signedAt: new Date(),
        })),
        create: jest.fn().mockImplementation(({ data }: any) => {
          createdContract = {
            id: 'contract-1',
            ...data,
            updatedAt: new Date('2026-09-03T08:00:00.000Z'),
            fulfillments: [],
          };
          return Promise.resolve(createdContract);
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      contractFulfillment: { findFirst: jest.fn().mockResolvedValue(null) },
      awardLetterDelivery: { findFirst: jest.fn().mockResolvedValue(null) },
      fileAsset: {
        findFirst: jest.fn().mockResolvedValue({ id: 'signed-file' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
      frameworkAgreement: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction = jest.fn(async (callback: (tx: any) => unknown) => callback(prisma));
    const subject = Object.create(FrameworkService.prototype) as FrameworkService;
    (subject as any).prisma = prisma;
    (subject as any).get = jest.fn().mockResolvedValue(fa);

    const orderContract = await subject.secondStageOrder('fa-1', { entryId: 'entry-1', amount: 100 });

    expect(prisma.contract.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractType: 'order',
        status: 'approved_for_signing',
        signedAt: null,
        signedAssetId: null,
        consistencyResult: expect.objectContaining({
          manualConfirm: true,
          source: 'none',
          consistent: true,
          basis: 'framework_second_stage',
          faCode: 'FA-202609-0001',
        }),
      }),
    });

    const contractService = Object.create(ContractService.prototype) as ContractService;
    (contractService as any).prisma = prisma;
    await expect((contractService as any).sign(
      orderContract.id,
      { signedAssetId: 'signed-file' },
      { userId: 'staff-1', username: '经办人' },
    )).resolves.toMatchObject({ status: 'signed', signedAssetId: 'signed-file' });
  });
});
