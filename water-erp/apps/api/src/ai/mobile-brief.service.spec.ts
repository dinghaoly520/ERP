import { MobileBriefService, sanitizeBriefText } from './mobile-brief.service';

describe('sanitizeBriefText', () => {
  it('禁词「审批」→「查阅」、剥引号、截断 40 字', () => {
    expect(sanitizeBriefText('「静待您审批」')).toBe('静待您查阅');
    expect(sanitizeBriefText(`${'长'.repeat(50)}`)).toHaveLength(40);
  });
});
describe('MobileBriefService.getBrief', () => {
  const scope: any = { resolveScope: jest.fn().mockResolvedValue({ kind: 'ALL' }), filter: jest.fn().mockReturnValue(undefined) };
  const dashboard: any = { getDashboard: jest.fn().mockResolvedValue({
    summary: { totalCount: 20, completedCount: 12, abnormalCount: 2, totalAwardLabel: '1,200万', totalSavingsLabel: '80万' },
    riskProjects: [{ project: 'X项目', pendingDays: 15, reason: '评标滞留' }],
    savingsRanking: [{ project: 'Y项目', savingsRate: 18 }],
    stageDistribution: [{ stage: 'CONTRACT', count: 3 }],
  }) };
  const llmOk: any = { chatJson: jest.fn().mockResolvedValue({
    focus: { text: 'X项目评标滞留15天，需关注' },
    metric: { text: '本月成交1,200万，节资80万' },
    reminder: { text: '合同阶段3项待推进' },
    shareText: '【蜀水云采】今日要报：成交1,200万，节资80万；X项目滞留15天请关注。',
  }) };
  it('正常生成三句+shareText，jump 映射', async () => {
    const svc = new MobileBriefService(llmOk, dashboard, scope as any);
    const r = await svc.getBrief({ sub: 'u1', role: 'admin' } as any);
    expect(r.available).toBe(true);
    if (r.available) {
      expect(r.focus.jump).toBe('/dashboard');
      expect(r.shareText).toContain('1,200万');
    }
  });
  it('LLM 失败 → available:false（不抛错）', async () => {
    const llmBad: any = { chatJson: jest.fn().mockRejectedValue(new Error('down')) };
    const svc = new MobileBriefService(llmBad, dashboard, scope as any);
    await expect(svc.getBrief({ sub: 'u1', role: 'admin' } as any)).resolves.toEqual({ available: false });
  });
});
