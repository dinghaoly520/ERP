'use client';

/**
 * 开标任务板（只读）——Phase 3 重构。
 * :3007 现为纯开标执行终端：项目全生命周期管理与全部阶段流转归 :3005 采购管理工作台。
 * 本页仅列出「开标中」与「待 :3005 确定开标（截标已过）」的项目，入口只有一个：进入开标大厅。
 */

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Gavel, Clock, KeyRound, FileCheck, UserCheck, AlertTriangle, ExternalLink, ChevronRight } from 'lucide-react';
import { portalURL } from '@water-erp/config';
import { getProjectsDashboard, type DashboardProject } from '@/lib/api/bid';

function fmt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function MiniStat({ icon, label, done, total, tone }: {
  icon: React.ReactNode; label: string; done: number; total: number; tone: 'accent' | 'danger';
}) {
  const color = tone === 'danger' && done > 0 ? 'var(--danger, #e74c3c)' : '#064ea2';
  return (
    <span className="inline-flex items-center gap-1 text-[11px] tabular-nums" style={{ color }} title={`${label} ${done}/${total}`}>
      {icon}
      <b>{done}</b><span className="opacity-50">/{total}</span>
    </span>
  );
}

export default function BidTaskBoard() {
  const router = useRouter();
  const [projects, setProjects] = useState<DashboardProject[] | null>(null);
  const [stageDistribution, setStageDistribution] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    getProjectsDashboard()
      .then(d => { setProjects(d.projects); setStageDistribution(d.stageDistribution); })
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // F9：低频 tick（30s），停留期间到点截标的项目自动移入「待确定开标」
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const opening = (projects ?? []).filter(p => p.stage === 'OPENING');
  // 棘轮化后项目可一直停在 DOWNLOAD 到截标（投递闸门不再要求 SUBMIT），
  // 故「待确定开标」需覆盖 DOWNLOAD+SUBMIT 两个截标已过的前阶段（审查发现 F2）
  const awaitingConfirm = (projects ?? []).filter(p => {
    if (p.stage !== 'DOWNLOAD' && p.stage !== 'SUBMIT') return false;
    const deadline = new Date(p.deadline).getTime();
    return !isNaN(deadline) && deadline <= now;
  });
  const archivedCount = stageDistribution['ARCHIVED'] ?? 0;

  const enterHall = (id: string) => router.push(`/bid/open?id=${id}`);

  return (
    <div className="space-y-5">
      {/* ── 页头 ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-[#064ea2] to-[#0b63ce] text-white shadow-[0_10px_24px_rgba(6,78,162,0.25)]">
            <Gavel size={17} strokeWidth={1.7} />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight text-[#18243a]">开标任务板</h1>
            <p className="text-[11px] text-[#8a96aa]">在线开标执行终端 · 项目管理与阶段流转请前往采购管理工作台（:3005）</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[#eff6ff] px-3 py-1 text-[11px] font-bold text-[#064ea2]">开标中 {opening.length}</span>
          <span className="rounded-full bg-[#fef6e8] px-3 py-1 text-[11px] font-bold text-[#92400e]">待确定开标 {awaitingConfirm.length}</span>
          <span className="rounded-full bg-[#f0faf6] px-3 py-1 text-[11px] font-bold text-[#11a874]">已归档 {archivedCount}</span>
          <button onClick={load} disabled={loading} title="刷新"
            className="rounded-xl border border-[#d5e0ef] bg-white p-2 text-[#5a6d8a] transition hover:border-[#bfdbfe] hover:text-[#064ea2]">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading && !projects ? (
        <div className="flex min-h-[240px] items-center justify-center text-sm text-[#8a96aa]">
          <RefreshCw size={18} className="mr-2 animate-spin" /> 加载开标任务…
        </div>
      ) : (
        <>
          {/* ── 开标中 ── */}
          <section>
            <h2 className="mb-2 text-[11px] font-black uppercase tracking-[0.1em] text-[#5a6d8a]">开标中 · {opening.length}</h2>
            {opening.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#dbe6f3] bg-white/60 px-6 py-10 text-center text-[13px] text-[#8a96aa]">
                暂无开标中的项目。项目在 :3005「按时开标」确定后出现在此处。
              </div>
            ) : (
              <div className="space-y-2.5">
                {opening.map(p => {
                  const total = p.supplierCount;
                  const disputed = p.pendingDisputeCount ?? 0;
                  return (
                    <button key={p.id} onClick={() => enterHall(p.id)}
                      className="group flex w-full flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-[#dbe6f3] bg-white px-5 py-4 text-left shadow-[0_6px_18px_rgba(15,47,87,0.05)] transition-all hover:border-[#064ea2] hover:shadow-[0_10px_28px_rgba(6,78,162,0.12)]">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[12px] font-bold text-[#064ea2]">{p.projectCode}</span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#e0f2fe] px-2 py-0.5 text-[10px] font-bold text-[#0369a1]">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#0ea5e9]" /> 开标中
                          </span>
                        </div>
                        <div className="mt-1 truncate text-sm font-bold tracking-tight text-[#18243a]">{p.name}</div>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-[#8a96aa]">
                        <Clock size={12} /> 开标 {fmt(p.openTime)}
                      </div>
                      <div className="flex items-center gap-3.5">
                        <MiniStat icon={<KeyRound size={11} />} label="解密" done={p.decryptedCount ?? 0} total={total} tone="accent" />
                        <MiniStat icon={<FileCheck size={11} />} label="唱标" done={p.openingRecordedCount ?? 0} total={total} tone="accent" />
                        <MiniStat icon={<UserCheck size={11} />} label="确认" done={p.confirmedCount ?? 0} total={total} tone="accent" />
                        <MiniStat icon={<AlertTriangle size={11} />} label="异议" done={disputed} total={total} tone="danger" />
                      </div>
                      <span className="inline-flex items-center gap-1 rounded-xl bg-[#064ea2] px-3.5 py-2 text-[12px] font-bold text-white transition group-hover:bg-[#054280]">
                        进入开标大厅 <ChevronRight size={13} />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── 待 :3005 确定开标（截标已过的 SUBMIT 项目，仅提示，不可操作）── */}
          <section>
            <h2 className="mb-2 text-[11px] font-black uppercase tracking-[0.1em] text-[#5a6d8a]">待确定开标（截标已过）· {awaitingConfirm.length}</h2>
            {awaitingConfirm.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#edf2f7] bg-white/40 px-6 py-6 text-center text-[12px] text-[#aab6c6]">
                暂无等待确定开标的项目
              </div>
            ) : (
              <div className="space-y-2">
                {awaitingConfirm.map(p => (
                  <div key={p.id} className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-2xl border border-[#edf2f7] bg-white/70 px-5 py-3.5 opacity-80">
                    <div className="min-w-0 flex-1">
                      <span className="mr-2 font-mono text-[12px] font-semibold text-[#8a96aa]">{p.projectCode}</span>
                      <span className="text-[13px] font-semibold text-[#5a6d8a]">{p.name}</span>
                    </div>
                    <span className="text-[11px] tabular-nums text-[#8a96aa]">截标 {fmt(p.deadline)} · {p.supplierSubmitted}/{p.supplierCount} 已投递</span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fef6e8] px-3 py-1 text-[11px] font-bold text-[#92400e]">
                      <Clock size={11} /> 等待 :3005 确定开标
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── 跨端入口 ── */}
          <div className="flex items-center justify-between rounded-2xl border border-[#dbe6f3] bg-gradient-to-r from-[#f8fbff] to-white px-5 py-3.5">
            <p className="text-[12px] text-[#5a6d8a]">
              评分标准 / 评标管理 / 澄清答疑 / 项目归档 → 均在采购管理工作台的项目「开标确认」面板中操作
            </p>
            <a href={portalURL('web', '/projects')} target="_blank" rel="noopener"
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#064ea2] px-3.5 py-2 text-[12px] font-bold text-[#064ea2] transition hover:bg-[#eff6ff]">
              <ExternalLink size={13} /> 前往采购管理工作台
            </a>
          </div>
        </>
      )}
    </div>
  );
}
