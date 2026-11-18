import { MobileBriefService, sanitizeBriefText, CONGESTION_THRESHOLD } from './mobile-brief.service';
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

/* 今日关注条（2026-11-18 用户裁定「AI 感太重」改版）：三句小作文（复述指标+自重复）
 * 收为一行事实句——只写风险/拥堵事项；无事返回 focus:null 且零 LLM 调用。 */
describe('MobileBriefService 今日关注条', () => {
  const user = { sub: 'u1', role: 'admin' } as any;
  const scopeHit: any = { resolveScope: jest.fn().mockResolvedValue({ all: true }), filter: jest.fn().mockReturnValue(undefined) };
  const progHit: any = { getProgressStats: jest.fn().mockResolvedValue({ stageDistribution: [{ stage: 'BID_EVALUATION', count: 1 }] }) };
  const llmText = (t: string): any => ({ chatJson: jest.fn().mockResolvedValue({ focus: t }) });

  function dash(opts: { risk?: Array<{ project: string; pendingDays: number; reason: string }>; summary?: object } = {}): any {
    return {
      getDashboard: jest.fn().mockResolvedValue({
        summary: opts.summary ?? { totalCount: 9, completedCount: 4, abnormalCount: 1, totalAwardLabel: '749.9万', totalSavingsLabel: '9.1万' },
        riskProjects: opts.risk ?? [],
        savingsRanking: [],
      }),
    };
  }

  it('无事项（无风险 + 最堵阶段低于拥堵阈值）→ focus:null 且零 LLM 调用，null 结果入缓存', async () => {
    const c = makeCachePrisma();
    const llm: any = { chatJson: jest.fn() };
    const svc = new MobileBriefService(llm, dash(), scopeHit, progHit, c.prisma);
    await expect(svc.getBrief(user)).resolves.toEqual({ available: true, focus: null });
    expect((llm.chatJson as jest.Mock).mock.calls.length).toBe(0); // 无事不烧 LLM
    expect(c.store.size).toBe(1); // null 关注也是合法缓存态（数据变才变）
  });

  it('阶段拥堵达阈值（无风险）→ 生成一行事实句，jump=/progress', async () => {
    const prog = { getProgressStats: jest.fn().mockResolvedValue({ stageDistribution: [{ stage: 'BID_EVALUATION', count: CONGESTION_THRESHOLD }] }) };
    const svc = new MobileBriefService(llmText('开标评标阶段3项拥堵'), dash(), scopeHit, prog as any, makeCachePrisma().prisma);
    const r = await svc.getBrief(user);
    expect(r).toEqual({ available: true, focus: { text: '开标评标阶段3项拥堵', jump: '/progress' } });
  });

  it('有风险项目 → focus 含项目名与天数，jump=/ledger（风险优先于拥堵）', async () => {
    const prog = { getProgressStats: jest.fn().mockResolvedValue({ stageDistribution: [{ stage: 'CONTRACT', count: 9 }] }) };
    const d = dash({ risk: [{ project: 'Z项目', pendingDays: 15, reason: '评标滞留' }] });
    const llm = llmText('Z项目滞留15天（评标滞留）');
    const svc = new MobileBriefService(llm, d, scopeHit, prog as any, makeCachePrisma().prisma);
    const r = await svc.getBrief(user);
    if (!r.available || !r.focus) throw new Error('expect focus');
    expect(r.focus.text).toContain('Z项目');
    expect(r.focus.text).toContain('15');
    expect(r.focus.jump).toBe('/ledger');
    const sys = (llm.chatJson as jest.Mock).mock.calls[0][0];
    const usr = (llm.chatJson as jest.Mock).mock.calls[0][1];
    expect(usr).toContain('Z项目'); // 数据行必须带风险项目
    expect(sys).toContain('风险项目优先'); // 生成规则在 system 侧
  });

  it('LLM 返回 {"focus":null}（数据边界自判无事）→ focus:null', async () => {
    const prog = { getProgressStats: jest.fn().mockResolvedValue({ stageDistribution: [{ stage: 'BID_EVALUATION', count: 9 }] }) };
    const llm: any = { chatJson: jest.fn().mockResolvedValue({ focus: null }) };
    const svc = new MobileBriefService(llm, dash(), scopeHit, prog as any, makeCachePrisma().prisma);
    await expect(svc.getBrief(user)).resolves.toEqual({ available: true, focus: null });
  });

  it('LLM 扁平形状（focus:"…"）也接受（2026-11-03 形状漂移教训沿用）', async () => {
    const prog = { getProgressStats: jest.fn().mockResolvedValue({ stageDistribution: [{ stage: 'BID_EVALUATION', count: 9 }] }) };
    const llm: any = { chatJson: jest.fn().mockResolvedValue({ focus: '开标评标阶段9项拥堵' }) };
    const svc = new MobileBriefService(llm, dash(), scopeHit, prog as any, makeCachePrisma().prisma);
    const r = await svc.getBrief(user);
    expect(r).toEqual({ available: true, focus: { text: '开标评标阶段9项拥堵', jump: '/progress' } });
  });

  it('LLM 失败 → available:false 且不入缓存（下次重试）', async () => {
    const c = makeCachePrisma();
    const prog = { getProgressStats: jest.fn().mockResolvedValue({ stageDistribution: [{ stage: 'BID_EVALUATION', count: 9 }] }) };
    const llm: any = { chatJson: jest.fn().mockRejectedValue(new Error('down')) };
    const svc = new MobileBriefService(llm, dash(), scopeHit, prog as any, c.prisma);
    await expect(svc.getBrief(user)).resolves.toEqual({ available: false });
    expect(c.store.size).toBe(0);
  });

  it('chatJson 预算 maxTokens=4096（思维链与正文共享预算，2026-11-03 实录沿用）', async () => {
    const prog = { getProgressStats: jest.fn().mockResolvedValue({ stageDistribution: [{ stage: 'BID_EVALUATION', count: 9 }] }) };
    const llm = llmText('开标评标阶段9项拥堵');
    const svc = new MobileBriefService(llm, dash(), scopeHit, prog as any, makeCachePrisma().prisma);
    await svc.getBrief(user);
    const opts = (llm.chatJson as jest.Mock).mock.calls[0][5];
    expect(opts.maxTokens).toBe(4096);
  });

  it('不传区间时 getDashboard 按本月起点取数；显式区间透传（数据面口径不变）', async () => {
    const prog = { getProgressStats: jest.fn().mockResolvedValue({ stageDistribution: [{ stage: 'BID_EVALUATION', count: 9 }] }) };
    const d = dash();
    const svc = new MobileBriefService(llmText('x'), d, scopeHit, prog as any, makeCachePrisma().prisma);
    const now = new Date();
    await svc.getBrief(user);
    const defStart = (d.getDashboard as jest.Mock).mock.calls[0][0];
    expect(defStart).toBe(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
    await svc.getBrief(user, undefined, '2026-01-01', '2026-12-31');
    expect((d.getDashboard as jest.Mock).mock.calls[1]).toEqual(['2026-01-01', '2026-12-31', undefined]);
  });
});

/* 数据指纹缓存（2026-11-16 落地，2026-11-18 随关注条改版升 v2 命名空间）*/
describe('MobileBriefService 数据指纹缓存', () => {
  const user = { sub: 'u1', role: 'admin' } as any;
  const scopeHit: any = { resolveScope: jest.fn().mockResolvedValue({ all: true }), filter: jest.fn().mockReturnValue(undefined) };
  const dashHit: any = { getDashboard: jest.fn().mockResolvedValue({
    summary: { totalCount: 9, completedCount: 4, abnormalCount: 1, totalAwardLabel: '749.9万', totalSavingsLabel: '9.1万' },
    riskProjects: [{ project: 'Z项目', pendingDays: 3, reason: '已终止' }],
    savingsRanking: [],
  }) };
  const progHit: any = { getProgressStats: jest.fn().mockResolvedValue({ stageDistribution: [{ stage: 'BID_EVALUATION', count: 9 }] }) };
  const llmText = (tag: string): any => ({ chatJson: jest.fn().mockResolvedValue({ focus: `${tag}Z项目滞留3天已终止` }) });

  it('数据指纹未变 → 命中缓存：不再调 LLM、不再查数据，返回同一份关注条', async () => {
    const llm: any = { chatJson: jest.fn().mockResolvedValue({ focus: 'Z项目滞留3天已终止' }) };
    const svc = new MobileBriefService(llm, dashHit, scopeHit, progHit, makeCachePrisma().prisma);
    const r1 = await svc.getBrief(user);
    expect(r1.available).toBe(true);
    const llmCalls = (llm.chatJson as jest.Mock).mock.calls.length;
    const dashCalls = (dashHit.getDashboard as jest.Mock).mock.calls.length;
    const r2 = await svc.getBrief(user);
    expect((llm.chatJson as jest.Mock).mock.calls.length).toBe(llmCalls);
    expect((dashHit.getDashboard as jest.Mock).mock.calls.length).toBe(dashCalls);
    expect(r2).toEqual(r1);
  });

  it('台账数据变化 → 指纹失效重新生成；缓存键升 v2（旧三句缓存不复用）', async () => {
    const c = makeCachePrisma();
    const llm: any = { chatJson: jest.fn().mockResolvedValueOnce({ focus: 'v1句' }).mockResolvedValueOnce({ focus: 'v2句' }) };
    const svc = new MobileBriefService(llm, dashHit, scopeHit, progHit, c.prisma);
    await svc.getBrief(user);
    expect([...c.store.keys()][0]).toContain('mobile-brief:v2');
    c.round.aggregate.mockResolvedValue({ _count: 6, _max: { updatedAt: new Date('2026-11-18T09:00:00.000Z') } });
    const r2 = await svc.getBrief(user);
    expect((llm.chatJson as jest.Mock).mock.calls.length).toBe(2);
    if (!r2.available || !r2.focus) throw new Error('expect focus');
    expect(r2.focus.text).toBe('v2句');
  });

  it('PMI 写入也失效（full 变体：关注条吃 PMI 阶段分布）', async () => {
    const c = makeCachePrisma();
    const llm: any = { chatJson: jest.fn().mockResolvedValue({ focus: 'x' }) };
    const svc = new MobileBriefService(llm, dashHit, scopeHit, progHit, c.prisma);
    await svc.getBrief(user);
    c.item.aggregate.mockResolvedValue({ _count: 4, _max: { updatedAt: new Date('2026-11-18T10:00:00.000Z') } });
    await svc.getBrief(user);
    expect((llm.chatJson as jest.Mock).mock.calls.length).toBe(2);
  });

  it('缓存按区间分键：本月与本年各存一份', async () => {
    const c = makeCachePrisma();
    const llm: any = { chatJson: jest.fn().mockResolvedValueOnce({ focus: '月' }).mockResolvedValueOnce({ focus: '年' }) };
    const svc = new MobileBriefService(llm, dashHit, scopeHit, progHit, c.prisma);
    await svc.getBrief(user, undefined, '2026-11-01', undefined, 'month');
    await svc.getBrief(user, undefined, '2026-01-01', undefined, 'year');
    expect(c.store.size).toBe(2);
  });
});
