'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ClipboardList, ArrowLeft, Building2, FileText, MessageSquare, Calendar, Clock, Lock, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { ExpertProject } from '@/lib/types';
import { PageHero } from '@water-erp/ui';

const stageLabel: Record<string, string> = {
  DOWNLOAD: '文件下载',
  SUBMIT: '加密投递',
  OPENING: '在线开标',
  EVALUATING: '专家评标',
  ARCHIVED: '资料归档',
};

const stageColor: Record<string, string> = {
  OPENING: '#f5a623',
  EVALUATING: '#064ea2',
  ARCHIVED: '#11a874',
};

const stageBg: Record<string, string> = {
  OPENING: '#fff7ed',
  EVALUATING: '#eff6ff',
  ARCHIVED: '#f0fdf4',
};

const stageBorder: Record<string, string> = {
  OPENING: '#fed7aa',
  EVALUATING: '#bfdbfe',
  ARCHIVED: '#bbf7d0',
};

function isActive(stage: string) {
  return stage === 'OPENING' || stage === 'EVALUATING';
}

export default function ExpertProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ExpertProject[]>([]);
  const [filter, setFilter] = useState<'reviewable' | 'archived' | 'all'>('reviewable');
  const [loading, setLoading] = useState(true);
  const [overviewProject, setOverviewProject] = useState<ExpertProject | null>(null);

  useEffect(() => {
    setLoading(true);
    api.get<ExpertProject[]>('/expert/projects')
      .then(setProjects)
      .catch(() => toast.error('加载项目列表失败'))
      .finally(() => setLoading(false));
  }, []);

  // P3: Auto-focus modal close button when opened
  const modalCloseRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (overviewProject && modalCloseRef.current) {
      modalCloseRef.current.focus();
    }
  }, [overviewProject]);

  const filtered = projects.filter(ep => {
    const s = ep.project.stage;
    if (filter === 'reviewable') return isActive(s);
    if (filter === 'archived') return s === 'ARCHIVED';
    return true;
  });

  // P2: single-pass count instead of separate .filter() passes
  const statusCounts = useMemo(() => {
    let all = 0, reviewable = 0, archived = 0;
    for (const ep of projects) {
      all++;
      const s = ep.project.stage;
      if (isActive(s)) reviewable++;
      else if (s === 'ARCHIVED') archived++;
    }
    return { all, reviewable, archived };
  }, [projects]);

  const filterTabs = [
    { key: 'reviewable' as const, label: '可评审', desc: 'OPENING + EVALUATING' },
    { key: 'archived' as const, label: '已归档', desc: 'ARCHIVED' },
    { key: 'all' as const, label: '全部', desc: 'ALL' },
  ];

  const handleCardClick = (ep: ExpertProject) => {
    if (isActive(ep.project.stage)) {
      router.push(`/evaluate/${ep.project.id}`);
    } else {
      setOverviewProject(ep);
    }
  };

  return (
    <div className="space-y-6">
      <PageHero
        tone="purple"
        icon={<ClipboardList size={14} strokeWidth={1.5} />}
        title="评审项目"
        description="查看所有分配给您的评审任务，管理评标进度"
        actions={
          <button
            onClick={() => router.push('/')}
            className="rounded-xl border border-[#dce6f3] bg-white/70 px-4 py-2 text-sm font-bold text-[#5a6d8a] hover:bg-white transition"
          >
            <span className="flex items-center gap-1.5">
              <ArrowLeft size={14} strokeWidth={1.5} />
              返回工作台
            </span>
          </button>
        }
      />

      {/* 筛选标签 — stage-driven */}
      <div className="flex flex-wrap gap-2">
        {filterTabs.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
              filter === f.key
                ? 'bg-[#064ea2]/80 backdrop-blur-sm text-white shadow-sm'
                : 'bg-white/70 text-[#5a6d8a] border border-[#dce6f3] hover:border-[#bfdbfe] hover:text-[#064ea2]'
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
        <div className="glass-card glass-card-blue rounded-2xl p-12 text-center text-sm text-[#8a96aa]">
          加载中...
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card glass-card-blue rounded-2xl p-12 text-center">
          <ClipboardList size={48} strokeWidth={1} className="text-[#cbd5e1] mx-auto mb-4" />
          <h3 className="text-base font-bold text-[#18243a] mb-2">
            {filter === 'reviewable' ? '暂无可评审项目' : filter === 'archived' ? '暂无已归档项目' : '暂无项目'}
          </h3>
          <p className="text-sm text-[#8a96aa]">
            {filter === 'reviewable' ? '请等待管理端启动开标，可评审项目将显示在这里' : '暂无匹配的项目'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(ep => {
            const active = isActive(ep.project.stage);
            const sc = stageColor[ep.project.stage] || '#5a6d8a';
            const sbg = stageBg[ep.project.stage] || '#f8fafc';
            const sbd = stageBorder[ep.project.stage] || '#e5ecf4';

            return (
              <div key={ep.id}
                role="button" tabIndex={0}
                onClick={() => handleCardClick(ep)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCardClick(ep); } }}
                className={`rounded-2xl overflow-hidden transition-all focus-visible:ring-2 focus-visible:ring-[#064ea2] focus-visible:outline-none ${
                  active
                    ? 'glass-card glass-card-lighter glass-card-emerald hover:shadow-sm hover:border-[#bfdbfe] cursor-pointer'
                    : 'glass-card opacity-60 cursor-default'
                }`}
              >
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-12 w-12 items-center justify-center rounded-xl text-lg font-black text-white ${
                        active ? 'bg-[#064ea2]/70 backdrop-blur-sm' : 'bg-[#94a3b8]/50 backdrop-blur-sm'
                      }`}>
                        {ep.project.name[0]}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-black text-[#18243a]">{ep.project.name}</h3>
                          {active && (
                            <span className="relative flex h-2.5 w-2.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                                style={{ backgroundColor: sc }} />
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5"
                                style={{ backgroundColor: sc }} />
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-mono text-[#5a6d8a]">{ep.project.projectCode}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Expert status badges — only show for active projects */}
                      {active && !ep.signedIn && (
                        <span className="inline-flex items-center rounded-full border border-[#fed7aa] bg-[#fff7ed]/60 px-2.5 py-0.5 text-xs font-bold text-[#f5a623]">
                          待核验
                        </span>
                      )}
                      {active && ep.signedIn && !ep.avoidanceConfirmed && (
                        <span className="inline-flex items-center rounded-full border border-[#fed7aa] bg-[#fff7ed]/60 px-2.5 py-0.5 text-xs font-bold text-[#f5a623]">
                          待回避确认
                        </span>
                      )}
                      {ep.progress >= 100 && (
                        <span className="inline-flex items-center rounded-full border border-[#bbf7d0] bg-[#f0fdf4]/60 px-2.5 py-0.5 text-xs font-bold text-[#11a874]">
                          已完成
                        </span>
                      )}
                      {active && ep.signedIn && ep.avoidanceConfirmed && ep.progress < 100 && (
                        <span className="inline-flex items-center rounded-full border border-[#bfdbfe] bg-[#eff6ff]/60 px-2.5 py-0.5 text-xs font-bold text-[#064ea2]">
                          评审中
                        </span>
                      )}
                      {/* Stage badge — always shown, color-coded */}
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold border"
                        style={{ color: sc, backgroundColor: sbg, borderColor: sbd }}>
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
                    <div className="flex-1 h-2.5 bg-white/25 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${ep.progress}%`,
                          background: ep.progress >= 100
                            ? 'linear-gradient(90deg, #11a874, #34d399)'
                            : active
                              ? 'linear-gradient(90deg, #064ea2, #0b63ce)'
                              : 'linear-gradient(90deg, #94a3b8, #cbd5e1)',
                        }}
                      />
                    </div>
                    <span className={`text-sm font-bold w-14 text-right ${active ? 'text-[#064ea2]' : 'text-[#94a3b8]'}`}>
                      {ep.progress}%
                    </span>
                  </div>
                </div>
                <div className={`border-t px-6 py-3 flex items-center justify-between bg-white/40 ${
                  active ? 'border-[#edf2f7] bg-[#f8fafc]' : 'border-[#e5e7eb] bg-[#f9fafb]'
                }`}>
                  <span className="text-xs text-[#5a6d8a]">专业领域：{ep.major || '综合评审'}</span>
                  {active ? (
                    <span className="text-sm font-bold text-[#064ea2] hover:text-[#054280] transition">进入评审 →</span>
                  ) : (
                    <span className="flex items-center gap-1 text-sm font-bold text-[#94a3b8]">
                      <Lock size={12} strokeWidth={1.5} />
                      查看概要
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Overview Modal for inactive projects */}
      {overviewProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          role="dialog" aria-modal="true" aria-label="项目概要"
          onClick={() => setOverviewProject(null)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setOverviewProject(null); } }}>
          <div className="glass-card glass-card-deeper glass-card-blue rounded-2xl shadow-xl max-w-md w-full mx-4 overflow-hidden"
            onClick={e => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOverviewProject(null); } }}>
            {/* Header */}
            <div className="px-6 py-4 border-b border-[#edf2f7] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock size={16} strokeWidth={1.5} className="text-[#8a96aa]" />
                <h3 className="text-base font-bold text-[#18243a]">项目概要</h3>
              </div>
              <button ref={modalCloseRef} onClick={() => setOverviewProject(null)}
                className="rounded-lg p-1.5 text-[#8a96aa] hover:bg-[#f1f5f9] hover:text-[#18243a] transition"
                aria-label="关闭">
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>
            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#94a3b8] to-[#64748b] text-base font-black text-white">
                  {overviewProject.project.name[0]}
                </div>
                <div>
                  <p className="font-bold text-[#18243a]">{overviewProject.project.name}</p>
                  <p className="text-sm font-mono text-[#5a6d8a]">{overviewProject.project.projectCode}</p>
                </div>
              </div>

              <div className="h-px bg-white/30" />

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[#8a96aa] text-xs mb-0.5">当前阶段</p>
                  <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold border"
                    style={{
                      color: stageColor[overviewProject.project.stage] || '#5a6d8a',
                      backgroundColor: stageBg[overviewProject.project.stage] || '#f8fafc',
                      borderColor: stageBorder[overviewProject.project.stage] || '#e5ecf4',
                    }}>
                    {stageLabel[overviewProject.project.stage] || overviewProject.project.stage}
                  </span>
                </div>
                <div>
                  <p className="text-[#8a96aa] text-xs mb-0.5">投标单位</p>
                  <p className="font-semibold text-[#18243a]">{overviewProject.project.suppliers?.length ?? 0} 家</p>
                </div>
                <div>
                  <p className="text-[#8a96aa] text-xs mb-0.5">开标时间</p>
                  <p className="font-semibold text-[#18243a]">
                    {new Date(overviewProject.project.openTime).toLocaleDateString('zh-CN')}
                  </p>
                </div>
                <div>
                  <p className="text-[#8a96aa] text-xs mb-0.5">专业领域</p>
                  <p className="font-semibold text-[#18243a]">{overviewProject.major || '综合评审'}</p>
                </div>
              </div>

              {overviewProject.project.stage === 'ARCHIVED' ? (
                <div className="rounded-xl bg-emerald-50/50 border border-emerald-100/50 px-4 py-3 flex items-start gap-2.5">
                  <ClipboardList size={14} strokeWidth={1.5} className="text-emerald-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-emerald-700">该项目已完成全部评审流程并归档</p>
                    <p className="text-xs text-emerald-600 mt-0.5">
                      归档期意味着招标及评审环节已经结束，所有评分与报告均已定稿。您可以在个人中心查看您的评审记录。
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl bg-amber-50/50 border border-amber-100/50 px-4 py-3 flex items-start gap-2.5">
                  <Lock size={14} strokeWidth={1.5} className="text-amber-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-amber-700">该项目尚未进入开评标阶段</p>
                    <p className="text-xs text-amber-600 mt-0.5">
                      请等待管理端启动开标。开标后，您将可以进入评审向导进行身份核验与专家打分。
                    </p>
                  </div>
                </div>
              )}
            </div>
            {/* Footer */}
            <div className="border-t border-[#edf2f7] bg-white/30 px-6 py-3 flex justify-end">
              <button onClick={() => setOverviewProject(null)}
                className="rounded-xl bg-white/70 border border-[#dce6f3] px-4 py-2 text-sm font-bold text-[#5a6d8a] hover:bg-white transition">
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
