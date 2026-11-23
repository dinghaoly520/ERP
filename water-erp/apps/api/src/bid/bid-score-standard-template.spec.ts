import { BidScoreStandardService } from './bid-score-standard.service';

/** U6（2026-11-23 评分标准链路审查）：模板保存重名冲突——同名同创建者此前可直接重复 create，
 *  模板列表堆积重名项。独立 spec 文件（bid.service.spec.ts 为并行会话领地，勿并入）。 */
describe('BidScoreStandardService 评分模板重名（U6）', () => {
  const prisma = {
    bidScoreItem: { findMany: jest.fn() },
    bidProject: { findUnique: jest.fn() },
    scoreTemplate: { findFirst: jest.fn(), create: jest.fn() },
  };
  const validator = {};
  const service = new BidScoreStandardService(prisma as any, validator as any);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.bidScoreItem.findMany.mockResolvedValue([
      { category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [] },
    ]);
    prisma.bidProject.findUnique.mockResolvedValue(null);
  });

  it('同名同创建者再存 → 409 TEMPLATE_NAME_EXISTS，不重复创建', async () => {
    prisma.scoreTemplate.findFirst.mockResolvedValue({ id: 'tpl-1' });
    await expect(service.saveScoreTemplate('p1', '我的模板', 'u1', '陈源远')).rejects.toMatchObject({
      response: { code: 'TEMPLATE_NAME_EXISTS' },
    });
    expect(prisma.scoreTemplate.create).not.toHaveBeenCalled();
  });

  it('同名不同创建者 → 放行创建（私有模板按创建者各自命名空间）', async () => {
    prisma.scoreTemplate.findFirst.mockResolvedValue(null);
    prisma.scoreTemplate.create.mockResolvedValue({ id: 'tpl-new' });
    await expect(service.saveScoreTemplate('p1', '我的模板', 'u2', '马岚')).resolves.toBeDefined();
    expect(prisma.scoreTemplate.create).toHaveBeenCalled();
  });
});
