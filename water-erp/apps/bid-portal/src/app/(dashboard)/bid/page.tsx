'use client';

/**
 * 开标任务板（只读）。
 * :3007 为纯开标执行终端：仅展示进行中项目（开标中 / 评标中），已归档移至归档端。
 * 项目全生命周期管理与全部阶段流转归 :3005 采购管理工作台。
 */

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Clock, KeyRound, FileCheck, UserCheck, Shield, AlertTriangle, ChevronRight, History, X } from 'lucide-react';
import { getProjectsDashboard, type DashboardProject } from '@/lib/api/bid';
import { getRecentProjects, removeRecentProject, type RecentProject } from '@/lib/storage';

function fmt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function MiniStat({ icon, label, done, total, tone }: {
  icon: React.ReactNode; label: string; done: number; total: number; tone: 'accent' | 'danger';
}) {
  const danger = tone === 'danger' && done > 0;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] tabular-nums ${danger ? 'text-[var(--danger)]' : 'text-[color:var(--accent-strong)]'}`}
      title={`${label} ${done}/${total}`}
    >
      {icon}
      <b className="font-bold">{done}</b><span className="opacity-50">/{total}</span>
    </span>
  );
}

export default function BidTaskBoard() {
  const router = useRouter();
  const [projects, setProjects] = useState<DashboardProject[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [recent, setRecent] = useState<RecentProject[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    getProjectsDashboard()
      .then(d => { setProjects(d.projects); })
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setRecent(getRecentProjects()); }, []);

  const opening = (projects ?? []).filter(p => p.stage === 'OPENING');
  // 评标中 / 已结束：dashboard 已返回全阶段项目，前端分组渲染为可进入工作区的入口
  // （评标管理 tab 现从 OPENING 起启用，故 EVALUATING 项目可直达评标 tab 看真实数据）
  const evaluating = (projects ?? []).filter(p => p.stage === 'EVALUATING');


  const enterHall = (id: string) => router.push(`/bid/project/${id}`);

  return (
    <div className="space-y-5">
      {loading && !projects ? (
        <div className="flex min-h-[240px] items-center justify-center text-sm text-[color:var(--muted-foreground)]">
          <RefreshCw size={18} className="mr-2 animate-spin" /> 加载开标任务…
        </div>
      ) : (
        <>
          {/* ── 开标中 ── */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-[15px] font-bold tracking-tight text-[color:var(--foreground)]">
              <span className="h-4 w-1 rounded-full bg-[oklch(0.6_0.15_210)]" />
              开标中
              <span className="rounded-full bg-[oklch(0.62_0.16_210_/_0.12)] px-2 py-0.5 text-[11px] font-bold tabular-nums text-[oklch(0.5_0.13_210)]">{opening.length}</span>
            </h2>
            {opening.length === 0 ? (
              <div className="neu-card-static px-6 py-10 text-center text-[13px] text-[color:var(--muted-foreground)]">
                暂无开标中的项目。项目在 :3005「按时开标」确定后出现在此处。
              </div>
            ) : (
              <div className="space-y-2.5">
                {opening.map(p => {
                  const total = p.supplierCount;
                  const disputed = p.pendingDisputeCount ?? 0;
                  return (
                    <button key={p.id} type="button" onClick={() => enterHall(p.id)}
                      className="neu-card group flex w-full flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 text-left">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[12px] font-bold text-[color:var(--accent-strong)]">{p.projectCode}</span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-[oklch(0.62_0.16_210_/_0.12)] px-2 py-0.5 text-[10px] font-bold text-[oklch(0.5_0.13_210)]">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[oklch(0.6_0.15_210)]" /> 开标中
                          </span>
                        </div>
                        <div className="mt-1 truncate text-sm font-bold tracking-tight text-[color:var(--foreground)]">{p.name}</div>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-[color:var(--muted-foreground)]">
                        <Clock size={12} /> 开标 {fmt(p.openTime)}
                      </div>
                      <div className="flex items-center gap-3.5">
                        <MiniStat icon={<KeyRound size={11} />} label="解密" done={p.decryptedCount ?? 0} total={total} tone="accent" />
                        <MiniStat icon={<FileCheck size={11} />} label="唱标" done={p.openingRecordedCount ?? 0} total={total} tone="accent" />
                        <MiniStat icon={<UserCheck size={11} />} label="确认" done={p.confirmedCount ?? 0} total={total} tone="accent" />
                        <MiniStat icon={<AlertTriangle size={11} />} label="异议" done={disputed} total={total} tone="danger" />
                      </div>
                      <span className="neu-btn-primary pointer-events-none !h-[34px] !px-3.5 text-[12px]">
                        进入开标大厅 <ChevronRight size={13} />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── 评标中（只读监测：进入工作区默认评标 tab，看真实评标数据）── */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-[15px] font-bold tracking-tight text-[color:var(--foreground)]">
              <span className="h-4 w-1 rounded-full bg-[oklch(0.55_0.12_150)]" />
              评标中
              <span className="rounded-full bg-[oklch(0.7_0.12_150_/_0.14)] px-2 py-0.5 text-[11px] font-bold tabular-nums text-[oklch(0.45_0.1_150)]">{evaluating.length}</span>
            </h2>
            {evaluating.length === 0 ? (
              <div className="neu-card-static px-6 py-8 text-center text-[12px] text-[color:var(--muted-foreground)]">
                暂无评标中的项目。:3005 启动评标后项目出现在此处，可在此只读查看评标进展。
              </div>
            ) : (
              <div className="space-y-2.5">
                {evaluating.map(p => (
                  <button key={p.id} type="button" onClick={() => enterHall(p.id)}
                    className="neu-card group flex w-full flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 text-left">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12px] font-bold text-[color:var(--accent-strong)]">{p.projectCode}</span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-[oklch(0.7_0.12_150_/_0.14)] px-2 py-0.5 text-[10px] font-bold text-[oklch(0.45_0.1_150)]">
                          <span className="h-1.5 w-1.5 rounded-full bg-[oklch(0.55_0.12_150)]" /> 评标中
                        </span>
                      </div>
                      <div className="mt-1 truncate text-sm font-bold tracking-tight text-[color:var(--foreground)]">{p.name}</div>
                    </div>
                    <div className="flex items-center gap-3.5">
                      <MiniStat icon={<UserCheck size={11} />} label="专家签到" done={p.expertSignedIn} total={p.expertCount} tone="accent" />
                      <MiniStat icon={<Shield size={11} />} label="投标" done={p.supplierCount} total={p.supplierCount} tone="accent" />
                    </div>
                    <span className="neu-btn-primary pointer-events-none !h-[34px] !px-3.5 text-[12px]">
                      查看评标 <ChevronRight size={13} />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* ── 最近访问 ── */}
          {recent.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-[15px] font-bold tracking-tight text-[color:var(--foreground)]">
                <History size={16} strokeWidth={1.8} className="text-[color:var(--muted-foreground)]" />
                最近访问
              </h2>
              <div className="neu-card-static divide-y divide-[oklch(0.6_0.04_258_/_0.1)] p-0">
                {recent.map(p => (
                  <div key={p.id} className="group flex items-center gap-3 px-5 py-3">
                    <button
                      type="button"
                      onClick={() => enterHall(p.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span className="shrink-0 font-mono text-[12px] font-bold text-[color:var(--accent-strong)]">{p.projectCode}</span>
                      <span className="truncate text-sm font-medium text-[color:var(--foreground)]">{p.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeRecentProject(p.id); setRecent(getRecentProjects()); }}
                      className="shrink-0 rounded p-1 text-[color:var(--muted-foreground)] opacity-0 transition-all hover:bg-[oklch(0.66_0.175_27_/_0.1)] hover:text-[var(--danger)] group-hover:opacity-100"
                      title="移除此记录"
                    >
                      <X size={13} strokeWidth={1.5} />
                    </button>
                    <ChevronRight size={14} className="shrink-0 text-[color:var(--muted-foreground)]" />
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
