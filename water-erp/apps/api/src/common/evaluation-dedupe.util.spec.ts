import { latestExpertEvals, latestSupplierEvals, reevalAllowed } from './evaluation-dedupe.util';

const mk = (o: Partial<Record<string, unknown>> & { id: string }) => ({
  createdAt: new Date('2026-10-01T10:00:00Z'),
  updatedAt: new Date('2026-10-01T10:00:00Z'),
  ...o,
} as any);

describe('评价多开·方案B 统计闸（2026-10-21）', () => {
  it('专家：同槽位（专家,项目,评价人）取最新一条；不同评价人/项目各自计票', () => {
    const rows = [
      mk({ id: 'a', expertUserId: 'u1', evaluatorId: 'e1', projectId: 'p1', overallGrade: 'E' }),
      mk({ id: 'b', expertUserId: 'u1', evaluatorId: 'e1', projectId: 'p1', overallGrade: 'A', updatedAt: new Date('2026-10-05T10:00:00Z') }), // 同槽新 → 覆盖 a
      mk({ id: 'c', expertUserId: 'u1', evaluatorId: 'e2', projectId: 'p1', overallGrade: 'E' }), // 另一评价人 → 计票
      mk({ id: 'd', expertUserId: 'u1', evaluatorId: 'e1', projectId: 'p2', overallGrade: 'D' }), // 另一项目 → 计票
    ];
    const out = latestExpertEvals(rows);
    expect(out.map(r => r.id).sort()).toEqual(['b', 'c', 'd']);
  });

  it('供应商：槽位含来源维度（procurement/contract 各自一票）', () => {
    const rows = [
      mk({ id: 'a', supplierId: 's1', evaluatorId: 'e1', projectId: 'p1', evaluationSource: 'procurement', finalGrade: 'C' }),
      mk({ id: 'b', supplierId: 's1', evaluatorId: 'e1', projectId: 'p1', evaluationSource: 'procurement', finalGrade: 'A', updatedAt: new Date('2026-10-06T10:00:00Z') }),
      mk({ id: 'c', supplierId: 's1', evaluatorId: 'e1', projectId: 'p1', evaluationSource: 'contract', finalGrade: 'B' }),
    ];
    const out = latestSupplierEvals(rows);
    expect(out.map(r => r.id).sort()).toEqual(['b', 'c']);
  });

  it('频次闸放行：leader/admin 或已填复评事由', () => {
    expect(reevalAllowed('leader', undefined)).toBe(true);
    expect(reevalAllowed('admin', '')).toBe(true);
    expect(reevalAllowed('staff', undefined)).toBe(false);
    expect(reevalAllowed('staff', '履约复评')).toBe(true);
  });
});
