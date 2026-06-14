'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { BarChart3, Clock, CheckCircle, TrendingUp, Clipboard, ScrollText, Inbox, Megaphone, Building2, Edit3, MessageSquare, Pencil, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import type { ExpertProject } from '@/lib/types';

export default function ExpertProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ExpertProject[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'active' | 'done'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get<ExpertProject[]>('/expert/projects')
      .then(setProjects)
      .catch(() => toast.error('加载项目列表失败'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = projects.filter(ep => {
    if (filter === 'pending') return !ep.signedIn;
    if (filter === 'active') return ep.signedIn && ep.progress < 100;
    if (filter === 'done') return ep.progress >= 100;
    return true;
  });

  const stageLabel: Record<string, string> = { DOWNLOAD: '文件下载', SUBMIT: '加密投递', OPENING: '在线开标', EVALUATING: '专家评标', ARCHIVED: '资料归档' };
  const statusCounts = {
    all: projects.length,
    pending: projects.filter(e => !e.signedIn).length,
    active: projects.filter(e => e.signedIn && e.progress < 100).length,
    done: projects.filter(e => e.progress >= 100).length,
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[oklch(0.18_0.012_265)]">评审项目</h1>
          <p className="text-sm text-[oklch(0.55_0.01_264)] mt-1">查看所有分配给您的评审任务，管理评标进度</p>
        </div>
        <button onClick={() => router.push('/')} className="px-4 py-2 text-sm text-[#7c3aed] bg-purple-50 rounded-lg hover:bg-purple-100 transition font-semibold">
          ← 返回工作台
        </button>
      </div>

      {/* 筛选标签 */}
      <div className="flex gap-2 mb-6">
        {([
          { key: 'all' as const, label: '全部', color: '#7c3aed' },
          { key: 'pending' as const, label: '待核验', color: '#f5a623' },
          { key: 'active' as const, label: '评审中', color: '#7c3aed' },
          { key: 'done' as const, label: '已完成', color: '#11a874' },
        ]).map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${filter === f.key ? 'text-white shadow-md' : 'bg-white text-[oklch(0.55_0.01_264)] border border-[oklch(0.91_0.006_264)] hover:border-[#c4b5fd]'}`}
            style={filter === f.key ? { backgroundColor: f.color } : {}}>
            {f.label}
            <span className={`ml-1.5 text-xs ${filter === f.key ? 'text-white/80' : ''}`}>({statusCounts[f.key]})</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-12 text-center text-[oklch(0.55_0.01_264)]">加载中...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-12 text-center">
          <div className="text-5xl mb-4">📭</div>
          <h3 className="text-lg font-bold text-[oklch(0.18_0.012_265)] mb-2">暂无{filter === 'all' ? '' : '符合条件的'}项目</h3>
          <p className="text-sm text-[oklch(0.55_0.01_264)]">请等待管理员分配评审任务</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(ep => (
            <div key={ep.id}
              className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] hover:shadow-lg hover:border-[#c4b5fd] transition-all cursor-pointer overflow-hidden"
              onClick={() => router.push(`/evaluate/${ep.project.id}`)}>
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#7c3aed] to-[#a78bfa] flex items-center justify-center text-white text-lg font-bold">
                      {ep.project.name[0]}
                    </div>
                    <div>
                      <h3 className="font-bold text-lg text-[oklch(0.18_0.012_265)]">{ep.project.name}</h3>
                      <p className="text-sm text-[oklch(0.55_0.01_264)]">{ep.project.projectCode}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!ep.signedIn && <span className="text-xs bg-amber-50 text-amber-600 px-3 py-1 rounded-full font-semibold">⚠ 待核验</span>}
                    {ep.signedIn && !ep.avoidanceConfirmed && <span className="text-xs bg-amber-50 text-amber-600 px-3 py-1 rounded-full font-semibold">⚠ 待回避确认</span>}
                    {ep.progress >= 100 && <span className="text-xs bg-emerald-50 text-emerald-600 px-3 py-1 rounded-full font-semibold">✓ 已完成</span>}
                    {ep.signedIn && ep.avoidanceConfirmed && ep.progress < 100 && <span className="text-xs bg-purple-50 text-[#7c3aed] px-3 py-1 rounded-full font-semibold">⏳ 评审中</span>}
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ color: ep.project.stage === 'EVALUATING' ? '#7c3aed' : '#5a6d8a', backgroundColor: ep.project.stage === 'EVALUATING' ? '#f3e8ff' : '#f0f4f8' }}>
                      {stageLabel[ep.project.stage] || ep.project.stage}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-6 text-sm text-[oklch(0.55_0.01_264)] mb-4">
                  <span>🏢 {ep.project.suppliers?.length ?? 0} 家投标单位</span>
                  <span>📝 {ep.project.scoreItems?.length ?? 0} 项评分</span>
                  <span>💬 {ep.project._count?.clarifications ?? 0} 条澄清</span>
                  <span>📅 开标：{new Date(ep.project.openTime).toLocaleDateString('zh-CN')}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2.5 bg-[oklch(0.94_0.004_264)] rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${ep.progress}%`, background: ep.progress >= 100 ? 'linear-gradient(90deg, #11a874, #34d399)' : 'linear-gradient(90deg, #7c3aed, #a78bfa)' }} />
                  </div>
                  <span className="text-sm font-bold text-[#7c3aed] w-14 text-right">{ep.progress}%</span>
                </div>
              </div>
              <div className="border-t border-[oklch(0.91_0.006_264)] bg-[#fafcfe] px-6 py-3 flex items-center justify-between">
                <span className="text-xs text-[oklch(0.55_0.01_264)]">专业领域：{ep.major || '综合评审'}</span>
                <button className="text-sm font-semibold text-[#7c3aed] hover:text-[#6d28d9] transition">进入评审 →</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
