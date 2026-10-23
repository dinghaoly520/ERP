import { MobileBriefService, sanitizeBriefText, sanitizeBriefShareText } from './mobile-brief.service';

describe('sanitizeBriefText', () => {
  it('禁词「审批」→「查阅」、剥引号、截断 40 字', () => {
    expect(sanitizeBriefText('「静待您审批」')).toBe('静待您查阅');
    expect(sanitizeBriefText(`${'长'.repeat(50)}`)).toHaveLength(40);
  });
});
describe('sanitizeBriefShareText', () => {
  it('同禁词/剥引号规则，但 160 字上限（段落文案，不共用 40 字单句截断）', () => {
    const share = sanitizeBriefShareText(`「${'今日要报'.repeat(20)}静待您审批」`);
    expect(share.startsWith('「')).toBe(false);
    expect(share.length).toBeGreaterThan(40); // 80+ 字正文不被 40 字截断
    expect(share).not.toContain('审批');
    expect(share).toContain('查阅');
    expect(sanitizeBriefShareText(`${'长'.repeat(200)}`)).toHaveLength(160);
  });
});
describe('MobileBriefService.getBrief', () => {
  const scope: any = { resolveScope: jest.fn().mockResolvedValue({ kind: 'ALL' }), filter: jest.fn().mockReturnValue(undefined) };
  const dashboard: any = { getDashboard: jest.fn().mockResolvedValue({
    summary: { totalCount: 20, completedCount: 12, abnormalCount: 2, totalAwardLabel: '1,200万', totalSavingsLabel: '80万' },
    riskProjects: [{ project: 'X项目', pendingDays: 15, reason: '评标滞留' }],
    savingsRanking: [{ project: 'Y项目', savingsRate: 18 }],
  }) };
  // 阶段分布来源 = ProgressService（getDashboard 无 stageDistribution 字段），须与 dashboard 同 companyFilter
  const progress: any = { getProgressStats: jest.fn().mockResolvedValue({ stageDistribution: [{ stage: 'CONTRACT', count: 3 }] }) };
  const longShare = `【蜀水云采】今日要报：成交1,200万，节资80万；X项目滞留15天请关注；合同阶段3项待推进。${'节资与风险动态详见平台驾驶舱。'.repeat(3)}静待您审批。`;
  const llmOk: any = { chatJson: jest.fn().mockResolvedValue({
    focus: { text: 'X项目评标滞留15天，需关注' },
    metric: { text: '本月成交1,200万，节资80万' },
    reminder: { text: '合同阶段3项待推进' },
    shareText: longShare,
  }) };
  it('正常生成三句+shareText，jump 映射', async () => {
    const svc = new MobileBriefService(llmOk, dashboard, scope as any, progress as any);
    const r = await svc.getBrief({ sub: 'u1', role: 'admin' } as any);
    expect(r.available).toBe(true);
    if (r.available) {
      expect(r.focus.jump).toBe('/dashboard');
      expect(r.metric.jump).toBe('/ledger');
      expect(r.reminder.jump).toBe('/progress');
      expect(r.shareText).toContain('1,200万');
    }
  });
  it('shareText 为 80~120 字段落：不被 40 字单句截断（>40 且 ≤160），禁词替换仍生效', async () => {
    expect(longShare.length).toBeGreaterThan(80);
    const svc = new MobileBriefService(llmOk, dashboard, scope as any, progress as any);
    const r = await svc.getBrief({ sub: 'u1', role: 'admin' } as any);
    if (!r.available) throw new Error('expected available');
    expect(r.shareText.length).toBeGreaterThan(40);
    expect(r.shareText.length).toBeLessThanOrEqual(160);
    expect(r.shareText).not.toContain('审批');
    expect(r.shareText).toContain('查阅');
  });
  it('最堵阶段取自 ProgressService.getProgressStats（同 companyFilter），不读 dashboard；prompt 用 STAGE_LABELS 中文标签', async () => {
    const svc = new MobileBriefService(llmOk, dashboard, scope as any, progress as any);
    await svc.getBrief({ sub: 'u1', role: 'admin' } as any);
    expect(progress.getProgressStats).toHaveBeenCalledWith(undefined, undefined, undefined);
    const prompt = (llmOk.chatJson as jest.Mock).mock.calls[0][1];
    expect(prompt).toContain('合同（3项）');
    expect(prompt).not.toContain('CONTRACT');
  });
  it('LLM 失败 → available:false（不抛错）', async () => {
    const llmBad: any = { chatJson: jest.fn().mockRejectedValue(new Error('down')) };
    const svc = new MobileBriefService(llmBad, dashboard, scope as any, progress as any);
    await expect(svc.getBrief({ sub: 'u1', role: 'admin' } as any)).resolves.toEqual({ available: false });
  });
});
