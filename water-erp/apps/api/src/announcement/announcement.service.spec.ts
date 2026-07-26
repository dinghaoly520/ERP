import { Test, TestingModule } from '@nestjs/testing';
import { AnnouncementService } from './announcement.service';
import { AnnouncementAiService } from './announcement-ai.service';
import { PrismaService } from '../prisma/prisma.service';

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
