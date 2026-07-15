'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getExpertRanking, getLoadDistribution } from '@/lib/api/expert';
import { StatusBadge } from '@/components/workbench';
import { Trophy, RefreshCw, UsersRound, ArrowLeft, Crown, Medal } from 'lucide-react';
import { toast } from 'sonner';

const PERIOD_LABELS: Record<string, string> = { month: '近一月', quarter: '近一季', all: '累计' };

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
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><Trophy size={17} /></div>
            <div><div className="page-hero__title">专家排名</div><div className="page-hero__sub">按评价表现排名，激励专家提升评审质量，辅助抽取决策参考</div></div>
          </div>
          <div className="page-hero__right">
            <button onClick={() => router.push('/expert/repository')} className="neu-btn-soft gap-1"><ArrowLeft size={14} />返回专家库</button>
            <button onClick={load} className="neu-btn-xs"><RefreshCw size={14} /></button>
          </div>
        </div>
        <div className="page-hero__divider">
          <div className="flex items-center gap-2">
            {(Object.entries(PERIOD_LABELS) as [any, string][]).map(([key, label]) => (
              <button key={key} onClick={() => setPeriod(key)} className={`neu-tab ${period === key ? 'is-active' : ''}`}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="neu-table-card py-14 text-center text-sm text-[var(--muted-foreground)]"><RefreshCw size={14} className="animate-spin inline mr-2" />加载中...</div>
      ) : errored ? (
        <div className="neu-table-card py-16 text-center">
          <p className="text-sm font-semibold text-[var(--danger)] mb-3">排名数据加载失败</p>
          <button onClick={load} className="neu-btn-xs is-info">重试</button>
        </div>
      ) : ranking.length === 0 ? (
        <div className="neu-table-card py-16 text-center">
          <Trophy size={36} className="mx-auto text-[var(--muted-foreground)]/40 mb-3" />
          <p className="text-sm text-[var(--muted-foreground)]">该时段暂无评价数据</p>
        </div>
      ) : (
        <>
          {/* Top 3 */}
          <div className="grid grid-cols-3 gap-3">
            {top3.map((r, i) => (
              <div
                key={r.expertUserId}
                className="neu-table-card p-5 text-center cursor-pointer hover:translate-y-[-2px] transition-all"
                onClick={() => router.push(`/expert/${r.expertUserId}`)}
              >
                <div className="mx-auto mb-1 flex h-12 w-12 items-center justify-center rounded-2xl neu-icon-well text-[var(--accent)]">
                  {r.rank === 1 ? <Crown size={22} strokeWidth={1.5} /> : <Medal size={22} strokeWidth={1.5} />}
                </div>
                <div className="mt-2 text-base font-black text-[var(--foreground)]">{r.displayName}</div>
                <div className="text-xs text-[var(--muted-foreground)] mt-0.5">{r.specialty}</div>
                <div className="flex items-center justify-center gap-3 mt-3">
                  <div>
                    <span className="text-2xl font-black text-[var(--accent)] tabular-nums">{r.avgScore}</span>
                    <span className="text-[10px] text-[var(--muted-foreground)] block">均分</span>
                  </div>
                  <div className="w-px h-8 bg-[var(--muted)]/30" />
                  <div>
                    <span className="text-lg font-bold text-[var(--foreground)] tabular-nums">{r.aCount}</span>
                    <span className="text-[10px] text-[var(--muted-foreground)] block">优秀次数</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Ranking table */}
          <div className="neu-table-card">
            <div className="overflow-x-auto">
              <table className="neu-table w-full min-w-[600px]">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>排名</th>
                    <th>专家</th>
                    <th className="text-center">专业</th>
                    <th className="text-center">评价均分</th>
                    <th className="text-center">评价次数</th>
                    <th className="text-center">优秀次数</th>
                  </tr>
                </thead>
                <tbody>
                  {rest.map(r => (
                    <tr key={r.expertUserId} className="row-clickable" onClick={() => router.push(`/expert/${r.expertUserId}`)}>
                      <td className="text-center font-bold tabular-nums text-[var(--muted-foreground)]">{r.rank}</td>
                      <td><span className="text-sm font-bold text-[var(--foreground)]">{r.displayName}</span></td>
                      <td className="text-center">{r.specialty && <StatusBadge tone="blue">{r.specialty}</StatusBadge>}</td>
                      <td className="text-center text-sm font-bold tabular-nums text-[var(--accent)]">{r.avgScore}</td>
                      <td className="text-center text-sm tabular-nums text-[var(--foreground)]">{r.evalCount}</td>
                      <td className="text-center text-sm font-bold tabular-nums text-[var(--success)]">{r.aCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 负荷概览 */}
          {loadData && (
            <div className="neu-table-card p-4">
              <div className="flex items-center gap-2 mb-3"><UsersRound size={15} className="text-[var(--accent)]" /><span className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">负荷分布 · {loadData.totalActiveExperts} 位活跃专家</span></div>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {Object.entries(loadData.loadDistribution).map(([level, count]) => (
                  <div key={level} className="kpi-card flex flex-col gap-1 p-2.5">
                    <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">{level}</span>
                    <span className="text-xl font-black tabular-nums text-[var(--foreground)]">{String(count)}</span>
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
            </div>
          )}
        </>
      )}
    </div>
  );
}
