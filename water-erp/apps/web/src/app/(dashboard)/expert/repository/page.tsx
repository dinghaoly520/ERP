'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { listExperts, listSpecialties, setExpertAvailability } from '@/lib/api/expert';
import type { ExpertListItem } from '@/lib/api/expert';
import { DataToolbar, MetricCard, PageHero, StatusBadge } from '@/components/workbench';
import { PlusCircle, UsersRound } from 'lucide-react';

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
    try { await setExpertAvailability(e.id, !e.isActive); load(); }
    catch (err: any) { alert(err?.message || '操作失败'); }
  };

  const available = experts.filter(e => e.isActive && e.expertProfile?.availability === '可用').length;
  const inProgress = experts.reduce((s, e) => s + e.bidExperts.filter(a => a.project.stage !== 'ARCHIVED').length, 0);
  const completed = experts.reduce((s, e) => s + e.bidExperts.filter(a => a.progress >= 100).length, 0);

  return (
    <div>
      <PageHero
        eyebrow="专家管理中心"
        title="专家库"
        description="评审专家目录、专业分类与启停管理；展示专家资源与履职参与状态。"
        tone="purple"
        icon={<UsersRound size={14} />}
        actions={<button onClick={() => router.push('/expert/entry')} className="inline-flex items-center gap-2 rounded-xl bg-[#7c3aed] px-4 py-2 text-sm font-bold text-white hover:bg-[#6d28d9]"><PlusCircle size={16} /> 录入专家</button>}
      />

      <div className="mt-6 mb-6 grid gap-4 md:grid-cols-4">
        <MetricCard label="专家总数" value={experts.length} tone="purple" />
        <MetricCard label="可用" value={available} tone="green" />
        <MetricCard label="参与项目中" value={inProgress} tone="blue" />
        <MetricCard label="履职完成" value={completed} tone="orange" />
      </div>

      {/* 筛选 */}
      <DataToolbar className="mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索专家姓名" className="flex-1 min-w-[200px] px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#7c3aed]" />
        <select value={specialty} onChange={e => setSpecialty(e.target.value)} className="px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#7c3aed]">
          <option value="">全部专业</option>
          {specialties.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={() => { setSearch(''); setSpecialty(''); }} className="px-4 py-2 text-sm text-[#5a6d8a] hover:text-[#7c3aed] transition">重置</button>
      </DataToolbar>

      {/* 列表 */}
      {loading ? (
        <div className="bg-white rounded-xl border border-[#e5ecf4] p-12 text-center text-[#5a6d8a]">加载中...</div>
      ) : experts.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#e5ecf4] p-12 text-center">
          <div className="text-5xl mb-4">👥</div>
          <h3 className="text-lg font-bold text-[#18243a] mb-2">暂无专家</h3>
          <button onClick={() => router.push('/expert/entry')} className="text-sm text-[#7c3aed] hover:underline">前往录入专家 →</button>
        </div>
      ) : (
        <div className="space-y-3">
          {experts.map(e => {
            const activeProjects = e.bidExperts.filter(a => a.project.stage !== 'ARCHIVED');
            return (
              <div key={e.id} className="bg-white rounded-xl border border-[#e5ecf4] p-5 hover:shadow-md hover:border-[#ddd6fe] transition-all">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3 cursor-pointer" onClick={() => router.push(`/expert/${e.id}`)}>
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#7c3aed] to-[#a78bfa] flex items-center justify-center text-white text-sm font-bold">{e.displayName[0]}</div>
                    <div>
                      <h3 className="font-bold text-[#18243a]">{e.displayName}</h3>
                      <p className="text-xs text-[#5a6d8a]">{e.expertProfile?.employer || '—'}{e.email && ` · ${e.email}`}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {e.expertProfile?.specialty && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-50 text-[#7c3aed]">{e.expertProfile.specialty}</span>}
                    {e.expertProfile?.title && <span className="text-xs text-[#5a6d8a]">{e.expertProfile.title}</span>}
                    <StatusBadge tone={e.isActive ? 'green' : 'gray'}>{e.isActive ? '可用' : '已停用'}</StatusBadge>
                  </div>
                </div>
                <div className="flex items-center gap-6 text-sm text-[#5a6d8a]">
                  <span>参与项目：{e.bidExperts.length} 个</span>
                  <span>进行中：{activeProjects.length} 个</span>
                  <span>获评次数：{e._count.expertEvaluations}</span>
                </div>
                <div className="mt-3 flex justify-end">
                  <button onClick={() => toggle(e)} className={`px-3 py-1 text-xs rounded-lg transition ${e.isActive ? 'text-[#5a6d8a] border border-[#e5ecf4] hover:bg-[#f8fafc]' : 'text-white bg-[#11a874] hover:bg-[#0e8c5f]'}`}>
                    {e.isActive ? '停用' : '启用'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
