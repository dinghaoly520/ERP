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
  // 2026-11-03 实录：deepseek-v4-flash 间歇性把 {"focus":{"text":…}} 拍平成
  // {"focus":"…"}（直连探测 12 发 2 中）——解析只认嵌套形状时该路径静默 available:false
  // 零日志，是 :3011 今日要报生成失败的主犯。两种形状都必须接受。
  it('LLM 返回扁平字符串形状（focus:"…" 而非 {focus:{text}}）→ 仍成功生成', async () => {
    const llmFlat: any = { chatJson: jest.fn().mockResolvedValue({
      focus: 'X项目评标滞留15天，需关注',
      metric: '本月成交1,200万，节资80万',
      reminder: '合同阶段3项待推进',
      shareText: longShare,
    }) };
    const svc = new MobileBriefService(llmFlat, dashboard, scope as any, progress as any);
    const r = await svc.getBrief({ sub: 'u1', role: 'admin' } as any);
    expect(r.available).toBe(true);
    if (r.available) {
      expect(r.focus.text).toBe('X项目评标滞留15天，需关注');
      expect(r.metric.text).toBe('本月成交1,200万，节资80万');
      expect(r.reminder.text).toBe('合同阶段3项待推进');
    }
  });
  it('三句全空时 available:false 且必须留 warn 日志（静默路径可观测，2026-11-03 教训）', async () => {
    const llmGarbage: any = { chatJson: jest.fn().mockResolvedValue({ unrelated: true }) };
    const svc = new MobileBriefService(llmGarbage, dashboard, scope as any, progress as any);
    const svcWarn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(svc.getBrief({ sub: 'u1', role: 'admin' } as any)).resolves.toEqual({ available: false });
    expect(svcWarn).toHaveBeenCalled();
    svcWarn.mockRestore();
  });
  it('chatJson 预算 maxTokens=4096（2048 时思维链可独占预算致 content 空，直连探测 reasoning_tokens=2048 实录）', async () => {
    const svc = new MobileBriefService(llmOk, dashboard, scope as any, progress as any);
    await svc.getBrief({ sub: 'u1', role: 'admin' } as any);
    const opts = (llmOk.chatJson as jest.Mock).mock.calls[0][5];
    expect(opts.maxTokens).toBe(4096);
  });
  // 2026-11-03 口径对齐：brief 固定「本月」而页面默认「本年」——admin 本月全 0 时 AI
  // 天天说「成交额 0.0 万」、下方指标卡显示本年数百万，同屏打架。brief 区间随页面。
  it('传 startDate/endDate（本年）时 prompt 用该区间数据与「本年」标签，不再固定「本月」', async () => {
    const svc = new MobileBriefService(llmOk, dashboard, scope as any, progress as any);
    await svc.getBrief({ sub: 'u1', role: 'admin' } as any, undefined, '2026-01-01', '2026-12-31');
    expect(dashboard.getDashboard).toHaveBeenCalledWith('2026-01-01', '2026-12-31', undefined);
    /* llmOk 为 describe 级共享 mock（calls 跨用例累积）——取本次（最后一次）调用 */
    const prompt = (llmOk.chatJson as jest.Mock).mock.calls[(llmOk.chatJson as jest.Mock).mock.calls.length - 1][1];
    expect(prompt).toContain('本年数据');
    expect(prompt).not.toContain('本月数据');
  });
  it('不传区间时维持本月口径（向后兼容，页面「全部」档无区间）', async () => {
    const svc = new MobileBriefService(llmOk, dashboard, scope as any, progress as any);
    await svc.getBrief({ sub: 'u1', role: 'admin' } as any);
    const prompt = (llmOk.chatJson as jest.Mock).mock.calls[llmOk.chatJson.mock.calls.length - 1][1];
    expect(prompt).toContain('本月数据');
  });
  it('rangeKey 显式语义优先于日期启发式（评审 F10：跨时区月/年边界零歧义）', async () => {
    const svc = new MobileBriefService(llmOk, dashboard, scope as any, progress as any);
    // 服务端时钟停在 11 月，页面传「本季」起止——启发式会误判，rangeKey 必须赢
    await svc.getBrief({ sub: 'u1', role: 'admin' } as any, undefined, '2026-10-01', '2026-12-31', 'quarter');
    const prompt = (llmOk.chatJson as jest.Mock).mock.calls[llmOk.chatJson.mock.calls.length - 1][1];
    expect(prompt).toContain('本季数据');
    expect(prompt).not.toContain('2026-10-01 至');
  });
});
