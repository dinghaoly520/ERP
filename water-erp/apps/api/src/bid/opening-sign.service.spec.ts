import { BadRequestException } from '@nestjs/common';
import { OpeningSignService } from './opening-sign.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

describe('OpeningSignService — P1-3①A 开标记录纸面签字', () => {
  let svc: any;
  let prisma: any;
  let storage: any;

  const SESSION = {
    projectId: 'p1', host: '主持人甲', supervisor: '监督人乙',
    status: '开标完成', handoverAssetId: 'fa-handover',
    hostSignScanFileId: null as string | null, supervisorSignScanFileId: null as string | null,
    openingSignRegisteredAt: null as Date | null, openingSignRegisteredBy: null as string | null,
    decryptWindowStart: new Date(Date.now() - 3600_000), decryptWindowEnd: new Date(Date.now() - 1800_000),
  };
  const PROJECT = {
    id: 'p1', name: 'P', projectCode: 'GK-1', procurementMethod: '公开招标',
    openTime: new Date(Date.now() - 7200_000), deadline: new Date(Date.now() - 86400_000), stage: 'EVALUATING',
  };

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue(PROJECT) },
      bidOpeningSession: { findUnique: jest.fn().mockResolvedValue({ ...SESSION }), update: jest.fn().mockResolvedValue({}) },
      bidSupplier: { findMany: jest.fn().mockResolvedValue([
        { supplierName: '甲公司', decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED', dangerAttribution: null },
      ]) },
      bidOpeningRecord: { findMany: jest.fn().mockResolvedValue([
        { supplierName: '甲公司', amount: '100', period: '120天', qualityTarget: '合格', bondStatus: '已缴纳', confirmStatus: 'CONFIRMED', objectionReason: null, handleResult: null },
      ]) },
      fileAsset: {
        upsert: jest.fn().mockResolvedValue({ id: 'fa-page' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'fa-scan-host', sha256: 'abc123' }),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (fn: any) => fn({
        bidOpeningSession: { update: jest.fn().mockResolvedValue({}) },
        fileAsset: { update: jest.fn().mockResolvedValue({}) },
        bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      })),
    };
    storage = {
      upload: jest.fn().mockResolvedValue({}),
      download: jest.fn().mockResolvedValue(Buffer.from(JSON.stringify({ packageType: 'BID_OPENING_HANDOVER', project: { id: 'p1' }, fingerprint: 'old' }))),
    };
    const { Test } = await import('@nestjs/testing');
    const module = await Test.createTestingModule({
      providers: [
        OpeningSignService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    svc = module.get(OpeningSignService);
    (svc as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  });

  describe('uploadSignScan', () => {
    it('host 扫描上传 → FileAsset upsert（category=opening_sign_scan）+ 会话 hostSignScanFileId 更新', async () => {
      prisma.fileAsset.upsert.mockResolvedValue({ id: 'fa-scan-host' });
      const res = await svc.uploadSignScan('p1', 'host', { buffer: Buffer.from('scan'), originalname: 'host.pdf', mimetype: 'application/pdf' }, 'u-host');
      expect(res.assetId).toBe('fa-scan-host');
      expect(prisma.fileAsset.upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({ category: 'opening_sign_scan' }),
      }));
      expect(prisma.bidOpeningSession.update).toHaveBeenCalledWith({
        where: { projectId: 'p1' },
        data: { hostSignScanFileId: 'fa-scan-host' },
      });
    });

    it('supervisor 上传但项目无监督人 → 400 NO_SUPERVISOR', async () => {
      prisma.bidOpeningSession.findUnique.mockResolvedValue({ ...SESSION, supervisor: null });
      await expect(svc.uploadSignScan('p1', 'supervisor', { buffer: Buffer.from('x'), originalname: 's.pdf', mimetype: 'application/pdf' }))
        .rejects.toMatchObject({ response: { code: 'NO_SUPERVISOR' } });
    });
  });

  describe('registerSign', () => {
    it('未完成开标（无 handoverAssetId）→ 400 HANDOVER_NOT_READY', async () => {
      prisma.bidOpeningSession.findUnique.mockResolvedValue({ ...SESSION, handoverAssetId: null });
      await expect(svc.registerSign('p1')).rejects.toMatchObject({ response: { code: 'HANDOVER_NOT_READY' } });
    });

    it('主持人扫描未上传 → 400 HOST_SCAN_MISSING', async () => {
      await expect(svc.registerSign('p1')).rejects.toMatchObject({ response: { code: 'HOST_SCAN_MISSING' } });
    });

    it('登记闭环 → 重建开标文件包（signatures 段 + 新 fingerprint）+ 会话/监督日志/审计三写', async () => {
      prisma.bidOpeningSession.findUnique.mockResolvedValue({ ...SESSION, hostSignScanFileId: 'fa-scan-host', supervisorSignScanFileId: 'fa-scan-sup' });
      prisma.fileAsset.findUnique.mockImplementation(({ where }: any) =>
        where.id === 'fa-scan-host' ? { id: 'fa-scan-host', sha256: 'hash-host' }
          : where.id === 'fa-scan-sup' ? { id: 'fa-scan-sup', sha256: 'hash-sup' } : null);

      const res = await svc.registerSign('p1', 'u-host');
      expect(res.registered).toBe(true);
      expect(res.packageSha256).toMatch(/^[0-9a-f]{64}$/);
      // 下载原包 → 追加 signatures → 覆盖上传
      expect(storage.download).toHaveBeenCalledWith('bid-opening-handover/p1.json');
      expect(storage.upload).toHaveBeenCalledTimes(1);
      const uploadedBuf = storage.upload.mock.calls[0][1] as Buffer;
      const uploaded = JSON.parse(uploadedBuf.toString('utf8'));
      expect(uploaded.signatures).toBeTruthy();
      expect(uploaded.signatures.host.sha256).toBe('hash-host');
      expect(uploaded.signatures.supervisor.sha256).toBe('hash-sup');
      expect(uploaded.fingerprint).toBe(res.packageSha256);
      expect(uploaded.fingerprint).not.toBe('old');
    });

    it('幂等：已登记 → 直接返回现状不重建', async () => {
      prisma.bidOpeningSession.findUnique.mockResolvedValue({
        ...SESSION, hostSignScanFileId: 'fa-scan-host', openingSignRegisteredAt: new Date('2026-08-25T00:00:00Z'),
      });
      const res = await svc.registerSign('p1');
      expect(res.alreadyRegistered).toBe(true);
      expect(storage.download).not.toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('无会话 → hasSession:false', async () => {
      prisma.bidOpeningSession.findUnique.mockResolvedValue(null);
      const res = await svc.getStatus('p1');
      expect(res).toEqual({ hasSession: false });
    });

    it('有会话 → 徽标字段齐', async () => {
      prisma.bidOpeningSession.findUnique.mockResolvedValue(SESSION);
      const res = await svc.getStatus('p1');
      expect(res).toMatchObject({ hasSession: true, host: '主持人甲', handoverReady: true, hostScanUploaded: false, registeredAt: null });
    });
  });
});
