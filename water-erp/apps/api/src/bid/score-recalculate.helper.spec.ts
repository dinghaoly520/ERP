import { recomputeExpertProgress, recomputeItemFromDecisions } from './score-recalculate.helper';

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

  it('totalItems=0 → progress=0', async () => {
    const tx: any = {
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([]) },
      bidSupplier: { findMany: jest.fn().mockResolvedValue([]) },
      bidScoreRecord: { count: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    };
    expect((await recomputeExpertProgress(tx, 'exp1', 'p1')).progress).toBe(0);
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
