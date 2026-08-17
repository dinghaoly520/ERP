'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getExpertRanking, getLoadDistribution } from '@/lib/api/expert';
import { StatusBadge, TableSkeleton } from '@/components/workbench';
import { Crown, Medal, RefreshCw, Trophy, AlertTriangle, Activity } from 'lucide-react';
import { toast } from 'sonner';
import type { WorkbenchTone } from '@water-erp/shared';

const PERIOD_LABELS: Record<string, string> = { month: '近一月', quarter: '近一季', all: '累计' };

const SPECIALTY_TONES: WorkbenchTone[] = ['blue', 'cyan', 'green', 'orange', 'red', 'purple'];
function specialtyTone(s: string): WorkbenchTone {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  return SPECIALTY_TONES[Math.abs(hash) % SPECIALTY_TONES.length];
}

// 前三名奖牌色：金 / 银 / 铜
const MEDAL_COLORS = ['#d4a017', '#94a3b8', '#b45309'];

export default function ExpertRankingPage() {
  const router = useRouter();
  const [period, setPeriod] = useState<'month' | 'quarter' | 'all'>('all');
  const [ranking, setRanking] = useState<any[]>([]);
  const [loadData, setLoadData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  const load = async () => {
    setLoading(true); setErrored(false);
    try {
      const [r, l] = await Promise.all([getExpertRanking(period), getLoadDistribution()]);
      setRanking(r);
      setLoadData(l);
    } catch (e: any) {
      setErrored(true);
      toast.error(e?.message || '加载排名数据失败');
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, [period]);

  const top3 = ranking.slice(0, 3);
  const rest = ranking.slice(3);

  return (
    <div className="flex flex-col gap-5">
      {/* ══════ page-hero ══════ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><Trophy size={17} /></div>
            <div><div className="page-hero__title">专家排名</div><div className="page-hero__sub">按评价表现排名，激励专家提升评审质量，辅助抽取决策参考</div></div>
          </div>
          <div className="page-hero__right">
            <button onClick={load} disabled={loading} className="neu-btn-xs" aria-label="刷新"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
            <button onClick={() => router.push('/expert/repository')} className="neu-btn-soft">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              返回专家库</button>
          </div>
        </div>
      </div>

      {/* ══════ 时段切换 ══════ */}
      <div className="wb-toolbar">
        <div className="neu-tab-bar">
          {(Object.entries(PERIOD_LABELS) as [any, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setPeriod(key)} className={`neu-tab ${period === key ? 'is-active' : ''}`}>{label}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="neu-table-card"><table className="neu-table w-full min-w-[500px]"><tbody><TableSkeleton cols={6} rows={5} /></tbody></table></div>
      ) : errored ? (
        <div className="neu-table-card py-16 text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl"><AlertTriangle size={22} className="text-[var(--danger)]" /></div>
            <p className="text-sm font-semibold text-[var(--danger)]">排名数据加载失败</p>
            <button onClick={load} className="neu-btn-soft"><RefreshCw size={15} />重试</button>
          </div>
        </div>
      ) : ranking.length === 0 ? (
        <div className="neu-table-card py-16 text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl"><Trophy size={22} className="text-[var(--muted-foreground)]" /></div>
            <p className="text-sm text-[var(--muted-foreground)]">该时段暂无评价数据</p>
          </div>
        </div>
      ) : (
        <>
          {/* ══════ Top 3 ══════ */}
          <div className="grid grid-cols-3 gap-3">
            {top3.map((r, i) => (
              <div
                key={r.expertUserId}
                className="neu-card-static !rounded-2xl p-5 text-center cursor-pointer hover:translate-y-[-2px] transition-all"
                onClick={() => router.push(`/expert/${r.expertUserId}`)}
              >
                <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl neu-icon-well" style={{ color: MEDAL_COLORS[i] }}>
                  {r.rank === 1 ? <Crown size={22} strokeWidth={1.5} /> : <Medal size={22} strokeWidth={1.5} />}
                </div>
                <div className="flex items-center justify-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-extrabold text-white">{r.displayName[0]}</div>
                  <span className="text-base font-black text-[var(--foreground)] truncate">{r.displayName}</span>
                </div>
                <div className="mt-1.5">{r.specialty && <StatusBadge tone={specialtyTone(r.specialty)}>{r.specialty}</StatusBadge>}</div>
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--border)] pt-3">
                  <div>
                    <span className="text-2xl font-black text-[var(--accent)] tabular-nums">{r.weightedScore}</span>
                    <span className="text-[10px] text-[var(--muted-foreground)] block">综合得分</span>
                  </div>
                  <div>
                    <span className="text-sm font-black text-[var(--foreground)] tabular-nums">{r.aCount}</span>
                    <span className="text-[10px] text-[var(--muted-foreground)] block">A级×{r.aCount}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* ══════ 排名表格 ══════ */}
          <div className="neu-table-card">
            <div className="overflow-x-auto">
              <table className="neu-table w-full min-w-[500px]">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>排名</th>
                    <th>专家</th>
                    <th className="text-center">专业</th>
                    <th className="text-center">评价次数</th>
                    <th className="text-center">综合得分</th>
                    <th className="text-center">A 级次数</th>
                  </tr>
                </thead>
                <tbody>
                  {rest.map(r => (
                    <tr key={r.expertUserId} className="row-clickable" onClick={() => router.push(`/expert/${r.expertUserId}`)}>
                      <td className="text-center font-bold tabular-nums text-[var(--muted-foreground)]">{r.rank}</td>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-extrabold text-white">{r.displayName[0]}</div>
                          <span className="text-sm font-bold text-[var(--foreground)] truncate hover:text-[var(--accent)] transition-colors">{r.displayName}</span>
                        </div>
                      </td>
                      <td className="text-center">{r.specialty && <StatusBadge tone={specialtyTone(r.specialty)}>{r.specialty}</StatusBadge>}</td>
                      <td className="text-center text-sm tabular-nums text-[var(--foreground)]">{r.evalCount}</td>
                      <td className="text-center text-sm font-bold tabular-nums text-[var(--accent)]">{r.weightedScore}</td>
                      <td className="text-center text-sm font-bold tabular-nums text-[var(--success)]">{r.aCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ══════ 负荷概览 ══════ */}
          {loadData && (
            <section className="neu-card-static !rounded-2xl p-5">
              <h3 className="mb-4 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]">
                <Activity size={13} />负荷分布 · {loadData.totalActiveExperts} 位活跃专家
              </h3>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {Object.entries(loadData.loadDistribution).map(([level, count]) => (
                  <div key={level} className="kpi-card group flex h-full flex-col gap-1.5 p-3">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">{level}</span>
                    <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{String(count)}</span>
                  </div>
                ))}
              </div>
              {loadData.busyExperts?.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">繁忙/过载专家（≥3 个活跃项目）</span>
                  {loadData.busyExperts.map((e: any) => (
                    <div key={e.userId} className="flex items-center justify-between text-xs py-1 px-2 rounded-lg bg-[color-mix(in_oklch,var(--warning)_6%,transparent)]">
                      <span className="font-medium text-[var(--foreground)]">{e.displayName}</span>
                      <span className="text-[var(--warning)]">{e.level} · {e.activeProjects}个项目</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
