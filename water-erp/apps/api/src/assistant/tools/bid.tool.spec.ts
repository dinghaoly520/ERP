import { BidTool } from './bid.tool';

/** 2026-11-04 首个 spec：stats 多维度（概览/阶段/采购方式分布——用户裁定
 *  「分布类=多结构全维度」，此前只有阶段单维度） */
function makeTool() {
  const prisma: any = {
    bidProject: {
      groupBy: jest.fn().mockImplementation(({ by }: any) =>
        by[0] === 'stage'
          ? Promise.resolve([
              { stage: 'OPENING', _count: 1 },
              { stage: 'EVALUATING', _count: 2 },
              { stage: 'ARCHIVED', _count: 5 },
              { stage: 'ABORTED', _count: 1 },
            ])
          : Promise.resolve([
              { procurementMethod: '公开招标', _count: 6 },
              { procurementMethod: '谈判采购', _count: 3 },
            ]),
      ),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
    },
  };
  return { prisma, tool: new BidTool(prisma) };
}

const ADMIN = { user: { sub: 'u', role: 'admin', companyId: null } };

it('stats：三卡——概览（开评标进行中/已归档/已流标）/阶段分布/采购方式分布', async () => {
  const { tool } = makeTool();
  const r = await tool.execute({ action: 'stats' }, ADMIN);
  const cards = r.cards as Array<Record<string, unknown>>;
  expect(cards.map((c) => c.title)).toEqual(['投标项目概览', '投标项目阶段分布', '投标项目采购方式分布']);
  const metrics = Object.fromEntries(
    (cards[0].metrics as Array<{ label: string; value: string }>).map((m) => [m.label, m.value]),
  );
  expect(metrics).toEqual({
    项目总数: '9',
    开评标进行中: '3',
    已归档: '5',
    已流标: '1',
  });
  const stageRows = cards[1].rows as Array<Record<string, unknown>>;
  // 排序降序：首行=资料归档；在线开标用 find 断言（不依赖次序）
  expect(stageRows[0]).toMatchObject({ stage: '资料归档', count: 5 });
  expect(stageRows.find((x) => x.stage === '在线开标')).toMatchObject({ count: 1 });
  const methodRows = cards[2].rows as Array<Record<string, unknown>>;
  expect(methodRows[0]).toEqual({ method: '公开招标', count: 6, pct: '66.7%' });
});
