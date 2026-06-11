'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { ExpertStatistics, ExpertProject, User } from '@/lib/types';

export default function ExpertDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [stats, setStats] = useState<ExpertStatistics | null>(null);
  const [projects, setProjects] = useState<ExpertProject[]>([]);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(setUser);
    api.get<ExpertStatistics>('/expert/statistics').then(setStats).catch(() => {});
    api.get<ExpertProject[]>('/expert/projects').then(setProjects).catch(() => {});
  }, []);

  const stageLabel: Record<string, string> = { DOWNLOAD: '文件下载', SUBMIT: '加密投递', OPENING: '在线开标', EVALUATING: '专家评标', ARCHIVED: '资料归档' };

  return (
    <div>
      {/* 欢迎横幅 */}
      <div className="bg-gradient-to-r from-[#042a58] via-[#064ea2] to-[#39a8ff] rounded-2xl p-8 mb-6 text-white relative overflow-hidden">
        <div className="absolute right-0 top-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/4" />
        <div className="absolute right-20 bottom-0 w-40 h-40 bg-white/5 rounded-full translate-y-1/2" />
        <div className="relative">
          <p className="text-white/70 text-sm mb-1">专家工作台</p>
          <h1 className="text-2xl font-bold mb-2">欢迎回来，{user?.displayName || '专家'}</h1>
          <p className="text-white/70 text-sm">管理您的评审任务、查看项目进度、提交评标结果</p>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: '分配项目', value: stats?.totalProjects ?? 0, icon: '📊', color: 'from-blue-500 to-blue-700' },
          { label: '进行中', value: stats?.signedInProjects ?? 0, icon: '⏳', color: 'from-amber-500 to-orange-600' },
          { label: '已完成', value: stats?.completedProjects ?? 0, icon: '✅', color: 'from-emerald-500 to-green-700' },
          { label: '平均得分', value: stats?.averageScore ?? 0, icon: '📈', color: 'from-purple-500 to-indigo-700' },
        ].map(card => (
          <div key={card.label} className="bg-white rounded-xl border border-[#e8f0fa] p-5 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-[#5a6d8a]">{card.label}</span>
              <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${card.color} flex items-center justify-center text-lg`}>
                {card.icon}
              </div>
            </div>
            <div className="text-3xl font-bold text-[#18243a]">{card.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[1fr_340px] gap-6">
        {/* 项目列表 */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-[#18243a]">我的评审项目</h2>
            <button onClick={() => router.push('/expert/projects')} className="text-sm text-[#064ea2] hover:underline font-semibold">查看全部 →</button>
          </div>

          {projects.length === 0 ? (
            <div className="bg-white rounded-xl border border-[#e8f0fa] p-12 text-center">
              <div className="text-5xl mb-4">📋</div>
              <h3 className="text-lg font-bold text-[#18243a] mb-2">暂无评审任务</h3>
              <p className="text-sm text-[#5a6d8a]">当您被分配为评审专家时，任务将显示在这里</p>
            </div>
          ) : (
            <div className="space-y-3">
              {projects.slice(0, 5).map(ep => {
                const stageColor: Record<string, string> = { EVALUATING: '#064ea2', OPENING: '#f5a623', ARCHIVED: '#11a874' };
                return (
                  <div key={ep.id} onClick={() => router.push(`/expert/evaluate/${ep.project.id}`)}
                    className="bg-white rounded-xl border border-[#e8f0fa] p-5 hover:shadow-md hover:border-[#b8d4f5] transition-all cursor-pointer">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-[#064ea2] bg-[#eef6ff] px-3 py-1 rounded-lg">{ep.project.projectCode}</span>
                        <h3 className="font-bold text-[#18243a]">{ep.project.name}</h3>
                      </div>
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
                        style={{ color: stageColor[ep.project.stage] || '#5a6d8a', backgroundColor: (stageColor[ep.project.stage] || '#5a6d8a') + '18' }}>
                        {stageLabel[ep.project.stage] || ep.project.stage}
                      </span>
                    </div>
                    <div className="flex items-center gap-6 text-sm text-[#5a6d8a] mb-3">
                      <span>投标单位：{ep.project.suppliers?.length ?? 0} 家</span>
                      <span>评分项：{ep.project.scoreItems?.length ?? 0} 项</span>
                      <span>澄清：{ep.project._count?.clarifications ?? 0} 条</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 bg-[#f0f4f8] rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-[#064ea2] to-[#39a8ff] rounded-full transition-all duration-500"
                          style={{ width: `${ep.progress}%` }} />
                      </div>
                      <span className="text-xs font-semibold text-[#064ea2] w-12 text-right">{ep.progress}%</span>
                      {!ep.signedIn && <span className="text-xs bg-[#fff3e0] text-[#f5a623] px-2 py-0.5 rounded font-semibold">待核验</span>}
                      {ep.signedIn && !ep.avoidanceConfirmed && <span className="text-xs bg-[#fff3e0] text-[#f5a623] px-2 py-0.5 rounded font-semibold">待回避确认</span>}
                      {ep.progress >= 100 && <span className="text-xs bg-[#e8f8f0] text-[#11a874] px-2 py-0.5 rounded font-semibold">已完成</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 右侧面板 */}
        <div className="space-y-4">
          {/* 快捷操作 */}
          <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
            <h3 className="font-bold text-[#18243a] mb-4">快捷操作</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: '评审项目', desc: '查看待评项目', icon: '📋', path: '/expert/projects' },
                { label: '个人信息', desc: '管理资料', icon: '👤', path: '/expert/profile' },
                { label: '开标大厅', desc: '进入开标', icon: '⚖️', path: '/bid/open' },
                { label: '评标入口', desc: '开始评分', icon: '📝', path: '/bid/evaluate' },
              ].map(action => (
                <button key={action.path} onClick={() => router.push(action.path)}
                  className="bg-[#f8fbff] rounded-lg p-4 text-left hover:bg-[#eef6ff] border border-[#e8f0fa] hover:border-[#b8d4f5] transition-all">
                  <div className="text-xl mb-1">{action.icon}</div>
                  <div className="text-sm font-semibold text-[#18243a]">{action.label}</div>
                  <div className="text-xs text-[#5a6d8a]">{action.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 评审须知 */}
          <div className="bg-gradient-to-br from-[#f8fbff] to-[#eef6ff] rounded-xl border border-[#e8f0fa] p-5">
            <h3 className="font-bold text-[#18243a] mb-3">📜 评审须知</h3>
            <ul className="space-y-2 text-sm text-[#5a6d8a]">
              <li className="flex items-start gap-2"><span className="text-[#064ea2] mt-0.5">•</span>评审前需完成身份核验与回避确认</li>
              <li className="flex items-start gap-2"><span className="text-[#064ea2] mt-0.5">•</span>独立评审，不得与其他专家商议</li>
              <li className="flex items-start gap-2"><span className="text-[#064ea2] mt-0.5">•</span>所有评分需给出客观理由</li>
              <li className="flex items-start gap-2"><span className="text-[#064ea2] mt-0.5">•</span>评分提交后不可随意修改</li>
              <li className="flex items-start gap-2"><span className="text-[#064ea2] mt-0.5">•</span>评审全程留痕，受监督</li>
            </ul>
          </div>

          {/* 最近动态 */}
          {stats?.recentActivity && stats.recentActivity.length > 0 && (
            <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
              <h3 className="font-bold text-[#18243a] mb-3">最近动态</h3>
              <div className="space-y-3">
                {stats.recentActivity.map(log => (
                  <div key={log.id} className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full bg-[#064ea2] mt-1.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm text-[#18243a]">{log.action}</p>
                      <p className="text-xs text-[#5a6d8a]">{new Date(log.time).toLocaleString('zh-CN')}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
