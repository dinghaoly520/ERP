import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { TenderHistoryService } from './tender-history.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const user = { sub: 'u1', role: 'staff' } as AuthenticatedUser;

describe('TenderHistoryService', () => {
  let service: TenderHistoryService;

  const mockPrisma = {
    tenderDocumentHistory: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenderHistoryService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TenderHistoryService>(TenderHistoryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockPrisma.tenderDocumentHistory.upsert.mockReset();
    mockPrisma.tenderDocumentHistory.findMany.mockReset();
    mockPrisma.tenderDocumentHistory.deleteMany.mockReset();
  });

  describe('create', () => {
    it('同内容重复保存走 content-hash upsert（不新增行）', async () => {
      mockPrisma.tenderDocumentHistory.upsert.mockResolvedValue({ id: 'h1' });
      mockPrisma.tenderDocumentHistory.findMany.mockResolvedValue([]);

      await service.create(
        { documentType: 'INTERNAL_BIDDING', title: 't', draftData: { a: '1' } },
        user,
      );

      expect(mockPrisma.tenderDocumentHistory.upsert).toHaveBeenCalledTimes(1);
      const where = (mockPrisma.tenderDocumentHistory.upsert as jest.Mock).mock
        .calls[0][0].where;
      expect(where.userId_documentType_contentHash).toMatchObject({
        userId: 'u1',
        documentType: 'INTERNAL_BIDDING',
      });
    });

    it('保存后按 (userId, documentType) 裁剪至最新 20 条', async () => {
      mockPrisma.tenderDocumentHistory.upsert.mockResolvedValue({ id: 'h21' });
      mockPrisma.tenderDocumentHistory.findMany.mockResolvedValue([
        { id: 'old1' },
        { id: 'old2' },
      ]);

      await service.create(
        { documentType: 'INTERNAL_BIDDING', title: 't', draftData: { a: '1' } },
        user,
      );

      // 溢出查询：本人 + 本类型，新→旧，跳过前 20
      expect(
        mockPrisma.tenderDocumentHistory.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', documentType: 'INTERNAL_BIDDING' },
          orderBy: { createdAt: 'desc' },
          skip: 20,
        }),
      );
      expect(mockPrisma.tenderDocumentHistory.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['old1', 'old2'] } },
      });
    });

    it('未溢出不触发删除', async () => {
      mockPrisma.tenderDocumentHistory.upsert.mockResolvedValue({ id: 'h1' });
      mockPrisma.tenderDocumentHistory.findMany.mockResolvedValue([]);

      await service.create(
        { documentType: 'INTERNAL_BIDDING', title: 't', draftData: { a: '1' } },
        user,
      );

      expect(mockPrisma.tenderDocumentHistory.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('clearMine', () => {
    it('只清当前用户该类型的全部记录（admin 也不清他人）', async () => {
      mockPrisma.tenderDocumentHistory.deleteMany.mockResolvedValue({ count: 3 });

      const result = await service.clearMine('INTERNAL_BIDDING', user);

      expect(mockPrisma.tenderDocumentHistory.deleteMany).toHaveBeenCalledWith({
        where: { documentType: 'INTERNAL_BIDDING', userId: 'u1' },
      });
      expect(result).toEqual({ cleared: true, count: 3 });
    });
  });
});
