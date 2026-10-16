// apps/api/scripts/assign-unattributed-company.spec.ts
import { planExpertCompanyAssignment, CompanyRow, ExpertRow } from './assign-unattributed-company';

const companies: CompanyRow[] = [
  { id: 'co-swhi-sjy', name: '四川水发勘测设计研究有限公司' },
  { id: 'co-swhi-js', name: '四川水发建设有限公司' },
];

const expert = (id: string, displayName: string, employer: string | null): ExpertRow => ({ id, displayName, employer });

describe('planExpertCompanyAssignment（专家按工作单位归属计划，纯函数）', () => {
  it('工作单位与公司全称精确匹配（trim 两侧空格）→ 归属该公司', () => {
    const plan = planExpertCompanyAssignment(
      [expert('u1', '甲', '  四川水发勘测设计研究有限公司 '), expert('u2', '乙', '四川水发建设有限公司')],
      companies,
    );
    expect(plan.matched).toHaveLength(2);
    expect(plan.matched.find(g => g.companyId === 'co-swhi-sjy')).toMatchObject({ companyName: '四川水发勘测设计研究有限公司', userIds: ['u1'] });
    expect(plan.matched.find(g => g.companyId === 'co-swhi-js')).toMatchObject({ userIds: ['u2'] });
    expect(plan.unmatched).toEqual([]);
  });

  it('同公司多名专家聚合为一个分组', () => {
    const plan = planExpertCompanyAssignment(
      [expert('u1', '甲', '四川水发勘测设计研究有限公司'), expert('u2', '乙', '四川水发勘测设计研究有限公司')],
      companies,
    );
    expect(plan.matched).toEqual([{ companyId: 'co-swhi-sjy', companyName: '四川水发勘测设计研究有限公司', userIds: ['u1', 'u2'] }]);
  });

  it('工作单位匹配不上任何公司 → 保持未归属（不做兜底强归）', () => {
    const plan = planExpertCompanyAssignment([expert('u1', '丙', '某某咨询有限公司')], companies);
    expect(plan.matched).toEqual([]);
    expect(plan.unmatched).toEqual([expert('u1', '丙', '某某咨询有限公司')]);
  });

  it('工作单位未填（null/空串/纯空格）→ 未归属', () => {
    const plan = planExpertCompanyAssignment(
      [expert('u1', '甲', null), expert('u2', '乙', ''), expert('u3', '丙', '   ')],
      companies,
    );
    expect(plan.matched).toEqual([]);
    expect(plan.unmatched.map(u => u.id)).toEqual(['u1', 'u2', 'u3']);
  });
});
