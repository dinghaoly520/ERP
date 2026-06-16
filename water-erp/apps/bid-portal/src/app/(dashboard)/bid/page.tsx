'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getDashboardStats } from '@/lib/api/bid';
import type { BidProject } from '@/lib/types';
import { Gavel, TrendingUp, ArrowRight, Plus, Search, Pencil, ChevronDown, ChevronRight } from 'lucide-react';
import { STAGE_LABEL, STAGE_COLOR } from '@water-erp/shared';
import { PageHero, SectionCard, MetricCard, DataToolbar } from '@water-erp/ui';
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
    { label: '开标主持端', hint: '在线解密 · 开标记录', path: '/bid/open', tone: 'blue' as const },
    { label: '专家评标端', hint: '独立评分 · 报告确认', path: '/bid/evaluate', tone: 'purple' as const },
    { label: '监督端',     hint: '日志追溯 · 不可干预', path: '/bid/supervise', tone: 'orange' as const },
    { label: '归档端',     hint: '资料归档 · 防篡改',   path: '/bid/archive', tone: 'green' as const },
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
    <div className="space-y-6">
      {/* ── Page Hero ── */}
      <PageHero
        eyebrow="开评标管理"
        tone="blue"
        icon={<Gavel size={14} strokeWidth={1.5} />}
        title="开评标管理系统"
        description="统一入口 · 多端协同 · 限时开标 · 全程留痕"
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-xl bg-[#064ea2] px-4 py-2 text-sm font-bold text-white hover:bg-[#054280] transition"
          >
            <Plus size={14} strokeWidth={2} />
            创建项目
          </button>
        }
      />

      {/* ── Stat cards ── */}
      <div className="grid gap-4 md:grid-cols-5">
        <MetricCard label="项目总数" value={total} tone="blue" />
        <MetricCard label="活跃项目" value={active} tone="red" />
        <MetricCard label="在线开标" value={opening} tone="orange" />
        <MetricCard label="专家评标" value={evaluating} tone="purple" />
        <MetricCard label="已归档" value={archived} tone="green" />
      </div>

      {/* ── Quick entry ── */}
      <div className="grid gap-4 md:grid-cols-4">
        {entries.map(e => (
          <MetricCard
            key={e.path}
            label={e.label}
            value=""
            hint={e.hint}
            tone={e.tone}
            onClick={() => router.push(e.path)}
          />
        ))}
      </div>

      {/* ── Filter bar ── */}
      <DataToolbar>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
          <input
            type="text"
            placeholder="搜索项目名称或编号…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="workbench-input w-full pl-9"
          />
        </div>
        <select
          value={stageFilter}
          onChange={e => setStageFilter(e.target.value)}
          className="workbench-input cursor-pointer"
        >
          <option value="">全部阶段</option>
          {Object.entries(STAGE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </DataToolbar>

      {/* ── Project table ── */}
      <SectionCard title="项目状态" className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-8 space-y-3">{[1,2,3].map(i=><div key={i} className="h-10 bg-[#e8f0fa] animate-pulse rounded"/>)}</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-[#8a96aa]">暂无项目数据</div>
          ) : (
            <table className="workbench-table">
              <thead>
                <tr className="bg-[#f3f7fc]">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-[#5a6d8a]">项目编号</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-[#5a6d8a]">项目名称</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-[#5a6d8a]">采购方式</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-[#5a6d8a]">开标时间</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-[#5a6d8a]">阶段</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-[#5a6d8a]">风险</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-[#5a6d8a]">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const label = STAGE_LABEL[p.stage] || p.stage; const color = STAGE_COLOR[p.stage] || '#94a3b8';
                  return (
                    <tr key={p.id} onClick={() => router.push(`/bid/open?projectId=${p.id}`)}
                      className="cursor-pointer transition-colors">
                      <td className="px-5 py-3 font-mono text-sm font-semibold text-[#064ea2]">{p.projectCode}</td>
                      <td className="px-5 py-3 text-sm font-medium text-[#18243a]">{p.name}</td>
                      <td className="px-5 py-3 text-sm text-[#5a6d8a]">{p.procurementMethod}</td>
                      <td className="px-5 py-3 text-sm text-[#5a6d8a] font-mono">
                        {new Date(p.openTime).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })}
                      </td>
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ color, backgroundColor: `${color}18` }}>
                          {label}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm text-[#8a96aa]">{p.riskNote || '—'}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditProject(p); }}
                            className="rounded-lg p-1.5 text-[#5a6d8a] hover:bg-[#f8fafc] hover:text-[#064ea2] transition"
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
                            className="flex items-center gap-1 rounded-lg border border-[#dce6f3] px-2 py-1 text-xs font-bold text-[#5a6d8a] hover:bg-[#f8fafc] transition"
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
      </SectionCard>

      {/* ── Workspace panel ── */}
      {workspaceId && (
        <SectionCard
          title="工作区检查"
          action={
            <button
              onClick={() => { setWorkspaceId(null); setWorkspaceData(null); }}
              className="text-xs font-semibold text-[#5a6d8a] hover:text-[#18243a] transition"
            >
              收起
            </button>
          }
        >
          <div className="space-y-6">
            {/* Supplier submission progress */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-[#18243a]">供应商提交进度</span>
                <span className="text-xs font-mono text-[#5a6d8a]">
                  {workspaceData?.supplierSubmitted ?? 0} / {workspaceData?.supplierTotal ?? 0}
                </span>
              </div>
              <div className="w-full h-2 bg-[#e8f0fa] rounded-full overflow-hidden">
                <div
                  className="h-2 rounded-full transition-all duration-300"
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
              <p className="mt-1 text-xs text-[#8a96aa]">
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
                <span className="text-sm font-bold text-[#18243a]">专家签到状态</span>
                <span className="text-xs font-mono text-[#5a6d8a]">
                  {workspaceData?.expertSignedIn ?? 0} / {workspaceData?.expertTotal ?? 0}
                </span>
              </div>
              <div className="flex gap-3 text-xs">
                <span className="text-[#064ea2] font-semibold">
                  已签到：{workspaceData?.expertSignedIn ?? '—'}
                </span>
                <span className="text-[#e74c3c] font-semibold">
                  未签到：{(workspaceData?.expertTotal ?? 0) - (workspaceData?.expertSignedIn ?? 0)}
                </span>
                <span className="text-[#8a96aa]">
                  回避：{workspaceData?.expertRecused ?? '—'}
                </span>
              </div>
            </div>

            {/* Overall readiness indicator */}
            <div className="flex items-center gap-3 pt-4 border-t border-[#edf2f7]">
              <span className="text-sm font-bold text-[#18243a]">整体就绪状态</span>
              {(() => {
                const allSubmitted = (workspaceData?.supplierSubmitted ?? 0) === (workspaceData?.supplierTotal ?? 0) && (workspaceData?.supplierTotal ?? 0) > 0;
                const allSignedIn = (workspaceData?.expertSignedIn ?? 0) === (workspaceData?.expertTotal ?? 0) && (workspaceData?.expertTotal ?? 0) > 0;
                if (allSubmitted && allSignedIn) {
                  return (
                    <span className="flex items-center gap-1.5 text-xs font-bold text-[#064ea2]">
                      <span className="w-2 h-2 rounded-full bg-[#11a874]" />
                      就绪 — 所有供应商已提交，所有专家已签到
                    </span>
                  );
                }
                if (allSubmitted || allSignedIn || (workspaceData?.supplierSubmitted ?? 0) > 0 || (workspaceData?.expertSignedIn ?? 0) > 0) {
                  return (
                    <span className="flex items-center gap-1.5 text-xs font-bold text-[#f5a623]">
                      <span className="w-2 h-2 rounded-full bg-[#f5a623]" />
                      部分就绪 — 仍有环节未完成
                    </span>
                  );
                }
                return (
                  <span className="flex items-center gap-1.5 text-xs font-bold text-[#e74c3c]">
                    <span className="w-2 h-2 rounded-full bg-[#e74c3c]" />
                    未就绪 — 等待供应商提交和专家签到
                  </span>
                );
              })()}
            </div>
          </div>
        </SectionCard>
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
