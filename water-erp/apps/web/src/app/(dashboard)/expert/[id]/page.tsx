'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { ArrowLeft } from 'lucide-react';

interface ScoreRecord {
  id: string; score: number; reason: string | null;
  scoreItem: { name: string; category: string; maxScore: number };
}

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

const stageMap: Record<string, { label: string; color: string }> = {
  DOWNLOAD: { label: '文件下载', color: '#0891b2' },
  SUBMIT: { label: '加密投递', color: '#064ea2' },
  OPENING: { label: '在线开标', color: '#d97706' },
  EVALUATING: { label: '专家评标', color: '#7c3aed' },
  ARCHIVED: { label: '已归档', color: '#059669' },
};

export default function ExpertDetailPage() {
  const router = useRouter();
  const params = useParams();
  const expertId = params.id as string;
  const [expert, setExpert] = useState<ExpertDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<ExpertDetail>(`/expert-admin/${expertId}`)
      .then(setExpert).catch(() => {}).finally(() => setLoading(false));
  }, [expertId]);

  if (loading) return <div className="py-20 text-center text-[13px] text-[#94a3b8]">加载中...</div>;
  if (!expert) return <div className="py-20 text-center text-[13px] text-[#94a3b8]">专家不存在</div>;

  return (
    <div>
      {/* Back + title */}
      <button onClick={() => router.push('/expert')} className="inline-flex items-center gap-1.5 text-[13px] text-[#64748b] hover:text-[#0756a5] mb-3">
        <ArrowLeft size={14} /> 返回专家列表
      </button>
      <h1 className="text-[24px] font-black tracking-[-0.03em] text-[#0f172a] mb-7">{expert.displayName}</h1>

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
      <h2 className="text-[15px] font-extrabold text-[#0f172a] mb-4">评审项目</h2>

      {expert.assignments.length === 0 ? (
        <div className="border border-[#dce3eb] bg-white py-12 text-center text-[13px] text-[#94a3b8]">暂无评审项目记录</div>
      ) : (
        <div className="border border-[#dce3eb] bg-white">
          {expert.assignments.map((a, i) => {
            const stage = stageMap[a.project.stage] || { label: a.project.stage, color: '#94a3b8' };
            return (
              <div key={a.id} className={`px-5 py-4 ${i < expert.assignments.length - 1 ? 'border-b border-[#e9eef4]' : ''}`}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h3 className="text-[14px] font-extrabold text-[#0f172a]">{a.project.name}</h3>
                    <p className="text-[12px] text-[#94a3b8] mt-0.5">{a.project.projectCode} · {a.project.procurementMethod}</p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold" style={{color: stage.color, background: stage.color + '12'}}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{background: stage.color}} />
                    {stage.label}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-3 text-[12px] text-[#64748b] mb-2">
                  <span>专业：{a.major || '—'}</span>
                  <span>签到：{a.signedIn ? '已签到' : '未签到'}</span>
                  <span>回避确认：{a.avoidanceConfirmed ? '已确认' : '未确认'}</span>
                  <span>总分：<strong className="text-[#0f172a]">{Number(a.totalScore)}</strong></span>
                </div>

                <div className="flex items-center gap-4 text-[12px] text-[#64748b]">
                  <span className="tabular-nums">{a.progress}%</span>
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
