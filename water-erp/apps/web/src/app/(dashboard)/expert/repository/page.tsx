'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { listExperts, listSpecialties, setExpertAvailability } from '@/lib/api/expert';
import type { ExpertListItem } from '@/lib/api/expert';

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
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="mb-2 inline-flex rounded-full border border-[#ddd6fe] bg-[#f5f3ff] px-3 py-1 text-xs font-semibold text-[#7c3aed]">专家管理中心</div>
          <h1 className="text-2xl font-bold text-[#0f2f57]">专家库</h1>
          <p className="text-sm text-[#5a6d8a] mt-1">评审专家目录、专业分类与启停管理</p>
        </div>
        <button onClick={() => router.push('/expert/entry')} className="rounded-xl bg-[#7c3aed] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6d28d9] transition">+ 录入专家</button>
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: '专家总数', value: experts.length, color: '#7c3aed' },
          { label: '可用', value: available, color: '#11a874' },
          { label: '参与项目中', value: inProgress, color: '#064ea2' },
          { label: '履职完成', value: completed, color: '#f5a623' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-[#e5ecf4] p-5">
            <p className="text-xs text-[#5a6d8a] mb-1">{s.label}</p>
            <p className="text-3xl font-bold" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* 筛选 */}
      <div className="bg-white rounded-xl border border-[#e5ecf4] p-4 mb-4 flex gap-3 items-center flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索专家姓名" className="flex-1 min-w-[200px] px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#7c3aed]" />
        <select value={specialty} onChange={e => setSpecialty(e.target.value)} className="px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#7c3aed]">
          <option value="">全部专业</option>
          {specialties.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={() => { setSearch(''); setSpecialty(''); }} className="px-4 py-2 text-sm text-[#5a6d8a] hover:text-[#7c3aed] transition">重置</button>
      </div>

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
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${e.isActive ? 'bg-[#e7f7ef] text-[#11a874]' : 'bg-[#f1f5f9] text-[#95a5a6]'}`}>{e.isActive ? '可用' : '已停用'}</span>
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
