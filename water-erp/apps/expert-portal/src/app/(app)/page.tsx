'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, CheckCircle, Clipboard, ScrollText, UserCircle, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { ExpertStatistics, ExpertProject, User } from '@/lib/types';
import { STAGE_LABEL, STAGE_COLOR } from '@water-erp/shared';
import { PageHero, SectionCard, MetricCard } from '@water-erp/ui';

export default function ExpertDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [stats, setStats] = useState<ExpertStatistics | null>(null);
  const [projects, setProjects] = useState<ExpertProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([
      fetch('/api/auth/me', { credentials: 'include' }).then(r => r.ok ? r.json() : null).then(setUser),
      api.get<ExpertStatistics>('/expert/statistics').then(setStats).catch((e) => toast.error(`加载统计数据失败: ${e.message}`)),
      api.get<ExpertProject[]>('/expert/projects').then(setProjects).catch((e) => toast.error(`加载项目列表失败: ${e.message}`)),
    ]).finally(() => setLoading(false));
  }, []);

  const isProjectActive = (stage: string) => stage === 'OPENING' || stage === 'EVALUATING';
  const activeProjects = projects.filter(p => isProjectActive(p.project.stage));
  const totalProjectCount = projects.length;

  return (
    <div className="space-y-6">
      <PageHero
        tone="purple"
        icon={<UserCircle size={14} strokeWidth={1.5} />}
        title={`欢迎，${user?.displayName || '专家'}`}
        description="在线开标、专家评审、过程留痕"
      />

      {/* 统计卡片 */}
      <div className="grid gap-4 md:grid-cols-3">
        {loading ? (
          <>
            {[{ label: '待核验', Icon: ShieldCheck }, { label: '评审中', Icon: Clipboard }, { label: '已完成', Icon: CheckCircle }].map(card => (
              <div key={card.label} className="glass-card glass-card-blue rounded-2xl p-5 animate-pulse">
                <div className="flex items-center gap-3">
                  <card.Icon size={16} strokeWidth={1.5} className="text-[#cbd5e1]" />
                  <div className="flex-1">
                    <div className="h-3 w-16 bg-white/25 rounded mb-2" />
                    <div className="h-6 w-10 bg-white/25 rounded" />
                  </div>
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <MetricCard label="待核验" value={stats?.pendingProjects ?? 0} tone="orange" icon={<ShieldCheck size={16} strokeWidth={1.5} />} hint="未完成身份核验" />
            <MetricCard label="评审中" value={activeProjects.length} tone="purple" icon={<Clipboard size={16} strokeWidth={1.5} />} hint="开评标进行中" />
            <MetricCard label="已完成" value={stats?.completedProjects ?? 0} tone="green" icon={<CheckCircle size={16} strokeWidth={1.5} />} />
          </>
        )}
      </div>

      <div className="grid grid-cols-[1fr_340px] gap-6">
        {/* 项目列表 */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-[oklch(0.18_0.012_265)]">进行中的评审</h2>
            <button onClick={() => router.push('/projects')} className="text-sm text-[#064ea2] hover:underline font-semibold">查看全部 →</button>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => (
                <div key={i} className="glass-card glass-card-blue rounded-2xl p-5 animate-pulse">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="h-7 w-20 bg-white/25 rounded-lg" />
                      <div className="h-5 w-40 bg-white/25 rounded" />
                    </div>
                    <div className="h-5 w-16 bg-white/25 rounded-full" />
                  </div>
                  <div className="flex gap-6 mb-3">
                    <div className="h-4 w-24 bg-white/25 rounded" />
                    <div className="h-4 w-20 bg-white/25 rounded" />
                    <div className="h-4 w-16 bg-white/25 rounded" />
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-2 bg-white/25 rounded-full" />
                    <div className="h-4 w-10 bg-white/25 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : activeProjects.length === 0 ? (
            <div className="glass-card glass-card-blue rounded-2xl p-12 text-center">
              <Clock size={48} strokeWidth={1} className="text-[oklch(0.80_0.006_264)] mx-auto mb-4" />
              <h3 className="text-lg font-bold text-[oklch(0.18_0.012_265)] mb-2">
                {totalProjectCount > 0 ? '暂无可评审项目' : '暂无评审任务'}
              </h3>
              <p className="text-sm text-[oklch(0.55_0.01_264)]">
                {totalProjectCount > 0
                  ? '您有已分配的项目，但尚未进入开评标阶段。请等待管理端启动开标。'
                  : '当您被分配为评审专家时，任务将显示在这里'}
              </p>
              {totalProjectCount > 0 && (
                <button onClick={() => router.push('/projects')}
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-[#064ea2] hover:underline">
                  查看全部项目 →
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {activeProjects.slice(0, 5).map(ep => {
                const sc = STAGE_COLOR[ep.project.stage] || '#5a6d8a';
                return (
                  <div key={ep.id} role="button" tabIndex={0}
                    onClick={() => router.push(`/evaluate/${ep.project.id}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/evaluate/${ep.project.id}`); } }}
                    className="glass-card glass-card-lighter glass-card-emerald rounded-2xl p-5 hover:shadow-md hover:border-[#bfdbfe] transition-all cursor-pointer">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-[#064ea2] bg-[#eff6ff]/50 px-3 py-1 rounded-lg">{ep.project.projectCode}</span>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-[oklch(0.18_0.012_265)]">{ep.project.name}</h3>
                          {/* Pulsing dot for active projects */}
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                              style={{ backgroundColor: sc }} />
                            <span className="relative inline-flex rounded-full h-2 w-2"
                              style={{ backgroundColor: sc }} />
                          </span>
                        </div>
                      </div>
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
                        style={{ color: sc, backgroundColor: sc + '18' }}>
                        {STAGE_LABEL[ep.project.stage] || ep.project.stage}
                      </span>
                    </div>
                    <div className="flex items-center gap-6 text-sm text-[oklch(0.55_0.01_264)] mb-3">
                      <span>投标单位：{ep.project.suppliers?.length ?? 0} 家</span>
                      <span>评分项：{ep.project.scoreItems?.length ?? 0} 项</span>
                      <span>澄清：{ep.project._count?.clarifications ?? 0} 条</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 bg-white/25 rounded-full overflow-hidden">
                        <div className="h-full bg-[#064ea2]/60 rounded-full transition-all duration-500"
                          style={{ width: `${ep.progress}%` }} />
                      </div>
                      <span className="text-xs font-semibold text-[#064ea2] w-12 text-right">{ep.progress}%</span>
                      {!ep.signedIn && <span className="text-xs bg-amber-50/50 text-amber-600 px-2 py-0.5 rounded font-semibold">待核验</span>}
                      {ep.progress >= 100 && <span className="text-xs bg-emerald-50/50 text-emerald-600 px-2 py-0.5 rounded font-semibold">已完成</span>}
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
          <div className="glass-card glass-card-purple rounded-2xl p-5">
            <h3 className="font-bold text-[oklch(0.18_0.012_265)] mb-4">快捷操作</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: '评审项目', desc: '查看+评审', path: '/projects', Icon: Clipboard },
                { label: '个人信息', desc: '管理资料', path: '/profile', Icon: UserCircle },
              ].map(action => (
                <button key={action.path} onClick={() => router.push(action.path)}
                  className="bg-white/50 rounded-lg p-4 text-left hover:bg-white/80 border border-[#bfdbfe] transition-all backdrop-blur-sm">
                  <action.Icon size={20} strokeWidth={1.5} className="text-[#064ea2]" />
                  <div className="text-sm font-semibold text-[oklch(0.18_0.012_265)]">{action.label}</div>
                  <div className="text-xs text-[oklch(0.55_0.01_264)]">{action.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 评审须知 */}
          <div className="glass-card glass-card-blue rounded-2xl p-5">
            <h3 className="font-bold text-[oklch(0.18_0.012_265)] mb-3"><ScrollText size={14} strokeWidth={1.5} className="inline" /> 评审须知</h3>
            <ul className="space-y-2 text-sm text-[oklch(0.55_0.01_264)]">
              <li className="flex items-start gap-2"><span className="text-[#064ea2] mt-0.5">•</span>评审前需完成身份核验与回避确认</li>
              <li className="flex items-start gap-2"><span className="text-[#064ea2] mt-0.5">•</span>独立评审，不得与其他专家商议</li>
              <li className="flex items-start gap-2"><span className="text-[#064ea2] mt-0.5">•</span>所有评分需给出客观理由</li>
              <li className="flex items-start gap-2"><span className="text-[#064ea2] mt-0.5">•</span>评分提交后不可随意修改</li>
              <li className="flex items-start gap-2"><span className="text-[#064ea2] mt-0.5">•</span>评审全程留痕，受监督审计</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
