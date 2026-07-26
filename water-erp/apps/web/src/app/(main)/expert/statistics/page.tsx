'use client';

import { useEffect, useState } from 'react';
import { getExpertStatistics, type ExpertStatistics } from '@/lib/api/expert';
import { StatusBadge } from '@/components/workbench';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { BarChart3, Clock, UsersRound } from 'lucide-react';
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
      <div className="skeleton h-7 w-48 rounded mb-2" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[1,2,3,4].map(i => <div key={i} className="skeleton h-24 rounded-2xl" />)}</div>
    </div>
  );
  if (errored || !data) return (
    <div className="py-24 text-center">
      <p className="text-sm font-semibold text-[var(--danger)] mb-3">统计数据加载失败</p>
      <button onClick={load} className="neu-btn-xs is-info">重试</button>
    </div>
  );

  const maxSpec = Math.max(...data.specialtyDistribution.map(s => s.count), 1);
  const availRate = data.totalExperts > 0 ? Math.round((data.available / data.totalExperts) * 100) : 0;

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
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['专家总数', data.totalExperts, '入库总量'],
              ['可用', data.available, `占比 ${availRate}%`],
              ['占用中', data.occupied, '正参与评审'],
              ['已停用', data.disabled, '退库/停用'],
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
        <div className="neu-table-card p-5">
          <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-4">专业领域分布</h3>
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
        </div>

        {/* 评价等级分布 */}
        <div className="neu-table-card p-5">
          <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-4">评价等级分布</h3>
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
        </div>

        {/* 月度评价趋势 */}
        <div className="neu-table-card p-5">
          <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-4">月度评价趋势（近12月）</h3>
          <div className="flex items-end gap-1 h-32">
            {data.monthlyEvalTrend.counts.map((c, i) => {
              const max = Math.max(...data.monthlyEvalTrend.counts, 1);
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] tabular-nums font-bold text-[var(--foreground)]">{c}</span>
                  <div className="w-full rounded-t-md bg-[var(--accent)]/80 transition-all hover:bg-[var(--accent)]" style={{ height: `${Math.round((c / max) * 100)}%`, minHeight: c > 0 ? 4 : 0 }} />
                  <span className="text-[9px] text-[var(--muted-foreground)]">{data.monthlyEvalTrend.labels[i]}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 近期动态 */}
        <div className="neu-table-card p-5">
          <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-4">近期动态</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="kpi-card flex flex-col gap-1 p-3">
              <div className="flex items-center gap-2"><Clock size={14} className="text-[var(--accent)]" /><span className="text-[10px] font-semibold text-[var(--muted-foreground)]">近7日分配</span></div>
              <span className="text-[1.55rem] font-black tabular-nums text-[var(--foreground)]">{data.recentAssigns7d}</span>
              <span className="text-[10px] text-[var(--muted-foreground)]">专家被分配至项目</span>
            </div>
            <div className="kpi-card flex flex-col gap-1 p-3">
              <div className="flex items-center gap-2"><UsersRound size={14} className="text-[var(--accent)]" /><span className="text-[10px] font-semibold text-[var(--muted-foreground)]">近30日抽取</span></div>
              <span className="text-[1.55rem] font-black tabular-nums text-[var(--foreground)]">{data.recentExtractions30d}</span>
              <span className="text-[10px] text-[var(--muted-foreground)]">专家组组建次数</span>
            </div>
          </div>
          {data.recentEvals.length > 0 && (
            <div className="mt-4 space-y-1.5">
              <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">最新评价</span>
              {data.recentEvals.slice(0, 6).map((e, i) => (
                <div key={i} className="flex items-center justify-between text-xs py-1" style={{ borderBottom: i < 5 ? '1px solid oklch(0.6 0.04 258 / 0.08)' : 'none' }}>
                  <span className="font-medium text-[var(--foreground)] truncate">{e.expert}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge tone={e.level === 'A' ? 'green' : e.level === 'B' ? 'blue' : e.level === 'C' ? 'orange' : e.level === 'D' ? 'orange' : 'red'}>{LEVEL_LABEL[e.level]}</StatusBadge>
                    <span className="tabular-nums font-bold text-[var(--muted-foreground)]">{new Date(e.time).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
