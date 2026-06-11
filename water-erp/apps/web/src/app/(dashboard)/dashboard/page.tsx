'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { User } from '@/lib/types';
import {
  ClipboardList, Building2, Users, Megaphone, ArrowUpRight,
  Gavel, Star, ShoppingCart, Info, TrendingUp, AlertTriangle,
  CheckCircle, Clock,
} from 'lucide-react';

interface DashboardStats {
  totalProjects: number;
  activeProjects: number;
  totalSuppliers: number;
  approvedSuppliers: number;
  totalExperts: number;
  totalAnnouncements: number;
  stageDistribution: Record<string, number>;
  recentActivity: { id: string; time: string; role: string; target: string; action: string; result: string; riskFlag: string }[];
}

const stageDefs: Record<string, { label: string; color: string }> = {
  DOWNLOAD:    { label: '文件下载', color: 'oklch(0.50 0.12 195)' },
  SUBMIT:      { label: '加密投递', color: 'oklch(0.42 0.14 260)' },
  OPENING:     { label: '在线开标', color: 'oklch(0.64 0.16 82)' },
  EVALUATING:  { label: '专家评标', color: 'oklch(0.55 0.18 285)' },
  ARCHIVED:    { label: '已归档', color: 'oklch(0.54 0.16 158)' },
};

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(setUser);
    api.get<DashboardStats>('/bid/dashboard-stats')
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const statCards = [
    { label: '招标项目', value: stats?.totalProjects ?? 0, sub: `${stats?.activeProjects ?? 0} 个进行中`, icon: ClipboardList, path: '/bid' },
    { label: '供应商库', value: stats?.totalSuppliers ?? 0, sub: `${stats?.approvedSuppliers ?? 0} 家已入库`, icon: Building2, path: '/supplier' },
    { label: '评审专家', value: stats?.totalExperts ?? 0, sub: '参与评标', icon: Users, path: '/bid' },
    { label: '信息公告', value: stats?.totalAnnouncements ?? 0, sub: '已发布', icon: Megaphone, path: '/notice' },
  ];

  return (
    <div>
      {/* ── Page header — typographic, no card ── */}
      <div className="mb-10">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-widest mb-2">
          <TrendingUp size={12} strokeWidth={1.5} />
          Overview
        </div>
        <h1 className="text-[28px] font-bold tracking-tight text-[oklch(0.18_0.012_265)]" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
          欢迎回来，{user?.displayName || '管理员'}
        </h1>
        <p className="text-[14px] text-[oklch(0.55_0.01_264)] mt-1">智慧水发 · 招采ERP管理平台</p>
      </div>

      {/* ── Stat cards — clean grid, no shadows ── */}
      <div className="grid grid-cols-4 gap-px bg-[oklch(0.91_0.006_264)] mb-10">
        {statCards.map(card => (
          <div
            key={card.label}
            onClick={() => router.push(card.path)}
            className="bg-white p-5 cursor-pointer hover:bg-[oklch(0.992_0.003_264)] transition-colors group"
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider">{card.label}</span>
              <card.icon size={16} strokeWidth={1.5} className="text-[oklch(0.62_0.008_264)] group-hover:text-[oklch(0.42_0.14_260)] transition-colors" />
            </div>
            {loading ? (
              <div className="h-8 w-16 bg-[oklch(0.94_0.004_264)] animate-pulse" />
            ) : (
              <>
                <div className="text-[2rem] font-bold text-[oklch(0.18_0.012_265)] tracking-tight font-mono">{card.value}</div>
                <div className="text-[11px] text-[oklch(0.62_0.008_264)] mt-1 flex items-center gap-1">
                  {card.sub}
                  <ArrowUpRight size={11} strokeWidth={1.5} className="opacity-0 group-hover:opacity-100 transition-opacity text-[oklch(0.42_0.14_260)]" />
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* ── Main grid — left (stages + activity), right (quick actions) ── */}
      <div className="grid grid-cols-[1fr_340px] gap-6">
        <div className="space-y-6">
          {/* Project stage distribution — precision bar chart */}
          <div className="bg-white border border-[oklch(0.91_0.006_264)] p-6">
            <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] mb-5 tracking-tight" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
              项目阶段分布
            </h2>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-6 bg-[oklch(0.94_0.004_264)] animate-pulse" />)}
              </div>
            ) : stats ? (
              <div className="space-y-2">
                {Object.entries(stageDefs).map(([stage, def]) => {
                  const count = stats.stageDistribution[stage] || 0;
                  const total = stats.totalProjects || 1;
                  const pct = Math.round((count / total) * 100);
                  return (
                    <div key={stage} className="flex items-center gap-4 group cursor-default">
                      <span className="text-[12px] text-[oklch(0.55_0.01_264)] w-[72px] flex-shrink-0 tracking-tight">{def.label}</span>
                      <div className="flex-1 h-6 bg-[oklch(0.97_0.004_264)] relative overflow-hidden">
                        <div
                          className="h-full transition-all duration-700 flex items-center px-2"
                          style={{
                            width: `${Math.max(pct, count > 0 ? 10 : 0)}%`,
                            backgroundColor: `color-mix(in oklch, ${def.color} 18%, transparent)`,
                          }}
                        >
                          {count > 0 && (
                            <span className="text-[11px] font-bold font-mono" style={{ color: def.color }}>
                              {count}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-[12px] font-mono font-bold text-[oklch(0.18_0.012_265)] w-10 text-right">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-[13px] text-[oklch(0.62_0.008_264)]">暂无数据</div>
            )}
          </div>

          {/* Activity feed — precision timeline */}
          <div className="bg-white border border-[oklch(0.91_0.006_264)] p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
                监督动态
              </h2>
              <button onClick={() => router.push('/bid')}
                className="flex items-center gap-1 text-[12px] text-[oklch(0.42_0.14_260)] hover:text-[oklch(0.50_0.16_258)] font-medium tracking-tight transition-colors">
                查看全部 <ArrowUpRight size={12} strokeWidth={1.5} />
              </button>
            </div>
            {!stats?.recentActivity?.length ? (
              <div className="text-center py-8 text-[13px] text-[oklch(0.62_0.008_264)]">暂无动态</div>
            ) : (
              <div className="space-y-0">
                {stats.recentActivity.map((log, i) => {
                  const isRisk = log.riskFlag && log.riskFlag !== '无';
                  const isSuccess = log.result === '成功';
                  return (
                    <div key={log.id} className={`flex items-center gap-3 py-2.5 ${i === 0 ? '' : 'border-t border-[oklch(0.94_0.004_264)]'}`}>
                      <div className={`w-1.5 h-1.5 flex-shrink-0 ${isRisk ? 'bg-[oklch(0.50_0.18_22)]' : isSuccess ? 'bg-[oklch(0.54_0.16_158)]' : 'bg-[oklch(0.64_0.16_82)]'}`} />
                      <span className="text-[13px] text-[oklch(0.18_0.012_265)] flex-1 min-w-0 truncate tracking-tight">{log.action}</span>
                      <span className="text-[11px] text-[oklch(0.62_0.008_264)] flex-shrink-0">{log.role}</span>
                      <span className={`text-[11px] font-medium flex-shrink-0 ${isSuccess ? 'text-[oklch(0.54_0.16_158)]' : isRisk ? 'text-[oklch(0.50_0.18_22)]' : 'text-[oklch(0.64_0.16_82)]'}`}>
                        {isRisk ? <AlertTriangle size={12} strokeWidth={1.5} /> : isSuccess ? <CheckCircle size={12} strokeWidth={1.5} /> : <Clock size={12} strokeWidth={1.5} />}
                      </span>
                      <span className="text-[11px] text-[oklch(0.72_0.008_264)] w-16 text-right font-mono flex-shrink-0">
                        {new Date(log.time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          {/* Quick actions */}
          <div className="bg-white border border-[oklch(0.91_0.006_264)] p-5">
            <h3 className="text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-widest mb-4">快捷操作</h3>
            <div className="space-y-px">
              {[
                { label: '开评标管理', sub: '在线开标 · 评审', icon: Gavel, path: '/bid' },
                { label: '供应商管理', sub: '审核 · 入库 · 评价', icon: Building2, path: '/supplier' },
                { label: '发布公告', sub: '招标公告 · 中标公示', icon: Megaphone, path: '/notice' },
                { label: '采购管理', sub: '立项 · 审批 · 归档', icon: ClipboardList, path: '/procurement' },
                { label: '评价管理', sub: '评分 · 统计 · 分析', icon: Star, path: '/evaluation' },
                { label: '电子商城', sub: '商品目录 · 采购', icon: ShoppingCart, path: '/mall' },
              ].map(action => (
                <button
                  key={action.path}
                  onClick={() => router.push(action.path)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[oklch(0.97_0.008_262)] transition-colors text-left group"
                >
                  <action.icon size={15} strokeWidth={1.5} className="text-[oklch(0.62_0.008_264)] group-hover:text-[oklch(0.42_0.14_260)] flex-shrink-0 transition-colors" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-[oklch(0.18_0.012_265)] tracking-tight">{action.label}</div>
                    <div className="text-[11px] text-[oklch(0.62_0.008_264)]">{action.sub}</div>
                  </div>
                  <ArrowUpRight size={12} strokeWidth={1.5} className="text-[oklch(0.80_0.006_264)] group-hover:text-[oklch(0.42_0.14_260)] opacity-0 group-hover:opacity-100 transition-all" />
                </button>
              ))}
            </div>
          </div>

          {/* System info */}
          <div className="bg-[oklch(0.97_0.008_262)] border border-[oklch(0.91_0.006_264)] p-5">
            <h3 className="text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-widest mb-4">系统概况</h3>
            <div className="space-y-2.5">
              {[
                { label: '平台版本', value: 'v2.0.0' },
                { label: '本月项目', value: `${stats?.totalProjects ?? 0} 个` },
                { label: '数据更新', value: new Date().toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) },
              ].map(item => (
                <div key={item.label} className="flex items-center justify-between">
                  <span className="text-[12px] text-[oklch(0.62_0.008_264)]">{item.label}</span>
                  <span className="text-[12px] font-medium text-[oklch(0.18_0.012_265)] tracking-tight font-mono">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Operation guide */}
          <div className="bg-white border border-[oklch(0.91_0.006_264)] p-5">
            <div className="flex items-center gap-2 mb-4">
              <Info size={14} strokeWidth={1.5} className="text-[oklch(0.55_0.01_264)]" />
              <h3 className="text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-widest">操作指引</h3>
            </div>
            <div className="space-y-2.5">
              {[
                '开评标管理中控制招标全流程',
                '供应商注册后需管理员审核入库',
                '专家通过独立工作站进行评审',
                '所有操作全程留痕接受监督审计',
              ].map((text, i) => (
                <p key={i} className="text-[12px] text-[oklch(0.55_0.01_264)] leading-relaxed flex items-start gap-2">
                  <span className="text-[11px] font-mono text-[oklch(0.72_0.008_264)] flex-shrink-0 mt-px">{String(i + 1).padStart(2, '0')}</span>
                  {text}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
