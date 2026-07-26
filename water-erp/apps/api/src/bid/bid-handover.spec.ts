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
  const OPENING_PROJECT = { id: 'p1', projectCode: 'C1', name: '测试项目', stage: 'OPENING', procurementMethod: '公开招标', openTime: new Date('2026-07-01'), deadline: new Date('2026-06-30'), projectManagementItemId: 'pm1' };
  const SESSION = { projectId: 'p1', host: '李主任', supervisor: '周老师', status: '待开标', decryptWindowStart: new Date(), decryptWindowEnd: new Date() };

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

  it('非 OPENING 阶段 → 409 OPENING_STAGE_REQUIRED', async () => {
    const prisma = makePrismaMock();
    const svc = await buildService(prisma);
    prisma.bidProject.findUnique.mockResolvedValue({ ...OPENING_PROJECT, stage: 'EVALUATING' });
    await expect(svc.completeOpening('p1')).rejects.toMatchObject({ response: { code: 'OPENING_STAGE_REQUIRED' } });
  });

  it('OPENING 但未组建会话 → 409 SESSION_NOT_FOUND', async () => {
    const prisma = makePrismaMock();
    const svc = await buildService(prisma);
    prisma.bidProject.findUnique.mockResolvedValue(OPENING_PROJECT);
    prisma.bidOpeningSession.findUnique.mockResolvedValue(null);
    await expect(svc.completeOpening('p1')).rejects.toMatchObject({ response: { code: 'SESSION_NOT_FOUND' } });
  });

  it('正常移交：生成文件包、写 FileAsset、会话置「开标完成」、stage 保持 OPENING', async () => {
    const prisma = makePrismaMock();
    const svc = await buildService(prisma);
    prisma.bidProject.findUnique.mockResolvedValue(OPENING_PROJECT);
    prisma.bidOpeningSession.findUnique.mockResolvedValue(SESSION);
    prisma.__tx.bidOpeningSession.findUnique.mockResolvedValue(SESSION);
    prisma.__tx.fileAsset.create.mockResolvedValue({ id: 'asset_1', key: 'bid-opening-handover/p1.json' });
    prisma.__tx.bidOpeningSession.update.mockResolvedValue({ ...SESSION, status: '开标完成', handoverAt: new Date(), handoverAssetId: 'asset_1' });
    prisma.__tx.bidProject.findUnique.mockResolvedValue(OPENING_PROJECT); // lockAndReassertStage 复查
    const r = await svc.completeOpening('p1', 'user1');
    expect(r.handoverAssetId).toBe('asset_1');
    expect(r.downloadUrl).toBe('/api/upload/files/asset_1');
    expect(prisma.__tx.bidOpeningSession.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: '开标完成' }),
    }));
    expect(prisma.__tx.fileAsset.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ category: 'bid_opening_handover', key: 'bid-opening-handover/p1.json' }),
    }));
  });

  it('幂等：已「开标完成」直接返回既有 asset，不再上传', async () => {
    const prisma = makePrismaMock();
    const svc = await buildService(prisma);
    const done = { ...SESSION, status: '开标完成', handoverAt: new Date(), handoverAssetId: 'asset_old' };
    prisma.bidProject.findUnique.mockResolvedValue(OPENING_PROJECT);
    prisma.bidOpeningSession.findUnique.mockResolvedValue(done);
    const storage = (svc as any).storage as { upload: jest.Mock };
    const r = await svc.completeOpening('p1');
    expect(r.handoverAssetId).toBe('asset_old');
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('并发幂等：事务内复查已移交 → 返回既有会话', async () => {
    const prisma = makePrismaMock();
    const svc = await buildService(prisma);
    prisma.bidProject.findUnique.mockResolvedValue(OPENING_PROJECT);
    prisma.bidOpeningSession.findUnique.mockResolvedValue(SESSION); // 事务外看未移交
    prisma.__tx.bidProject.findUnique.mockResolvedValue(OPENING_PROJECT); // lockAndReassertStage 复查
    prisma.__tx.bidOpeningSession.findUnique.mockResolvedValue({ ...SESSION, status: '开标完成', handoverAt: new Date(), handoverAssetId: 'asset_race' });
    const r = await svc.completeOpening('p1');
    expect(r.handoverAssetId).toBe('asset_race');
    expect(prisma.__tx.fileAsset.create).not.toHaveBeenCalled();
  });
});
