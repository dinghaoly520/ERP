import { buildCandidateLines, type SelectionCandidate } from './supplier-selection-ai.service';
import type { ConditionCheck } from './supplier-hard-conditions';

describe('buildCandidateLines（候选行证据组装）', () => {
  const c: SelectionCandidate = {
    id: 's1',
    name: '甲公司',
    businessScope: '钻机生产',
    industry: '通用设备制造业',
    qualificationNames: ['ISO9001质量管理体系认证', '高新技术企业证书'],
    performanceSummary: '近期业绩2项（钻机采购、钻具供货）',
    penaltyCount: 0,
    registeredCapital: '1000万元',
    tags: ['钻探设备'],
    evalAvgScore: 4.5,
    evalLevel: 'A',
    evalCount: 2,
    activeProjects: 1,
  };

  it('行内含行业/资质全名/业绩摘要/注册资本', () => {
    const { lines, indexToId } = buildCandidateLines([c]);
    expect(lines[0]).toContain('行业:通用设备制造业');
    expect(lines[0]).toContain('资质全:ISO9001质量管理体系认证、高新技术企业证书');
    expect(lines[0]).toContain('业绩:近期业绩2项（钻机采购、钻具供货）');
    expect(lines[0]).toContain('注册资本:1000万元');
    expect(indexToId.get('c0')).toBe('s1');
  });

  it('业绩缺失明示「库内无业绩记录」，不虚构', () => {
    const { lines } = buildCandidateLines([{ ...c, performanceSummary: undefined }]);
    expect(lines[0]).toContain('业绩:库内无业绩记录');
  });

  it('资质缺失明示「库内未见」', () => {
    const { lines } = buildCandidateLines([{ ...c, qualificationNames: undefined }]);
    expect(lines[0]).toContain('资质:库内未见');
  });

  it('核验标记：PASS✓/MISSING○/FAIL✗ 附加到行尾', () => {
    const checks = new Map<string, ConditionCheck[]>([
      [
        's1',
        [
          { type: 'industry', label: '行业（批发业）', status: 'PASS', required: true },
          { type: 'qualification', label: 'ISO9001 质量管理体系认证', status: 'MISSING', required: true },
          { type: 'grade', label: '评价等级≥B', status: 'FAIL', required: true },
        ],
      ],
    ]);
    const { lines } = buildCandidateLines([c], checks);
    expect(lines[0]).toContain('核验:行业（批发业）✓ ISO9001 质量管理体系认证○ 评价等级≥B✗');
  });

  it('无核验数据时行尾无核验段', () => {
    const { lines } = buildCandidateLines([c]);
    expect(lines[0]).not.toContain('核验:');
  });
});
