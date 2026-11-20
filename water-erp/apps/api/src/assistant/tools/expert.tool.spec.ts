import { ExpertTool } from './expert.tool';

/** 2026-11-04 用户裁定：「分布」类问题是多结构数据——专家分布不止专业一个维度，
 *  归属公司/职称/评审负荷同样是结构（admin/:3011 口径下公司维度是结构性重点）。
 *  stats 从单专业分布扩为五卡多维度；负荷=在途指派（同 expert-admin 口径）。
 *  2026-11-19 审查⑵收口：可用=库况四态派生（expert-busy-state.util 单源），
 *  死指标「占用（登记）」已删；search/list 状态列改四态派生。
 *  同日第一波 E2/E4：「占用」镜像值写入路径已封（PATCH profile 删字段）；
 *  search 的 availability 参数改派生语义（「可用」视同「空闲」行级后过滤）。 */
function makeTool() {
  const prisma: any = {
    expertProfile: {
      count: jest.fn().mockResolvedValue(5), // E8：全量档案 5（含停用/退库）——与库内人口分母分叉，防同值空转
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
    { label: '专家总数', value: '5' }, // E8：总数=全量档案（与分母分叉后自锁）
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
  // 负荷阈值同 getLoadDistribution：≥4 过载；空闲 = 库内可抽取人口 − 有指派人数（E8 基数收口）
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

it('search：availability="空闲" → 按派生四态后过滤（DB 侧不再按镜像列过滤）——在途专家不再冒充空闲（E4 2026-11-19）', async () => {
  const { prisma, tool } = makeTool();
  prisma.expertProfile.findMany.mockResolvedValue([
    { id: 'e1', specialty: '水文', title: '高工', employer: '设计院', user: { displayName: '李四', bidExperts: [{ expertRole: '正选', project: { stage: 'SUBMIT' } }] } },
    { id: 'e2', specialty: '地质', title: null, employer: '局机关', user: { displayName: '王五', bidExperts: [] } },
  ]);
  const r = await tool.execute({ action: 'search', availability: '空闲' }, ADMIN);
  const where = prisma.expertProfile.findMany.mock.calls[0][0].where;
  expect(where).not.toHaveProperty('availability'); // DB 侧弃镜像过滤
  const card = (r.cards as Array<Record<string, unknown>>)[0];
  // b 修复：带状态过滤的标题明示「前 N 名」（放大窗内幸存数，非全库匹配总数）
  expect(card.title).toBe('符合条件且当前空闲的专家（前 1 名）');
  const rows = card.rows as Array<Record<string, string>>;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ name: '王五', state: '空闲' });
});

it('search：availability="可用"（旧词）翻译为「空闲」同义（LLM 旧习惯容错）', async () => {
  const { prisma, tool } = makeTool();
  prisma.expertProfile.findMany.mockResolvedValue([
    { id: 'e1', specialty: '水文', title: '高工', employer: '设计院', user: { displayName: '李四', bidExperts: [{ expertRole: '正选', project: { stage: 'SUBMIT' } }] } },
    { id: 'e2', specialty: '地质', title: null, employer: '局机关', user: { displayName: '王五', bidExperts: [] } },
  ]);
  const r = await tool.execute({ action: 'search', availability: '可用' }, ADMIN);
  const rows = ((r.cards as Array<Record<string, unknown>>)[0].rows) as Array<Record<string, string>>;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ name: '王五', state: '空闲' });
});

it('search：availability="正在评标" → 按四态标签过滤命中在途专家', async () => {
  const { prisma, tool } = makeTool();
  prisma.expertProfile.findMany.mockResolvedValue([
    { id: 'e1', specialty: '水文', title: '高工', employer: '设计院', user: { displayName: '李四', bidExperts: [{ expertRole: '正选', project: { stage: 'SUBMIT' } }] } },
    { id: 'e2', specialty: '地质', title: null, employer: '局机关', user: { displayName: '王五', bidExperts: [{ expertRole: '候补', project: { stage: 'EVALUATING' } }] } },
  ]);
  const r = await tool.execute({ action: 'search', availability: '正在评标' }, ADMIN);
  const rows = ((r.cards as Array<Record<string, unknown>>)[0].rows) as Array<Record<string, string>>;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ name: '王五', state: '正在评标' });
});

it('description：教 LLM 填派生语义「空闲」——不再引导查镜像「可用状态」（E4）', () => {
  const { tool } = makeTool();
  expect(tool.description).toContain('空闲');
  expect(tool.description).not.toContain('可用状态填');
});

it('search：limit>60 带状态过滤 → take 不被 60 硬顶（a 修复：min(limit*3, max(60,limit))——旧行为给不满要求数）', async () => {
  const { prisma, tool } = makeTool();
  prisma.expertProfile.findMany.mockResolvedValue([]);
  await tool.execute({ action: 'search', availability: '空闲', limit: 80 }, ADMIN);
  expect(prisma.expertProfile.findMany.mock.calls[0][0].take).toBe(80);
});

it('search：limit 为负数（LLM 畸形输入）→ 兜底为 1 而非穿透 slice(0,负数) 截尾成空表（终评低置信#1）', async () => {
  const { prisma, tool } = makeTool();
  prisma.expertProfile.findMany.mockResolvedValue([
    { id: 'e2', specialty: '地质', title: null, employer: '局机关', user: { displayName: '王五', bidExperts: [] } },
  ]);
  const r = await tool.execute({ action: 'search', limit: -5 }, ADMIN);
  expect(prisma.expertProfile.findMany.mock.calls[0][0].take).toBe(1); // 旧代码 take=-5（Prisma 负 take=取末行）
  const rows = ((r.cards as Array<Record<string, unknown>>)[0].rows) as Array<Record<string, string>>;
  expect(rows).toHaveLength(1); // 新代码曾 slice(0,-5) 截尾成空表——兜底后不再丢行
});

it('E7：停用-ACTIVE 档案（临时需求代表等）+ 在途绑定 → list 状态列「已停用」（不冒充已被抽取）', async () => {
  const { prisma, tool } = makeTool();
  prisma.expertProfile.findMany.mockResolvedValue([
    { id: 'e1', specialty: '综合', title: null, employer: '项目部', availability: '停用', entryStatus: 'ACTIVE', user: { displayName: '临时代表甲', bidExperts: [{ expertRole: '正选', project: { stage: 'SUBMIT' } }] } },
    { id: 'e2', specialty: '水文', title: '高工', employer: '设计院', availability: '可用', entryStatus: 'ACTIVE', user: { displayName: '在职乙', bidExperts: [{ expertRole: '正选', project: { stage: 'SUBMIT' } }] } },
  ]);
  const r = await tool.execute({ action: 'list' }, ADMIN);
  const rows = ((r.cards as Array<Record<string, unknown>>)[0].rows) as Array<Record<string, string>>;
  expect(rows[0]).toMatchObject({ name: '临时代表甲', state: '已停用' });
  expect(rows[1]).toMatchObject({ name: '在职乙', state: '已被抽取' });
});

it('E7：RETIRED 档案 → search 状态列「已退库」', async () => {
  const { prisma, tool } = makeTool();
  prisma.expertProfile.findMany.mockResolvedValue([
    { id: 'e1', specialty: '地质', title: null, employer: '局机关', availability: '停用', entryStatus: 'RETIRED', user: { displayName: '王退库', bidExperts: [] } },
  ]);
  const r = await tool.execute({ action: 'search' }, ADMIN);
  const rows = ((r.cards as Array<Record<string, unknown>>)[0].rows) as Array<Record<string, string>>;
  expect(rows[0]).toMatchObject({ name: '王退库', state: '已退库' });
});

it('E7：availability="空闲" 过滤按 lifecycle 比较——停用档案（无在途）不再混入空闲结果', async () => {
  const { prisma, tool } = makeTool();
  prisma.expertProfile.findMany.mockResolvedValue([
    { id: 'e1', specialty: '综合', title: null, employer: '项目部', availability: '停用', entryStatus: 'ACTIVE', user: { displayName: '临时代表甲', bidExperts: [] } },
    { id: 'e2', specialty: '地质', title: null, employer: '局机关', availability: '可用', entryStatus: 'ACTIVE', user: { displayName: '王五', bidExperts: [] } },
  ]);
  const r = await tool.execute({ action: 'search', availability: '空闲' }, ADMIN);
  const rows = ((r.cards as Array<Record<string, unknown>>)[0].rows) as Array<Record<string, string>>;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ name: '王五', state: '空闲' });
});

it('stats：E8 口径分叉锁定——在途评审中=派生 occupied（宽松会答 4）、负荷空闲基数=库内人口、负荷查询带人口过滤', async () => {
  const { prisma, tool } = makeTool();
  // 库内可抽取人口 4（e1/e2/e3/e4）；全量档案 count 已在 base fixture 置 5（含停用/退库）
  prisma.expertProfile.groupBy.mockImplementation(({ by }: any) => {
    if (by[0] === 'availability') return Promise.resolve([{ availability: '可用', _count: 4 }]);
    return Promise.resolve([
      { specialty: '水利水电工程', _count: 2 },
      { specialty: '电子信息', _count: 1 },
    ]);
  });
  // busy 路径（select 带 project）：e1 正选 SUBMIT + e2 候补 EVALUATING → occupied=2
  // load 路径（select 无 project）：混入 e9（仅-ABORTED）与 e10（declined/池外）→ 宽松 distinct=4
  prisma.bidExpert.findMany.mockImplementation((args: any) =>
    args?.select?.project
      ? Promise.resolve([
          { userId: 'e1', expertRole: '正选', project: { stage: 'SUBMIT' } },
          { userId: 'e2', expertRole: '候补', project: { stage: 'EVALUATING' } },
        ])
      : Promise.resolve([{ userId: 'e1' }, { userId: 'e2' }, { userId: 'e9' }, { userId: 'e10' }]));
  const r = await tool.execute({ action: 'stats' }, ADMIN);
  const cards = r.cards as Array<Record<string, unknown>>;
  const metrics = cards[0].metrics as Array<{ label: string; value: string }>;
  expect(metrics).toEqual([
    { label: '专家总数', value: '5' }, // 全量档案（口径披露在 note）
    { label: '可用', value: '2' }, // 库内 4 − 在途 2
    { label: '在途评审中', value: '2' }, // 派生在途并集——宽松口径会答 4（含 ABORTED/declined/池外），锁分叉
  ]);
  // 负荷查询 where 形状：人口过滤（mock 对 where 全盲，形状断言锁回归）
  const loadCall = (prisma.bidExpert.findMany.mock.calls as Array<any[]>).find(c => !c[0].select?.project)![0];
  expect(loadCall.where.user.expertProfile).toEqual({ entryStatus: 'ACTIVE', availability: { not: '停用' } });
  // 负荷空闲基数=库内人口 4（宽松 distinct=4 → 空闲 0；全量基数会答 1）
  const loadRows = cards[4].rows as Array<Record<string, unknown>>;
  const loadMap = Object.fromEntries(loadRows.map((x) => [x.load, x.count]));
  expect(loadMap).toEqual({ 正常: 4 });
});
