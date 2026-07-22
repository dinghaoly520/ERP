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
});

describe('recomputeExpertProgress', () => {
  it('progress = scoredItems/totalItems；totalScore = Σ record.score', async () => {
    const tx: any = {
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([{ id: 'si1' }, { id: 'si2' }]) },
      bidSupplier: { count: jest.fn().mockResolvedValue(3) }, // 2 items × 3 suppliers = 6 total
      bidScoreRecord: {
        count: jest.fn().mockResolvedValue(3), // 3 scored → 50%
        findMany: jest.fn().mockResolvedValue([{ score: 10 }, { score: 20 }]),
      },
    };
    const r = await recomputeExpertProgress(tx, 'exp1', 'p1');
    expect(r.progress).toBe(50);
    expect(r.totalScore).toBe(30);
  });

  it('totalItems=0 → progress=0', async () => {
    const tx: any = {
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([]) },
      bidSupplier: { count: jest.fn().mockResolvedValue(0) },
      bidScoreRecord: { count: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    };
    expect((await recomputeExpertProgress(tx, 'exp1', 'p1')).progress).toBe(0);
  });

  it('P1-6：progress 用下取整（209/210 → 99，不误判 100）', async () => {
    const tx: any = {
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([{ id: 'si1' }, { id: 'si2' }, { id: 'si3' }]) }, // 3 项
      bidSupplier: { count: jest.fn().mockResolvedValue(70) }, // 3 × 70 = 210 total
      bidScoreRecord: { count: jest.fn().mockResolvedValue(209), findMany: jest.fn().mockResolvedValue([]) }, // 209 scored
    };
    const r = await recomputeExpertProgress(tx, 'exp1', 'p1');
    expect(r.progress).toBe(99); // floor(99.52) = 99，漏评 1 项不得记 100
  });
});
