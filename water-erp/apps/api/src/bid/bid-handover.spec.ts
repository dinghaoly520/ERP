import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { BidService } from './bid.service';
import { BidScoreStandardService } from './bid-score-standard.service';
import { GbCodeService } from '../common/gb-code.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { ClarificationAiService } from './clarification-ai.service';
import { BidGateway } from './bid.gateway';
import { ScoreStandardValidator } from './score-standard-validator.service';
import { StorageService } from '../storage/storage.service';
import { PriceFormulaService } from './price-formula.service';
import { AdminKeyService } from '../common/crypto/admin-keystore.service';
import { DualEnvelopeService } from '../common/crypto/dual-envelope.service';

jest.mock('../upload/minio.client', () => ({
  minioClient: { getObject: jest.fn().mockResolvedValue({}), putObject: jest.fn().mockResolvedValue({}) },
  MINIO_BUCKET: 'test-bucket',
}));

function makePrismaMock() {
  const tx: any = {
    $queryRaw: jest.fn(),
    bidProject: { findUnique: jest.fn() },
    bidOpeningSession: { findUnique: jest.fn(), update: jest.fn() },
    // completeOpening 事务内 TOCTOU 复查：tx.bidSupplier.findMany（空列表 = 无未终局供应商）
    bidSupplier: { findMany: jest.fn().mockResolvedValue([]) },
    fileAsset: { create: jest.fn(), upsert: jest.fn() },
    bidSupervisionLog: { create: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma: any = {
    bidProject: { findUnique: jest.fn() },
    bidOpeningSession: { findUnique: jest.fn() },
    bidSupplier: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
    bidOpeningRecord: { findMany: jest.fn().mockResolvedValue([]) },
    // §5.5b（Task 18）：buildHandoverPackage 解密明文指纹段查 submission（默认空 → 旧项目零变化）
    supplierBidSubmission: { findMany: jest.fn().mockResolvedValue([]) },
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
      BidScoreStandardService,
      { provide: PrismaService, useValue: prisma },
      { provide: GbCodeService, useValue: { allocateProjectCode: async () => 'GB-TEST', allocateProcureCode: async () => 'GB-PROC-TEST' } },
      { provide: NotificationService, useValue: { sendToRole: jest.fn().mockResolvedValue(undefined) } },
      { provide: ScoreStandardValidator, useValue: { assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
      // 与 bid.service.spec.ts 同口径（BidService 构造器第 4 参）
      { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
      { provide: ClarificationAiService, useValue: {} },
      { provide: BidGateway, useValue: { notifyOpeningCompleted: jest.fn(), notifySupervisionLog: jest.fn(), notifyStageChange: jest.fn() } },
      { provide: StorageService, useValue: { upload: jest.fn().mockResolvedValue(undefined) } },
      // BidService 构造器中 @InjectQueue 的可选队列：提供空令牌避免 DI 报错
      { provide: 'BullQueue_tender-processing', useValue: {} },
      // Task 12 新增构造依赖（Nest 测试模块不自动实例化未注册 provider）
      { provide: AdminKeyService, useValue: { readPrivateKey: jest.fn(), getActiveCert: jest.fn(), ensureBootstrap: jest.fn(), generate: jest.fn() } },
      { provide: DualEnvelopeService, useValue: { verifySignature: jest.fn(), assertEnvelopeIntact: jest.fn(), decryptOuterFile: jest.fn(), verifyFieldsCommit: jest.fn() } },
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
    prisma.__tx.fileAsset.upsert.mockResolvedValue({ id: 'asset_1', key: 'bid-opening-handover/p1.json' });
    prisma.__tx.bidOpeningSession.update.mockResolvedValue({ ...SESSION, status: '开标完成', handoverAt: new Date(), handoverAssetId: 'asset_1' });
    prisma.__tx.bidProject.findUnique.mockResolvedValue(OPENING_PROJECT); // lockAndReassertStage 复查
    const r = await svc.completeOpening('p1', 'user1');
    expect(r.handoverAssetId).toBe('asset_1');
    expect(r.downloadUrl).toBe('/api/upload/files/asset_1');
    expect(prisma.__tx.bidOpeningSession.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: '开标完成' }),
    }));
    // 终审 must-fix #2：移交包 fileAsset 须 upsert——MinIO 上传在事务前且 payload 含 generatedAt，
    // 亚秒级并发下第二笔先覆盖 MinIO 再裸 create 撞 key @unique（P2002 → 500）；upsert 的 update 段
    // 同步刷新 size/sha256，DB 指纹不与 MinIO 内容分叉（N3/P1-17 同款）
    expect(prisma.__tx.fileAsset.create).not.toHaveBeenCalled();
    expect(prisma.__tx.fileAsset.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'bid-opening-handover/p1.json' },
      create: expect.objectContaining({
        key: 'bid-opening-handover/p1.json',
        originalName: '开标文件包-C1.json',
        mimeType: 'application/json',
        category: 'bid_opening_handover',
        uploaderId: 'user1',
      }),
      update: expect.objectContaining({ sha256: expect.any(String), size: expect.any(Number), uploaderId: 'user1' }),
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
    expect(prisma.__tx.fileAsset.upsert).not.toHaveBeenCalled(); // 早退路径零写入
  });
});
