'use client';

import { useEffect, useState } from 'react';
import { getExpertStatistics, type ExpertStatistics } from '@/lib/api/expert';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { BarChart3, RefreshCw, AlertTriangle, Layers, Award, TrendingUp, Activity } from 'lucide-react';
import { LEVEL_LABEL } from '@water-erp/shared';

export default function ExpertStatisticsPage() {
  const router = useRouter();
  const [data, setData] = useState<ExpertStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  const load = async () => {
    setLoading(true); setErrored(false);
    try { setData(await getExpertStatistics()); }
    catch (e: any) { setErrored(true); toast.error(e?.message || '加载统计数据失败'); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  if (loading) return (
    <div className="space-y-5 animate-pulse">
      <div className="neu-card-static !rounded-2xl h-24" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">{[1,2,3,4].map(i => <div key={i} className="neu-card-static !rounded-2xl h-56" />)}</div>
    </div>
  );
  if (errored || !data) return (
    <div className="neu-table-card py-16 text-center">
      <div className="flex flex-col items-center gap-3">
        <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl"><AlertTriangle size={22} className="text-[var(--danger)]" /></div>
        <p className="text-sm font-semibold text-[var(--danger)]">统计数据加载失败</p>
        <button onClick={load} className="neu-btn-soft"><RefreshCw size={15} />重试</button>
      </div>
    </div>
  );

  const maxSpec = Math.max(...data.specialtyDistribution.map(s => s.count), 1);
  const availRate = data.totalExperts > 0 ? Math.round((data.available / data.totalExperts) * 100) : 0;
  const trendTotal = data.monthlyEvalTrend.counts.reduce((s, c) => s + c, 0);
  const trendMax = Math.max(...data.monthlyEvalTrend.counts, 1);
  const GRADE_COLORS: Record<string, string> = { A: 'var(--success)', B: 'var(--accent)', C: 'var(--warning)', D: '#ca8a04', E: 'var(--danger)' };

  return (
    <div className="flex flex-col gap-5">
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><BarChart3 size={17} /></div>
            <div><div className="page-hero__title">专家统计</div><div className="page-hero__sub">专家库整体态势、专业分布、评价趋势与活跃度分析</div></div>
          </div>
          <div className="page-hero__right">
            <button onClick={() => router.push('/expert/repository')} className="neu-btn-soft">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              返回专家库</button>
          </div>
        </div>
        <div className="page-hero__divider">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
            {[
              ['专家总数', data.totalExperts, '入库总量'],
              ['可用', data.available, `占比 ${availRate}%`],
              ['占用中', data.occupied, '正参与评审'],
              ['已停用', data.disabled, '退库/停用'],
              ['近7日分配', data.recentAssigns7d, '专家被分配至项目'],
              ['近30日抽取', data.recentExtractions30d, '专家组组建次数'],
            ].map(([label, value, sub]) => (
              <div key={label} className="kpi-card group flex h-full flex-col gap-1.5 p-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">{label}</span>
                <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{String(value)}</span>
                <span className="min-h-[14px] text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">{sub}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 评价趋势 + 活跃度 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 专业分布 */}
        <section className="neu-card-static !rounded-2xl p-5">
          <h3 className="mb-4 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"><Layers size={13} />专业领域分布</h3>
          <div className="space-y-2.5">
            {data.specialtyDistribution.slice(0, 8).map(s => (
              <div key={s.name} className="flex items-center gap-3">
                <span className="w-[80px] text-xs font-medium text-[var(--foreground)] truncate shrink-0">{s.name}</span>
                <div className="flex-1 h-4 rounded-full bg-[var(--muted)]/30 overflow-hidden">
                  <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${Math.round((s.count / maxSpec) * 100)}%` }} />
                </div>
                <span className="text-xs font-bold tabular-nums text-[var(--muted-foreground)] w-8 text-right">{s.count}</span>
              </div>
            ))}
          </div>
        </section>

        {/* 评价等级分布 */}
        <section className="neu-card-static !rounded-2xl p-5">
          <h3 className="mb-4 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"><Award size={13} />评价等级分布</h3>
          <div className="grid grid-cols-5 gap-2">
            {(['A','B','C','D','E'] as const).map(lv => {
              const count = data.evaluationStats.levelCounts[lv];
              const total = data.evaluationStats.total || 1;
              const pct = Math.round((count / total) * 100);
              const colors: Record<string, string> = { A: 'var(--success)', B: 'var(--accent)', C: 'var(--warning)', D: '#ca8a04', E: 'var(--danger)' };
              return (
                <div key={lv} className="flex flex-col items-center gap-1 p-2">
                  <span className="text-2xl font-black tabular-nums" style={{ color: colors[lv] }}>{lv}</span>
                  <span className="text-[10px] text-[var(--muted-foreground)]">{LEVEL_LABEL[lv]}</span>
                  <span className="text-xs font-bold tabular-nums text-[var(--foreground)]">{count}</span>
                  <div className="w-full h-1.5 rounded-full bg-[var(--muted)]/30 overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: colors[lv] }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
            <span>累计评价 <strong className="tabular-nums text-[var(--foreground)]">{data.evaluationStats.total}</strong> 次</span>
            <span>优良率 <strong className="tabular-nums text-[var(--accent)]">{data.evaluationStats.excellentRatio}%</strong></span>
          </div>
        </section>

        {/* 月度评价趋势 */}
        <section className="neu-card-static !rounded-2xl p-5">
          <h3 className="mb-4 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]">
            <TrendingUp size={13} />月度评价趋势（近12月）
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal text-[var(--accent)] tabular-nums">累计 {trendTotal} 次</span>
          </h3>
          {trendTotal === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2">
              <div className="neu-icon-well flex h-10 w-10 items-center justify-center rounded-xl"><TrendingUp size={16} className="text-[var(--muted-foreground)]" /></div>
              <p className="text-xs text-[var(--muted-foreground)]">近 12 个月暂无评价记录</p>
            </div>
          ) : (
            <div>
              <div className="flex items-end gap-1 h-32">
                {data.monthlyEvalTrend.counts.map((c, i) => {
                  const isCurrent = i === data.monthlyEvalTrend.counts.length - 1;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 h-full" title={`${data.monthlyEvalTrend.labels[i]}：${c} 次`}>
                      {c > 0 && <span className="text-[9px] tabular-nums font-bold text-[var(--foreground)]">{c}</span>}
                      <div
                        className={`w-full rounded-t-md transition-all ${isCurrent ? 'bg-[var(--accent)]' : 'bg-[var(--accent)]/50 hover:bg-[var(--accent)]/80'}`}
                        style={{ height: `${Math.max(Math.round((c / trendMax) * 88), c > 0 ? 6 : 2)}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              {/* 基线 + 月份标签 */}
              <div className="h-px bg-[color-mix(in_oklch,var(--foreground)_12%,transparent)]" />
              <div className="mt-1 flex gap-1">
                {data.monthlyEvalTrend.labels.map((l, i) => (
                  <span key={i} className={`flex-1 text-center text-[9px] tabular-nums ${i === data.monthlyEvalTrend.labels.length - 1 ? 'font-bold text-[var(--accent)]' : 'text-[var(--muted-foreground)]'}`}>{l}</span>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* 最新评价 */}
        <section className="neu-card-static !rounded-2xl p-5">
          <h3 className="mb-3 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]">
            <Activity size={13} />最新评价
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal text-[var(--accent)] tabular-nums">累计 {data.evaluationStats.total} 次</span>
          </h3>
          {data.recentEvals.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8">
              <div className="neu-icon-well flex h-10 w-10 items-center justify-center rounded-xl"><Activity size={16} className="text-[var(--muted-foreground)]" /></div>
              <p className="text-xs text-[var(--muted-foreground)]">暂无评价记录</p>
            </div>
          ) : (
            <div>
              {data.recentEvals.map((e, i) => (
                <button
                  key={i}
                  onClick={() => e.expertUserId && router.push(`/expert/${e.expertUserId}`)}
                  className="flex w-full items-center gap-2.5 px-2 py-2 text-left rounded-lg transition-colors hover:bg-[color-mix(in_oklch,var(--accent)_6%,transparent)]"
                  style={{ boxShadow: i < data.recentEvals.length - 1 ? 'inset 0 -1px 0 oklch(0.6 0.04 258 / 0.08)' : 'none' }}
                  title={e.expertUserId ? `查看 ${e.expert} 的专家档案` : undefined}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-extrabold text-white">{e.expert[0]}</div>
                  <span className="flex-1 min-w-0 truncate text-sm font-bold text-[var(--foreground)]">{e.expert}</span>
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-extrabold text-white" style={{ backgroundColor: GRADE_COLORS[e.level] ?? 'var(--muted-foreground)' }}>{e.level}</span>
                  <span className="w-12 shrink-0 text-[11px] text-[var(--muted-foreground)]">{LEVEL_LABEL[e.level]}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-[var(--muted-foreground)]">{new Date(e.time).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
