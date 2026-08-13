import { Test, TestingModule } from '@nestjs/testing';
import { ExpertCrossConflictService } from './expert-cross-conflict.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ExpertCrossConflictService', () => {
  let service: ExpertCrossConflictService;
  let prisma: PrismaService;

  const mockPrisma = {
    expertProfile: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpertCrossConflictService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ExpertCrossConflictService>(ExpertCrossConflictService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('checkCrossConflicts', () => {
    it('同单位专家应被标记冲突', async () => {
      mockPrisma.expertProfile.findMany.mockResolvedValue([
        { userId: 'e1', employer: '四川大学', user: { displayName: '张三' } },
        { userId: 'e2', employer: '四川大学', user: { displayName: '李四' } },
        { userId: 'e3', employer: '西南交大', user: { displayName: '王五' } },
      ]);

      const result = await service.checkCrossConflicts(['e1', 'e2', 'e3']);

      expect(result).toHaveLength(2);
      expect(result).toEqual([
        { expertId: 'e1', expertName: '张三', conflictWith: '李四', conflictType: '同单位' },
        { expertId: 'e2', expertName: '李四', conflictWith: '张三', conflictType: '同单位' },
      ]);
    });

    it('空列表或单专家不产生冲突', async () => {
      let result = await service.checkCrossConflicts([]);
      expect(result).toEqual([]);

      result = await service.checkCrossConflicts(['e1']);
      expect(result).toEqual([]);

      // findMany 不应被调用
      expect(mockPrisma.expertProfile.findMany).not.toHaveBeenCalled();
    });

    it('不同单位专家无冲突', async () => {
      mockPrisma.expertProfile.findMany.mockResolvedValue([
        { userId: 'e1', employer: '四川大学', user: { displayName: '张三' } },
        { userId: 'e2', employer: '西南交大', user: { displayName: '李四' } },
      ]);

      const result = await service.checkCrossConflicts(['e1', 'e2']);

      expect(result).toEqual([]);
    });

    it('employer 为空时不应误报', async () => {
      mockPrisma.expertProfile.findMany.mockResolvedValue([
        { userId: 'e1', employer: '四川大学', user: { displayName: '张三' } },
        { userId: 'e2', employer: null, user: { displayName: '李四' } },
      ]);

      const result = await service.checkCrossConflicts(['e1', 'e2']);

      expect(result).toEqual([]);
    });

    it('雇主为空字符串时不应误报', async () => {
      mockPrisma.expertProfile.findMany.mockResolvedValue([
        { userId: 'e1', employer: '四川大学', user: { displayName: '张三' } },
        { userId: 'e2', employer: '', user: { displayName: '李四' } },
      ]);

      const result = await service.checkCrossConflicts(['e1', 'e2']);

      expect(result).toEqual([]);
    });

    it('多个冲突对应全部检测', async () => {
      mockPrisma.expertProfile.findMany.mockResolvedValue([
        { userId: 'e1', employer: '四川大学', user: { displayName: '张三' } },
        { userId: 'e2', employer: '四川大学', user: { displayName: '李四' } },
        { userId: 'e3', employer: '四川大学', user: { displayName: '王五' } },
      ]);

      const result = await service.checkCrossConflicts(['e1', 'e2', 'e3']);

      // 3选2 = 3对，每对生成2条（双向），共6条
      expect(result).toHaveLength(6);
    });

    it('displayName 缺失时退回 userId', async () => {
      mockPrisma.expertProfile.findMany.mockResolvedValue([
        { userId: 'e1', employer: '四川大学', user: null },
        { userId: 'e2', employer: '四川大学', user: null },
      ]);

      const result = await service.checkCrossConflicts(['e1', 'e2']);

      expect(result).toEqual([
        { expertId: 'e1', expertName: 'e1', conflictWith: 'e2', conflictType: '同单位' },
        { expertId: 'e2', expertName: 'e2', conflictWith: 'e1', conflictType: '同单位' },
      ]);
    });
  });
});
