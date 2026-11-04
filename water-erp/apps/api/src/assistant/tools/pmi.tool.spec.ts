import { PmiTool } from './pmi.tool';

/** 2026-11-04 用户裁定「采购项目=PMI、除邀请招标外都是采购」——本工具补齐 PMI
 *  清单/详情（此前只有 global_overview 计数，清单类提问会被误导去台账轮次工具） */
function makeTool() {
  const prisma: any = {
    projectManagementItem: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), groupBy: jest.fn().mockResolvedValue([]) },
  };
  return { prisma, tool: new PmiTool(prisma) };
}

const ADMIN = { user: { sub: 'u', role: 'admin', companyId: null } };

it('list：阶段/状态用 canon 中文标签，默认排除回收站', async () => {
  const { prisma, tool } = makeTool();
  prisma.projectManagementItem.findMany.mockResolvedValue([
    {
      id: 'p1',
      title: '智慧水利大数据平台建设',
      procurementMethod: '谈判采购',
      currentStage: 'BID_EVALUATION',
      status: 'ACTIVE',
      budgetAmount: 12000000,
      companyName: '设计院',
    },
  ]);
  const r = await tool.execute({ action: 'list' }, ADMIN);
  expect(prisma.projectManagementItem.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ status: { not: 'RECYCLED' } }),
      orderBy: { updatedAt: 'desc' },
    }),
  );
  const card = (r.cards as Array<Record<string, unknown>>)[0];
  expect(card.title).toBe('采购项目清单（1 个）');
  expect((card.columns as Array<{ key: string }>).map((c) => c.key)).toEqual(['项目', '方式', '阶段', '预算', '状态']);
  expect((card.rows as Array<Record<string, unknown>>)[0]).toMatchObject({
    阶段: '开标评标',
    状态: '在办',
    预算: '1200.0万',
  });
});

it('list：中文阶段名反查 canon 键（LLM 常给中文），公司口径随 ctx', async () => {
  const { prisma, tool } = makeTool();
  await tool.execute({ action: 'list', stage: '开标评标' }, { user: { sub: 'u', role: 'leader', companyId: 'co-1' } });
  expect(prisma.projectManagementItem.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ currentStage: 'BID_EVALUATION', companyId: 'co-1' }),
    }),
  );
});

it('list：方式简写 contains 容错（LLM 传「谈判」匹配「谈判采购」）', async () => {
  const { prisma, tool } = makeTool();
  await tool.execute({ action: 'list', method: '谈判' }, ADMIN);
  expect(prisma.projectManagementItem.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ OR: expect.arrayContaining([expect.objectContaining({ procurementMethod: { contains: '谈判' } })]) }),
    }),
  );
});

it('list：阶段简写多命中取全集（「开标」→ 开标评标 in 查询）', async () => {
  const { prisma, tool } = makeTool();
  await tool.execute({ action: 'list', stage: '开标' }, ADMIN);
  const call = prisma.projectManagementItem.findMany.mock.calls[0][0];
  expect(JSON.stringify(call.where)).toContain('\"in\":[\"BID_EVALUATION\"]');
});

it('detail：全字段中文标签（含终止原因条件行）', async () => {
  const { prisma, tool } = makeTool();
  prisma.projectManagementItem.findFirst.mockResolvedValue({
    title: '某终止项目',
    projectCode: 'SWHI-TP-2026101901',
    procurementMethod: '询比采购',
    currentStage: 'CONTRACT',
    status: 'TERMINATED',
    budgetAmount: 500000,
    contractAmount: null,
    initiationDate: new Date('2026-09-01'),
    awardedSupplier: null,
    companyName: '设计院',
    terminationReason: '需求取消',
  });
  const r = await tool.execute({ action: 'detail', projectId: 'pmi-1' }, ADMIN);
  const rows = ((r.cards as Array<Record<string, unknown>>)[0].rows as Array<Record<string, string>>);
  const map = Object.fromEntries(rows.map((x) => [x['项'], x['值']]));
  expect(map['当前阶段']).toBe('合同');
  expect(map['状态']).toBe('已终止');
  expect(map['终止原因']).toBe('需求取消');
  expect(map['预算']).toBe('50.0万');
});

it('stats：多维度——概览/方式/归属公司（含预算合计）三卡', async () => {
  const { prisma, tool } = makeTool();
  prisma.projectManagementItem.groupBy.mockImplementation(({ by }: any) =>
    by[0] === 'procurementMethod'
      ? Promise.resolve([
          { procurementMethod: '谈判采购', _count: 8 },
          { procurementMethod: '邀请招标', _count: 3 },
        ])
      : Promise.resolve([
          { status: 'ACTIVE', _count: 23 },
          { status: 'ARCHIVED', _count: 3 },
        ]),
  );
  prisma.projectManagementItem.findMany.mockResolvedValue([
    { companyName: '设计院', budgetAmount: 1000000 },
    { companyName: '设计院', budgetAmount: 500000 },
    { companyName: null, budgetAmount: 200000 },
  ]);
  const r = await tool.execute({ action: 'stats' }, ADMIN);
  const cards = r.cards as Array<Record<string, unknown>>;
  expect(cards.map((c) => c.title)).toEqual(['采购项目概览（PMI）', '采购方式分布', '归属公司分布（含预算）']);
  const companyRows = cards[2].rows as Array<Record<string, unknown>>;
  expect(companyRows[0]).toEqual({ company: '设计院', count: 2, budget: '150.0万' });
  expect(companyRows[1]).toEqual({ company: '未归属', count: 1, budget: '20.0万' });
});

it('limit 钳制（上限 20）', async () => {
  const { prisma, tool } = makeTool();
  await tool.execute({ action: 'list', limit: 99999 }, ADMIN);
  expect(prisma.projectManagementItem.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ take: 20 }),
  );
});
