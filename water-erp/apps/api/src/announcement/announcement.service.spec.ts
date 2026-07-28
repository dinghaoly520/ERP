import { Test, TestingModule } from '@nestjs/testing';
import { AnnouncementService } from './announcement.service';
import { AnnouncementAiService } from './announcement-ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { sealField } from '../common/crypto/field-crypto';

// 解密门控断言依赖 KMS_SECRET（openField 拆封密封 bidPrice）。
const ANN_SPEC_KMS = 'test-kms-secret-from-announcement-spec';
const ANN_SPEC_ORIG_KMS = process.env.KMS_SECRET;
beforeAll(() => { process.env.KMS_SECRET = ANN_SPEC_KMS; });
afterAll(() => { if (ANN_SPEC_ORIG_KMS !== undefined) process.env.KMS_SECRET = ANN_SPEC_ORIG_KMS; else delete process.env.KMS_SECRET; });

describe('AnnouncementService — remove 级联清理 (H3)', () => {
  let service: AnnouncementService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      announcement: { findUnique: jest.fn(), delete: jest.fn() },
      bidProject: { findUnique: jest.fn(), update: jest.fn() },
      bidSupervisionLog: { create: jest.fn() },
      bidDocument: { updateMany: jest.fn() },
      bidOpeningSession: { deleteMany: jest.fn() },
      bidOpeningRecord: { deleteMany: jest.fn() },
      bidScoreRecord: { deleteMany: jest.fn() },
      bidEvaluationResult: { deleteMany: jest.fn() },
      bidInvalidBid: { deleteMany: jest.fn() },
      bidSupplier: { updateMany: jest.fn() },
      bidExpert: { updateMany: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnouncementService,
        { provide: PrismaService, useValue: prisma },
        { provide: AnnouncementAiService, useValue: {} },
      ],
    }).compile();
    service = module.get(AnnouncementService);
  });

  it('项目原处 EVALUATING 时重置 stage 并级联清理下游产物', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ type: 'BID_NOTICE', relatedProjectCode: 'C1', status: 'PUBLISHED' });
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'C1', stage: 'EVALUATING', riskNote: '' });
    prisma.bidProject.update.mockResolvedValue({});
    prisma.bidSupervisionLog.create.mockResolvedValue({});
    prisma.bidDocument.updateMany.mockResolvedValue({});
    prisma.announcement.delete.mockResolvedValue({});

    await service.remove('ann1');

    expect(prisma.bidOpeningSession.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
    expect(prisma.bidOpeningRecord.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
    expect(prisma.bidScoreRecord.deleteMany).toHaveBeenCalledWith({ where: { supplier: { projectId: 'p1' } } });
    expect(prisma.bidEvaluationResult.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
    expect(prisma.bidInvalidBid.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
    expect(prisma.bidSupplier.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'p1' }, data: expect.objectContaining({ decryptStatus: 'PENDING', confirmStatus: 'PENDING' }) }),
    );
    expect(prisma.bidExpert.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reportConfirmed: false }) }),
    );
  });

  it('项目原处 DOWNLOAD（无需重置）时不做级联清理', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ type: 'BID_NOTICE', relatedProjectCode: 'C1', status: 'PUBLISHED' });
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'C1', stage: 'DOWNLOAD', riskNote: '' });
    prisma.bidProject.update.mockResolvedValue({});
    prisma.bidDocument.updateMany.mockResolvedValue({});
    prisma.announcement.delete.mockResolvedValue({});

    await service.remove('ann1');

    expect(prisma.bidOpeningSession.deleteMany).not.toHaveBeenCalled();
    expect(prisma.bidSupplier.updateMany).not.toHaveBeenCalled();
  });
});

describe('AnnouncementService — getParticipants 报价解密门控', () => {
  let service: AnnouncementService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      announcement: { findUnique: jest.fn() },
      bidProject: { findUnique: jest.fn() },
      bidSupplier: { findMany: jest.fn() },
      supplierBidSubmission: { findMany: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnouncementService,
        { provide: PrismaService, useValue: prisma },
        { provide: AnnouncementAiService, useValue: {} },
      ],
    }).compile();
    service = module.get(AnnouncementService);
  });

  it('未解密供应商的 bidPrice 返回 null（即便项目已进入 OPENING/EVALUATING）', async () => {
    // 旧阶段制在这里会泄漏——这是本任务修复的核心回归点。
    prisma.announcement.findUnique.mockResolvedValue({ type: 'BID_NOTICE', relatedProjectCode: 'C1' });
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'C1', stage: 'OPENING', deadline: new Date() });
    prisma.bidSupplier.findMany.mockResolvedValue([
      { supplierId: 'su1', supplierName: '甲公司', decryptStatus: 'PENDING', submitStatus: '已提交', supplier: { classification: { name: 'A' } } },
    ]);
    const sealed = sealField('980000', ANN_SPEC_KMS);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([
      { supplierId: 'su1', status: 'submitted', submittedAt: new Date(), bidPrice: sealed },
    ]);

    const result = await service.getParticipants('ann1');
    expect(result.suppliers[0].bidPrice).toBeNull();
  });

  it('已解密（SUCCESS）供应商的 bidPrice 被拆封返回明文', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ type: 'BID_NOTICE', relatedProjectCode: 'C1' });
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'C1', stage: 'OPENING', deadline: new Date() });
    prisma.bidSupplier.findMany.mockResolvedValue([
      { supplierId: 'su1', supplierName: '甲公司', decryptStatus: 'SUCCESS', submitStatus: '已提交', supplier: { classification: { name: 'A' } } },
    ]);
    const sealed = sealField('1234567', ANN_SPEC_KMS);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([
      { supplierId: 'su1', status: 'submitted', submittedAt: new Date(), bidPrice: sealed },
    ]);

    const result = await service.getParticipants('ann1');
    expect(result.suppliers[0].bidPrice).toBe('1234567');
  });

  it('旧明文 bidPrice（无 v1: 前缀）在解密后经 legacy 兼容原样返回', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ type: 'BID_NOTICE', relatedProjectCode: 'C1' });
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'C1', stage: 'EVALUATING', deadline: new Date() });
    prisma.bidSupplier.findMany.mockResolvedValue([
      { supplierId: 'su1', supplierName: '甲公司', decryptStatus: 'SUCCESS', submitStatus: '已提交', supplier: { classification: { name: 'A' } } },
    ]);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([
      { supplierId: 'su1', status: 'submitted', submittedAt: new Date(), bidPrice: '770000' }, // legacy 明文
    ]);

    const result = await service.getParticipants('ann1');
    expect(result.suppliers[0].bidPrice).toBe('770000');
  });
});
