import { ProcurementTool } from './procurement.tool';

/** 2026-11-04 台账工具翻新：数据源从旧立项表（全库 1 行死轨）改为轮次表
 *  ProcurementRound（台账页真实数据源）——轮次清单/区间汇总/待处理/异常/月度/
 *  方式成交/供应商排行。2026-11-03 F14 的月度计数语义保留并补金额列。 */
function makeTool() {
  const prisma: any = {
    procurementRound: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { budgetAmount: null, awardAmount: null } }),
    },
  };
  return { prisma, tool: new ProcurementTool(prisma) };
}

const ADMIN = { user: { sub: 'u', role: 'admin', companyId: null } };

it('monthly：台账轮次按采购日期本地月度计数 + 成交额列，趋势 viz', async () => {
  const { prisma, tool } = makeTool();
  prisma.procurementRound.findMany.mockResolvedValue([
    { procurementDate: new Date('2026-09-05'), awardAmount: 1000000 },
    { procurementDate: new Date('2026-10-03'), awardAmount: null },
    { procurementDate: new Date('2026-10-21'), awardAmount: 500000 },
    { procurementDate: null, awardAmount: 1 },
  ]);
  const r = await tool.execute({ action: 'monthly' }, ADMIN);
  expect(prisma.procurementRound.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ isRecycled: false }),
      select: { procurementDate: true, awardAmount: true },
    }),
  );
  const card = (r.cards as Array<Record<string, unknown>>)[0];
  expect(card.title).toBe('采购月度趋势（台账轮次）');
  // 时间升序 + 无日期轮不计 + 成交额万位格式
  expect(card.rows).toEqual([
    { 月份: '2026-09', 轮次: 1, 成交额: '100.0万' },
    { 月份: '2026-10', 轮次: 2, 成交额: '50.0万' },
  ]);
  expect(card.viz).toEqual({ kind: 'trend', value: '轮次', timeField: '月份' });
});

it('monthly：公司口径随 ctx（leader 本公司轮次；totalData=全库）', async () => {
  const { prisma, tool } = makeTool();
  await tool.execute({ action: 'monthly' }, { user: { sub: 'u', role: 'leader', companyId: 'co-1' } });
  expect(prisma.procurementRound.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ companyId: 'co-1' }) }),
  );
  await tool.execute({ action: 'monthly' }, { totalData: true } as never);
  expect(prisma.procurementRound.findMany).toHaveBeenLastCalledWith(
    expect.objectContaining({ where: expect.not.objectContaining({ companyId: expect.anything() }) }),
  );
});

it('list：轮次清单默认采购日期降序 NULLS LAST（无日期轮次不再置顶）', async () => {
  const { prisma, tool } = makeTool();
  prisma.procurementRound.findMany.mockResolvedValue([
    {
      project: { name: '数字化转型咨询服务' },
      procurementMethod: '竞争性谈判',
      procurementDate: new Date('2026-08-09'),
      budgetAmount: 1560000,
      awardAmount: 1560000,
      resultStatus: 'AWARDED',
    },
  ]);
  const r = await tool.execute({ action: 'list' }, ADMIN);
  expect(prisma.procurementRound.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      orderBy: [{ procurementDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    }),
  );
  const card = (r.cards as Array<Record<string, unknown>>)[0];
  expect(card.title).toBe('台账轮次清单（1 个）');
  expect((card.rows as Array<Record<string, unknown>>)[0]).toMatchObject({
    项目: '数字化转型咨询服务',
    结果: '已成交',
    成交额: '156.0万',
  });
});

it('pending：查轮次 resultStatus=PENDING（页面同口径），标题带压预算合计', async () => {
  const { prisma, tool } = makeTool();
  prisma.procurementRound.findMany.mockResolvedValue([
    {
      project: { name: '水电站增效扩容水轮发电机组' },
      procurementMethod: '公开招标',
      budgetAmount: 6800000,
      resultStatus: 'PENDING',
    },
  ]);
  const r = await tool.execute({ action: 'pending' }, ADMIN);
  expect(prisma.procurementRound.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ resultStatus: 'PENDING' }) }),
  );
  const card = (r.cards as Array<Record<string, unknown>>)[0];
  expect(card.title).toBe('待处理轮次（1 个，压预算 680.0万）');
});

it('abnormal：异常四态清单 + 终止原因列', async () => {
  const { prisma, tool } = makeTool();
  prisma.procurementRound.findMany.mockResolvedValue([
    {
      project: { name: '某终止项目' },
      procurementMethod: '询比采购',
      budgetAmount: 300000,
      resultStatus: 'CANCELLED',
      terminationReason: '需求变更终止',
    },
  ]);
  const r = await tool.execute({ action: 'abnormal' }, ADMIN);
  expect(prisma.procurementRound.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ resultStatus: { in: expect.arrayContaining(['CANCELLED']) } }),
    }),
  );
  const card = (r.cards as Array<Record<string, unknown>>)[0];
  expect(card.title).toBe('异常/终止轮次（1 个）');
  expect((card.rows as Array<Record<string, unknown>>)[0]).toMatchObject({
    结果: '已取消',
    原因: '需求变更终止',
  });
});

it('stats：节资仅计已成交轮（PENDING 在途预算不虚增），结果分布带中文标签', async () => {
  const { prisma, tool } = makeTool();
  prisma.procurementRound.groupBy.mockResolvedValue([
    { resultStatus: 'AWARDED', _count: 4, _sum: { budgetAmount: 7590000 } },
    { resultStatus: 'PENDING', _count: 3, _sum: { budgetAmount: 19300000 } },
  ]);
  prisma.procurementRound.aggregate.mockResolvedValue({
    _sum: { budgetAmount: 7590000, awardAmount: 7499000 },
  });
  const r = await tool.execute({ action: 'stats', startDate: '2026-01-01' }, ADMIN);
  // 节资聚合限 AWARDED + 金额为正
  expect(prisma.procurementRound.aggregate).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ resultStatus: 'AWARDED', budgetAmount: { gt: 0 } }),
    }),
  );
  const metric = (r.cards as Array<Record<string, unknown>>)[0];
  expect(metric.type).toBe('metric');
  expect((metric.metrics as Array<{ label: string; value: string }>).map((m) => `${m.label}=${m.value}`)).toEqual([
    '轮次=7',
    '成交总额=749.9万',
    '节资=9.1万',
    '节资率=1.2%',
  ]);
  const dist = (r.cards as Array<Record<string, unknown>>)[1];
  expect((dist.rows as Array<Record<string, unknown>>)[0]).toMatchObject({ 结果: '已成交', 轮次: 4 });
});

it('limit 钳制：LLM 传大数不爆表（上限 20）', async () => {
  const { prisma, tool } = makeTool();
  await tool.execute({ action: 'list', limit: 100000 }, ADMIN);
  expect(prisma.procurementRound.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ take: 20 }),
  );
});
