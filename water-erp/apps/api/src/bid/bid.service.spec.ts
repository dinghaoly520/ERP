import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { BidService } from './bid.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
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
      bidSupervisionLog: { findMany: jest.fn() },
      bidExpert: { groupBy: jest.fn(), findFirst: jest.fn() },
      bidScoreItem: { findFirst: jest.fn() },
      bidScoreRecord: { upsert: jest.fn() },
      supplier: { count: jest.fn() },
      announcement: { count: jest.fn() },
      bidSupplier: { findMany: jest.fn(), update: jest.fn(), create: jest.fn(), findFirst: jest.fn() },
      bidArchiveItem: { findMany: jest.fn(), updateMany: jest.fn() },
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
    it('transitions DOWNLOAD → SUBMIT', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'DOWNLOAD' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'SUBMIT' });

      const result = await service.openSubmission('p1');
      expect(result.stage).toBe('SUBMIT');
    });
  });

  describe('startOpening', () => {
    it('rejects if not in SUBMIT', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'DOWNLOAD' });

      await expect(service.startOpening('p1')).rejects.toThrow(ConflictException);
    });
  });

  describe('archiveAll', () => {
    it('uses transaction for atomic archive + stage update', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidArchiveItem.findMany.mockResolvedValue([
        { id: 'a1', status: 'PENDING_CONFIRM' },
      ]);

      const txCalls: any[][] = [];
      prisma.$transaction = jest.fn(async (ops: any[]) => {
        txCalls.push(ops);
        // Simulate the two operations
        await Promise.all(ops);
      });
      prisma.bidArchiveItem.updateMany = jest.fn().mockResolvedValue({ count: 1 });
      prisma.bidProject.update = jest.fn().mockResolvedValue({ id: 'p1', stage: 'ARCHIVED' });
      prisma.bidProject.findUnique = jest.fn().mockResolvedValue({ id: 'p1', stage: 'ARCHIVED', archiveItems: [] });

      const result = await service.archiveAll('p1');

      // Verify $transaction was called with batch operations
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(txCalls.length).toBe(1);
      expect(txCalls[0].length).toBe(2); // updateMany + update
    });

    it('rejects if not in EVALUATING', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });

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
});
