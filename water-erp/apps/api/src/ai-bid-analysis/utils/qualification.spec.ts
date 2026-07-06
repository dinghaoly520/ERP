// apps/api/src/ai-bid-analysis/utils/qualification.spec.ts
import { resolveQualification } from './qualification';

describe('resolveQualification', () => {
  it('无冲突且★条款全满足 → 通过 / low / 无附注', () => {
    const r = resolveQualification({
      qualConflict: false,
      starredResponse: { allMet: true, unmet: [] },
      concordanceConflictCount: 0,
      concordanceWarningCount: 0,
    });
    expect(r.qualificationStatus).toBe('通过');
    expect(r.riskLevel).toBe('low');
    expect(r.autoNote).toBeNull();
  });

  it('资质一致性冲突 → 不通过', () => {
    const r = resolveQualification({
      qualConflict: true,
      starredResponse: { allMet: true, unmet: [] },
      concordanceConflictCount: 0,
      concordanceWarningCount: 0,
    });
    expect(r.qualificationStatus).toBe('不通过');
  });

  it('★实质性条款未响应 → 不通过 / high / 附注列明条款', () => {
    const r = resolveQualification({
      qualConflict: false,
      starredResponse: { allMet: false, unmet: ['工期不超过365天', '项目经理甲级'] },
      concordanceConflictCount: 0,
      concordanceWarningCount: 0,
    });
    expect(r.qualificationStatus).toBe('不通过');
    expect(r.riskLevel).toBe('high');
    expect(r.autoNote).toBe('[自动] 存在未响应的 ★实质性条款：工期不超过365天、项目经理甲级');
  });

  it('★条款未响应即便 concordance 全干净也升级 high', () => {
    const r = resolveQualification({
      qualConflict: false,
      starredResponse: { allMet: false, unmet: ['某条款'] },
      concordanceConflictCount: 0,
      concordanceWarningCount: 0,
    });
    expect(r.riskLevel).toBe('high');
  });

  it('资质未冲突但其他字段有 conflict → 通过 / high', () => {
    const r = resolveQualification({
      qualConflict: false,
      starredResponse: { allMet: true, unmet: [] },
      concordanceConflictCount: 2,
      concordanceWarningCount: 0,
    });
    expect(r.qualificationStatus).toBe('通过');
    expect(r.riskLevel).toBe('high');
  });

  it('仅 warning → 通过 / medium', () => {
    const r = resolveQualification({
      qualConflict: false,
      starredResponse: { allMet: true, unmet: [] },
      concordanceConflictCount: 0,
      concordanceWarningCount: 3,
    });
    expect(r.qualificationStatus).toBe('通过');
    expect(r.riskLevel).toBe('medium');
  });

  it('starredResponse 为 null 时安全降级（视为无未响应）', () => {
    const r = resolveQualification({
      qualConflict: false,
      starredResponse: null,
      concordanceConflictCount: 0,
      concordanceWarningCount: 0,
    });
    expect(r.qualificationStatus).toBe('通过');
    expect(r.autoNote).toBeNull();
  });

  it('unmet 为 undefined 时安全降级', () => {
    const r = resolveQualification({
      qualConflict: false,
      starredResponse: { allMet: false },
      concordanceConflictCount: 0,
      concordanceWarningCount: 0,
    });
    expect(r.qualificationStatus).toBe('通过');
    expect(r.autoNote).toBeNull();
  });
});
