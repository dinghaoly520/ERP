'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api } from '@/lib/api';

interface ScoreRecord {
  id: string;
  score: number;
  reason: string | null;
  scoreItem: { name: string; category: string; maxScore: number };
}

interface Assignment {
  id: string;
  expertName: string;
  major: string;
  progress: number;
  signedIn: boolean;
  avoidanceConfirmed: boolean;
  totalScore: number;
  project: {
    id: string;
    projectCode: string;
    name: string;
    stage: string;
    procurementMethod: string;
    openTime: string;
  };
  scoreRecords: ScoreRecord[];
}

interface ExpertDetail {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  department: { id: string; name: string } | null;
  createdAt: string;
  assignments: Assignment[];
  statistics: {
    totalProjects: number;
    completedProjects: number;
    signedInProjects: number;
  };
}

const stageMap: Record<string, { label: string; color: string; bg: string }> = {
  DOWNLOAD: { label: '文件下载', color: '#0891b2', bg: '#0891b218' },
  SUBMIT: { label: '加密投递', color: '#064ea2', bg: '#064ea218' },
  OPENING: { label: '在线开标', color: '#f5a623', bg: '#f5a62318' },
  EVALUATING: { label: '专家评标', color: '#7c3aed', bg: '#7c3aed18' },
  ARCHIVED: { label: '已归档', color: '#11a874', bg: '#11a87418' },
};

export default function ExpertDetailPage() {
  const router = useRouter();
  const params = useParams();
  const expertId = params.id as string;
  const [expert, setExpert] = useState<ExpertDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<ExpertDetail>(`/expert-admin/${expertId}`)
      .then(setExpert)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [expertId]);

  if (loading) {
    return <div className="p-12 text-center text-[oklch(0.55_0.01_264)]">加载中...</div>;
  }

  if (!expert) {
    return <div className="p-12 text-center text-[oklch(0.55_0.01_264)]">专家不存在</div>;
  }

  return (
    <div>
      {/* 返回 + 标题 */}
      <div className="mb-6">
        <button onClick={() => router.push('/expert')} className="text-sm text-[#064ea2] hover:underline mb-2 inline-block">
          ← 返回专家列表
        </button>
        <h1 className="text-2xl font-bold text-[oklch(0.18_0.012_265)]">{expert.displayName}</h1>
      </div>

      {/* 基本信息 */}
      <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-6 mb-6">
        <div className="grid grid-cols-4 gap-6">
          <div>
            <p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">用户名</p>
            <p className="font-semibold text-[oklch(0.18_0.012_265)]">{expert.username}</p>
          </div>
          <div>
            <p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">邮箱</p>
            <p className="font-semibold text-[oklch(0.18_0.012_265)]">{expert.email || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">所属部门</p>
            <p className="font-semibold text-[oklch(0.18_0.012_265)]">{expert.department?.name || '未分配'}</p>
          </div>
          <div>
            <p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">注册时间</p>
            <p className="font-semibold text-[oklch(0.18_0.012_265)]">{new Date(expert.createdAt).toLocaleDateString('zh-CN')}</p>
          </div>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5">
          <p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">参与项目</p>
          <p className="text-3xl font-bold text-[#064ea2]">{expert.statistics.totalProjects}</p>
        </div>
        <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5">
          <p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">已完成评审</p>
          <p className="text-3xl font-bold text-[#11a874]">{expert.statistics.completedProjects}</p>
        </div>
        <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5">
          <p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">已签到项目</p>
          <p className="text-3xl font-bold text-[#7c3aed]">{expert.statistics.signedInProjects}</p>
        </div>
      </div>

      {/* 评审项目列表 */}
      <h2 className="text-lg font-bold text-[oklch(0.18_0.012_265)] mb-4">评审项目</h2>
      {expert.assignments.length === 0 ? (
        <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-12 text-center">
          <p className="text-[oklch(0.55_0.01_264)]">暂无评审项目记录</p>
        </div>
      ) : (
        <div className="space-y-3">
          {expert.assignments.map(a => {
            const stage = stageMap[a.project.stage] || { label: a.project.stage, color: '#5a6d8a', bg: '#5a6d8a18' };
            return (
              <div key={a.id} className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-bold text-[oklch(0.18_0.012_265)]">{a.project.name}</h3>
                    <p className="text-xs text-[oklch(0.55_0.01_264)]">{a.project.projectCode} · {a.project.procurementMethod}</p>
                  </div>
                  <span className="text-xs font-semibold px-3 py-1 rounded-full" style={{ color: stage.color, backgroundColor: stage.bg }}>
                    {stage.label}
                  </span>
                </div>
                <div className="flex items-center gap-6 text-sm text-[oklch(0.55_0.01_264)] mb-3">
                  <span>专业：{a.major || '—'}</span>
                  <span>签到：{a.signedIn ? '✅ 已签到' : '❌ 未签到'}</span>
                  <span>回避确认：{a.avoidanceConfirmed ? '✅ 已确认' : '❌ 未确认'}</span>
                </div>
                <div className="flex items-center gap-6 text-sm text-[oklch(0.55_0.01_264)]">
                  <span>进度：{a.progress}%</span>
                  <span>总分：{Number(a.totalScore)}</span>
                  <span>评分记录：{a.scoreRecords.length} 条</span>
                  <div className="flex-1">
                    <div className="h-2 bg-[oklch(0.95_0.006_264)] rounded-full overflow-hidden">
                      <div className="h-full bg-[#064ea2] rounded-full transition-all" style={{ width: `${a.progress}%` }} />
                    </div>
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
