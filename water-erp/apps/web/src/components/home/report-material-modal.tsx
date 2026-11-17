'use client';

/**
 * 数据库「导出汇报材料」弹窗（2026-11-17 用户裁定；同日二次返工）：
 * 图表面板**直接复用数据库页组件本体**（TrendChartPanel/DepartmentPanel/MethodPieChartPanel/
 * ProjectScalePanel/NonAwardDonutPanel/SavingsRankingPanel/SupplierCards/KpiCard）——
 * 同一组件同一设计，非重绘仿制；每面板配数据要点文字说明（前端从数据计算，确定性）。
 * AI 总述走 /ai/dashboard-analysis（缓存优先；载荷 rangeLabel 已注入「未开标=在途非异常」口径，
 * 避免 AI 把区间末端尚未采购的项目当风险强调——2026-11-17 用户裁定）。
 * 打印：footer 打印钮 window.print + @media print visibility 隔离（globals.css）。
 */
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/workbench';
import { FileDown, Loader2, Printer, Sparkles } from 'lucide-react';
import { fetchDashboardAnalysis, fetchDashboardAnalysisCache, type DashboardAnalysisPayload, type DashboardAnalysisResult } from '@/lib/api/ai';
import type { DashboardData } from '@/lib/api/dashboard';
import {
  KpiCard, SavingsRankingPanel, ProjectScalePanel, MethodPieChartPanel,
  SupplierCards, TrendChartPanel, DepartmentPanel,
  type SupplierDetail, type SavingsRankingItem,
} from '@/components/home/dashboard-home';

/** 汇报小节：面板（复用数据库页组件，自带题名）+ 数据要点说明——外层不再重复标题 */
function Section({ note, children }: { note: string; children: React.ReactNode }) {
  return (
    <section className="report-sheet break-inside-avoid">
      <div className="mb-3 min-h-[240px]">{children}</div>
      <p className="rounded-[10px] bg-[color-mix(in_oklch,var(--accent)_5%,transparent)] px-3 py-2 text-xs leading-5 text-[var(--foreground)]"><strong className="text-[var(--accent)]">说明：</strong>{note}</p>
    </section>
  );
}

export function ReportMaterialModal({ open, onClose, data, companyId, analysisPayload }: {
  open: boolean; onClose: () => void; data: DashboardData | null; companyId: string;
  /** AI 分析载荷（dashboard-home 的 bap() 规范形状——rangeLabel 已带在途口径注记） */
  analysisPayload: DashboardAnalysisPayload;
}) {
  const [ai, setAi] = useState<DashboardAnalysisResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(false);

  useEffect(() => {
    if (!open || !data) return;
    let cancelled = false;
    setAi(null); setAiError(false); setAiLoading(true);
    (async () => {
      try {
        const cache = await fetchDashboardAnalysisCache(companyId, data.range.startDate ?? undefined, data.range.endDate ?? undefined);
        if (!cancelled && cache.hit && cache.result) { setAi(cache.result); setAiLoading(false); return; }
        const res = await fetchDashboardAnalysis(analysisPayload, companyId);
        if (!cancelled) setAi(res);
      } catch {
        if (!cancelled) setAiError(true);
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, data, companyId, analysisPayload]);

  const suppliers: SupplierDetail[] = useMemo(
    () => data ? data.supplierStats.map(s => ({ ...s, id: s.name })) : [],
    [data],
  );

  if (!data) return null;
  const s = data.summary;
  const doneRate = s.totalCount > 0 ? Math.round((s.completedCount / s.totalCount) * 100) : 0;
  const savingsRate = s.totalBudget > 0 ? (s.totalSavings / s.totalBudget) * 100 : 0;

  /* —— 各维度数据要点（说明文字，前端确定性计算）—— */
  const S = data.trendSeries;
  const totalAmount = S.reduce((x, t) => x + t.amount, 0);
  const peak = S.reduce((m, t) => (t.amount > m.amount ? t : m), S[0] ?? { label: '—', amount: 0, count: 0 } as never);
  const lastActive = [...S].reverse().find(t => t.count > 0);
  const trendNote = S.length
    ? `区间共 ${S.length} 个统计桶、采购 ${s.totalCount} 项、成交金额合计 ${totalAmount.toFixed(1)} 万元。成交金额峰值出现在 ${peak.label}（${peak.amount.toFixed(1)} 万元）；最近有采购活动的月份为 ${lastActive?.label ?? '—'}。副带柱体上行为立项节点、下行为归档节点，虚线阶梯为在执行净值（累计立项减累计归档）。`
    : '区间内暂无采购活动。';
  const deptTop = data.departmentStats[0];
  const deptTop2 = data.departmentStats[1];
  const deptNote = data.departmentStats.length
    ? `共 ${data.departmentStats.length} 个部门发生采购。${deptTop ? `${deptTop.name} 金额最高（${deptTop.amountLabel}，完成率 ${deptTop.completedRate}%，主要方式 ${deptTop.topMethod || '—'}）` : ''}${deptTop2 ? `；其次为 ${deptTop2.name}（${deptTop2.amountLabel}）` : ''}。完成率=该部门已成交项目占其项目总数的比例。`
    : '暂无部门数据。';
  const mTop = data.methodStats[0];
  const mTop2 = data.methodStats[1];
  const methodNote = data.methodStats.length
    ? `${mTop ? `最主要采购方式为 ${mTop.name}（${mTop.count} 项、占 ${mTop.share}%、金额 ${mTop.amountLabel}）` : ''}${mTop2 ? `，其次 ${mTop2.name}（${mTop2.share}%）` : ''}。方式结构反映采购合规路径的分布，占比随公司采购制度要求动态变化。`
    : '暂无方式数据。';
  const segsOf = (min: number, max: number) => data.trendSeries.reduce((n, t) => n + t.projects.filter(p => {
    const bs = String(p.budgetLabel || ''); let b = 0;
    if (bs.includes('万')) b = parseFloat(bs.replace('万', '').replace(/,/g, '').trim()) * 10000; else b = parseFloat(bs.replace('元', '').replace(/,/g, '')) || 0;
    return b >= min && b < max;
  }).length, 0);
  const smallN = segsOf(0, 100000), midN = segsOf(100000, 2000000), bigN = segsOf(2000000, Infinity);
  const scaleNote = `按预算金额四档分层：小额（<10 万）${smallN} 项、中小/中型（10-200 万）${segsOf(100000, 500000) + segsOf(500000, 2000000)} 项、大型（>200 万）${bigN} 项。小额高频与大型低频的结构是否符合业务预期，可结合部门与方式分布交叉解读。`;
  const rankTop = data.savingsRanking[0];
  const rankNote = data.savingsRanking.length
    ? `按节约资金（控制金额 − 成交金额）排序的 Top 项目。${rankTop ? `节约最多的是「${rankTop.project.slice(0, 24)}」（${rankTop.savingsLabel}，节约率 ${rankTop.savingsRate}%，方式 ${rankTop.method}）` : ''}；区间合计节约 ${s.totalSavingsLabel}、节资率 ${savingsRate.toFixed(1)}%。`
    : '暂无节约数据（需已成交项目）。';
  const supTop = data.supplierStats[0];
  const supNote = data.supplierStats.length
    ? `${supTop ? `${supTop.name} 中标 ${supTop.winCount} 次（参与 ${supTop.participatedCount} 次、中标率 ${supTop.hitRate}%、累计 ${supTop.awardAmountLabel}）` : ''}。卡片展示参与/中标活跃度与主要活跃部门，供供应商集中度研判。`
    : '暂无供应商参与数据。';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="4xl"
      icon={<FileDown size={14} />}
      title="采购数据汇报材料"
      description={`${data.range.startDate && data.range.endDate ? `${data.range.startDate} ~ ${data.range.endDate}` : '全部区间'} · 共 ${s.totalCount} 项 · 生成于 ${new Date().toLocaleDateString('zh-CN')}`}
      footer={
        <>
          <button onClick={onClose} className="neu-btn-soft">关闭</button>
          <button onClick={() => window.print()} className="neu-btn-primary is-water !h-[38px] gap-1.5">
            <Printer size={14} /> 打印
          </button>
        </>
      }
    >
      <div className="report-print-root flex flex-col gap-5">

        {/* KPI 摘要（复用数据库页 KpiCard 同款） */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-8">
          <KpiCard label="预算总金额" value={s.totalBudgetLabel} signal="normal" index={1} reducedMotion />
          <KpiCard label="未成交预算" value={s.pendingBudgetLabel} signal={s.pendingBudget > 0 ? 'warning' : 'normal'} index={2} reducedMotion />
          <KpiCard label="已成交预算" value={s.awardedBudgetLabel} signal="success" index={3} reducedMotion />
          <KpiCard label="成交总额" value={s.totalAwardLabel} signal="normal" index={4} reducedMotion />
          <KpiCard label="节约资金" value={s.totalSavingsLabel} signal={s.totalSavings > 0 ? 'success' : 'normal'} index={5} reducedMotion />
          <KpiCard label="节资率" value={`${savingsRate.toFixed(1)}%`} signal={savingsRate > 5 ? 'success' : 'warning'} index={6} reducedMotion />
          <KpiCard label="已成交项目" value={`${s.completedCount}/${s.totalCount}`} index={7} reducedMotion />
          <KpiCard label="成交率" value={`${doneRate}%`} signal={doneRate >= 60 ? 'success' : 'normal'} index={8} reducedMotion />
        </div>

        {/* AI 综合分析 */}
        <section className="report-sheet">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles size={14} className="text-[var(--accent)]" />
            <h3 className="text-sm font-bold text-[var(--foreground)]">AI 综合分析</h3>
          </div>
          {aiLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-[var(--muted-foreground)]"><Loader2 size={15} className="animate-spin" /> 正在生成整体分析…</div>
          ) : aiError ? (
            <p className="text-xs leading-5 text-[var(--muted-foreground)]">AI 分析暂不可用，以下图表与数据说明仍完整可查。</p>
          ) : ai ? (
            <div className="flex flex-col gap-3">
              <p className="text-xs leading-6 text-[var(--foreground)]">{ai.overview}</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {([['主要亮点', ai.highlights, 'var(--success)'], ['关注事项', ai.concerns, 'var(--warning)'], ['工作建议', ai.suggestions, 'var(--accent)']] as const).map(([t, list, c]) => (
                  <div key={t}>
                    <div className="mb-1 text-[11px] font-bold" style={{ color: c }}>{t}</div>
                    <ul className="flex flex-col gap-1">
                      {list.slice(0, 5).map((x, i) => <li key={i} className="text-[11px] leading-5 text-[var(--muted-foreground)]">· {x}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        {/* ① 节约资金排行（2026-11-17 用户裁定：提前至首位） */}
        <Section note={rankNote}>
          <SavingsRankingPanel items={data.savingsRanking as SavingsRankingItem[]} index={1} reducedMotion />
        </Section>

        {/* ② 采购执行趋势（复用 TrendChartPanel） */}
        <Section note={trendNote}>
          <TrendChartPanel profile={data} index={2} reducedMotion />
        </Section>

        {/* ③ 部门采购分析（复用 DepartmentPanel） */}
        <Section note={deptNote}>
          <DepartmentPanel profile={data} index={3} reducedMotion />
        </Section>

        {/* ④ 采购方式分布（复用 MethodPieChartPanel） */}
        <Section note={methodNote}>
          <MethodPieChartPanel profile={data} index={4} reducedMotion />
        </Section>

        {/* ⑤ 项目规模分析（复用 ProjectScalePanel） */}
        <Section note={scaleNote}>
          <ProjectScalePanel profile={data} index={5} reducedMotion />
        </Section>

        {/* ⑥ 重点供应商动态（复用 SupplierCards） */}
        <Section note={supNote}>
          <SupplierCards suppliers={suppliers} index={6} reducedMotion />
        </Section>

      </div>
    </Modal>
  );
}
