import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { TenderDraftService } from './tender-draft.service';

describe('TenderDraftService.deleteVersion', () => {
  let service: TenderDraftService;

  const mockPrisma = {
    projectTenderDraftVersion: {
      deleteMany: jest.fn(),
    },
    projectManagementItem: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenderDraftService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TenderDraftService>(TenderDraftService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockPrisma.projectTenderDraftVersion.deleteMany.mockReset();
    mockPrisma.projectManagementItem.findUnique.mockReset();
  });

  it('round 缺省时解析 PMI currentRound，并按 id+项目+轮删除单条版本', async () => {
    mockPrisma.projectManagementItem.findUnique.mockResolvedValue({
      id: 'p1',
      currentRound: 2,
    });
    mockPrisma.projectTenderDraftVersion.deleteMany.mockResolvedValue({ count: 1 });

    const result = await service.deleteVersion('p1', 'v1');

    expect(
      mockPrisma.projectTenderDraftVersion.deleteMany,
    ).toHaveBeenCalledWith({
      where: { id: 'v1', projectId: 'p1', round: 2 },
    });
    expect(result).toEqual({ deleted: true });
  });

  it('显式 round 不重查轮次，只校验项目存在', async () => {
    mockPrisma.projectManagementItem.findUnique.mockResolvedValue({ id: 'p1' });
    mockPrisma.projectTenderDraftVersion.deleteMany.mockResolvedValue({ count: 1 });

    await service.deleteVersion('p1', 'v1', 3);

    expect(mockPrisma.projectManagementItem.findUnique).toHaveBeenCalledWith({
      where: { id: 'p1' },
      select: { id: true },
    });
    expect(mockPrisma.projectTenderDraftVersion.deleteMany).toHaveBeenCalledWith({
      where: { id: 'v1', projectId: 'p1', round: 3 },
    });
  });

  it('目标版本不存在时幂等返回 deleted:false（不抛 404）', async () => {
    mockPrisma.projectManagementItem.findUnique.mockResolvedValue({ id: 'p1' });
    mockPrisma.projectTenderDraftVersion.deleteMany.mockResolvedValue({ count: 0 });

    const result = await service.deleteVersion('p1', 'ghost', 1);

    expect(result).toEqual({ deleted: false });
  });
});
