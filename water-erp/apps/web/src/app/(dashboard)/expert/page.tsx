'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface ExpertAssignment {
  id: string;
  expertName: string;
  major: string;
  progress: number;
  signedIn: boolean;
  totalScore: number;
  project: { id: string; name: string; stage: string };
}

interface Expert {
  id: string;
  displayName: string;
  email: string | null;
  department: { id: string; name: string } | null;
  bidExperts: ExpertAssignment[];
}

export default function ExpertPage() {
  const router = useRouter();
  const [experts, setExperts] = useState<Expert[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  function loadExperts() {
    setLoading(true);
    const query = search ? `?search=${encodeURIComponent(search)}` : '';
    api.get<Expert[]>(`/expert-admin${query}`)
      .then(setExperts)
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadExperts(); }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[oklch(0.18_0.012_265)]">专家管理</h1>
          <p className="text-sm text-[oklch(0.55_0.01_264)] mt-1">管理评审专家库，查看专家评审记录与统计数据</p>
        </div>
      </div>

      {/* 搜索 */}
      <div className="flex gap-3 mb-6">
        <input
          type="text"
          placeholder="搜索专家姓名..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && loadExperts()}
          className="flex-1 px-4 py-2.5 rounded-lg border border-[oklch(0.91_0.006_264)] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#064ea2]/20 focus:border-[#064ea2]"
        />
        <button
          onClick={loadExperts}
          className="px-5 py-2.5 bg-[#064ea2] text-white rounded-lg text-sm font-semibold hover:bg-[#053f85] transition"
        >
          搜索
        </button>
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5">
          <p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">专家总数</p>
          <p className="text-3xl font-bold text-[#064ea2]">{experts.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5">
          <p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">参与项目中</p>
          <p className="text-3xl font-bold text-[#7c3aed]">
            {experts.reduce((s, e) => s + e.bidExperts.filter(a => a.project.stage !== 'ARCHIVED').length, 0)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5">
          <p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">已完成项目</p>
          <p className="text-3xl font-bold text-[#11a874]">
            {experts.reduce((s, e) => s + e.bidExperts.filter(a => a.progress >= 100).length, 0)}
          </p>
        </div>
      </div>

      {/* 专家列表 */}
      {loading ? (
        <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-12 text-center text-[oklch(0.55_0.01_264)]">加载中...</div>
      ) : experts.length === 0 ? (
        <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-12 text-center">
          <div className="text-5xl mb-4">👥</div>
          <h3 className="text-lg font-bold text-[oklch(0.18_0.012_265)] mb-2">暂无专家</h3>
          <p className="text-sm text-[oklch(0.55_0.01_264)]">当前系统中没有评审专家用户</p>
        </div>
      ) : (
        <div className="space-y-3">
          {experts.map(expert => {
            const activeProjects = expert.bidExperts.filter(a => a.project.stage !== 'ARCHIVED');
            const completedProjects = expert.bidExperts.filter(a => a.progress >= 100);
            const majors = [...new Set(expert.bidExperts.map(a => a.major).filter(Boolean))];

            return (
              <div
                key={expert.id}
                onClick={() => router.push(`/expert/${expert.id}`)}
                className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5 hover:shadow-md hover:border-[oklch(0.80_0.04_258)] transition-all cursor-pointer"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#7c3aed] to-[#a78bfa] flex items-center justify-center text-white text-sm font-bold">
                      {expert.displayName[0]}
                    </div>
                    <div>
                      <h3 className="font-bold text-[oklch(0.18_0.012_265)]">{expert.displayName}</h3>
                      <p className="text-xs text-[oklch(0.55_0.01_264)]">
                        {expert.department?.name || '未分配部门'}
                        {expert.email && ` · ${expert.email}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {majors.slice(0, 2).map(m => (
                      <span key={m} className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-50 text-[#7c3aed]">
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-6 text-sm text-[oklch(0.55_0.01_264)]">
                  <span>参与项目：{expert.bidExperts.length} 个</span>
                  <span>进行中：{activeProjects.length} 个</span>
                  <span>已完成：{completedProjects.length} 个</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
