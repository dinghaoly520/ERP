import { GlobalOverviewTool } from './global-overview.tool';

/** 2026-11-03 用户裁定：阶段分布以采购流程（PMI currentStage）为准——
 *  「招标项目阶段分布」（BidProject 投标执行阶段 + ABORTED 英文泄漏）完全错误。
 *  2026-11-04 用户裁定：「采购项目」数据源改 PMI（非邀请招标、不含回收站），
 *  邀请招标单列「招标项目」行——旧台账立项表（ProcurementProject）不再充当「采购项目」 */
function makeTool() {
  const prisma: any = {
    bidProject: { count: jest.fn().mockResolvedValue(21) },
    supplier: { count: jest.fn().mockResolvedValue(508), groupBy: jest.fn().mockResolvedValue([{ status: 'APPROVED', _count: 496 }]) },
    expertProfile: { count: jest.fn().mockResolvedValue(180), groupBy: jest.fn().mockResolvedValue([{ specialty: '水利', _count: 90 }]) },
    announcement: { count: jest.fn().mockResolvedValue(30) },
    projectManagementItem: {
      count: jest.fn().mockResolvedValue(6),
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

it('「采购项目」行数 PMI（非邀请招标、不含回收站），邀请招标单列「招标项目（邀请招标）」行（2026-11-04 裁定）', async () => {
  const { prisma, tool } = makeTool();
  const r = await tool.execute({}, { user: { sub: 'u', role: 'admin', companyId: null } });
  const overview = (r.cards as Array<Record<string, unknown>>).find((c) => c.title === '全局概览统计');
  const rows = overview!.rows as Array<Record<string, unknown>>;
  expect(rows.find((x) => x.item === '采购项目')).toEqual({ item: '采购项目', value: 6, note: '其中 6 个在办' });
  expect(rows.find((x) => x.item === '招标项目（邀请招标）')).toEqual({ item: '招标项目（邀请招标）', value: 6, note: '其中 6 个在办' });
  // 计数来自 PMI 且带方式过滤（mock 恒返 6，断言 where 形状）
  expect(prisma.projectManagementItem.count).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ procurementMethod: { not: '邀请招标' }, status: { not: 'RECYCLED' } }) }),
  );
  expect(prisma.projectManagementItem.count).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ procurementMethod: '邀请招标' } ) }),
  );
});

it('「采购项目状态分布」卡=PMI 状态聚合（在办/已归档标签 + budgetAmount 预算）', async () => {
  const { prisma, tool } = makeTool();
  prisma.projectManagementItem.groupBy.mockResolvedValue([
    { status: 'ACTIVE', _count: 20, _sum: { budgetAmount: 500 } },
    { status: 'ARCHIVED', _count: 3, _sum: { budgetAmount: null } },
  ]);
  const r = await tool.execute({}, { user: { sub: 'u', role: 'admin', companyId: null } });
  const statusCard = (r.cards as Array<Record<string, unknown>>).find((c) => c.title === '采购项目状态分布');
  expect(statusCard).toBeTruthy();
  const rows = statusCard!.rows as Array<Record<string, unknown>>;
  expect(rows[0]).toEqual({ status: '在办', count: 20, pct: '87.0%', budget: '¥500' });
  expect(rows[1]).toEqual({ status: '已归档', count: 3, pct: '13.0%', budget: '-' });
  expect(rows[rows.length - 1]).toMatchObject({ _total: true, status: '合计', count: 23, budget: '¥500' });
  // 状态聚合同样排除邀请招标与回收站
  expect(prisma.projectManagementItem.groupBy).toHaveBeenCalledWith(
    expect.objectContaining({
      by: ['status'],
      where: expect.objectContaining({ procurementMethod: { not: '邀请招标' }, status: { not: 'RECYCLED' } }),
    }),
  );
});
