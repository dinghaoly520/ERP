import { ExpertTool } from './expert.tool';

/** 2026-11-04 用户裁定：「分布」类问题是多结构数据——专家分布不止专业一个维度，
 *  归属公司/职称/评审负荷同样是结构（admin/:3011 口径下公司维度是结构性重点）。
 *  stats 从单专业分布扩为五卡多维度；负荷=在途指派（同 expert-admin 口径）。 */
function makeTool() {
  const prisma: any = {
    expertProfile: {
      count: jest.fn().mockResolvedValue(3),
      groupBy: jest.fn().mockResolvedValue([
        { specialty: '水利水电工程', _count: 2 },
        { specialty: '电子信息', _count: 1 },
      ]),
      findMany: jest.fn().mockResolvedValue([
        { title: '高工', user: { company: '设计院' } },
        { title: '高工', user: { company: '设计院' } },
        { title: null, user: { company: null } },
      ]),
    },
    bidExpert: {
      findMany: jest.fn().mockResolvedValue([
        { userId: 'e1' }, { userId: 'e1' }, { userId: 'e1' }, { userId: 'e1' }, // 过载（≥4）
        { userId: 'e2' }, // 正常（1-2）
      ]),
    },
  };
  return { prisma, tool: new ExpertTool(prisma) };
}

const ADMIN = { user: { sub: 'u', role: 'admin', companyId: null } };

it('stats：五卡多维度——概览/专业/归属公司/职称/评审负荷', async () => {
  const { tool } = makeTool();
  const r = await tool.execute({ action: 'stats' }, ADMIN);
  const cards = r.cards as Array<Record<string, unknown>>;
  expect(cards.map((c) => c.title)).toEqual([
    '专家资源概览',
    '专业方向分布',
    '归属公司分布',
    '职称分布',
    '评审负荷分布（在途指派）',
  ]);
  // 概览含「在途评审中」（登记占用与实际指派的判别字段）
  const metrics = cards[0].metrics as Array<{ label: string; value: string }>;
  expect(metrics.map((m) => m.label)).toContain('在途评审中');
  // 公司分布：快照名 + 未归类
  const companyRows = cards[2].rows as Array<Record<string, unknown>>;
  expect(companyRows).toEqual([
    { company: '设计院', count: 2, pct: '66.7%' },
    { company: '未归属', count: 1, pct: '33.3%' },
  ]);
  // 职称 null → 未登记
  const titleRows = cards[3].rows as Array<Record<string, unknown>>;
  expect(titleRows.find((x) => x.title === '未登记')).toEqual({ title: '未登记', count: 1, pct: '33.3%' });
  // 负荷阈值同 getLoadDistribution：≥4 过载；空闲 = 总数 − 有指派人数
  const loadRows = cards[4].rows as Array<Record<string, unknown>>;
  const loadMap = Object.fromEntries(loadRows.map((x) => [x.load, x.count]));
  expect(loadMap).toEqual({ 过载: 1, 正常: 1, 空闲: 1 });
});

it('stats：data.note 提示登记占用与在途指派的口径差（占用恒 0 判别依据）', async () => {
  const { tool } = makeTool();
  const r = await tool.execute({ action: 'stats' }, ADMIN);
  expect(String((r.data as { note: string }).note)).toContain('以在途指派为准');
});

it('stats：视野裁剪——leader 单公司视野出「所属部门分布」而非公司分布（2026-11-04 二次裁定）', async () => {
  const { prisma, tool } = makeTool();
  prisma.expertProfile.findMany.mockResolvedValue([
    { title: '高工', user: { company: '设计院', department: { name: '工程勘察院' } } },
    { title: '高工', user: { company: '设计院', department: { name: '工程勘察院' } } },
    { title: null, user: { company: '设计院', department: null } },
  ]);
  const r = await tool.execute({ action: 'stats' }, { user: { sub: 'u-2', role: 'leader', companyId: 'co-1' } });
  const cards = r.cards as Array<Record<string, unknown>>;
  expect(cards[2].title).toBe('所属部门分布');
  const rows = cards[2].rows as Array<Record<string, unknown>>;
  expect(rows[0]).toEqual({ company: '工程勘察院', count: 2, pct: '66.7%' });
  expect(rows[1]).toEqual({ company: '未分配部门', count: 1, pct: '33.3%' });
});

it('list：出卡（此前裸 data 无卡）', async () => {
  const { prisma, tool } = makeTool();
  prisma.expertProfile.findMany.mockResolvedValue([
    { id: 'e1', specialty: '水利水电工程', title: '高工', employer: '设计院', availability: '可用', user: { displayName: '张三' } },
  ]);
  const r = await tool.execute({ action: 'list' }, ADMIN);
  const card = (r.cards as Array<Record<string, unknown>>)[0];
  expect(card.title).toBe('专家清单（1 名）');
  expect((card.rows as Array<Record<string, string>>)[0]).toMatchObject({ name: '张三', specialty: '水利水电工程' });
});
