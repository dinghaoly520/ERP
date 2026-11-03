import { GlobalOverviewTool } from './global-overview.tool';

/** 2026-11-03 用户裁定：阶段分布以采购流程（PMI currentStage）为准——
 *  「招标项目阶段分布」（BidProject 投标执行阶段 + ABORTED 英文泄漏）完全错误 */
function makeTool() {
  const groupBy = jest.fn();
  const prisma: any = {
    procurementProject: { count: jest.fn().mockResolvedValue(6), groupBy: jest.fn().mockResolvedValue([{ status: 'BIDDING', _count: 6, _sum: { budget: 100 } }]) },
    bidProject: { count: jest.fn().mockResolvedValue(21) },
    supplier: { count: jest.fn().mockResolvedValue(508), groupBy: jest.fn().mockResolvedValue([{ status: 'APPROVED', _count: 496 }]) },
    expertProfile: { count: jest.fn().mockResolvedValue(180), groupBy: jest.fn().mockResolvedValue([{ specialty: '水利', _count: 90 }]) },
    announcement: { count: jest.fn().mockResolvedValue(30) },
    projectManagementItem: {
      groupBy: jest.fn().mockResolvedValue([
        { currentStage: 'TENDER_DOCUMENT', _count: 10 },
        { currentStage: 'BID_EVALUATION', _count: 9 },
        { currentStage: null, _count: 2 },
      ]),
    },
  };
  return { prisma, tool: new GlobalOverviewTool(prisma) };
}

it('阶段分布卡取 PMI currentStage（采购流程步骤），标题为「采购阶段分布（在办）」', async () => {
  const { prisma, tool } = makeTool();
  const r = await tool.execute({}, { user: { sub: 'u', role: 'admin', companyId: null } });
  expect(prisma.projectManagementItem.groupBy).toHaveBeenCalledWith(
    expect.objectContaining({ by: ['currentStage'] }),
  );
  const stageCard = (r.cards as Array<Record<string, unknown>>).find((c) => String(c.title).includes('采购阶段分布'));
  expect(stageCard).toBeTruthy();
  const rows = stageCard!.rows as Array<Record<string, unknown>>;
  expect(rows[0]).toEqual({ 阶段: '采购文件', 项目数: 10, 占比: '47.6%' });
  expect(rows[1]).toEqual({ 阶段: '开标评标', 项目数: 9, 占比: '42.9%' });
  expect(rows[2]).toEqual({ 阶段: '未设置', 项目数: 2, 占比: '9.5%' });
  expect((rows[rows.length - 1] as Record<string, unknown>)._total).toBe(true);
  expect(stageCard!.viz).toEqual({ kind: 'distribution', category: '阶段', value: '项目数' });
});

it('不再产出「招标项目阶段分布」卡；BidProject 阶段不进全局概览', async () => {
  const { tool } = makeTool();
  const r = await tool.execute({}, { user: { sub: 'u', role: 'admin', companyId: null } });
  expect((r.cards as Array<Record<string, unknown>>).some((c) => c.title === '招标项目阶段分布')).toBe(false);
});

it('全局概览统计行「招标项目」改「投标项目」（采购口径）', async () => {
  const { tool } = makeTool();
  const r = await tool.execute({}, { user: { sub: 'u', role: 'admin', companyId: null } });
  const overview = (r.cards as Array<Record<string, unknown>>).find((c) => c.title === '全局概览统计');
  const items = (overview!.rows as Array<Record<string, unknown>>).map((x) => x.item);
  expect(items).toContain('投标项目');
  expect(items).not.toContain('招标项目');
});
