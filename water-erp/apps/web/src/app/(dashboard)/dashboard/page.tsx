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

interface SupplierStats {
  total: number; pending: number; approved: number; disabled: number; blacklist: number;
}

interface AnnouncementStats {
  total: number; published: number; bidNotice: number; winNotice: number; policy: number;
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
  const [supplierStats, setSupplierStats] = useState<SupplierStats | null>(null);
  const [announcementStats, setAnnouncementStats] = useState<AnnouncementStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(setUser);

    Promise.all([
      api.get<DashboardStats>('/bid/dashboard-stats').catch(() => null),
      api.get<SupplierStats>('/supplier/stats').catch(() => null),
      api.get<AnnouncementStats>('/announcements/stats').catch(() => null),
    ]).then(([ds, ss, as]) => {
      setStats(ds);
      setSupplierStats(ss);
      setAnnouncementStats(as);
      setLoading(false);
    });
  }, []);

  const statCards = [
    { label: '招标项目', value: stats?.totalProjects ?? 0, sub: `${stats?.activeProjects ?? 0} 个进行中`, icon: ClipboardList, path: '/bid', color: '#064ea2' },
    { label: '供应商库', value: supplierStats?.total ?? stats?.totalSuppliers ?? 0, sub: `${supplierStats?.approved ?? stats?.approvedSuppliers ?? 0} 家已入库`, icon: Building2, path: '/supplier', color: '#11a874' },
    { label: '评审专家', value: stats?.totalExperts ?? 0, sub: '参与评标', icon: Users, path: '/bid', color: '#0891b2' },
    { label: '信息公告', value: announcementStats?.total ?? stats?.totalAnnouncements ?? 0, sub: `${announcementStats?.published ?? 0} 条已发布`, icon: Megaphone, path: '/notice', color: '#f5a623' },
  ];

  return (
    <div>
      {/* ── 品牌欢迎横幅 ── */}
      <div className="mb-8 bg-gradient-to-r from-[#064ea2] to-[#0891b2] rounded-xl p-6 text-white flex items-center gap-5">
        <img src="/assets/logo.jpg" alt="四川水发集团" className="w-14 h-14 rounded-xl object-cover border-2 border-white/30 flex-shrink-0" />
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <span className="text-[11px] font-semibold bg-white/20 px-2.5 py-0.5 rounded tracking-wider uppercase">Overview</span>
            <TrendingUp size={12} strokeWidth={1.5} className="opacity-60" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">欢迎回来，{user?.displayName || '管理员'}</h1>
          <p className="text-sm text-white/70 mt-0.5">四川水发集团 · 智慧水发招采ERP管理平台</p>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {statCards.map(card => (
          <div
            key={card.label}
            onClick={() => router.push(card.path)}
            className="bg-white rounded-xl border border-[#e5ecf4] p-5 cursor-pointer hover:shadow-md transition-all group"
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-[11px] font-semibold text-[#8a96aa] uppercase tracking-wider">{card.label}</span>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: card.color + '18' }}>
                <card.icon size={16} strokeWidth={1.5} style={{ color: card.color }} />
              </div>
            </div>
            {loading ? (
              <div className="h-8 w-16 bg-[#f0f3f8] animate-pulse rounded" />
            ) : (
              <>
                <div className="text-[2rem] font-bold text-[#18243a] tracking-tight">{card.value}</div>
                <div className="text-[11px] text-[#8a96aa] mt-1 flex items-center gap-1">
                  {card.sub}
                  <ArrowUpRight size={11} strokeWidth={1.5} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: card.color }} />
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* ── Main grid ── */}
      <div className="grid grid-cols-[1fr_340px] gap-6">
        <div className="space-y-6">
          {/* 项目阶段分布 */}
          <div className="bg-white rounded-xl border border-[#e5ecf4] p-6">
            <h2 className="text-[13px] font-semibold text-[#18243a] mb-5 tracking-tight">项目阶段分布</h2>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-6 bg-[#f0f3f8] animate-pulse rounded" />)}
              </div>
            ) : stats ? (
              <div className="space-y-2">
                {Object.entries(stageDefs).map(([stage, def]) => {
                  const count = stats.stageDistribution[stage] || 0;
                  const total = stats.totalProjects || 1;
                  const pct = Math.round((count / total) * 100);
                  return (
                    <div key={stage} className="flex items-center gap-4 group cursor-default">
                      <span className="text-[12px] text-[#5a6d8a] w-[72px] flex-shrink-0">{def.label}</span>
                      <div className="flex-1 h-6 bg-[#f7f9fc] rounded overflow-hidden relative">
                        <div
                          className="h-full transition-all duration-700 flex items-center px-2 rounded"
                          style={{
                            width: `${Math.max(pct, count > 0 ? 10 : 0)}%`,
                            backgroundColor: def.color.replace(')', ' / 0.18)').replace('oklch(', 'oklch('),
                          }}
                        >
                          {count > 0 && (
                            <span className="text-[11px] font-bold" style={{ color: def.color }}>{count}</span>
                          )}
                        </div>
                      </div>
                      <span className="text-[12px] font-mono font-bold text-[#18243a] w-10 text-right">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-[13px] text-[#8a96aa]">暂无数据</div>
            )}
          </div>

          {/* 供应商统计卡片（A 提供） */}
          {supplierStats && (
            <div className="bg-white rounded-xl border border-[#e5ecf4] p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-[13px] font-semibold text-[#18243a] tracking-tight">供应商概况</h2>
                <button onClick={() => router.push('/supplier')} className="text-[12px] text-[#064ea2] hover:underline flex items-center gap-1">
                  查看详情 <ArrowUpRight size={12} strokeWidth={1.5} />
                </button>
              </div>
              <div className="grid grid-cols-4 gap-4">
                {[
                  { label: '供应商总数', value: supplierStats.total, color: '#18243a' },
                  { label: '待审核', value: supplierStats.pending, color: '#f5a623' },
                  { label: '已入库', value: supplierStats.approved, color: '#11a874' },
                  { label: '异常/停用', value: supplierStats.disabled + supplierStats.blacklist, color: '#e74c3c' },
                ].map(s => (
                  <div key={s.label} className="text-center p-3 bg-[#f7f9fc] rounded-lg">
                    <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
                    <p className="text-[11px] text-[#8a96aa] mt-1">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 监督动态 */}
          <div className="bg-white rounded-xl border border-[#e5ecf4] p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[13px] font-semibold text-[#18243a] tracking-tight">监督动态</h2>
              <button onClick={() => router.push('/bid')}
                className="flex items-center gap-1 text-[12px] text-[#064ea2] hover:underline font-medium">
                查看全部 <ArrowUpRight size={12} strokeWidth={1.5} />
              </button>
            </div>
            {!stats?.recentActivity?.length ? (
              <div className="text-center py-8 text-[13px] text-[#8a96aa]">暂无动态</div>
            ) : (
              <div className="space-y-0">
                {stats.recentActivity.map((log, i) => {
                  const isRisk = log.riskFlag && log.riskFlag !== '无';
                  const isSuccess = log.result === '成功';
                  return (
                    <div key={log.id} className={`flex items-center gap-3 py-2.5 ${i === 0 ? '' : 'border-t border-[#f0f3f8]'}`}>
                      <div className={`w-1.5 h-1.5 flex-shrink-0 rounded-full ${isRisk ? 'bg-[#e74c3c]' : isSuccess ? 'bg-[#11a874]' : 'bg-[#f5a623]'}`} />
                      <span className="text-[13px] text-[#18243a] flex-1 min-w-0 truncate">{log.action}</span>
                      <span className="text-[11px] text-[#8a96aa] flex-shrink-0">{log.role}</span>
                      <span className="flex-shrink-0">
                        {isRisk ? <AlertTriangle size={12} strokeWidth={1.5} className="text-[#e74c3c]" /> : isSuccess ? <CheckCircle size={12} strokeWidth={1.5} className="text-[#11a874]" /> : <Clock size={12} strokeWidth={1.5} className="text-[#f5a623]" />}
                      </span>
                      <span className="text-[11px] text-[#8a96aa] w-16 text-right font-mono flex-shrink-0">
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
          <div className="bg-white rounded-xl border border-[#e5ecf4] p-5">
            <h3 className="text-[11px] font-semibold text-[#8a96aa] uppercase tracking-widest mb-4">快捷操作</h3>
            <div className="space-y-1">
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
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#f7f9fc] rounded-lg transition-colors text-left group"
                >
                  <action.icon size={15} strokeWidth={1.5} className="text-[#8a96aa] group-hover:text-[#064ea2] flex-shrink-0 transition-colors" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-[#18243a]">{action.label}</div>
                    <div className="text-[11px] text-[#8a96aa]">{action.sub}</div>
                  </div>
                  <ArrowUpRight size={12} strokeWidth={1.5} className="text-[#ccc] group-hover:text-[#064ea2] opacity-0 group-hover:opacity-100 transition-all" />
                </button>
              ))}
            </div>
          </div>

          {/* System info */}
          <div className="bg-[#f7f9fc] rounded-xl border border-[#e5ecf4] p-5">
            <div className="flex items-center gap-3 mb-4">
              <img src="/assets/logo.jpg" alt="四川水发" className="w-7 h-7 rounded-lg object-cover" />
              <h3 className="text-[11px] font-semibold text-[#8a96aa] uppercase tracking-widest">系统概况</h3>
            </div>
            <div className="space-y-2.5">
              {[
                { label: '平台名称', value: '智慧水发·蜀水云采' },
                { label: '版本', value: 'v2.0.0' },
                { label: '本月项目', value: `${stats?.totalProjects ?? 0} 个` },
                { label: '数据更新', value: new Date().toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) },
              ].map(item => (
                <div key={item.label} className="flex items-center justify-between">
                  <span className="text-[12px] text-[#8a96aa]">{item.label}</span>
                  <span className="text-[12px] font-medium text-[#18243a]">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Operation guide */}
          <div className="bg-white rounded-xl border border-[#e5ecf4] p-5">
            <div className="flex items-center gap-2 mb-4">
              <Info size={14} strokeWidth={1.5} className="text-[#8a96aa]" />
              <h3 className="text-[11px] font-semibold text-[#8a96aa] uppercase tracking-widest">操作指引</h3>
            </div>
            <div className="space-y-2.5">
              {[
                '开评标管理中控制招标全流程',
                '供应商注册后需管理员审核入库',
                '专家通过独立工作站进行评审',
                '所有操作全程留痕接受监督审计',
              ].map((text, i) => (
                <p key={i} className="text-[12px] text-[#5a6d8a] leading-relaxed flex items-start gap-2">
                  <span className="text-[11px] font-mono text-[#ccc] flex-shrink-0 mt-px">{String(i + 1).padStart(2, '0')}</span>
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
