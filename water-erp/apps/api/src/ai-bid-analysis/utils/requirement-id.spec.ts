// apps/api/src/ai-bid-analysis/utils/requirement-id.spec.ts
import { stableReqId, stabilizeRequirements } from './requirement-id';
import type { TenderRequirements } from '../types';

describe('requirement-id', () => {
  it('同 category+content 产出相同 id', () => {
    expect(stableReqId('technical', '工期不超过365日历天'))
      .toBe(stableReqId('technical', '工期不超过365日历天'));
  });

  it('★号/空白/标点差异不影响 id', () => {
    expect(stableReqId('technical', '★ 工期不超过 365 日历天。'))
      .toBe(stableReqId('technical', '工期不超过365日历天'));
  });

  it('不同 content 产出不同 id', () => {
    expect(stableReqId('technical', '工期不超过365日历天'))
      .not.toBe(stableReqId('technical', '资质等级甲级'));
  });

  it('不同 category 同 content 产出不同 id', () => {
    expect(stableReqId('technical', '某要求'))
      .not.toBe(stableReqId('commercial', '某要求'));
  });

  it('stabilizeRequirements 覆盖三类 requirement 的 id', () => {
    const req: TenderRequirements = {
      projectName: 'p', projectType: 't',
      qualificationRequirements: [{ id: 'q1', category: '资质', content: '甲级资质', isRequired: true, evidenceType: '证书' }],
      technicalRequirements: [{ id: 't1', category: '技术', content: '工期365天', isStarred: true, weight: 10 }],
      commercialRequirements: [{ id: 'c1', category: '商务', content: '质保2年', isRequired: true }],
      priceEvaluationMethod: '基准价法',
      scoringRules: { technicalMax: 0, commercialMax: 0, priceMax: 0, technicalWeights: {}, commercialWeights: {}, priceMethod: '', notes: '' },
    };
    const out = stabilizeRequirements(req);
    expect(out.technicalRequirements![0].id).toBe(stableReqId('technical', '工期365天'));
    expect(out.qualificationRequirements![0].id).toBe(stableReqId('qualification', '甲级资质'));
    expect(out.commercialRequirements![0].id).toBe(stableReqId('commercial', '质保2年'));
    // 其余字段原样保留
    expect(out.technicalRequirements![0].isStarred).toBe(true);
    expect(out.projectName).toBe('p');
  });
});
