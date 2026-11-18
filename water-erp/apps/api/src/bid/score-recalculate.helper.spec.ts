import { recomputeExpertProgress, recomputeItemFromDecisions, filterEvaluableSuppliers, recomputeAllExpertsProgress } from './score-recalculate.helper';

describe('recomputeItemFromDecisions', () => {
  it('score = Σ awardedScore；非通过性 passed=null', () => {
    const r = recomputeItemFromDecisions({
      category: 'TECHNICAL',
      points: [
        { id: 'p1', objective: true, fullScore: 10 },
        { id: 'p2', objective: false, fullScore: 8 },
      ],
      decisions: new Map([
        ['p1', { checked: true, awardedScore: 10 }],
        ['p2', { checked: true, awardedScore: 5 }],
      ]),
    });
    expect(r.score).toBe(15);
    expect(r.passed).toBeNull();
  });

  it('通过性 item：客观 point 全勾=passed=true，任一不勾=false', () => {
    const points = [
      { id: 'p1', objective: true, fullScore: 0 },
      { id: 'p2', objective: true, fullScore: 0 },
    ];
    expect(recomputeItemFromDecisions({ category: 'QUALIFICATION', points, decisions: new Map([['p1', { checked: true, awardedScore: 0 }], ['p2', { checked: true, awardedScore: 0 }]]) }).passed).toBe(true);
    expect(recomputeItemFromDecisions({ category: 'QUALIFICATION', points, decisions: new Map([['p1', { checked: true, awardedScore: 0 }], ['p2', { checked: false, awardedScore: 0 }]]) }).passed).toBe(false);
  });

  it('主观 point 不影响 passed（只客观算）', () => {
    const r = recomputeItemFromDecisions({
      category: 'QUALIFICATION',
      points: [{ id: 'p1', objective: true, fullScore: 0 }, { id: 'p2', objective: false, fullScore: 5 }],
      decisions: new Map([['p1', { checked: true, awardedScore: 0 }], ['p2', { checked: false, awardedScore: 0 }]]),
    });
    expect(r.passed).toBe(true); // 客观全勾
    expect(r.score).toBe(0);
  });

  it('缺 decision 的 point 视为 awardedScore 0 / checked false', () => {
    const r = recomputeItemFromDecisions({
      category: 'TECHNICAL',
      points: [{ id: 'p1', objective: true, fullScore: 10 }],
      decisions: new Map(), // p1 无 decision
    });
    expect(r.score).toBe(0);
  });

  it('P0-A：提供 maxScore 时 Σawarded 封顶到 maxScore', () => {
    const r = recomputeItemFromDecisions({
      category: 'TECHNICAL',
      points: [
        { id: 'p1', objective: true, fullScore: 30 },
        { id: 'p2', objective: true, fullScore: 30 },
      ],
      decisions: new Map([
        ['p1', { checked: true, awardedScore: 30 }],
        ['p2', { checked: true, awardedScore: 30 }],
      ]),
      maxScore: 40, // Σawarded=60 → 封顶 40
    });
    expect(r.score).toBe(40);
  });

  it('P0-A：未提供 maxScore 时保持原 Σawarded（兼容）', () => {
    const r = recomputeItemFromDecisions({
      category: 'TECHNICAL',
      points: [{ id: 'p1', objective: true, fullScore: 30 }],
      decisions: new Map([['p1', { checked: true, awardedScore: 30 }]]),
    });
    expect(r.score).toBe(30);
  });

  it('P2：通过性项不计总分（即使得分点有 awardedScore）', () => {
    const r = recomputeItemFromDecisions({
      category: 'QUALIFICATION',
      points: [{ id: 'p1', objective: true, fullScore: 5 }],
      decisions: new Map([['p1', { checked: true, awardedScore: 5 }]]),
      maxScore: 0,
    });
    expect(r.score).toBe(0);
    expect(r.passed).toBe(true);
  });

  it('P2：客观点未勾选不计分（checked=false → awarded 0）', () => {
    const r = recomputeItemFromDecisions({
      category: 'TECHNICAL',
      points: [{ id: 'p1', objective: true, fullScore: 10 }],
      decisions: new Map([['p1', { checked: false, awardedScore: 10 }]]),
    });
    expect(r.score).toBe(0);
  });

  it('P2：通过性项无客观点 → 不自动通过（passed=false）', () => {
    const r = recomputeItemFromDecisions({
      category: 'QUALIFICATION',
      points: [{ id: 'p1', objective: false, fullScore: 0 }], // 仅主观
      decisions: new Map([['p1', { checked: false, awardedScore: 0 }]]),
    });
    expect(r.passed).toBe(false);
  });
});

describe('recomputeExpertProgress', () => {
  it('progress = scoredItems/totalItems；totalScore = 跨供应商均分', async () => {
    const tx: any = {
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([{ id: 'si1' }, { id: 'si2' }]) },
      bidSupplier: { findMany: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]) }, // 2 items × 3 活跃 = 6 total
      bidScoreRecord: {
        count: jest.fn().mockResolvedValue(3), // 3 scored → 50%
        findMany: jest.fn().mockResolvedValue([{ score: 10 }, { score: 20 }]),
      },
    };
    const r = await recomputeExpertProgress(tx, 'exp1', 'p1');
    expect(r.progress).toBe(50);
    expect(r.totalScore).toBe(10); // (10+20) / 3 活跃供应商 = 10
  });

  it('P1-5（中断审查）：分母排除该专家申报回避的供应商（可评集合=活跃−回避）——评完其余家即 100', async () => {
    const tx: any = {
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([{ id: 'si1' }, { id: 'si2' }]) },
      bidSupplier: { findMany: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]) },
      bidScoreRecord: {
        count: jest.fn().mockResolvedValue(4), // a、b 各 2 项已评（c 回避不可评不可计）
        findMany: jest.fn().mockResolvedValue([{ score: 10 }, { score: 20 }, { score: 30 }, { score: 40 }]),
      },
    };
    const r = await recomputeExpertProgress(tx, 'exp1', 'p1', ['c']);
    expect(r.progress).toBe(100); // 4 / (2 项 × 2 可评家) —— 回避家不入分母
    expect(tx.bidScoreRecord.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ supplierId: { in: ['a', 'b'] } }),
    }));
  });

  it('P1-6（中断审查）：分母排除废标家（bidValidity=invalid）——未评分废标家的专家可达 100', async () => {
    const tx: any = {
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([{ id: 'si1' }]) },
      bidSupplier: { findMany: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b', bidValidity: 'invalid' }]) },
      bidScoreRecord: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([{ score: 10 }]),
      },
    };
    const r = await recomputeExpertProgress(tx, 'exp1', 'p1');
    expect(r.progress).toBe(100); // 1 / (1 项 × 1 可评家)
    expect(r.totalScore).toBe(10); // 均分只跨可评家
  });

  it('P1-5：conflictedSupplierIds 缺省 []（既有调用零变化）', async () => {
    const tx: any = {
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([{ id: 'si1' }]) },
      bidSupplier: { findMany: jest.fn().mockResolvedValue([{ id: 'a' }]) },
      bidScoreRecord: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([{ score: 10 }]) },
    };
    expect((await recomputeExpertProgress(tx, 'exp1', 'p1')).progress).toBe(100);
  });

  it('totalItems=0 且 0 家可评（空项目退化态）→ progress=0', async () => {
    const tx: any = {
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([]) },
      bidSupplier: { findMany: jest.fn().mockResolvedValue([]) },
      bidScoreRecord: { count: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    };
    expect((await recomputeExpertProgress(tx, 'exp1', 'p1')).progress).toBe(0);
  });

  it('none 直接采购（spec §4.2）：0 个非 PRICE 评分项 + ≥1 家可评 → progress=100（解报告步死锁）', async () => {
    const tx: any = {
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([]) }, // 直接采购零评分项
      bidSupplier: { findMany: jest.fn().mockResolvedValue([{ id: 'a', bidValidity: 'valid' }]) },
      bidScoreRecord: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) }, // 0 条记录
    };
    const r = await recomputeExpertProgress(tx, 'exp1', 'p1');
    expect(r.progress).toBe(100); // 修复前 totalItems=0 → 0，报告确认永久死锁
    expect(r.totalScore).toBe(0); // totalScore 沿用 0（spec §4.2）
  });

  it('spec §4.2：0 个评分项 + 0 家可评（全部回避）→ progress 维持 0（防普通项目语义漂移）', async () => {
    const tx: any = {
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([]) },
      bidSupplier: { findMany: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]) }, // 两家全部被该专家回避
      bidScoreRecord: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    };
    const r = await recomputeExpertProgress(tx, 'exp1', 'p1', ['a', 'b']);
    expect(r.progress).toBe(0); // 可评集合空=维持 0，不随本次改动漂移
  });

  it('P1-12fix：PRICE 公式项不计入专家进度分母（竞价采购仅通过性时可达 100）', async () => {
    const tx: any = {
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([
        { id: 'si-q', category: 'QUALIFICATION' }, { id: 'si-r', category: 'RESPONSIVE' }, { id: 'si-p', category: 'PRICE' },
      ]) }, // 3 项含 PRICE → 专家可打 2 项
      bidSupplier: { findMany: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]) },
      bidScoreRecord: { count: jest.fn().mockResolvedValue(6), findMany: jest.fn().mockResolvedValue([]) }, // 2×3 全打
    };
    const r = await recomputeExpertProgress(tx, 'exp1', 'p1');
    expect(r.progress).toBe(100); // 修复前 = 6/9 → 66，报告确认死锁
  });

  it('P1-6：progress 用下取整（209/210 → 99，不误判 100）', async () => {
    const tx: any = {
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([{ id: 'si1' }, { id: 'si2' }, { id: 'si3' }]) }, // 3 项
      bidSupplier: { findMany: jest.fn().mockResolvedValue(Array.from({ length: 70 }, (_, i) => ({ id: `s${i}` }))) }, // 3 × 70 = 210 total
      bidScoreRecord: { count: jest.fn().mockResolvedValue(209), findMany: jest.fn().mockResolvedValue([]) }, // 209 scored
    };
    const r = await recomputeExpertProgress(tx, 'exp1', 'p1');
    expect(r.progress).toBe(99); // floor(99.52) = 99，漏评 1 项不得记 100
  });

  it('P1-9：scoredItems/totalScore 仅计活跃供应商（按 activeIds 过滤）', async () => {
    const tx: any = {
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([{ id: 'si1' }]) },
      bidSupplier: { findMany: jest.fn().mockResolvedValue([{ id: 's1' }, { id: 's2' }]) }, // s3 已撤回，不在活跃集
      bidScoreRecord: { count: jest.fn().mockResolvedValue(2), findMany: jest.fn().mockResolvedValue([{ score: 10 }, { score: 20 }]) },
    };
    const r = await recomputeExpertProgress(tx, 'exp1', 'p1');
    expect(tx.bidScoreRecord.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ supplierId: { in: ['s1', 's2'] } }),
    }));
    expect(r.progress).toBe(100); // 1 项 × 2 活跃 = 2 total；scored 2 → 100
    expect(r.totalScore).toBe(15); // (10+20) / 2 活跃供应商 = 15
  });

  it('N8b：手填价格分记录不计入进度分子（分母已排 PRICE，分子同步排除）', async () => {
    const tx: any = {
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([
        { id: 'i1', category: 'TECHNICAL' }, { id: 'i2', category: 'PRICE' },
      ]) }, // 分母 = 1 项技术 × 1 供应商
      bidSupplier: { findMany: jest.fn().mockResolvedValue([{ id: 's1' }]) },
      bidScoreRecord: {
        count: jest.fn(async () => 2), // 1 条技术 + 1 条手填价格（固定 mock 返回值对数字断言无区分度）
        findMany: jest.fn().mockResolvedValue([{ score: 40 }, { score: 27 }]),
      },
    };
    const { progress } = await recomputeExpertProgress(tx, 'e1', 'p1');
    // 直接验证查询条件：分子 count 的 scoreItem where 必须排除 PRICE——
    // 否则手填价格分记录会在分母（已排 PRICE）之外虚增分子，进度虚高甚至提前 100%
    const whereArg = (tx.bidScoreRecord.count as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.scoreItem).toMatchObject({ projectId: 'p1', category: { not: 'PRICE' } });
    expect(whereArg.supplierId).toEqual({ in: ['s1'] });
    expect(progress).toBe(100); // 新口径下真实查询只数非 PRICE 记录：1 项技术 / 1 分母 = 100%
  });

  it('P1-9：progress 封顶 100（防御性）', async () => {
    const tx: any = {
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([{ id: 'si1' }]) },
      bidSupplier: { findMany: jest.fn().mockResolvedValue([{ id: 's1' }]) }, // totalItems = 1
      bidScoreRecord: { count: jest.fn().mockResolvedValue(5), findMany: jest.fn().mockResolvedValue([]) }, // scored 5 > 1
    };
    const r = await recomputeExpertProgress(tx, 'exp1', 'p1');
    expect(r.progress).toBe(100); // floor(500) → 封顶 100
  });

  it('totalScore 应为平均供应商得分而非总分（3 供应商 × 均分 76 = 228 总分 → 均分 76）', async () => {
    const tx: any = {
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([{ id: 'si1' }, { id: 'si2' }]) }, // 2 项
      bidSupplier: { findMany: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]) }, // 3 活跃
      bidScoreRecord: {
        count: jest.fn().mockResolvedValue(6),
        // 3 个供应商，每个两项：总分 228，均分 76
        findMany: jest.fn().mockResolvedValue(
          Array.from({ length: 6 }, () => ({ score: 38 })), // 6 × 38 = 228 → /3 = 76
        ),
      },
    };
    const r = await recomputeExpertProgress(tx, 'exp1', 'p1');
    expect(r.progress).toBe(100);
    expect(r.totalScore).toBe(76); // 语义修正：跨供应商均分，非总分 228
  });
});

describe('bug#140a 资格短路豁免（分母排除本专家已判通过性不通过家的非通过性项）', () => {
  const PF_ITEMS = [
    { id: 'q', category: 'QUALIFICATION' },
    { id: 'r', category: 'RESPONSIVE' },
    { id: 't', category: 'TECHNICAL' },
  ];

  /** 场景：a 家 QUALIFICATION 判不通过（豁免），b 家正常——a 只评了两项通过性，b 全评 */
  function buildTx(records: any[], countImpl?: (args: any) => any) {
    return {
      bidScoreItem: { findMany: jest.fn().mockResolvedValue(PF_ITEMS) },
      bidSupplier: { findMany: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]) },
      bidScoreRecord: {
        count: jest.fn(countImpl ?? (async (args: any) => (args.where.supplierId.in.includes('b') ? 3 : 2))),
        findMany: jest.fn().mockResolvedValue(records),
      },
    } as any;
  }

  const baseRecords = [
    { supplierId: 'a', scoreItemId: 'q', passed: false, score: 0 },
    { supplierId: 'a', scoreItemId: 'r', passed: true, score: 0 },
    { supplierId: 'b', scoreItemId: 'q', passed: true, score: 0 },
    { supplierId: 'b', scoreItemId: 'r', passed: true, score: 0 },
    { supplierId: 'b', scoreItemId: 't', passed: null, score: 80 },
  ];

  it('豁免家只评通过性项即可达 100（分母 = 非豁免家×全部项 + 豁免家×通过性项）', async () => {
    const tx = buildTx(baseRecords);
    const res = await recomputeExpertProgress(tx, 'exp1', 'p1');
    // 分母 = 1×3（b 全部）+ 1×2（a 仅通过性）= 5；分子 = b 3 条 + a 通过性 2 条 = 5
    expect(res.progress).toBe(100);
    // 分子第二段（豁免家）必须按通过性类目收口——历史全量评分记录不得虚增
    const secondCall = (tx.bidScoreRecord.count as jest.Mock).mock.calls[1]?.[0]?.where;
    expect(secondCall.scoreItem.category).toEqual({ in: ['QUALIFICATION', 'RESPONSIVE'] });
    expect(secondCall.supplierId).toEqual({ in: ['a'] });
  });

  it('豁免家的历史全量评分记录不虚增分子（分子对其只数通过性项）', async () => {
    // a 曾全量评过 3 项（含技术 90 分）后才改判资格不通过——分子对 a 只数 2 条
    const tx = buildTx([
      ...baseRecords,
      { supplierId: 'a', scoreItemId: 't', passed: null, score: 90 },
    ]);
    const res = await recomputeExpertProgress(tx, 'exp1', 'p1');
    expect(res.progress).toBe(100); // 5/5，a 的技术分记录不入分子（第二段 count 类别已收口）
  });

  it('均分口径排除豁免家（其通过性 0 分记录不稀释 totalScore）', async () => {
    const tx = buildTx(baseRecords);
    const res = await recomputeExpertProgress(tx, 'exp1', 'p1');
    // b 家 0+0+80=80 / 1 家 = 80；若把 a 的两条 0 分记录计入（/2）会得 40
    expect(res.totalScore).toBe(80);
  });

  it('改票/复议推翻（无 passed=false）→ 豁免消失分母回扩（无状态自愈）', async () => {
    const records = [
      { supplierId: 'a', scoreItemId: 'q', passed: true, score: 0 }, // 改判通过
      { supplierId: 'a', scoreItemId: 'r', passed: true, score: 0 },
      { supplierId: 'a', scoreItemId: 't', passed: null, score: 70 },
      { supplierId: 'b', scoreItemId: 'q', passed: true, score: 0 },
      { supplierId: 'b', scoreItemId: 'r', passed: true, score: 0 },
      { supplierId: 'b', scoreItemId: 't', passed: null, score: 80 },
    ];
    const tx = buildTx(records, async () => 6);
    const res = await recomputeExpertProgress(tx, 'exp1', 'p1');
    expect(res.progress).toBe(100); // 无豁免：分母 3×2=6，单次 count 全量 6
    // 豁免为空时不得发第二段 count（既有单 count 契约）
    expect((tx.bidScoreRecord.count as jest.Mock).mock.calls.length).toBe(1);
    expect((tx.bidScoreRecord.count as jest.Mock).mock.calls[0][0].where.supplierId).toEqual({ in: ['a', 'b'] });
  });

  it('passed=false 但记录已不在活跃集（陈旧幻影）→ 不产生幻影豁免（区分度版）', async () => {
    // a/b 两家在册均无 fail（各 3 项全评）+ 一条已离场家 fail 幻影：
    // 若无活跃集闸，幻影会虚增豁免分母（2×3+1×2=8 → 6/8=75%）并多发第二段 count
    const tx = buildTx(
      [
        { supplierId: 'a', scoreItemId: 'q', passed: true, score: 0 },
        { supplierId: 'a', scoreItemId: 'r', passed: true, score: 0 },
        { supplierId: 'a', scoreItemId: 't', passed: null, score: 70 },
        { supplierId: 'b', scoreItemId: 'q', passed: true, score: 0 },
        { supplierId: 'b', scoreItemId: 'r', passed: true, score: 0 },
        { supplierId: 'b', scoreItemId: 't', passed: null, score: 80 },
        { supplierId: 'gone', scoreItemId: 'q', passed: false, score: 0 }, // 撤回/废标后遗留
      ],
      async (args: any) => (args.where.supplierId.in.includes('a') ? 6 : 1),
    );
    const res = await recomputeExpertProgress(tx, 'exp1', 'p1');
    expect(res.progress).toBe(100); // 有闸：6/6；无闸 7/8=87 → 断言有区分度
    // 豁免集为空 → 只发单段 count，且 supplierId 即全量活跃集
    const calls = (tx.bidScoreRecord.count as jest.Mock).mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][0].where.supplierId).toEqual({ in: ['a', 'b'] });
  });
});

describe('filterEvaluableSuppliers（P1-5/P1-6 单一口径·终审补）', () => {
  it('可评集合 = 活跃行 − 回避 − 废标', () => {
    const rows = [
      { id: 'a', bidValidity: 'valid' },
      { id: 'b', bidValidity: null },
      { id: 'c-inv', bidValidity: 'invalid' },
      { id: 'd-conf' },
    ];
    expect(filterEvaluableSuppliers(rows, ['d-conf']).map(s => s.id)).toEqual(['a', 'b']);
    // 缺省无回避：仅排废标
    expect(filterEvaluableSuppliers(rows).map(s => s.id)).toEqual(['a', 'b', 'd-conf']);
  });
});

describe('recomputeAllExpertsProgress（host 侧废标处置后全量重算·终审补）', () => {
  it('逐正选专家按可评集合重算并落库（各自的回避集独立排除）', async () => {
    const prisma: any = {
      bidExpert: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'e1', conflictedSupplierIds: ['s-c'] },
          { id: 'e2', conflictedSupplierIds: null },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([{ id: 'si1' }, { id: 'si2' }]) },
      bidSupplier: { findMany: jest.fn().mockResolvedValue([
        { id: 's-a', bidValidity: 'valid' }, { id: 's-b', bidValidity: 'valid' }, { id: 's-c' }, { id: 's-inv', bidValidity: 'invalid' },
      ]) },
      bidScoreRecord: { count: jest.fn().mockResolvedValue(4), findMany: jest.fn().mockResolvedValue([{ score: 10 }, { score: 20 }, { score: 30 }, { score: 40 }]) },
    };
    await recomputeAllExpertsProgress(prisma, 'p1');
    // e1（回避 s-c）：分母 2×2=4，count=4 → 100；e2：分母 2×3=6，count=4 → 66
    expect(prisma.bidExpert.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: expect.objectContaining({ progress: 100 }) });
    expect(prisma.bidExpert.update).toHaveBeenCalledWith({ where: { id: 'e2' }, data: expect.objectContaining({ progress: 66 }) });
  });
});
