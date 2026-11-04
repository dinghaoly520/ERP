import { AnnouncementTool } from './announcement.tool';

/** 2026-11-04 首个 spec：stats 多维度（概览/类型分布/发布趋势——用户裁定
 *  「分布类=多结构全维度」）；list 出卡（此前裸 data）。 */
function makeTool() {
  const prisma: any = {
    announcement: {
      // stats=单查询内存聚合（PUBLIC_WHERE 的 metadata.path 不支持 groupBy）
      count: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn().mockResolvedValue([
        { type: 'BID_NOTICE', publishDate: new Date(2026, 8, 5), status: 'PUBLISHED', dataClass: null, metadata: null },
        { type: 'BID_NOTICE', publishDate: new Date(2026, 9, 3), status: 'PUBLISHED', dataClass: null, metadata: null },
        { type: 'BID_NOTICE', publishDate: new Date(2026, 9, 21), status: 'PUBLISHED', dataClass: null, metadata: null },
        { type: 'WIN_NOTICE', publishDate: null, status: 'PUBLISHED', dataClass: null, metadata: null },
        { type: 'WIN_NOTICE', publishDate: new Date(2026, 9, 10), status: 'PUBLISHED', dataClass: null, metadata: null },
        // RESTRICTED 一篇：内存过滤应剔除（不入统计）
        { type: 'WIN_NOTICE', publishDate: new Date(2026, 9, 11), status: 'PUBLISHED', dataClass: null, metadata: { visibility: 'RESTRICTED' } },
      ]),
      findUnique: jest.fn(),
    },
  };
  return { prisma, tool: new AnnouncementTool(prisma) };
}

const ADMIN = { user: { sub: 'u', role: 'admin', companyId: null } };

it('stats：三卡——概览 metric/类型分布/发布趋势（单查询内存聚合，本地时区切月）', async () => {
  const { tool } = makeTool();
  const r = await tool.execute({ action: 'stats' }, ADMIN);
  const cards = r.cards as Array<Record<string, unknown>>;
  expect(cards.map((c) => c.title)).toEqual(['公告概览', '按类型分布', '发布趋势（近12个月）']);
  const metrics = (cards[0].metrics as Array<{ label: string; value: string }>).map((m) => `${m.label}=${m.value}`);
  expect(metrics).toEqual(['已发布公告=5']); // RESTRICTED 一篇被 isPubliclyVisible 剔除
  const typeRows = cards[1].rows as Array<Record<string, unknown>>;
  expect(typeRows[0]).toEqual({ type: '采购公告', count: 3, pct: '60.0%' });
  expect(typeRows[1]).toEqual({ type: '成交公告', count: 2, pct: '40.0%' });
  const trendRows = cards[2].rows as Array<Record<string, unknown>>;
  expect(trendRows).toEqual([
    { 月份: '2026-09', 篇数: 1 },
    { 月份: '2026-10', 篇数: 3 },
  ]);
  expect(cards[2].viz).toEqual({ kind: 'trend', value: '篇数', timeField: '月份' });
});

it('list：出卡（标题/类型中文标签/发布日期本地格式）', async () => {
  const { prisma, tool } = makeTool();
  prisma.announcement.findMany.mockResolvedValue([
    { id: 'a1', title: '某项目采购公告', type: 'BID_NOTICE', status: 'PUBLISHED', publishDate: new Date(2026, 9, 3), viewCount: 5, isTop: false, dataClass: null, metadata: null },
  ]);
  const r = await tool.execute({ action: 'list' }, ADMIN);
  const card = (r.cards as Array<Record<string, unknown>>)[0];
  expect(card.title).toBe('公告列表（1 篇）');
  expect((card.rows as Array<Record<string, string>>)[0]).toEqual({
    title: '某项目采购公告',
    type: '采购公告',
    publishDate: '2026-10-03',
  });
});
