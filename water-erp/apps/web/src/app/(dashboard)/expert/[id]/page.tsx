'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { AlertBanner, Breadcrumb } from '@/components/workbench';
import { useExpertAlerts } from '@/lib/hooks/use-alerts';
import { ArrowLeft } from 'lucide-react';

interface ScoreRecord { id: string; score: number; reason: string | null; scoreItem: { name: string; category: string; maxScore: number }; }
interface Assignment {
  id: string; expertName: string; major: string; progress: number;
  signedIn: boolean; avoidanceConfirmed: boolean; totalScore: number;
  project: { id: string; projectCode: string; name: string; stage: string; procurementMethod: string; openTime: string };
  scoreRecords: ScoreRecord[];
}
interface ExpertDetail {
  id: string; username: string; displayName: string; email: string | null;
  department: { id: string; name: string } | null; createdAt: string;
  assignments: Assignment[];
  statistics: { totalProjects: number; completedProjects: number; signedInProjects: number };
}

const stageMap: Record<string, { label: string; color: string; bg: string }> = {
  DOWNLOAD: { label: '文件下载', color: '#0891b2', bg: '#0891b214' },
  SUBMIT: { label: '加密投递', color: '#0756a5', bg: '#0756a514' },
  OPENING: { label: '在线开标', color: '#d97706', bg: '#d9770614' },
  EVALUATING: { label: '专家评标', color: '#7c3aed', bg: '#7c3aed14' },
  ARCHIVED: { label: '已归档', color: '#059669', bg: '#05966914' },
};

export default function ExpertDetailPage() {
  const router = useRouter();
  const params = useParams();
  const expertId = params.id as string;
  const [expert, setExpert] = useState<ExpertDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<ExpertDetail>(`/expert-admin/${expertId}`).then(setExpert).catch(() => {}).finally(() => setLoading(false));
  }, [expertId]);

  const expertAlerts = useExpertAlerts(expertId);
  const alertItems = [
    ...(expertAlerts.consecutiveD ? [{ severity: 'red' as const, title: '连续 2 次 D 级评价', detail: '该专家近期履职评价连续不合格，建议关注' }] : []),
    ...(expertAlerts.overloaded ? [{ severity: 'orange' as const, title: '评审负荷过载', detail: `同时参与 ${expertAlerts.activeProjectCount} 个未归档项目，超过 3 个上限` }] : []),
  ];

  if (loading) return (
    <div className="space-y-5 animate-pulse">
      <div className="skeleton h-5 w-24 rounded" />
      <div className="space-y-2"><div className="skeleton h-7 w-48 rounded" /><div className="skeleton h-3 w-32 rounded" /></div>
      <div className="grid grid-cols-4 border border-[#e5ecf4] rounded-xl overflow-hidden bg-white">{[1,2,3,4].map(i => <div key={i} className="p-4 border-r last:border-r-0 border-[#e9eef4]"><div className="skeleton h-2 w-12 mb-2" /><div className="skeleton h-5 w-24" /></div>)}</div>
      <div className="grid grid-cols-3 border border-[#e5ecf4] rounded-xl overflow-hidden bg-white">{[1,2,3].map(i => <div key={i} className="p-4 border-r last:border-r-0 border-[#e9eef4]"><div className="skeleton h-2 w-16 mb-2" /><div className="skeleton h-8 w-12" /></div>)}</div>
    </div>
  );
  if (!expert) return <div className="py-24 text-center text-[13px] text-[#94a3b8]">专家不存在</div>;

  return (
    <div>
      <Breadcrumb items={[
        { label: '专家库', path: '/expert/repository' },
        { label: expert?.displayName || '详情' },
      ]} />
      <button onClick={() => router.push('/expert')} className="inline-flex items-center gap-1.5 text-[13px] text-[#64748b] hover:text-[#0756a5] mb-3">
        <ArrowLeft size={14} /> 返回专家列表
      </button>

      {alertItems.length > 0 && <div className="mb-5"><AlertBanner items={alertItems} /></div>}

      <div className="mb-7 pb-4 border-b border-[#dce3eb]">
        <div className="text-[11px] font-extrabold text-[#0756a5] uppercase tracking-[0.1em]">Expert Profile</div>
        <h1 className="mt-1 text-[24px] font-black tracking-[-0.03em] text-[#0f172a]">{expert.displayName}</h1>
      </div>

      {/* Profile info */}
      <div className="grid grid-cols-4 border border-[#dce3eb] bg-white mb-5">
        <InfoCell label="用户名" value={expert.username} />
        <InfoCell label="邮箱" value={expert.email || '—'} />
        <InfoCell label="所属部门" value={expert.department?.name || '未分配'} />
        <InfoCell label="注册时间" value={new Date(expert.createdAt).toLocaleDateString('zh-CN')} last />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 border border-[#dce3eb] bg-white mb-7">
        <StatCell label="参与项目" value={expert.statistics.totalProjects} color="#0756a5" />
        <StatCell label="已完成评审" value={expert.statistics.completedProjects} color="#059669" />
        <StatCell label="已签到项目" value={expert.statistics.signedInProjects} color="#7c3aed" last />
      </div>

      {/* Assignments */}
      <div className="flex items-end justify-between gap-4 mb-4">
        <h2 className="text-[12px] font-extrabold uppercase tracking-[0.04em] text-[#64748b]">评审项目 · {expert.assignments.length}</h2>
      </div>

      {expert.assignments.length === 0 ? (
        <div className="border border-[#dce3eb] bg-white py-16 text-center text-[13px] text-[#94a3b8]">暂无评审项目记录</div>
      ) : (
        <div className="border border-[#dce3eb] bg-white">
          {expert.assignments.map((a, i) => {
            const stage = stageMap[a.project.stage] || { label: a.project.stage, color: '#94a3b8', bg: '#94a3b814' };
            return (
              <div key={a.id} className={`px-5 py-4 ${i < expert.assignments.length - 1 ? 'border-b border-[#e9eef4]' : ''}`}>
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="min-w-0">
                    <h3 className="text-[14px] font-extrabold text-[#0f172a] truncate">{a.project.name}</h3>
                    <p className="text-[12px] text-[#94a3b8] mt-0.5">{a.project.projectCode} · {a.project.procurementMethod}</p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold flex-shrink-0" style={{color: stage.color, background: stage.bg}}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{background: stage.color}} />
                    {stage.label}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-3 text-[12px] text-[#64748b] mb-3">
                  <span>专业：<strong className="text-[#0f172a]">{a.major || '—'}</strong></span>
                  <span>签到：<strong className={a.signedIn ? 'text-[#059669]' : 'text-[#94a3b8]'}>{a.signedIn ? '已签到' : '未签到'}</strong></span>
                  <span>回避确认：<strong className={a.avoidanceConfirmed ? 'text-[#059669]' : 'text-[#94a3b8]'}>{a.avoidanceConfirmed ? '已确认' : '未确认'}</strong></span>
                  <span>总分：<strong className="text-[#0f172a] tabular-nums">{Number(a.totalScore)}</strong></span>
                </div>

                <div className="flex items-center gap-4 text-[12px] text-[#64748b]">
                  <span className="tabular-nums font-bold text-[#0f172a]">{a.progress}%</span>
                  <span>评分记录 {a.scoreRecords.length} 条</span>
                  <div className="flex-1 h-1.5 bg-[#f1f5f9] overflow-hidden">
                    <div className="h-full bg-[#0756a5] transition-all duration-500" style={{width: `${a.progress}%`}} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function InfoCell({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`px-5 py-4 ${!last ? 'border-r border-[#e9eef4]' : ''}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#94a3b8] mb-1">{label}</div>
      <div className="text-[14px] font-bold text-[#0f172a]">{value}</div>
    </div>
  );
}

function StatCell({ label, value, color, last }: { label: string; value: number; color: string; last?: boolean }) {
  return (
    <div className={`px-5 py-4 ${!last ? 'border-r border-[#e9eef4]' : ''}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#94a3b8] mb-1">{label}</div>
      <div className="text-[28px] font-black tabular-nums leading-none" style={{color}}>{value}</div>
    </div>
  );
}
