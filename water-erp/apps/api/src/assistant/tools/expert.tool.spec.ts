import { ExpertTool } from './expert.tool';

/** 2026-11-04 用户裁定：「分布」类问题是多结构数据——专家分布不止专业一个维度，
 *  归属公司/职称/评审负荷同样是结构（admin/:3011 口径下公司维度是结构性重点）。
 *  stats 从单专业分布扩为五卡多维度；负荷=在途指派（同 expert-admin 口径）。
 *  2026-11-19 审查⑵收口：可用=库况四态派生（expert-busy-state.util 单源），
 *  死指标「占用（登记）」（镜像零写入者恒 0）已删；search/list 状态列改四态派生。 */
function makeTool() {
  const prisma: any = {
    expertProfile: {
      count: jest.fn().mockResolvedValue(3),
      groupBy: jest.fn().mockImplementation(({ by, where }: any) => {
        if (by[0] === 'availability') {
          // where 感知（模拟 DB 过滤）：util 的分母查询带 availability:{not:'停用'}
          const all = [
            { availability: '可用', _count: 3 },
            { availability: '占用', _count: 0 },
            { availability: '停用', _count: 1 }, // 临时需求方代表——不入分母
          ];
          return Promise.resolve(
            where?.availability?.not === '停用' ? all.filter((g: any) => g.availability !== '停用') : all,
          );
        }
        return Promise.resolve([
          { specialty: '水利水电工程', _count: 2 },
          { specialty: '电子信息', _count: 1 },
        ]);
      }),
      findMany: jest.fn().mockResolvedValue([
        { title: '高工', user: { company: '设计院' } },
        { title: '高工', user: { company: '设计院' } },
        { title: null, user: { company: null } },
      ]),
    },
    bidExpert: {
      // 按调用形状分流：库况派生（select 带 project）/ 负荷指派（只取 userId）
      findMany: jest.fn().mockImplementation((args: any) =>
        args?.select?.project
          ? Promise.resolve([
              { userId: 'e1', expertRole: '正选', project: { stage: 'SUBMIT' } },
              { userId: 'e2', expertRole: '候补', project: { stage: 'EVALUATING' } },
            ])
          : Promise.resolve([
              { userId: 'e1' }, { userId: 'e1' }, { userId: 'e1' }, { userId: 'e1' }, // 过载（≥4）
              { userId: 'e2' }, // 正常（1-2）
            ])),
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
  // 概览三指标（⑵收口）：死指标「占用（登记）」已删；可用=派生空闲（分母 3 − 在途 2 = 1）
  const metrics = cards[0].metrics as Array<{ label: string; value: string }>;
  expect(metrics).toEqual([
    { label: '专家总数', value: '3' },
    { label: '可用', value: '1' },
    { label: '在途评审中', value: '2' },
  ]);
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

it('stats：data.note 直述口径——可用=派生空闲、在途=实际指派；「占用（登记）」死指标不再出现', async () => {
  const { tool } = makeTool();
  const r = await tool.execute({ action: 'stats' }, ADMIN);
  const note = String((r.data as { note: string }).note);
  expect(note).toContain('在途并集');
  expect(note).not.toContain('占用'); // 镜像死指标连提示都不再出现
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

it('list：出卡（此前裸 data 无卡）；状态列=四态派生（⑵收口：镜像原文不再喂 LLM）', async () => {
  const { prisma, tool } = makeTool();
  prisma.expertProfile.findMany.mockResolvedValue([
    {
      id: 'e1', specialty: '水利水电工程', title: '高工', employer: '设计院',
      user: { displayName: '张三', bidExperts: [{ expertRole: '正选', project: { stage: 'SUBMIT' } }] },
    },
  ]);
  const r = await tool.execute({ action: 'list' }, ADMIN);
  const card = (r.cards as Array<Record<string, unknown>>)[0];
  expect(card.title).toBe('专家清单（1 名）');
  expect((card.rows as Array<Record<string, string>>)[0]).toMatchObject({
    name: '张三', specialty: '水利水电工程', state: '已被抽取',
  });
});

it('search：状态列四态派生——档案镜像「可用」的专家若在途，按真实状态显示而非 availability 原文', async () => {
  const { prisma, tool } = makeTool();
  prisma.expertProfile.findMany.mockResolvedValue([
    {
      id: 'e1', specialty: '水文', title: '高工', employer: '设计院',
      user: { displayName: '李四', bidExperts: [{ expertRole: '候补', project: { stage: 'EVALUATING' } }] },
    },
    {
      id: 'e2', specialty: '地质', title: null, employer: '局机关',
      user: { displayName: '王五', bidExperts: [] },
    },
  ]);
  const r = await tool.execute({ action: 'search' }, ADMIN);
  const rows = ((r.cards as Array<Record<string, unknown>>)[0].rows) as Array<Record<string, string>>;
  expect(rows[0]).toMatchObject({ name: '李四', state: '正在评标' });
  expect(rows[1]).toMatchObject({ name: '王五', state: '空闲' });
});
