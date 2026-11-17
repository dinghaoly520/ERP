'use client';

/**
 * 数据库「导出汇报材料」弹窗（2026-11-17 用户裁定）：
 * HTML 窗口展示 + 打印；AI 整体分析（/ai/dashboard-analysis，缓存优先）+
 * 多维度手写 SVG 图表（月度趋势/部门/方式/规模分层/成交状态），每图配简要文字说明。
 * 图表规范（dataviz）：magnitude 单 hue 亮度阶梯、薄标记 4px 圆角数据端、直接值标签、
 * 文字用文本 token 色不用系列色、单系列无 legend（标题即名）；打印为矢量 SVG。
 */
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/workbench';
import { FileDown, Loader2, Printer, Sparkles } from 'lucide-react';
import { fetchDashboardAnalysis, fetchDashboardAnalysisCache, type DashboardAnalysisPayload, type DashboardAnalysisResult } from '@/lib/api/ai';
import type { DashboardData } from '@/lib/api/dashboard';

/* ── 通用小件 ── */

/** 金额（元）→ 万元显示 */
const wan = (v: number) => (v >= 10000 ? `${(v / 10000).toFixed(v >= 1e8 ? 0 : 1)}万` : `${Math.round(v)}元`);
/** 单 hue 亮度阶梯（magnitude 编码）：值越大越深（oklch 0.66→0.42） */
const ramp = (t: number) => `oklch(${(0.66 - 0.24 * Math.max(0, Math.min(1, t))).toFixed(3)} 0.12 258)`;

/** 纵向柱图：月度趋势/规模分层共用。柱端 4px 圆角、基线锚定、顶端直接标签（选择性：峰值必标）。 */
function VBars({ items, unit, barW = 34, gap = 14, h = 150 }: {
  items: Array<{ label: string; value: number; note?: string }>; unit: string; barW?: number; gap?: number; h?: number;
}) {
  const max = Math.max(1, ...items.map(i => i.value));
  const topIdx = items.findIndex(i => i.value === max);
  const W = items.length * (barW + gap);
  return (
    <svg viewBox={`0 0 ${W} ${h + 42}`} className="w-full" role="img" aria-label={`柱状图，单位${unit}`}>
      <line x1={0} y1={h} x2={W} y2={h} stroke="oklch(0.6 0.04 258 / 0.25)" strokeWidth={1} />
      {items.map((it, i) => {
        const bh = Math.max(it.value > 0 ? 4 : 0, (it.value / max) * (h - 14));
        const x = i * (barW + gap);
        const r = Math.min(4, barW / 2, bh);
        // 顶端 4px 圆角、基线平贴（dataviz：数据端圆角+基线锚定）
        const d = `M ${x} ${h} L ${x} ${h - bh + r} Q ${x} ${h - bh} ${x + r} ${h - bh} L ${x + barW - r} ${h - bh} Q ${x + barW} ${h - bh} ${x + barW} ${h - bh + r} L ${x + barW} ${h} Z`;
        return (
          <g key={i}>
            <path d={d} fill={ramp(it.value / max)}>
              <title>{`${it.label}：${it.value}${unit}${it.note ? `（${it.note}）` : ''}`}</title>
            </path>
            {(i === topIdx || items.length <= 14) && it.value > 0 && (
              <text x={x + barW / 2} y={h - bh - 6} textAnchor="middle" style={{ fontSize: 10, fill: 'oklch(0.42 0.03 258)', fontWeight: i === topIdx ? 700 : 500 }}>{it.value}</text>
            )}
            <text x={x + barW / 2} y={h + 14} textAnchor="middle" style={{ fontSize: 9.5, fill: 'oklch(0.55 0.03 258)' }}>{it.label}</text>
            {it.note && <text x={x + barW / 2} y={h + 27} textAnchor="middle" style={{ fontSize: 8.5, fill: 'oklch(0.62 0.03 258)' }}>{it.note}</text>}
          </g>
        );
      })}
    </svg>
  );
}

/** 横向条图：部门/方式共用。条端 4px 圆角、右端直接标签、按值深浅。 */
function HBars({ items, fmt }: { items: Array<{ label: string; value: number }>; fmt: (v: number) => string }) {
  const max = Math.max(1, ...items.map(i => i.value));
  return (
    <div className="flex flex-col gap-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="w-[92px] shrink-0 truncate text-right text-[11px] text-[var(--muted-foreground)]" title={it.label}>{it.label}</span>
          <div className="h-[16px] flex-1 overflow-hidden rounded-[4px]" style={{ background: 'oklch(0.94 0.01 258)' }}>
            <div className="h-full rounded-[4px]" style={{ width: `${Math.max(1.5, (it.value / max) * 100)}%`, background: ramp(it.value / max) }} title={`${it.label}：${fmt(it.value)}`} />
          </div>
          <span className="w-[64px] shrink-0 text-[11px] font-semibold tabular-nums text-[var(--foreground)]">{fmt(it.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** 汇报小节：编号标题 + 图 + 简要文字说明 */
function Section({ n, title, desc, children }: { n: number; title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="report-sheet rounded-[14px] p-5" style={{ background: 'oklch(1 0 0 / 0.72)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.8), 2px 2px 6px oklch(0.55 0.03 258 / 0.08)' }}>
      <div className="mb-1 flex items-baseline gap-2">
        <span className="flex h-[18px] w-[18px] items-center justify-center rounded-md text-[10px] font-extrabold text-white" style={{ background: 'var(--accent)' }}>{n}</span>
        <h3 className="text-sm font-bold text-[var(--foreground)]">{title}</h3>
      </div>
      <p className="mb-3 text-xs leading-5 text-[var(--muted-foreground)]">{desc}</p>
      {children}
    </section>
  );
}

/* ── 主体 ── */

export function ReportMaterialModal({ open, onClose, data, companyId, analysisPayload }: {
  open: boolean; onClose: () => void; data: DashboardData | null; companyId: string;
  /** AI 分析载荷（dashboard-home 的 bap() 规范形状——与移动端同源） */
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

  /* 维度数据派生（图表口径与页面一致，纯前端计算） */
  const dims = useMemo(() => {
    if (!data) return null;
    const trend = data.trendSeries.map(t => ({ label: t.label, value: t.count, note: t.amount > 0 ? wan(t.amount) : undefined }));
    const dept = [...data.departmentStats].sort((a, b) => b.amount - a.amount).slice(0, 10).map(d => ({ label: d.name, value: d.amount }));
    const methods = [...data.methodStats].sort((a, b) => b.count - a.count).slice(0, 8).map(m => ({ label: m.name, value: m.count }));
    // 规模分层（万元）：≤10 / 10-50 / 50-100 / 100-500 / >500
    const buckets = [0, 0, 0, 0, 0];
    data.trendSeries.forEach(t => t.projects.forEach(p => {
      const s = String(p.budgetLabel || ''); let v = 0;
      if (s.includes('万')) v = parseFloat(s.replace(/万|,/g, '')) * 10000; else v = parseFloat(s.replace(/元|,/g, '')) || 0;
      if (!v) return;
      if (v <= 100000) buckets[0]++; else if (v <= 500000) buckets[1]++; else if (v <= 1e6) buckets[2]++; else if (v <= 5e6) buckets[3]++; else buckets[4]++;
    }));
    const scale = [
      { label: '≤10万', value: buckets[0] }, { label: '10-50万', value: buckets[1] }, { label: '50-100万', value: buckets[2] },
      { label: '100-500万', value: buckets[3] }, { label: '>500万', value: buckets[4] },
    ];
    return { trend, dept, methods, scale };
  }, [data]);

  if (!data || !dims) return null;
  const s = data.summary;
  const doneRate = s.totalCount > 0 ? Math.round((s.completedCount / s.totalCount) * 100) : 0;
  const peak = dims.trend.reduce((m, t) => (t.value > m.value ? t : m), dims.trend[0]);
  const avgPerMonth = dims.trend.length ? (s.totalCount / dims.trend.length).toFixed(1) : '0';
  const deptTop = dims.dept[0];
  const deptTopShare = s.totalBudget > 0 && deptTop ? Math.round((deptTop.value / s.totalBudget) * 100) : 0;
  const mTop = dims.methods[0];
  const mTopShare = s.totalCount > 0 && mTop ? Math.round((mTop.value / s.totalCount) * 100) : 0;
  const smallCount = dims.scale[0].value + dims.scale[1].value;
  const smallShare = s.totalCount > 0 ? Math.round((smallCount / s.totalCount) * 100) : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="3xl"
      icon={<FileDown size={14} />}
      title="采购数据汇报材料"
      description={`${analysisPayload.rangeLabel || '全部区间'} · 共 ${s.totalCount} 项 · 生成于 ${new Date().toLocaleDateString('zh-CN')}`}
      footer={
        <>
          <button onClick={onClose} className="neu-btn-soft">关闭</button>
          <button onClick={() => window.print()} className="neu-btn-primary is-water !h-[38px] gap-1.5">
            <Printer size={14} /> 打印
          </button>
        </>
      }
    >
      <div className="report-print-root flex flex-col gap-4">

        {/* KPI 摘要 */}
        <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
          {[
            { l: '预算总金额', v: s.totalBudgetLabel }, { l: '已成交预算', v: s.awardedBudgetLabel },
            { l: '成交总额', v: s.totalAwardLabel }, { l: '节约资金', v: s.totalSavingsLabel },
            { l: '节资率', v: s.totalBudget > 0 ? `${((s.totalSavings / s.totalBudget) * 100).toFixed(1)}%` : '—' },
            { l: '已成交项目', v: `${s.completedCount}/${s.totalCount}` },
          ].map((k, i) => (
            <div key={i} className="report-sheet rounded-[12px] px-3 py-2.5 text-center" style={{ background: 'oklch(1 0 0 / 0.72)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.8), 2px 2px 6px oklch(0.55 0.03 258 / 0.08)' }}>
              <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">{k.l}</div>
              <div className="mt-1 text-[15px] font-black tabular-nums text-[var(--foreground)]">{k.v}</div>
            </div>
          ))}
        </div>

        {/* AI 综合分析 */}
        <section className="report-sheet rounded-[14px] p-5" style={{ background: 'oklch(1 0 0 / 0.72)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.8), 2px 2px 6px oklch(0.55 0.03 258 / 0.08)' }}>
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
                      {list.slice(0, 4).map((x, i) => <li key={i} className="text-[11px] leading-5 text-[var(--muted-foreground)]">· {x}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        {/* ① 月度采购趋势 */}
        <Section n={1} title="月度采购趋势"
          desc={`各月采购项目数与成交金额（柱上小字为当月成交额）。区间内月均 ${avgPerMonth} 项；峰值 ${peak.label} 共 ${peak.value} 项。`}>
          {dims.trend.length > 0 ? <VBars items={dims.trend} unit="项" /> : <div className="py-6 text-center text-xs text-[var(--muted-foreground)]">区间内无数据</div>}
        </Section>

        {/* ② 部门采购金额 */}
        <Section n={2} title="部门采购金额 Top 10"
          desc={`按已成交计成交额、未成交计预算口径。${deptTop ? `${deptTop.label} 以 ${wan(deptTop.value)} 居首（占预算总额 ${deptTopShare}%）。` : ''}颜色越深金额越大。`}>
          {dims.dept.length > 0 ? <HBars items={dims.dept} fmt={wan} /> : <div className="py-6 text-center text-xs text-[var(--muted-foreground)]">暂无部门数据</div>}
        </Section>

        {/* ③ 采购方式分布 */}
        <Section n={3} title="采购方式分布（Top 8）"
          desc={`按项目数统计。${mTop ? `${mTop.label} 为最主要方式（${mTop.value} 项，占 ${mTopShare}%）。` : ''}`}>
          {dims.methods.length > 0 ? <HBars items={dims.methods} fmt={v => `${v} 项`} /> : <div className="py-6 text-center text-xs text-[var(--muted-foreground)]">暂无方式数据</div>}
        </Section>

        {/* ④ 预算规模分层 */}
        <Section n={4} title="项目预算规模分层"
          desc={`按项目预算金额分档统计件数。小额（50 万及以下）项目 ${smallCount} 项、占 ${smallShare}%；大额（100 万以上）${dims.scale[3].value + dims.scale[4].value} 项。`}>
          <VBars items={dims.scale} unit="项" barW={56} />
        </Section>

        {/* ⑤ 成交状态构成 */}
        <Section n={5} title="成交状态构成"
          desc={`已成交 ${s.completedCount} 项（成交率 ${doneRate}%）；未成交/待处理预算 ${s.pendingBudgetLabel}，成交总额 ${s.totalAwardLabel}。`}>
          <div className="flex h-[22px] w-full overflow-hidden rounded-[5px]">
            <div style={{ width: `${s.totalCount ? (s.completedCount / s.totalCount) * 100 : 0}%`, background: 'oklch(0.55 0.12 164)' }} title={`已成交 ${s.completedCount} 项`} />
            <div style={{ width: '2px', background: 'oklch(1 0 0 / 0.9)' }} />
            <div className="flex-1" style={{ background: 'oklch(0.78 0.06 258)' }} title={`未成交/待处理 ${s.totalCount - s.completedCount} 项`} />
          </div>
          <div className="mt-2 flex justify-between text-[11px]">
            <span className="text-[var(--foreground)]">已成交 {s.completedCount} 项（{doneRate}%）</span>
            <span className="text-[var(--muted-foreground)]">未成交/待处理 {s.totalCount - s.completedCount} 项</span>
          </div>
        </Section>

      </div>
    </Modal>
  );
}
