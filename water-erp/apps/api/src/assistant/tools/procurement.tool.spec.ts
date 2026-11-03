import { ProcurementTool } from './procurement.tool';

/** 2026-11-03 口径审计 F14：问「采购趋势/月度采购量」时全链只有 bid monthly
 *  （BidProject.createdAt 计数）可拿——投标项目数冒充采购趋势。补台账轮次月度。 */
function makeTool() {
  const prisma: any = {
    procurementProject: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
    },
    procurementRound: {
      findMany: jest.fn().mockResolvedValue([
        { procurementDate: new Date('2026-09-05') },
        { procurementDate: new Date('2026-10-03') },
        { procurementDate: new Date('2026-10-21') },
        { procurementDate: null },
      ]),
    },
  };
  return { prisma, tool: new ProcurementTool(prisma) };
}

it('monthly：台账轮次按采购日期月度计数（真实采购活动量），趋势 viz', async () => {
  const { prisma, tool } = makeTool();
  const r = await tool.execute({ action: 'monthly' }, { user: { sub: 'u', role: 'admin', companyId: null } });
  expect(prisma.procurementRound.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ isRecycled: false }),
      select: { procurementDate: true },
    }),
  );
  const card = (r.cards as Array<Record<string, unknown>>)[0];
  expect(card.title).toBe('采购月度趋势（台账轮次）');
  // 时间升序 + 无日期轮不计
  expect(card.rows).toEqual([
    { 月份: '2026-09', 轮次: 1 },
    { 月份: '2026-10', 轮次: 2 },
  ]);
  expect(card.viz).toEqual({ kind: 'trend', value: '轮次', timeField: '月份' });
});

it('monthly：公司口径随 ctx（leader 本公司轮次）', async () => {
  const { prisma, tool } = makeTool();
  await tool.execute({ action: 'monthly' }, { user: { sub: 'u', role: 'leader', companyId: 'co-1' } });
  expect(prisma.procurementRound.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ companyId: 'co-1' }) }),
  );
});
