// apps/api/src/ai-bid-analysis/utils/calibration.spec.ts
import { buildCalibration } from './calibration';

const D = (scoreItemId: string, expertScore: number, aiScore: number, accepted: boolean) => ({
  scoreItemId,
  expertScore,
  aiScore,
  delta: Math.round((expertScore - aiScore) * 10) / 10,
  accepted,
});
const I = (id: string, category: string, name: string) => ({ id, category, name });

describe('buildCalibration', () => {
  it('空 deltas → null', () => {
    expect(buildCalibration([], [])).toBeNull();
  });

  it('全采纳 → adoptionRate = 1', () => {
    const r = buildCalibration(
      [D('s1', 8, 8, true), D('s2', 9, 9, true)],
      [I('s1', 'TECHNICAL', '技术'), I('s2', 'BUSINESS', '商务')],
    );
    expect(r!.overall.adoptionRate).toBe(1);
    expect(r!.overall.accepted).toBe(2);
  });

  it('全不采纳 → adoptionRate = 0', () => {
    const r = buildCalibration([D('s1', 5, 9, false)], [I('s1', 'TECHNICAL', '技术')]);
    expect(r!.overall.adoptionRate).toBe(0);
  });

  it('category 聚合 avgDelta + count', () => {
    const r = buildCalibration(
      [D('s1', 8, 6, false), D('s2', 10, 7, false), D('s3', 5, 5, true)],
      [I('s1', 'TECHNICAL', '技术'), I('s2', 'TECHNICAL', '技术'), I('s3', 'BUSINESS', '商务')],
    );
    const tech = r!.byCategory.find((c) => c.category === 'TECHNICAL')!;
    expect(tech.count).toBe(2);
    expect(tech.avgDelta).toBe(2.5); // (2 + 3) / 2
  });

  it('topDeviations 按 |avgDelta| 降序 top 5', () => {
    const r = buildCalibration(
      [
        D('s1', 10, 0, false),
        D('s2', 9, 0, false),
        D('s3', 8, 0, false),
        D('s4', 7, 0, false),
        D('s5', 6, 0, false),
        D('s6', 5, 0, false), // 不进 top 5
      ],
      [I('s1', 'A', 'n1'), I('s2', 'A', 'n2'), I('s3', 'A', 'n3'), I('s4', 'A', 'n4'), I('s5', 'A', 'n5'), I('s6', 'A', 'n6')],
    );
    expect(r!.topDeviations).toHaveLength(5);
    expect(r!.topDeviations[0].scoreItemId).toBe('s1'); // delta 10 最大
  });

  it('overall.total 计所有 delta（含无 item）', () => {
    const r = buildCalibration(
      [D('s1', 8, 8, true), D('s2', 9, 9, true), D('s3', 5, 5, false)],
      [I('s1', 'A', 'n'), I('s2', 'A', 'n')],
    );
    expect(r!.overall.total).toBe(3); // s3 无 item 仍计入 overall
  });

  it('topDeviations join name/category', () => {
    const r = buildCalibration([D('s1', 10, 0, false)], [I('s1', 'TECHNICAL', '技术方案')]);
    expect(r!.topDeviations[0].name).toBe('技术方案');
    expect(r!.topDeviations[0].category).toBe('TECHNICAL');
  });

  it('无对应 item 的 delta 在 topDeviations/byCategory 跳过', () => {
    const r = buildCalibration([D('s1', 10, 0, false)], []);
    expect(r!.topDeviations).toHaveLength(0);
    expect(r!.byCategory).toHaveLength(0);
    expect(r!.overall.total).toBe(1); // overall 仍计
  });
});
