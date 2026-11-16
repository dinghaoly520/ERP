import { MobileBriefService, sanitizeBriefText, sanitizeBriefShareText } from './mobile-brief.service';
import type { PrismaService } from '../prisma/prisma.service';

/** 指纹缓存测试底座：三表聚合 mock（值可变以驱动指纹变化）+ SystemConfig 内存存储 */
function makeCachePrisma() {
  const store = new Map<string, string>();
  const agg = (count: number, iso: string) => jest.fn().mockResolvedValue({ _count: count, _max: { updatedAt: new Date(iso) } });
  const round = { aggregate: agg(5, '2026-11-15T08:00:00.000Z') };
  const item = { aggregate: agg(3, '2026-11-14T08:00:00.000Z') };
  const link = { aggregate: agg(2, '2026-11-13T08:00:00.000Z') };
  const prisma = {
    procurementRound: round,
    projectManagementItem: item,
    supplierCompanyLink: link,
    systemConfig: {
      findUnique: jest.fn(({ where }: { where: { key: string } }) => (store.has(where.key) ? { key: where.key, value: store.get(where.key) } : null)),
      upsert: jest.fn(({ create }: { create: { key: string; value: string } }) => { store.set(create.key, create.value); return {}; }),
    },
  } as unknown as PrismaService & Record<string, never>;
  return { prisma, round, item, link, store };
}

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
  /* CompanyScope 真实形状（company-scope.ts）：{all:true} | {all:false,companyIds}——
   * 旧桩 {kind:'ALL'} 是过时形状，缓存键派生读 scope.all/companyIds */
  const scope: any = { resolveScope: jest.fn().mockResolvedValue({ all: true }), filter: jest.fn().mockReturnValue(undefined) };
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
    const svc = new MobileBriefService(llmOk, dashboard, scope as any, progress as any, makeCachePrisma().prisma);
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
    const svc = new MobileBriefService(llmOk, dashboard, scope as any, progress as any, makeCachePrisma().prisma);
    const r = await svc.getBrief({ sub: 'u1', role: 'admin' } as any);
    if (!r.available) throw new Error('expected available');
    expect(r.shareText.length).toBeGreaterThan(40);
    expect(r.shareText.length).toBeLessThanOrEqual(160);
    expect(r.shareText).not.toContain('审批');
    expect(r.shareText).toContain('查阅');
  });
  it('最堵阶段取自 ProgressService.getProgressStats（同 companyFilter），不读 dashboard；prompt 用 STAGE_LABELS 中文标签', async () => {
    const svc = new MobileBriefService(llmOk, dashboard, scope as any, progress as any, makeCachePrisma().prisma);
    await svc.getBrief({ sub: 'u1', role: 'admin' } as any);
    expect(progress.getProgressStats).toHaveBeenCalledWith(undefined, undefined, undefined);
    const prompt = (llmOk.chatJson as jest.Mock).mock.calls[0][1];
    expect(prompt).toContain('合同（3项）');
    expect(prompt).not.toContain('CONTRACT');
  });
  it('LLM 失败 → available:false（不抛错）', async () => {
    const llmBad: any = { chatJson: jest.fn().mockRejectedValue(new Error('down')) };
    const svc = new MobileBriefService(llmBad, dashboard, scope as any, progress as any, makeCachePrisma().prisma);
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
    const svc = new MobileBriefService(llmFlat, dashboard, scope as any, progress as any, makeCachePrisma().prisma);
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
    const svc = new MobileBriefService(llmGarbage, dashboard, scope as any, progress as any, makeCachePrisma().prisma);
    const svcWarn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(svc.getBrief({ sub: 'u1', role: 'admin' } as any)).resolves.toEqual({ available: false });
    expect(svcWarn).toHaveBeenCalled();
    svcWarn.mockRestore();
  });
  it('chatJson 预算 maxTokens=4096（2048 时思维链可独占预算致 content 空，直连探测 reasoning_tokens=2048 实录）', async () => {
    const svc = new MobileBriefService(llmOk, dashboard, scope as any, progress as any, makeCachePrisma().prisma);
    await svc.getBrief({ sub: 'u1', role: 'admin' } as any);
    const opts = (llmOk.chatJson as jest.Mock).mock.calls[0][5];
    expect(opts.maxTokens).toBe(4096);
  });
  // 2026-11-03 口径对齐：brief 固定「本月」而页面默认「本年」——admin 本月全 0 时 AI
  // 天天说「成交额 0.0 万」、下方指标卡显示本年数百万，同屏打架。brief 区间随页面。
  it('传 startDate/endDate（本年）时 prompt 用该区间数据与「本年」标签，不再固定「本月」', async () => {
    const svc = new MobileBriefService(llmOk, dashboard, scope as any, progress as any, makeCachePrisma().prisma);
    await svc.getBrief({ sub: 'u1', role: 'admin' } as any, undefined, '2026-01-01', '2026-12-31');
    expect(dashboard.getDashboard).toHaveBeenCalledWith('2026-01-01', '2026-12-31', undefined);
    /* llmOk 为 describe 级共享 mock（calls 跨用例累积）——取本次（最后一次）调用 */
    const prompt = (llmOk.chatJson as jest.Mock).mock.calls[(llmOk.chatJson as jest.Mock).mock.calls.length - 1][1];
    expect(prompt).toContain('本年数据');
    expect(prompt).not.toContain('本月数据');
  });
  it('不传区间时维持本月口径（向后兼容，页面「全部」档无区间）', async () => {
    const svc = new MobileBriefService(llmOk, dashboard, scope as any, progress as any, makeCachePrisma().prisma);
    await svc.getBrief({ sub: 'u1', role: 'admin' } as any);
    const prompt = (llmOk.chatJson as jest.Mock).mock.calls[llmOk.chatJson.mock.calls.length - 1][1];
    expect(prompt).toContain('本月数据');
  });
  it('rangeKey 显式语义优先于日期启发式（评审 F10：跨时区月/年边界零歧义）', async () => {
    const svc = new MobileBriefService(llmOk, dashboard, scope as any, progress as any, makeCachePrisma().prisma);
    // 服务端时钟停在 11 月，页面传「本季」起止——启发式会误判，rangeKey 必须赢
    await svc.getBrief({ sub: 'u1', role: 'admin' } as any, undefined, '2026-10-01', '2026-12-31', 'quarter');
    const prompt = (llmOk.chatJson as jest.Mock).mock.calls[llmOk.chatJson.mock.calls.length - 1][1];
    expect(prompt).toContain('本季数据');
    expect(prompt).not.toContain('2026-10-01 至');
  });
});

/* 数据指纹缓存（2026-11-16 实录：每击必调 LLM × AiController 类级 @Throttle 20/min →
 * 挂载/切Tab/切区间/下拉每次都重取，测试「更新了没」连点几分钟即打满 429，前端 catch
 * 抹成「生成失败」后再点仍 429——「本次登录怎么点都不再更新」。套 2026-11-12 用户裁定
 * 的指纹缓存（数据变才变，拒绝时间窗），与综合分析/进度洞察同源件） */
describe('MobileBriefService 数据指纹缓存', () => {
  const user = { sub: 'u1', role: 'admin' } as any;
  const scopeHit: any = { resolveScope: jest.fn().mockResolvedValue({ all: true }), filter: jest.fn().mockReturnValue(undefined) };
  const dashHit: any = { getDashboard: jest.fn().mockResolvedValue({
    summary: { totalCount: 9, completedCount: 4, abnormalCount: 1, totalAwardLabel: '749.9万', totalSavingsLabel: '9.1万' },
    riskProjects: [{ project: 'Z项目', pendingDays: 3, reason: '已终止' }],
    savingsRanking: [],
  }) };
  const progHit: any = { getProgressStats: jest.fn().mockResolvedValue({ stageDistribution: [{ stage: 'BID_EVALUATION', count: 10 }] }) };
  const llmText = (tag: string) => ({
    focus: { text: `${tag}：Z项目滞留3天已终止` },
    metric: { text: `${tag}：本年成交749.9万` },
    reminder: { text: `${tag}：开标评标拥堵10项` },
    shareText: `${tag}：今日要报正文，成交749.9万，拥堵10项，请关注。`,
  });

  it('数据指纹未变 → 第二次调用命中缓存：不再调 LLM、不再查数据，返回同一份要报', async () => {
    const llm: any = { chatJson: jest.fn().mockResolvedValue(llmText('v1')) };
    const svc = new MobileBriefService(llm, dashHit, scopeHit, progHit, makeCachePrisma().prisma);
    const r1 = await svc.getBrief(user);
    expect(r1.available).toBe(true);
    const llmCalls = (llm.chatJson as jest.Mock).mock.calls.length;
    const dashCalls = (dashHit.getDashboard as jest.Mock).mock.calls.length;
    const r2 = await svc.getBrief(user);
    expect((llm.chatJson as jest.Mock).mock.calls.length).toBe(llmCalls); // 缓存命中零 LLM
    expect((dashHit.getDashboard as jest.Mock).mock.calls.length).toBe(dashCalls); // 数据面也不再查
    expect(r2).toEqual(r1);
  });

  it('台账数据变化（ProcurementRound 更新）→ 指纹失效重新生成新要报', async () => {
    const c = makeCachePrisma();
    const llm: any = { chatJson: jest.fn().mockResolvedValueOnce(llmText('v1')).mockResolvedValueOnce(llmText('v2')) };
    const svc = new MobileBriefService(llm, dashHit, scopeHit, progHit, c.prisma);
    await svc.getBrief(user);
    c.round.aggregate.mockResolvedValue({ _count: 6, _max: { updatedAt: new Date('2026-11-16T09:00:00.000Z') } });
    const r2 = await svc.getBrief(user);
    expect((llm.chatJson as jest.Mock).mock.calls.length).toBe(2);
    expect(r2.available).toBe(true);
    if (r2.available) expect(r2.focus.text).toContain('v2');
  });

  it('brief 混消费 PMI 阶段分布（最堵阶段句）→ full 变体：PMI 写入也失效缓存', async () => {
    const c = makeCachePrisma();
    const llm: any = { chatJson: jest.fn().mockResolvedValueOnce(llmText('v1')).mockResolvedValueOnce(llmText('v2')) };
    const svc = new MobileBriefService(llm, dashHit, scopeHit, progHit, c.prisma);
    await svc.getBrief(user);
    c.item.aggregate.mockResolvedValue({ _count: 4, _max: { updatedAt: new Date('2026-11-16T10:00:00.000Z') } });
    await svc.getBrief(user);
    expect((llm.chatJson as jest.Mock).mock.calls.length).toBe(2);
  });

  it('LLM 失败（available:false）不入缓存——下次仍重试生成（质量降级不冻结共享缓存）', async () => {
    const c = makeCachePrisma();
    const llm: any = { chatJson: jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(llmText('v1')) };
    const svc = new MobileBriefService(llm, dashHit, scopeHit, progHit, c.prisma);
    await expect(svc.getBrief(user)).resolves.toEqual({ available: false });
    expect(c.store.size).toBe(0); // 失败结果未落存
    const r2 = await svc.getBrief(user);
    expect(r2.available).toBe(true);
  });

  it('缓存按区间分键：本月与本年各存一份，互不串台', async () => {
    const c = makeCachePrisma();
    const llm: any = { chatJson: jest.fn().mockResolvedValueOnce(llmText('月报')).mockResolvedValueOnce(llmText('年报')) };
    const svc = new MobileBriefService(llm, dashHit, scopeHit, progHit, c.prisma);
    await svc.getBrief(user, undefined, '2026-11-01', undefined, 'month');
    await svc.getBrief(user, undefined, '2026-01-01', undefined, 'year');
    expect(c.store.size).toBe(2);
    // 同区间再次命中：零新增 LLM 调用
    const llmCalls = (llm.chatJson as jest.Mock).mock.calls.length;
    await svc.getBrief(user, undefined, '2026-01-01', undefined, 'year');
    expect((llm.chatJson as jest.Mock).mock.calls.length).toBe(llmCalls);
    expect([...c.store.keys()].some((k) => k.includes('mobile-brief'))).toBe(true);
  });
});
