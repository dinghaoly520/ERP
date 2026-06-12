import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { BidService } from './bid.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

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
      bidExpert: { groupBy: jest.fn() },
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

  describe('assertStageTransition (via updateProject)', () => {
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

    it('rejects DOWNLOAD → ARCHIVED (skip stages)', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'DOWNLOAD' });

      await expect(service.updateProject('p1', { stage: 'ARCHIVED' as any }))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects ARCHIVED → DOWNLOAD (backward)', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'ARCHIVED' });

      await expect(service.updateProject('p1', { stage: 'DOWNLOAD' as any }))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects same-stage transition', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT' });

      await expect(service.updateProject('p1', { stage: 'SUBMIT' as any }))
        .rejects.toThrow(BadRequestException);
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

      await expect(service.startOpening('p1')).rejects.toThrow(BadRequestException);
    });
  });
});
