'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { listExperts, listSpecialties, setExpertAvailability } from '@/lib/api/expert';
import type { ExpertListItem } from '@/lib/api/expert';
import { DataToolbar, MetricCard, PageHero, SectionCard, StatusBadge } from '@/components/workbench';
import { UsersRound, PlusCircle, Search } from 'lucide-react';

export default function ExpertRepositoryPage() {
  const router = useRouter();
  const [experts, setExperts] = useState<ExpertListItem[]>([]);
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [specialty, setSpecialty] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listExperts({ search: search || undefined, specialty: specialty || undefined });
      setExperts(res as ExpertListItem[]);
    } catch { /* empty */ }
    setLoading(false);
  }, [search, specialty]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { listSpecialties().then(setSpecialties).catch(() => {}); }, []);

  const toggle = async (e: ExpertListItem) => {
    try {
      await setExpertAvailability(e.id, !e.isActive);
      toast.success(e.isActive ? '已停用' : '已启用');
      load();
    } catch (err: any) { toast.error(err?.message || '操作失败'); }
  };

  const total = experts.length;
  const available = experts.filter(e => e.isActive && e.expertProfile?.availability === '可用').length;
  const inProgress = experts.reduce((s, e) => s + e.bidExperts.filter(a => a.project.stage !== 'ARCHIVED').length, 0);
  const completed = experts.reduce((s, e) => s + e.bidExperts.filter(a => a.progress >= 100).length, 0);

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="专家管理中心" title="专家库"
        description="评审专家目录、专业分类与启停管理。支持按专业和姓名筛选。"
        tone="blue" icon={<UsersRound size={14} />}
        actions={<button onClick={() => router.push('/expert/entry')} className="rounded-xl bg-[#064ea2] px-4 py-2 text-sm font-bold text-white hover:bg-[#054280] transition">录入专家</button>}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="专家总数" value={total} tone="blue" icon={<UsersRound size={18} strokeWidth={1.7} />} />
        <MetricCard label="可用" value={available} tone="green" />
        <MetricCard label="参与项目中" value={inProgress} tone="purple" />
        <MetricCard label="履职完成" value={completed} tone="cyan" />
      </div>

      <DataToolbar>
        <div className="flex items-center gap-2 flex-1">
          <Search size={15} className="text-[#94a3b8] flex-shrink-0" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="搜索专家姓名"
            className="workbench-input flex-1 text-sm"
          />
        </div>
        <select value={specialty} onChange={e => setSpecialty(e.target.value)} className="workbench-input text-sm">
          <option value="">全部专业</option>
          {specialties.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {(search || specialty) && (
          <button onClick={() => { setSearch(''); setSpecialty(''); }}
            className="rounded-xl border border-[#dce3eb] px-3 py-2 text-sm font-semibold text-[#5a6d8a] hover:bg-[#f8fafc] transition">
            重置
          </button>
        )}
        <button onClick={load} className="rounded-xl bg-[#064ea2] px-4 py-2 text-sm font-bold text-white hover:bg-[#054280] transition">刷新</button>
      </DataToolbar>

      <SectionCard className="overflow-hidden p-0">
        {loading ? (
          <div className="py-16 text-center text-sm text-[#8a99ad]">加载中...</div>
        ) : experts.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f1f5f9] text-[#94a3b8]">
              <Search size={20} />
            </div>
            <p className="text-sm font-bold text-[#64748b] mb-1">暂无专家</p>
            <p className="text-xs text-[#94a3b8] mb-4">还没有录入评审专家</p>
            <button onClick={() => router.push('/expert/entry')} className="text-sm font-bold text-[#064ea2] hover:underline">前往录入专家 →</button>
          </div>
        ) : (
          <table className="workbench-table">
            <thead className="bg-[#f3f7fc] text-[#5a6d8a]">
              <tr>
                <th className="px-4 py-3">专家</th>
                <th className="px-4 py-3">专业</th>
                <th className="px-4 py-3">职称</th>
                <th className="px-4 py-3">工作单位</th>
                <th className="px-4 py-3">参评项目</th>
                <th className="px-4 py-3">评价次数</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {experts.map(e => {
                const activeProjects = e.bidExperts.filter(a => a.project.stage !== 'ARCHIVED');
                return (
                  <tr key={e.id} className="border-t border-[#edf2f7] hover:bg-[#f8fafc]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#064ea2] text-xs font-extrabold text-white">
                          {e.displayName[0]}
                        </div>
                        <div>
                          <div
                            className="text-sm font-bold text-[#18243a] cursor-pointer hover:text-[#064ea2] transition"
                            onClick={() => router.push(`/expert/${e.id}`)}
                          >
                            {e.displayName}
                          </div>
                          <div className="text-xs text-[#8a99ad]">{e.email || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {e.expertProfile?.specialty && (
                        <StatusBadge tone="blue">{e.expertProfile.specialty}</StatusBadge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-[#5a6d8a]">{e.expertProfile?.title || '—'}</td>
                    <td className="px-4 py-3 text-sm text-[#5a6d8a]">{e.expertProfile?.employer || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-semibold text-[#18243a] tabular-nums">{activeProjects.length}</span>
                      <span className="text-xs text-[#8a99ad] ml-1">/{e.bidExperts.length}</span>
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-[#18243a] tabular-nums">{e._count.expertEvaluations}</td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={e.isActive ? 'green' : 'gray'}>
                        {e.isActive ? '可用' : '已停用'}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggle(e)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                          e.isActive
                            ? 'border border-orange-200 text-orange-700 hover:bg-orange-50'
                            : 'border border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                        }`}
                      >
                        {e.isActive ? '停用' : '启用'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </SectionCard>
    </div>
  );
}
