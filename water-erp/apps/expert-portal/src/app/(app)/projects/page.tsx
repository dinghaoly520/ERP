'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ClipboardList, ArrowLeft, Building2, FileText, MessageSquare, Calendar } from 'lucide-react';
import { api } from '@/lib/api';
import type { ExpertProject } from '@/lib/types';
import { PageHero, SectionCard } from '@water-erp/ui';

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

  const filterTabs = [
    { key: 'all' as const, label: '全部', tone: 'purple' as const },
    { key: 'pending' as const, label: '待核验', tone: 'orange' as const },
    { key: 'active' as const, label: '评审中', tone: 'purple' as const },
    { key: 'done' as const, label: '已完成', tone: 'green' as const },
  ];

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="评审项目"
        tone="purple"
        icon={<ClipboardList size={14} strokeWidth={1.5} />}
        title="评审项目"
        description="查看所有分配给您的评审任务，管理评标进度"
        actions={
          <button
            onClick={() => router.push('/')}
            className="rounded-xl border border-[#dce6f3] bg-white px-4 py-2 text-sm font-bold text-[#5a6d8a] hover:bg-[#f8fafc] transition"
          >
            <span className="flex items-center gap-1.5">
              <ArrowLeft size={14} strokeWidth={1.5} />
              返回工作台
            </span>
          </button>
        }
      />

      {/* 筛选标签 — pill-style matching web/supplier pattern */}
      <div className="flex flex-wrap gap-2">
        {filterTabs.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
              filter === f.key
                ? 'bg-[#064ea2] text-white shadow-sm'
                : 'bg-white text-[#5a6d8a] border border-[#dce6f3] hover:border-[#bfdbfe] hover:text-[#064ea2]'
            }`}
          >
            {f.label}
            <span className={`ml-1.5 text-xs ${filter === f.key ? 'text-white/70' : 'text-[#8a96aa]'}`}>
              ({statusCounts[f.key]})
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-2xl border border-[#e5ecf4] bg-white p-12 text-center text-sm text-[#8a96aa]">
          加载中...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-[#e5ecf4] bg-white p-12 text-center">
          <ClipboardList size={48} strokeWidth={1} className="text-[#cbd5e1] mx-auto mb-4" />
          <h3 className="text-base font-bold text-[#18243a] mb-2">暂无{filter === 'all' ? '' : '符合条件的'}项目</h3>
          <p className="text-sm text-[#8a96aa]">请等待管理员分配评审任务</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(ep => (
            <div key={ep.id}
              className="rounded-2xl border border-[#e5ecf4] bg-white hover:shadow-sm hover:border-[#bfdbfe] transition-all cursor-pointer overflow-hidden"
              onClick={() => router.push(`/evaluate/${ep.project.id}`)}
            >
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#064ea2] to-[#0b63ce] text-lg font-black text-white">
                      {ep.project.name[0]}
                    </div>
                    <div>
                      <h3 className="text-base font-black text-[#18243a]">{ep.project.name}</h3>
                      <p className="text-sm font-mono text-[#5a6d8a]">{ep.project.projectCode}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!ep.signedIn && (
                      <span className="inline-flex items-center rounded-full border border-[#fed7aa] bg-[#fff7ed] px-2.5 py-0.5 text-xs font-bold text-[#f5a623]">
                        待核验
                      </span>
                    )}
                    {ep.signedIn && !ep.avoidanceConfirmed && (
                      <span className="inline-flex items-center rounded-full border border-[#fed7aa] bg-[#fff7ed] px-2.5 py-0.5 text-xs font-bold text-[#f5a623]">
                        待回避确认
                      </span>
                    )}
                    {ep.progress >= 100 && (
                      <span className="inline-flex items-center rounded-full border border-[#bbf7d0] bg-[#f0fdf4] px-2.5 py-0.5 text-xs font-bold text-[#11a874]">
                        已完成
                      </span>
                    )}
                    {ep.signedIn && ep.avoidanceConfirmed && ep.progress < 100 && (
                      <span className="inline-flex items-center rounded-full border border-[#bfdbfe] bg-[#eff6ff] px-2.5 py-0.5 text-xs font-bold text-[#064ea2]">
                        评审中
                      </span>
                    )}
                    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold"
                      style={{
                        color: ep.project.stage === 'EVALUATING' ? '#064ea2' : '#5a6d8a',
                        backgroundColor: ep.project.stage === 'EVALUATING' ? '#eff6ff' : '#f8fafc',
                        borderColor: ep.project.stage === 'EVALUATING' ? '#bfdbfe' : '#e5ecf4',
                      }}>
                      {stageLabel[ep.project.stage] || ep.project.stage}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-6 text-sm text-[#5a6d8a] mb-4">
                  <span className="flex items-center gap-1.5">
                    <Building2 size={14} strokeWidth={1.5} />
                    {ep.project.suppliers?.length ?? 0} 家投标单位
                  </span>
                  <span className="flex items-center gap-1.5">
                    <FileText size={14} strokeWidth={1.5} />
                    {ep.project.scoreItems?.length ?? 0} 项评分
                  </span>
                  <span className="flex items-center gap-1.5">
                    <MessageSquare size={14} strokeWidth={1.5} />
                    {ep.project._count?.clarifications ?? 0} 条澄清
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Calendar size={14} strokeWidth={1.5} />
                    开标：{new Date(ep.project.openTime).toLocaleDateString('zh-CN')}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2.5 bg-[#e8f0fa] rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${ep.progress}%`,
                        background: ep.progress >= 100
                          ? 'linear-gradient(90deg, #11a874, #34d399)'
                          : 'linear-gradient(90deg, #064ea2, #0b63ce)',
                      }}
                    />
                  </div>
                  <span className="text-sm font-bold text-[#064ea2] w-14 text-right">{ep.progress}%</span>
                </div>
              </div>
              <div className="border-t border-[#edf2f7] bg-[#f8fafc] px-6 py-3 flex items-center justify-between">
                <span className="text-xs text-[#5a6d8a]">专业领域：{ep.major || '综合评审'}</span>
                <span className="text-sm font-bold text-[#064ea2] hover:text-[#054280] transition">进入评审 →</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
