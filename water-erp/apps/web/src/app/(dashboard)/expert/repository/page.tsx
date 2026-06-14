'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { listExperts, listSpecialties, setExpertAvailability } from '@/lib/api/expert';
import type { ExpertListItem } from '@/lib/api/expert';
import { PlusCircle, Search } from 'lucide-react';

const stageLabel: Record<string, string> = {
  DOWNLOAD: '文件下载', SUBMIT: '加密投递', OPENING: '在线开标',
  EVALUATING: '专家评标', ARCHIVED: '已归档',
};

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
      {/* Header */}
      <div className="flex items-end justify-between gap-4 mb-7 pb-4 border-b border-[#dce3eb]">
        <div>
          <div className="text-[11px] font-extrabold text-[#0756a5] uppercase tracking-[0.1em]">Expert Repository</div>
          <h1 className="mt-1 text-[22px] font-black tracking-[-0.03em] text-[#0f172a]">专家库</h1>
          <p className="mt-1 text-[13px] text-[#64748b]">评审专家目录、专业分类与启停管理。</p>
        </div>
        <button onClick={() => router.push('/expert/entry')} className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-bold text-white bg-[#0756a5] hover:bg-[#06428a] transition">
          <PlusCircle size={15} /> 录入专家
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 border border-[#dce3eb] bg-white mb-5">
        <div className="px-5 py-4 border-r border-[#e9eef4]">
          <div className="text-[22px] font-black text-[#0f172a] tabular-nums">{experts.length}</div>
          <div className="text-[12px] font-semibold text-[#64748b] mt-0.5">专家总数</div>
        </div>
        <div className="px-5 py-4 border-r border-[#e9eef4]">
          <div className="text-[22px] font-black text-[#059669] tabular-nums">{available}</div>
          <div className="text-[12px] font-semibold text-[#64748b] mt-0.5">可用</div>
        </div>
        <div className="px-5 py-4 border-r border-[#e9eef4]">
          <div className="text-[22px] font-black text-[#0f172a] tabular-nums">{inProgress}</div>
          <div className="text-[12px] font-semibold text-[#64748b] mt-0.5">参与项目中</div>
        </div>
        <div className="px-5 py-4">
          <div className="text-[22px] font-black text-[#0f172a] tabular-nums">{completed}</div>
          <div className="text-[12px] font-semibold text-[#64748b] mt-0.5">履职完成</div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border border-[#dce3eb] bg-white mb-4">
        <Search size={15} className="text-[#94a3b8] flex-shrink-0" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索专家姓名" className="flex-1 text-[13px] placeholder:text-[#94a3b8] border-none outline-none bg-transparent" />
        <select value={specialty} onChange={e => setSpecialty(e.target.value)} className="px-3 py-1.5 border border-[#dce3eb] text-[13px] focus:outline-none focus:border-[#0756a5]">
          <option value="">全部专业</option>
          {specialties.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {(search || specialty) && (
          <button onClick={() => { setSearch(''); setSpecialty(''); }} className="text-[13px] text-[#64748b] hover:text-[#0756a5]">重置</button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="py-16 text-center text-[13px] text-[#94a3b8]">加载中...</div>
      ) : experts.length === 0 ? (
        <div className="border border-[#dce3eb] bg-white py-16 text-center">
          <div className="w-12 h-12 mx-auto mb-3 flex items-center justify-center bg-[#f1f5f9] text-[#94a3b8]">
            <Search size={20} />
          </div>
          <p className="text-[14px] font-bold text-[#64748b] mb-1">暂无专家</p>
          <p className="text-[13px] text-[#94a3b8] mb-4">还没有录入评审专家，点击下方按钮录入第一位专家</p>
          <button onClick={() => router.push('/expert/entry')} className="text-[13px] font-bold text-[#0756a5] hover:underline">前往录入专家 →</button>
        </div>
      ) : (
        <div className="border border-[#dce3eb] bg-white">
          {experts.map((e, i) => {
            const activeProjects = e.bidExperts.filter(a => a.project.stage !== 'ARCHIVED');
            return (
              <div key={e.id} className={`flex items-center gap-5 px-5 py-3.5 ${i < experts.length - 1 ? 'border-b border-[#e9eef4]' : ''} hover:bg-[#f8fafc] transition`}>
                {/* Avatar + name */}
                <div className="flex items-center gap-3 min-w-0 flex-[2]" onClick={() => router.push(`/expert/${e.id}`)} style={{cursor:'pointer'}}>
                  <div className="w-9 h-9 flex items-center justify-center bg-[#0756a5] text-white text-[13px] font-extrabold flex-shrink-0">{e.displayName[0]}</div>
                  <div className="min-w-0">
                    <div className="text-[14px] font-extrabold text-[#0f172a] truncate">{e.displayName}</div>
                    <div className="text-[12px] text-[#94a3b8] truncate">{e.expertProfile?.employer || '—'}{e.email && ` · ${e.email}`}</div>
                  </div>
                </div>

                {/* Tags */}
                <div className="flex items-center gap-2 flex-[2] min-w-0">
                  {e.expertProfile?.specialty && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 border border-[#dce3eb] text-[#0756a5] bg-[#e8f4ff] whitespace-nowrap">{e.expertProfile.specialty}</span>
                  )}
                  {e.expertProfile?.title && (
                    <span className="text-[12px] text-[#64748b] truncate">{e.expertProfile.title}</span>
                  )}
                </div>

                {/* Stats */}
                <div className="flex items-center gap-5 text-[12px] text-[#64748b] flex-1">
                  <span className="tabular-nums">项目 {e.bidExperts.length}</span>
                  <span className="tabular-nums">进行中 {activeProjects.length}</span>
                  <span className="tabular-nums">评价 {e._count.expertEvaluations}</span>
                  <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold ${e.isActive ? 'text-[#059669]' : 'text-[#94a3b8]'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${e.isActive ? 'bg-[#059669]' : 'bg-[#94a3b8]'}`} />
                    {e.isActive ? '可用' : '已停用'}
                  </span>
                </div>

                {/* Action */}
                <button onClick={() => toggle(e)} className={`flex-shrink-0 px-3 py-1 text-[12px] font-semibold border transition ${e.isActive ? 'border-[#dce3eb] text-[#64748b] hover:bg-[#f8fafc]' : 'text-white bg-[#0756a5] border-[#0756a5] hover:bg-[#06428a]'}`}>
                  {e.isActive ? '停用' : '启用'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
