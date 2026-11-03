import { CockpitTool } from './cockpit.tool';

const monthStart = () => `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`;
const dashboard: any = { getDashboard: jest.fn().mockResolvedValue({
  summary: { totalCount: 10, completedCount: 5, abnormalCount: 1, totalAwardLabel: '900万', totalSavingsLabel: '60万' },
  riskProjects: [{ project: 'R1', pendingDays: 20, reason: '评标滞留' }],
  savingsRanking: [{ project: 'S1', savingsRate: 15, savingsLabel: '30万' }],
}) };
const progress: any = { getProgressStats: jest.fn().mockResolvedValue({ totalActive: 7, stageDistribution: [{ stage: 'CONTRACT', count: 3 }, { stage: 'NOT_IN_LABELS', count: 1 }] }) };

it('summary 返回指标卡，且过滤条件来自 ctx（leader 本公司）', async () => {
  const tool = new CockpitTool(dashboard, progress);
  const r = await tool.execute({ action: 'summary' }, { user: { sub: 'u', role: 'leader', companyId: 'co-1' } });
  expect(r.success).toBe(true);
  expect(r.cards?.[0].type).toBe('metric');
  expect(dashboard.getDashboard).toHaveBeenCalledWith(monthStart(), undefined, { companyId: 'co-1' });
});
it('stages 走 ProgressService，行键映射 STAGE_LABELS 中文标签（未收录键回退原键）', async () => {
  const tool = new CockpitTool(dashboard, progress);
  const r = await tool.execute({ action: 'stages' }, { user: { sub: 'u', role: 'admin', companyId: null } });
  expect(progress.getProgressStats).toHaveBeenCalledWith(undefined, undefined, {});
  expect(r.cards?.[0].type).toBe('table');
  expect((r.cards?.[0] as any).rows).toEqual([
    { 阶段: '合同', 项目数: 3 },
    { 阶段: 'NOT_IN_LABELS', 项目数: 1 },
  ]);
});

describe('cockpit 出图声明（2026-11-03 表下真图）', () => {
  it('stages 卡带 distribution viz（阶段分布→柱图）', async () => {
    const tool = new CockpitTool(dashboard, progress);
    const r = await tool.execute({ action: 'stages' }, { user: { sub: 'u', role: 'admin', companyId: null } });
    expect((r.cards?.[0] as any).viz).toEqual({ kind: 'distribution', category: '阶段', value: '项目数' });
  });

  it('savings 卡带 ranking viz + columns 隐藏数值键（节资率数值不进表列）', async () => {
    const tool = new CockpitTool(dashboard, progress);
    const r = await tool.execute({ action: 'savings' }, { user: { sub: 'u', role: 'admin', companyId: null } });
    const card = r.cards?.[0] as any;
    expect(card.viz).toEqual({ kind: 'ranking', category: '项目', value: '节资率数值' });
    expect(card.columns.map((c: any) => c.key)).toEqual(['项目', '节资率', '节约额']);
    expect(typeof card.rows[0].节资率数值).toBe('number');
    expect(card.rows[0].节资率数值).toBe(15);
  });

  it('risk 卡不配 viz（明细列表图无增益，spec 裁定）', async () => {
    const tool = new CockpitTool(dashboard, progress);
    const r = await tool.execute({ action: 'risk' }, { user: { sub: 'u', role: 'admin', companyId: null } });
    expect((r.cards?.[0] as any).viz).toBeUndefined();
  });
});
