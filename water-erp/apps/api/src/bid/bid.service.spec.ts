import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { BidService } from './bid.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { BidGateway } from './bid.gateway';
import { assertBidStageTransition } from './bid-state';

/* ── 纯函数测试：bid-state 状态机 ── */

describe('assertBidStageTransition (bid-state)', () => {
  it('允许合法流转 DOWNLOAD → SUBMIT', () => {
    expect(() => assertBidStageTransition('DOWNLOAD', 'SUBMIT')).not.toThrow();
  });

  it('允许合法流转 SUBMIT → OPENING', () => {
    expect(() => assertBidStageTransition('SUBMIT', 'OPENING')).not.toThrow();
  });

  it('允许合法流转 OPENING → EVALUATING', () => {
    expect(() => assertBidStageTransition('OPENING', 'EVALUATING')).not.toThrow();
  });

  it('允许合法流转 EVALUATING → ARCHIVED', () => {
    expect(() => assertBidStageTransition('EVALUATING', 'ARCHIVED')).not.toThrow();
  });

  it('同阶段幂等不报错', () => {
    expect(() => assertBidStageTransition('DOWNLOAD', 'DOWNLOAD')).not.toThrow();
    expect(() => assertBidStageTransition('ARCHIVED', 'ARCHIVED')).not.toThrow();
  });

  it('跳级抛 ConflictException', () => {
    expect(() => assertBidStageTransition('DOWNLOAD', 'ARCHIVED')).toThrow(ConflictException);
  });

  it('回退抛 ConflictException', () => {
    expect(() => assertBidStageTransition('ARCHIVED', 'DOWNLOAD')).toThrow(ConflictException);
  });

  it('ARCHIVED 后不能转到任何阶段', () => {
    expect(() => assertBidStageTransition('ARCHIVED', 'EVALUATING')).toThrow(ConflictException);
    expect(() => assertBidStageTransition('ARCHIVED', 'OPENING')).toThrow(ConflictException);
  });

  it('异常消息包含流转方向', () => {
    try {
      assertBidStageTransition('DOWNLOAD', 'ARCHIVED');
      fail('应抛出 ConflictException');
    } catch (e) {
      expect(e.message).toContain('DOWNLOAD');
      expect(e.message).toContain('ARCHIVED');
    }
  });
});

/* ── 集成测试：BidService 使用状态机 ── */

describe('BidService — stage transitions', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
      bidSupervisionLog: { findMany: jest.fn(), create: jest.fn() },
      bidExpert: { groupBy: jest.fn(), findFirst: jest.fn() },
      bidScoreItem: { findFirst: jest.fn() },
      bidScoreRecord: { upsert: jest.fn(), findMany: jest.fn() },
      supplier: { count: jest.fn() },
      announcement: { count: jest.fn() },
      bidSupplier: { findMany: jest.fn(), update: jest.fn(), create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
      bidOpeningRecord: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
      bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
      bidArchiveItem: { findMany: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
      notification: { create: jest.fn(), createMany: jest.fn() },
      user: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BidService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn() } },
      ],
    }).compile();

    service = module.get<BidService>(BidService);
  });

  describe('assertBidStageTransition (via updateProject)', () => {
    it('allows DOWNLOAD → SUBMIT', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'DOWNLOAD' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'SUBMIT' });

      await expect(service.updateProject('p1', { stage: 'SUBMIT' as any })).resolves.toBeDefined();
    });

    it('allows SUBMIT → OPENING', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'OPENING' });

      await expect(service.updateProject('p1', { stage: 'OPENING' as any })).resolves.toBeDefined();
    });

    it('rejects DOWNLOAD → ARCHIVED (skip stages) with ConflictException', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'DOWNLOAD' });

      await expect(service.updateProject('p1', { stage: 'ARCHIVED' as any }))
        .rejects.toThrow(ConflictException);
    });

    it('rejects ARCHIVED → DOWNLOAD (backward) with ConflictException', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'ARCHIVED' });

      await expect(service.updateProject('p1', { stage: 'DOWNLOAD' as any }))
        .rejects.toThrow(ConflictException);
    });

    it('allows same-stage (idempotent)', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'SUBMIT' });

      await expect(service.updateProject('p1', { stage: 'SUBMIT' as any })).resolves.toBeDefined();
    });
  });

  describe('openSubmission', () => {
    it('transitions DOWNLOAD → SUBMIT and writes supervision log', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'DOWNLOAD', name: '测试项目' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'SUBMIT' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      const result = await service.openSubmission('p1');
      expect(result.stage).toBe('SUBMIT');
      expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: '开放投递 (DOWNLOAD→SUBMIT)' }),
        }),
      );
    });
  });

  describe('startOpening', () => {
    it('rejects if not in SUBMIT', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'DOWNLOAD' });

      await expect(service.startOpening('p1')).rejects.toThrow(ConflictException);
    });
  });

  describe('decryptSupplier', () => {
    beforeEach(() => {
      prisma.$transaction = jest.fn(async (callback: any) => callback(prisma));
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs-1', projectId: 'p1', supplierName: '测试供应商' });
      prisma.bidSupplier.update.mockResolvedValue({ id: 'bs-1', decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED' });
      prisma.bidSupplier.findUnique.mockResolvedValue({ id: 'bs-1', decryptStatus: 'DANGER' });
      prisma.bidOpeningRecord.create.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});
    });

    it('succeeds deterministically by default', async () => {
      const result = await service.decryptSupplier('p1', 'bs-1', {} as any);

      expect(result).toBeDefined();
      expect(prisma.bidSupplier.update).toHaveBeenCalledWith({
        where: { id: 'bs-1' },
        data: { decryptStatus: 'SUCCESS' },
      });
      expect(prisma.bidSupplier.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ decryptStatus: 'DANGER' }) }),
      );
    });

    it('simulates danger only when explicitly requested', async () => {
      await service.decryptSupplier('p1', 'bs-1', { simulateDanger: true } as any);

      expect(prisma.bidSupplier.update).toHaveBeenCalledWith({
        where: { id: 'bs-1' },
        data: expect.objectContaining({ decryptStatus: 'DANGER' }),
      });
    });

    it('creates a pending opening record and leaves BidSupplier confirmStatus PENDING', async () => {
      await service.decryptSupplier('p1', 'bs-1', {
        amount: '100', period: '30天', qualityTarget: '合格', bondStatus: '已缴纳',
      } as any);

      expect(prisma.bidOpeningRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ bidSupplierId: 'bs-1', confirmStatus: '待供应商确认' }),
        }),
      );
      expect(prisma.bidSupplier.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ confirmStatus: 'PENDING' }) }),
      );
      expect(prisma.bidSupplier.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ confirmStatus: 'CONFIRMED' }) }),
      );
    });
  });

  describe('resolveOpeningDispute', () => {
    it('updates record handle result and BidSupplier status on confirm', async () => {
      prisma.bidOpeningRecord.findFirst.mockResolvedValue({
        id: 'r1', projectId: 'p1', supplierName: '测试供应商', bidSupplierId: 'bs-1',
      });
      prisma.bidOpeningRecord.update.mockResolvedValue({});
      prisma.bidOpeningRecord.findUnique.mockResolvedValue({ id: 'r1', confirmStatus: '异议已处理-确认' });
      prisma.bidSupplier.update.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      await service.resolveOpeningDispute('p1', 'r1', { result: '经核实无误', confirm: true });

      expect(prisma.bidOpeningRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'r1' }, data: expect.objectContaining({ handleResult: '经核实无误', confirmStatus: '异议已处理-确认' }) }),
      );
      expect(prisma.bidSupplier.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ confirmStatus: 'CONFIRMED' }) }),
      );
    });

    it('sets BidSupplier EXCEPTION when dispute is not confirmed', async () => {
      prisma.bidOpeningRecord.findFirst.mockResolvedValue({
        id: 'r1', projectId: 'p1', supplierName: '测试供应商', bidSupplierId: 'bs-1',
      });
      prisma.bidOpeningRecord.update.mockResolvedValue({});
      prisma.bidOpeningRecord.findUnique.mockResolvedValue({ id: 'r1' });
      prisma.bidSupplier.update.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      await service.resolveOpeningDispute('p1', 'r1', { result: '异议成立', confirm: false });

      expect(prisma.bidSupplier.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ confirmStatus: 'EXCEPTION' }) }),
      );
    });

    it('rejects when record not found', async () => {
      prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);
      await expect(service.resolveOpeningDispute('p1', 'r1', { result: 'x', confirm: true }))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('generateEvaluationResults', () => {
    it('rejects until all experts confirm reports', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', stage: 'EVALUATING', name: '测试项目',
        experts: [{ id: 'e1', reportConfirmed: false }, { id: 'e2', reportConfirmed: true }],
        suppliers: [],
      });

      await expect(service.generateEvaluationResults('p1'))
        .rejects.toMatchObject({ response: { code: 'EXPERT_REPORTS_NOT_CONFIRMED' } });
    });

    it('rejects when project is not EVALUATING', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'OPENING', name: 'x', experts: [], suppliers: [] });
      await expect(service.generateEvaluationResults('p1'))
        .rejects.toMatchObject({ response: { code: 'PROJECT_NOT_EVALUATING' } });
    });

    it('ranks suppliers by average score and recommends the top supplier', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', stage: 'EVALUATING', name: '测试项目',
        experts: [{ id: 'e1', reportConfirmed: true }, { id: 'e2', reportConfirmed: true }],
        suppliers: [
          { id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
          { id: 's2', supplierName: '乙', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
          { id: 's3', supplierName: '丙', decryptStatus: 'SUCCESS', submitStatus: '已撤回', confirmStatus: 'CONFIRMED' },
        ],
      });
      prisma.bidScoreRecord.findMany.mockImplementation((args: any) =>
        Promise.resolve(args.where.supplierId === 's1' ? [{ score: 90 }, { score: 80 }] : [{ score: 70 }, { score: 60 }]),
      );
      prisma.bidEvaluationResult.deleteMany.mockResolvedValue({ count: 0 });
      prisma.bidEvaluationResult.createMany.mockResolvedValue({ count: 2 });
      prisma.bidEvaluationResult.findMany.mockResolvedValue([
        { supplierName: '甲', rank: 1, recommended: true, averageScore: 85 },
        { supplierName: '乙', rank: 2, recommended: false, averageScore: 65 },
      ]);
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      const results = await service.generateEvaluationResults('p1');

      expect(prisma.bidEvaluationResult.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ supplierId: 's1', rank: 1, recommended: true }),
            expect.objectContaining({ supplierId: 's2', rank: 2, recommended: false }),
          ]),
        }),
      );
      // 撤回供应商 s3 不参与结果
      const created = prisma.bidEvaluationResult.createMany.mock.calls[0][0].data as any[];
      expect(created.find((r: any) => r.supplierId === 's3')).toBeUndefined();
      expect(results[0].supplierName).toBe('甲');
    });
  });

  describe('archiveAll', () => {
    it('auto-creates standard archive items when none exist', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', name: '测试项目' });
      prisma.bidArchiveItem.findFirst.mockResolvedValue(null);
      prisma.bidArchiveItem.create.mockResolvedValue({});
      prisma.bidArchiveItem.findMany.mockResolvedValue([{ id: 'a1', status: 'PENDING_CONFIRM' }]);
      prisma.bidArchiveItem.updateMany.mockResolvedValue({ count: 7 });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'ARCHIVED' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.$transaction = jest.fn(async (ops: any[]) => Promise.all(ops));

      await service.archiveAll('p1');

      expect(prisma.bidArchiveItem.create).toHaveBeenCalled();
      expect(prisma.bidArchiveItem.create.mock.calls.length).toBeGreaterThanOrEqual(7);
    });

    it('uses transaction for atomic archive + stage update + supervision log', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', name: '测试项目' });
      prisma.bidArchiveItem.findMany.mockResolvedValue([
        { id: 'a1', status: 'PENDING_CONFIRM' },
      ]);

      const txCalls: any[][] = [];
      prisma.$transaction = jest.fn(async (ops: any[]) => {
        txCalls.push(ops);
        // Simulate the operations
        await Promise.all(ops);
      });
      prisma.bidArchiveItem.updateMany = jest.fn().mockResolvedValue({ count: 1 });
      prisma.bidProject.update = jest.fn().mockResolvedValue({ id: 'p1', stage: 'ARCHIVED' });
      prisma.bidSupervisionLog.create = jest.fn().mockResolvedValue({});
      prisma.bidProject.findUnique = jest.fn().mockResolvedValue({ id: 'p1', stage: 'ARCHIVED', archiveItems: [] });

      const result = await service.archiveAll('p1');

      // Verify $transaction was called with batch operations (3 elements now)
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(txCalls.length).toBe(1);
      expect(txCalls[0].length).toBe(3); // updateMany + update + supervisionLog.create
    });

    it('rejects if not in EVALUATING', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '测试项目' });

      await expect(service.archiveAll('p1')).rejects.toThrow(ConflictException);
    });
  });

  describe('submitScore', () => {
    it('validates expert belongs to project', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue(null); // expert not in project

      await expect(service.submitScore('p1', {
        expertId: 'exp-999', scoreItemId: 'si-1', supplierId: 'sup-1', score: 10,
      })).rejects.toThrow(BadRequestException);
    });

    it('validates scoreItem belongs to project', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1' });
      prisma.bidScoreItem.findFirst.mockResolvedValue(null); // scoreItem not in project

      await expect(service.submitScore('p1', {
        expertId: 'exp-1', scoreItemId: 'si-999', supplierId: 'sup-1', score: 10,
      })).rejects.toThrow(BadRequestException);
    });

    it('upserts score record on valid input', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1' });
      prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'si-1' });
      prisma.bidScoreRecord.upsert.mockResolvedValue({ id: 'sr-1', score: 10 });

      const result = await service.submitScore('p1', {
        expertId: 'exp-1', scoreItemId: 'si-1', supplierId: 'sup-1', score: 10, reason: 'good',
      });

      expect(prisma.bidScoreRecord.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { expertId_scoreItemId_supplierId: { expertId: 'exp-1', scoreItemId: 'si-1', supplierId: 'sup-1' } },
          update: { score: 10, reason: 'good' },
          create: expect.objectContaining({ expertId: 'exp-1', scoreItemId: 'si-1', supplierId: 'sup-1', score: 10, reason: 'good' }),
        }),
      );
    });
  });

  describe('startEvaluation', () => {
    it('transitions OPENING → EVALUATING and writes supervision log', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '测试项目' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'EVALUATING' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      const result = await service.startEvaluation('p1');
      expect(result.stage).toBe('EVALUATING');
      expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: '启动评标 (OPENING→EVALUATING)' }),
        }),
      );
    });
  });

  describe('decryptSupplier', () => {
    it('writes supervision log on successful decrypt', async () => {
      const logCreate = jest.fn().mockResolvedValue({});
      prisma.$transaction = jest.fn(async (fn: any) => {
        const tx = {
          bidSupplier: {
            findFirst: jest.fn().mockResolvedValue({ id: 'bs-1', supplierName: '供应商A' }),
            update: jest.fn().mockResolvedValue({ id: 'bs-1', decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED' }),
            findUnique: jest.fn().mockResolvedValue({ id: 'bs-1', decryptStatus: 'DANGER' }),
          },
          bidOpeningRecord: { create: jest.fn().mockResolvedValue({}) },
          bidSupervisionLog: { create: logCreate },
        };
        return fn(tx);
      });

      // Force non-danger outcome by mocking Math.random
      const origRandom = Math.random;
      Math.random = () => 0.5; // > 0.05, so not DANGER

      const result = await service.decryptSupplier('p1', 'bs-1');

      expect(logCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: '标书解密', riskFlag: '无' }),
        }),
      );

      Math.random = origRandom;
    });
  });

  describe('submitBid — 投标提交规则', () => {
    it('项目不存在时拒绝提交', async () => {
      prisma.bidProject.findUnique.mockResolvedValue(null);

      await expect(service.submitBid('p1', { supplierName: '测试供应商' }))
        .rejects.toThrow(BadRequestException);
    });

    it('项目不在投标阶段时拒绝提交', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', deadline: new Date('2099-12-31') });

      await expect(service.submitBid('p1', { supplierName: '测试供应商' }))
        .rejects.toThrow(BadRequestException);
    });

    it('投标截止时间已过时拒绝提交', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT', deadline: new Date('2020-01-01') });

      await expect(service.submitBid('p1', { supplierName: '测试供应商' }))
        .rejects.toThrow(BadRequestException);
    });

    it('供应商已提交时拒绝重复提交', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT', deadline: new Date('2099-12-31') });
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs-1', submitStatus: '已提交' });

      await expect(service.submitBid('p1', { supplierName: '测试供应商' }))
        .rejects.toThrow(BadRequestException);
    });

    it('DOWNLOAD 阶段允许提交', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'DOWNLOAD', deadline: new Date('2099-12-31') });
      prisma.bidSupplier.findFirst.mockResolvedValue(null);
      prisma.bidSupplier.create.mockResolvedValue({ id: 'bs-1', submitStatus: '已提交' });

      const result = await service.submitBid('p1', { supplierName: '测试供应商' });
      expect(result).toBeDefined();
      expect(prisma.bidSupplier.create).toHaveBeenCalled();
    });

    it('SUBMIT 阶段允许提交', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT', deadline: new Date('2099-12-31') });
      prisma.bidSupplier.findFirst.mockResolvedValue(null);
      prisma.bidSupplier.create.mockResolvedValue({ id: 'bs-1', submitStatus: '已提交' });

      const result = await service.submitBid('p1', { supplierName: '测试供应商' });
      expect(result).toBeDefined();
    });
  });
});

/* ── 集成测试：decryptSupplier 真实校验（无文件引用 → SUCCESS，保持开标流程不空指针）── */

describe('BidService — decryptSupplier 真实校验', () => {
  it('无投标文件引用时仍返回 SUCCESS（保持开标流程）', async () => {
    const tx: any = {
      bidSupplier: {
        findFirst: jest.fn(async () => ({ id: 'bs1', projectId: 'p1', supplierName: 'S1' })),
        update: jest.fn(async ({ data }: any) => ({
          id: 'bs1', supplierName: 'S1',
          decryptStatus: data.decryptStatus ?? 'SUCCESS',
          confirmStatus: 'PENDING',
        })),
        findUnique: jest.fn(async () => ({ id: 'bs1', supplierName: 'S1', decryptStatus: 'SUCCESS' })),
      },
      bidOpeningRecord: { create: jest.fn() },
      bidSupervisionLog: { create: jest.fn() },
    };
    const prisma: any = { $transaction: jest.fn(async (cb: any) => cb(tx)) };
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn() } },
        { provide: BidGateway, useValue: { notifyDecryptStatus: jest.fn() } },
        BidService,
      ],
    }).compile();
    const service = module.get(BidService);

    const res = await service.decryptSupplier('p1', 'bs1');
    expect(res).not.toBeNull();
    expect(res!.decryptStatus).toBe('SUCCESS');
    expect(tx.bidSupplier.update).toHaveBeenCalled();
    expect(tx.bidSupervisionLog.create).toHaveBeenCalled();
  });
});
