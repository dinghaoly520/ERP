'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getDashboardStats } from '@/lib/api/bid';
import type { BidProject } from '@/lib/types';
import { Gavel, TrendingUp, ArrowRight, Plus, Search, Pencil, ChevronDown, ChevronRight } from 'lucide-react';
import { STAGE_LABEL, STAGE_COLOR } from '@water-erp/shared';
import CreateProjectDialog from '@/components/create-project-dialog';
import EditProjectDialog from '@/components/edit-project-dialog';

interface DashboardStats {
  totalProjects: number;
  activeProjects: number;
  totalSuppliers: number;
  approvedSuppliers: number;
  totalExperts: number;
  totalAnnouncements: number;
  stageDistribution: Record<string, number>;
  recentLogs: any[];
}

export default function BidDashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState<BidProject[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [editProject, setEditProject] = useState<any>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceData, setWorkspaceData] = useState<any>(null);

  const fetchProjects = () => {
    setLoading(true);
    Promise.all([
      api.get<BidProject[]>('/bid/projects'),
      getDashboardStats().catch(() => null as DashboardStats | null),
    ])
      .then(([ps, s]) => {
        setProjects(ps);
        if (s !== null) setStats(s);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const total = stats?.stageDistribution
    ? Object.values(stats.stageDistribution).reduce((a, b) => a + b, 0)
    : projects.length;
  const opening = stats?.stageDistribution?.OPENING ?? projects.filter(p => p.stage === 'OPENING').length;
  const evaluating = stats?.stageDistribution?.EVALUATING ?? projects.filter(p => p.stage === 'EVALUATING').length;
  const archived = stats?.stageDistribution?.ARCHIVED ?? projects.filter(p => p.stage === 'ARCHIVED').length;
  const active = stats?.activeProjects ?? projects.filter(p => p.stage === 'OPENING' || p.stage === 'EVALUATING').length;

  const entries = [
    { label: '开标主持端', sub: '在线解密 · 开标记录', path: '/bid/open' },
    { label: '专家评标端', sub: '独立评分 · 报告确认', path: '/bid/evaluate' },
    { label: '监督端',     sub: '日志追溯 · 不可干预', path: '/bid/supervise' },
    { label: '归档端',     sub: '资料归档 · 防篡改',   path: '/bid/archive' },
  ];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter(p => {
      if (q && !p.name.toLowerCase().includes(q) && !p.projectCode.toLowerCase().includes(q)) return false;
      if (stageFilter && p.stage !== stageFilter) return false;
      return true;
    });
  }, [projects, search, stageFilter]);

  return (
    <div>
      <div className="mb-10">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-widest mb-2">
          <Gavel size={12} strokeWidth={1.5} />
          Bidding Management
        </div>
        <div className="flex items-center justify-between">
          <h1 className="text-[28px] font-bold tracking-tight text-[oklch(0.18_0.012_265)]" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
            开评标管理
          </h1>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-[oklch(0.42_0.14_260)] text-white text-[12px] font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] transition-colors"
          >
            <Plus size={13} strokeWidth={2} />
            创建项目
          </button>
        </div>
        <p className="text-[14px] text-[oklch(0.55_0.01_264)] mt-1">统一入口 · 多端协同 · 限时开标 · 全程留痕</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-5 gap-px bg-[oklch(0.91_0.006_264)] mb-10">
        {[
          { label: '项目总数', value: total, color: '#064ea2' },
          { label: '活跃项目', value: active, color: '#e04a1f' },
          { label: '在线开标', value: opening, color: '#f5a623' },
          { label: '专家评标', value: evaluating, color: '#7c3aed' },
          { label: '已归档',   value: archived, color: '#11a874' },
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

      {/* Filter bar */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-2 px-3 py-2 bg-white border border-[oklch(0.91_0.006_264)] flex-1">
          <Search size={13} strokeWidth={1.5} className="text-[oklch(0.55_0.01_264)] shrink-0" />
          <input
            type="text"
            placeholder="搜索项目名称或编号…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 text-[13px] text-[oklch(0.18_0.012_265)] placeholder:text-[oklch(0.62_0.008_264)] bg-transparent outline-none"
          />
        </div>
        <select
          value={stageFilter}
          onChange={e => setStageFilter(e.target.value)}
          className="px-3 py-2 text-[13px] text-[oklch(0.18_0.012_265)] bg-white border border-[oklch(0.91_0.006_264)] outline-none cursor-pointer"
        >
          <option value="">全部阶段</option>
          {Object.entries(STAGE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
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
        ) : filtered.length === 0 ? (
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
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const label = STAGE_LABEL[p.stage] || p.stage; const color = STAGE_COLOR[p.stage] || '#94a3b8';
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
                      <span className="text-[11px] font-semibold px-2 py-0.5 tracking-wide" style={{ color: color, backgroundColor: `${color}18` }}>
                        {label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-[12px] text-[oklch(0.62_0.008_264)]">{p.riskNote || '—'}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditProject(p); }}
                          className="p-1 text-[oklch(0.55_0.01_264)] hover:text-[oklch(0.42_0.14_260)] transition-colors"
                          title="编辑"
                        >
                          <Pencil size={13} strokeWidth={1.5} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (workspaceId === p.id) {
                              setWorkspaceId(null);
                              setWorkspaceData(null);
                            } else {
                              setWorkspaceId(p.id);
                              api.get<any>(`/bid/projects/${p.id}/workspace`).then(setWorkspaceData).catch(() => setWorkspaceData(null));
                            }
                          }}
                          className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-[oklch(0.42_0.14_260)] hover:bg-[oklch(0.95_0.02_260)] transition-colors border border-[oklch(0.91_0.006_264)]"
                          title="检查工作区"
                        >
                          {workspaceId === p.id ? <ChevronDown size={11} strokeWidth={2} /> : <ChevronRight size={11} strokeWidth={2} />}
                          检查
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Workspace panel */}
      {workspaceId && (
        <div className="mt-4 bg-white border border-[oklch(0.91_0.006_264)]">
          <div className="px-5 py-3 border-b border-[oklch(0.91_0.006_264)] flex items-center justify-between">
            <h2
              className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight"
              style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}
            >
              工作区检查
            </h2>
            <button
              onClick={() => { setWorkspaceId(null); setWorkspaceData(null); }}
              className="text-[11px] text-[oklch(0.55_0.01_264)] hover:text-[oklch(0.18_0.012_265)] transition-colors"
            >
              收起
            </button>
          </div>
          <div className="px-5 py-5 space-y-6">
            {/* Supplier submission progress */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight">供应商提交进度</span>
                <span className="text-[11px] font-mono text-[oklch(0.55_0.01_264)]">
                  {workspaceData?.supplierSubmitted ?? 0} / {workspaceData?.supplierTotal ?? 0}
                </span>
              </div>
              <div className="w-full h-2 bg-[oklch(0.94_0.004_264)]">
                <div
                  className="h-2 transition-all duration-300"
                  style={{
                    width: `${workspaceData?.supplierTotal > 0 ? ((workspaceData?.supplierSubmitted ?? 0) / workspaceData.supplierTotal) * 100 : 0}%`,
                    backgroundColor: workspaceData?.supplierSubmitted === workspaceData?.supplierTotal && workspaceData?.supplierTotal > 0
                      ? '#11a874'
                      : workspaceData?.supplierSubmitted > 0
                        ? '#f5a623'
                        : '#d1d5db',
                  }}
                />
              </div>
              <p className="mt-1 text-[11px] text-[oklch(0.62_0.008_264)]">
                {workspaceData?.supplierSubmitted === workspaceData?.supplierTotal && workspaceData?.supplierTotal > 0
                  ? '全部供应商已提交'
                  : workspaceData?.supplierSubmitted > 0
                    ? '部分供应商已提交'
                    : '暂无供应商提交'}
              </p>
            </div>

            {/* Expert sign-in status */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight">专家签到状态</span>
                <span className="text-[11px] font-mono text-[oklch(0.55_0.01_264)]">
                  {workspaceData?.expertSignedIn ?? 0} / {workspaceData?.expertTotal ?? 0}
                </span>
              </div>
              <div className="flex gap-3 text-[11px]">
                <span className="text-[oklch(0.42_0.14_260)] font-semibold">
                  已签到：{workspaceData?.expertSignedIn ?? '—'}
                </span>
                <span className="text-[oklch(0.50_0.18_22)] font-semibold">
                  未签到：{(workspaceData?.expertTotal ?? 0) - (workspaceData?.expertSignedIn ?? 0)}
                </span>
                <span className="text-[oklch(0.62_0.008_264)]">
                  回避：{workspaceData?.expertRecused ?? '—'}
                </span>
              </div>
            </div>

            {/* Overall readiness indicator */}
            <div className="flex items-center gap-3 pt-2 border-t border-[oklch(0.94_0.004_264)]">
              <span className="text-[12px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight">整体就绪状态</span>
              {(() => {
                const allSubmitted = (workspaceData?.supplierSubmitted ?? 0) === (workspaceData?.supplierTotal ?? 0) && (workspaceData?.supplierTotal ?? 0) > 0;
                const allSignedIn = (workspaceData?.expertSignedIn ?? 0) === (workspaceData?.expertTotal ?? 0) && (workspaceData?.expertTotal ?? 0) > 0;
                if (allSubmitted && allSignedIn) {
                  return (
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[oklch(0.42_0.14_260)]">
                      <span className="w-2 h-2 rounded-full bg-[#11a874]" />
                      就绪 — 所有供应商已提交，所有专家已签到
                    </span>
                  );
                }
                if (allSubmitted || allSignedIn || (workspaceData?.supplierSubmitted ?? 0) > 0 || (workspaceData?.expertSignedIn ?? 0) > 0) {
                  return (
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[oklch(0.50_0.16_60)]">
                      <span className="w-2 h-2 rounded-full bg-[#f5a623]" />
                      部分就绪 — 仍有环节未完成
                    </span>
                  );
                }
                return (
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[oklch(0.50_0.18_22)]">
                    <span className="w-2 h-2 rounded-full bg-[#e04a1f]" />
                    未就绪 — 等待供应商提交和专家签到
                  </span>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      <CreateProjectDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          setShowCreate(false);
          fetchProjects();
        }}
      />

      <EditProjectDialog
        open={!!editProject}
        project={editProject}
        onClose={() => setEditProject(null)}
        onUpdated={() => {
          setEditProject(null);
          fetchProjects();
        }}
      />
    </div>
  );
}
