'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { BidProject } from '@/lib/types';
import { Gavel, TrendingUp, ArrowRight } from 'lucide-react';

export default function BidDashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState<BidProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<BidProject[]>('/bid/projects').then(ps => { setProjects(ps); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const stageDefs: Record<string, { label: string; color: string }> = {
    DOWNLOAD:   { label: '文件下载', color: '#0891b2' },
    SUBMIT:     { label: '加密投递', color: '#064ea2' },
    OPENING:    { label: '在线开标', color: '#f5a623' },
    EVALUATING: { label: '专家评标', color: '#7c3aed' },
    ARCHIVED:   { label: '已归档',   color: '#11a874' },
  };

  const stats = {
    total: projects.length,
    opening: projects.filter(p => p.stage === 'OPENING').length,
    evaluating: projects.filter(p => p.stage === 'EVALUATING').length,
    archived: projects.filter(p => p.stage === 'ARCHIVED').length,
  };

  const entries = [
    { label: '开标主持端', sub: '在线解密 · 开标记录', path: '/bid/open' },
    { label: '专家评标端', sub: '独立评分 · 报告确认', path: '/bid/evaluate' },
    { label: '监督端',     sub: '日志追溯 · 不可干预', path: '/bid/supervise' },
    { label: '归档端',     sub: '资料归档 · 防篡改',   path: '/bid/archive' },
  ];

  return (
    <div>
      <div className="mb-10">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-widest mb-2">
          <Gavel size={12} strokeWidth={1.5} />
          Bidding Management
        </div>
        <h1 className="text-[28px] font-bold tracking-tight text-[oklch(0.18_0.012_265)]" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
          开评标管理
        </h1>
        <p className="text-[14px] text-[oklch(0.55_0.01_264)] mt-1">统一入口 · 多端协同 · 限时开标 · 全程留痕</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-px bg-[oklch(0.91_0.006_264)] mb-10">
        {[
          { label: '项目总数', value: stats.total, color: '#064ea2' },
          { label: '在线开标', value: stats.opening, color: '#f5a623' },
          { label: '专家评标', value: stats.evaluating, color: '#7c3aed' },
          { label: '已归档',   value: stats.archived, color: '#11a874' },
        ].map(s => (
          <div key={s.label} className="bg-white p-5">
            {loading ? (
              <div className="space-y-2"><div className="h-3 w-16 bg-[oklch(0.94_0.004_264)] animate-pulse"/><div className="h-8 w-12 bg-[oklch(0.94_0.004_264)] animate-pulse"/></div>
            ) : (
              <>
                <p className="text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1">{s.label}</p>
                <p className="text-[2rem] font-bold font-mono tracking-tight" style={{ color: s.color }}>{s.value}</p>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Quick entry */}
      <div className="grid grid-cols-4 gap-px bg-[oklch(0.91_0.006_264)] mb-10">
        {entries.map(e => (
          <button key={e.path} onClick={() => router.push(e.path)}
            className="bg-white p-5 text-left hover:bg-[oklch(0.992_0.003_264)] transition-colors group">
            <h3 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight mb-1">{e.label}</h3>
            <p className="text-[12px] text-[oklch(0.55_0.01_264)]">{e.sub}</p>
            <div className="flex items-center gap-1 mt-3 text-[11px] text-[oklch(0.62_0.008_264)] group-hover:text-[oklch(0.42_0.14_260)] transition-colors">
              进入 <ArrowRight size={12} strokeWidth={1.5} />
            </div>
          </button>
        ))}
      </div>

      {/* Project table */}
      <div className="bg-white border border-[oklch(0.91_0.006_264)]">
        <div className="px-5 py-4 border-b border-[oklch(0.91_0.006_264)]">
          <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
            项目状态
          </h2>
        </div>
        {loading ? (
          <div className="p-5 space-y-3">{[1,2,3].map(i=><div key={i} className="h-10 bg-[oklch(0.94_0.004_264)] animate-pulse"/>)}</div>
        ) : projects.length === 0 ? (
          <div className="p-16 text-center text-[13px] text-[oklch(0.62_0.008_264)]">暂无项目数据</div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[oklch(0.91_0.006_264)] text-left text-[oklch(0.55_0.01_264)]">
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">项目编号</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">项目名称</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">采购方式</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">开标时间</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">阶段</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">风险</th>
              </tr>
            </thead>
            <tbody>
              {projects.map(p => {
                const stage = stageDefs[p.stage] || { label: p.stage, color: '#94a3b8' };
                return (
                  <tr key={p.id} onClick={() => router.push(`/bid/open?projectId=${p.id}`)}
                    className="border-b border-[oklch(0.94_0.004_264)] hover:bg-[oklch(0.992_0.003_264)] cursor-pointer transition-colors">
                    <td className="px-5 py-3 font-mono text-[oklch(0.42_0.14_260)] font-semibold tracking-tight">{p.projectCode}</td>
                    <td className="px-5 py-3 font-medium text-[oklch(0.18_0.012_265)]">{p.name}</td>
                    <td className="px-5 py-3 text-[oklch(0.55_0.01_264)]">{p.procurementMethod}</td>
                    <td className="px-5 py-3 text-[oklch(0.55_0.01_264)] font-mono tracking-tight">
                      {new Date(p.openTime).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })}
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-[11px] font-semibold px-2 py-0.5 tracking-wide" style={{ color: stage.color, backgroundColor: `${stage.color}18` }}>
                        {stage.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-[12px] text-[oklch(0.62_0.008_264)]">{p.riskNote || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
