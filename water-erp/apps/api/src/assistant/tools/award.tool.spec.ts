import { AwardTool } from './award.tool';

/** 2026-11-04 数据广度补齐：成交结果（评标定标明细）此前项目级点名不可查 */
function makeTool() {
  const prisma: any = {
    bidProject: { findFirst: jest.fn() },
    bidEvaluationResult: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { prisma, tool: new AwardTool(prisma) };
}

const ADMIN = { user: { sub: 'u', role: 'admin', companyId: null } };

it('by_project：按名定位项目 → 排名卡（报价万位+推荐/废标注）+ 价格对比卡', async () => {
  const { prisma, tool } = makeTool();
  prisma.bidProject.findFirst.mockResolvedValue({ id: 'p1', name: '岷江流域防洪治理工程勘察设计', projectCode: 'SWHI-TP-1', stage: 'ARCHIVED' });
  prisma.bidEvaluationResult.findMany.mockResolvedValue([
    { rank: 1, supplierName: '中科院成都信息技术', averageScore: 91.2, bidPrice: 4756000, recommended: true, disqualified: false },
    { rank: 2, supplierName: '某建设公司', averageScore: 85.4, bidPrice: 4800000, recommended: false, disqualified: false },
    { rank: null, supplierName: '某围标公司', averageScore: null, bidPrice: null, recommended: false, disqualified: true },
  ]);
  const r = await tool.execute({ action: 'by_project', keyword: '岷江' }, ADMIN);
  const cards = r.cards as Array<Record<string, unknown>>;
  expect(cards[0].title).toBe('岷江流域防洪治理工程勘察设计·评审排名与报价');
  const rows = cards[0].rows as Array<Record<string, unknown>>;
  expect(rows[0]).toMatchObject({ rank: 1, supplier: '中科院成都信息技术', price: '475.6万', note: '推荐中标' });
  expect(rows[2]).toMatchObject({ note: '废标' });
  expect(cards[1].title).toContain('价格对比');
});

it('recent：公司口径穿 project 关系（结果表无 companyId）', async () => {
  const { prisma, tool } = makeTool();
  await tool.execute({ action: 'recent' }, { user: { sub: 'u', role: 'leader', companyId: 'co-1' } });
  expect(prisma.bidEvaluationResult.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ project: expect.objectContaining({ companyId: 'co-1' }) }),
    }),
  );
});

it('by_project 未生成结果 → 优雅空态卡', async () => {
  const { prisma, tool } = makeTool();
  prisma.bidProject.findFirst.mockResolvedValue({ id: 'p2', name: '在办项目' });
  const r = await tool.execute({ action: 'by_project', keyword: '在办' }, ADMIN);
  const card = (r.cards as Array<Record<string, unknown>>)[0];
  expect(card.type).toBe('metric');
  expect((card.metrics as Array<{ value: string }>)[0].value).toBe('尚未生成评标结果');
});
