import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { BidService } from './bid.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { ClarificationAiService } from './clarification-ai.service';
import { BidGateway } from './bid.gateway';
import { ScoreStandardValidator } from './score-standard-validator.service';
import { StorageService } from '../storage/storage.service';

jest.mock('../upload/minio.client', () => ({
  minioClient: { getObject: jest.fn().mockResolvedValue({}), putObject: jest.fn().mockResolvedValue({}) },
  MINIO_BUCKET: 'test-bucket',
}));

function makePrismaMock() {
  const tx: any = {
    $queryRaw: jest.fn(),
    bidProject: { findUnique: jest.fn() },
    bidOpeningSession: { findUnique: jest.fn(), update: jest.fn() },
    fileAsset: { create: jest.fn() },
    bidSupervisionLog: { create: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma: any = {
    bidProject: { findUnique: jest.fn() },
    bidOpeningSession: { findUnique: jest.fn() },
    bidSupplier: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
    bidOpeningRecord: { findMany: jest.fn().mockResolvedValue([]) },
    bidSupervisionLog: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
    __tx: tx,
  };
  return prisma;
}

async function buildService(prisma: any) {
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      BidService,
      { provide: PrismaService, useValue: prisma },
      { provide: NotificationService, useValue: { sendToRole: jest.fn().mockResolvedValue(undefined) } },
      { provide: ScoreStandardValidator, useValue: { assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
      { provide: ClarificationAiService, useValue: {} },
      { provide: BidGateway, useValue: { notifyOpeningCompleted: jest.fn(), notifySupervisionLog: jest.fn(), notifyStageChange: jest.fn() } },
      { provide: StorageService, useValue: { upload: jest.fn().mockResolvedValue(undefined) } },
      // BidService 构造器中 @InjectQueue 的可选队列：提供空令牌避免 DI 报错
      { provide: 'BullQueue_tender-processing', useValue: {} },
    ],
  }).compile();
  return moduleRef.get(BidService);
}

describe('completeOpening / assertOpeningDone', () => {
  it('开标未完成（有供应商未解密）→ 409 OPENING_NOT_DONE 且带名单', async () => {
    const prisma = makePrismaMock();
    const svc = await buildService(prisma);
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'C1', name: '测试项目', stage: 'OPENING', procurementMethod: '公开招标', openTime: new Date(), deadline: new Date(), projectManagementItemId: null });
    prisma.bidOpeningSession.findUnique.mockResolvedValue({ projectId: 'p1', host: '主持', supervisor: '监督', status: '待开标' });
    prisma.bidSupplier.findMany.mockResolvedValue([
      { supplierName: '甲公司', decryptStatus: 'PENDING', confirmStatus: 'PENDING', submitStatus: '已投递' },
    ]);
    await expect(svc.completeOpening('p1', 'user1')).rejects.toMatchObject({
      status: 409,
      response: { code: 'OPENING_NOT_DONE' },
    });
  });
});
