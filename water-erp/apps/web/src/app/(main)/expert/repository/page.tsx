'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { listExperts, listSpecialties, setExpertAvailability } from '@/lib/api/expert';
import type { ExpertListItem } from '@/lib/api/expert';
import { StatusBadge } from '@/components/workbench';
import { UsersRound, PlusCircle, Search, RefreshCw } from 'lucide-react';

export default function ExpertRepositoryPage() {
  const router = useRouter();
  const [experts, setExperts] = useState<ExpertListItem[]>([]);
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [specialty, setSpecialty] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { setExperts(await listExperts({ search: search || undefined, specialty: specialty || undefined }) as ExpertListItem[]); } catch {}
    setLoading(false);
  }, [search, specialty]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { listSpecialties().then(setSpecialties).catch(() => {}); }, []);

  const toggle = async (e: ExpertListItem) => {
    try { await setExpertAvailability(e.id, !e.isActive); toast.success(e.isActive ? '已停用' : '已启用'); load(); }
    catch (err: any) { toast.error(err?.message || '操作失败'); }
  };

  const total = experts.length;
  const available = experts.filter(e => e.isActive && e.expertProfile?.availability === '可用').length;
  const inProgress = experts.reduce((s, e) => s + e.bidExperts.filter(a => a.project.stage !== 'ARCHIVED').length, 0);
  const completed = experts.reduce((s, e) => s + e.bidExperts.filter(a => a.progress >= 100).length, 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><UsersRound size={17} /></div>
            <div><div className="page-hero__title">专家库</div><div className="page-hero__sub">评审专家目录、专业分类与启停管理，支持按专业和姓名筛选</div></div>
          </div>
          <div className="page-hero__right">
            <button onClick={load} disabled={loading} className="neu-btn-xs"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
            <button onClick={() => router.push('/expert/entry')} className="neu-btn-soft"><PlusCircle size={15} />录入专家</button>
          </div>
        </div>
        <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 items-stretch">
          {[
            ['专家总数', total, '录入总量'],
            ['可用', available, '可参与评审'],
            ['参与项目中', inProgress, '正在评审'],
            ['履职完成', completed, '已完成项目'],
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

      <div className="flex flex-wrap items-center gap-3 rounded-[16px] border border-[color-mix(in_oklch,var(--border)_80%,transparent)] bg-[var(--surface)] px-4 py-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.65),2px_2px_6px_oklch(0.55_0.03_258/0.08),-1px_-1px_3px_oklch(1_0_0/0.85)]">
        <div className="relative min-w-[140px] xl:min-w-[200px] flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] z-10" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索专家姓名" className="neu-input !pl-9" /></div>
        <select value={specialty} onChange={e => setSpecialty(e.target.value)} className="workbench-input !w-auto min-w-[110px]"><option value="">全部专业</option>{specialties.map(s => <option key={s} value={s}>{s}</option>)}</select>
        {(search || specialty) && <button onClick={() => { setSearch(''); setSpecialty(''); }} className="neu-btn-xs">重置</button>}
      </div>

      <div className="neu-table-card">
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[700px]">
            <thead><tr><th>专家</th><th className="text-center">专业</th><th className="text-center">职称</th><th className="text-center">工作单位</th><th className="text-center">参评项目</th><th className="text-center">评价次数</th><th className="text-center">状态</th><th className="text-center">操作</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-16 text-center text-sm text-[var(--muted-foreground)]">加载中...</td></tr>
              ) : experts.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-16">
                  <div className="flex flex-col items-center gap-3">
                    <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl"><UsersRound size={22} className="text-[var(--muted-foreground)]" /></div>
                    <p className="text-sm text-[var(--muted-foreground)]">暂无专家</p>
                    <button onClick={() => router.push('/expert/entry')} className="neu-btn-xs is-info">前往录入专家 →</button>
                  </div>
                </td></tr>
              ) : experts.map(e => {
                const activeProjects = e.bidExperts.filter(a => a.project.stage !== 'ARCHIVED');
                return (
                  <tr key={e.id} className="row-clickable" onClick={() => router.push(`/expert/${e.id}`)}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-extrabold text-white">{e.displayName[0]}</div>
                        <div><div className="text-sm font-bold text-[var(--foreground)] hover:text-[var(--accent)] transition-colors">{e.displayName}</div><div className="text-xs text-[var(--muted-foreground)]">{e.email || '—'}</div></div>
                      </div>
                    </td>
                    <td className="text-center">{e.expertProfile?.specialty && <StatusBadge tone="blue">{e.expertProfile.specialty}</StatusBadge>}</td>
                    <td className="text-center text-sm text-[var(--muted-foreground)]">{e.expertProfile?.title || '—'}</td>
                    <td className="text-center text-sm text-[var(--muted-foreground)]">{e.expertProfile?.employer || '—'}</td>
                    <td className="text-center"><span className="text-sm font-semibold text-[var(--foreground)] tabular-nums">{activeProjects.length}</span><span className="text-xs text-[var(--muted-foreground)] ml-1">/{e.bidExperts.length}</span></td>
                    <td className="text-center text-sm font-semibold text-[var(--foreground)] tabular-nums">{e._count.expertEvaluations}</td>
                    <td className="text-center"><StatusBadge tone={e.isActive ? 'green' : 'gray'}>{e.isActive ? '可用' : '已停用'}</StatusBadge></td>
                    <td onClick={e => e.stopPropagation()} className="text-center">
                      <button onClick={() => toggle(e)} className={e.isActive ? 'neu-btn-xs is-warning' : 'neu-btn-xs is-success'}>{e.isActive ? '停用' : '启用'}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
