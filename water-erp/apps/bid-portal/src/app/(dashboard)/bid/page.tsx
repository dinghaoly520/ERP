'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Pagination } from '@/components/pagination';
import { getProjectsDashboard, type DashboardProject } from '@/lib/api/bid';
import { Gavel, Plus, Search, Pencil, ChevronDown, ChevronRight, AlertTriangle, Clock, Users, UserCheck } from 'lucide-react';
import { STAGE_LABEL, STAGE_COLOR } from '@water-erp/shared';
import { PageHero, SectionCard, MetricCard, DataToolbar } from '@water-erp/ui';
import CreateProjectDialog from '@/components/create-project-dialog';
import EditProjectDialog from '@/components/edit-project-dialog';

interface DashboardData {
  projects: DashboardProject[];
  stageDistribution: Record<string, number>;
  totalProjects: number;
  activeProjects: number;
}

const READINESS_LABEL: Record<string, string> = {
  ready: '就绪',
  partial: '部分就绪',
  'not-ready': '未就绪',
  archived: '已归档',
};

const READINESS_COLOR: Record<string, string> = {
  ready: '#11a874',
  partial: '#f5a623',
  'not-ready': '#e74c3c',
  archived: '#94a3b8',
};

/** Stage → sub-route mapping for context-aware row navigation */
const STAGE_ROUTE: Record<string, string> = {
  DOWNLOAD: '',
  SUBMIT: '',
  OPENING: '/bid/project',
  EVALUATING: '/bid/project',
  ARCHIVED: '/bid/project',
};

const pad = (n: number) => String(n).padStart(2, '0');

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isOverdue(iso: string): boolean {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
}

const PAGE_SIZE = 20;

export default function BidDashboard() {
  const router = useRouter();
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [readinessFilter, setReadinessFilter] = useState('');
  const [editProject, setEditProject] = useState<any>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [workspaceMap, setWorkspaceMap] = useState<Map<string, any>>(new Map());
  const [projectsPage, setProjectsPage] = useState(1);

  const toggleWorkspace = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        // Fetch workspace data if not already cached
        if (!workspaceMap.has(id)) {
          api.get<any>(`/bid/projects/${id}/workspace`)
            .then(data => setWorkspaceMap(prev => new Map(prev).set(id, data)))
            .catch(() => {});
        }
      }
      return next;
    });
  };

  const fetchData = () => {
    setLoading(true);
    getProjectsDashboard()
      .then(setDash)
      .catch((e) => { toast.error(e?.message || '加载项目列表失败'); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const projects = dash?.projects ?? [];
  const stageDistribution = dash?.stageDistribution ?? {};

  // ── Derived counts ──
  const total = dash?.totalProjects ?? projects.length;
  const opening = stageDistribution['OPENING'] ?? 0;
  const evaluating = stageDistribution['EVALUATING'] ?? 0;
  const archived = stageDistribution['ARCHIVED'] ?? 0;
  const downloading = stageDistribution['DOWNLOAD'] ?? 0;
  const submitting = stageDistribution['SUBMIT'] ?? 0;
  const readyCount = projects.filter(p => p.readiness === 'ready').length;
  const notReadyCount = projects.filter(p => p.readiness === 'not-ready').length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter(p => {
      if (q && !p.name.toLowerCase().includes(q) && !p.projectCode.toLowerCase().includes(q)) return false;
      if (stageFilter && p.stage !== stageFilter) return false;
      if (readinessFilter && p.readiness !== readinessFilter) return false;
      return true;
    });
  }, [projects, search, stageFilter, readinessFilter]);

  const paginated = useMemo(() => {
    const start = (projectsPage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, projectsPage]);

  // Reset page when filters change
  useEffect(() => { setProjectsPage(1); }, [search, stageFilter, readinessFilter]);

  // ── Row click: navigate to stage-appropriate route ──
  const handleRowClick = (p: DashboardProject) => {
    const route = STAGE_ROUTE[p.stage];
    if (route) {
      const defaultTab = p.stage === 'EVALUATING' ? 'evaluate' : 'open';
      router.push(`${route}/${p.id}?tab=${defaultTab}`);
    }
  };

  // ── Collect computed risks for a project ──
  const getRisks = (p: DashboardProject) => {
    const risks: string[] = [];
    if (p.stage !== 'ARCHIVED') {
      if (isOverdue(p.deadline)) risks.push('截标已逾期');
      if (p.supplierCount === 0 && (p.stage === 'SUBMIT' || p.stage === 'OPENING')) risks.push('无供应商');
      if (p.expertCount === 0 && (p.stage === 'OPENING' || p.stage === 'EVALUATING')) risks.push('无专家');
    }
    return risks;
  };

  return (
    <div className="space-y-6">
      {/* ── Page Hero ── */}
      <PageHero
        tone="blue"
        icon={<Gavel size={14} strokeWidth={1.5} />}
        title="开评标管理系统"
        description="统一入口 · 多端协同 · 限时开标 · 全程留痕"
      />

      {/* ── Key metrics ── */}
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="项目总数" value={total} tone="blue" />
        <MetricCard
          label="就绪可开"
          value={readyCount}
          tone="green"
          hint={`${opening} 个在开标阶段`}
        />
        <MetricCard
          label="进行中·阻塞"
          value={notReadyCount}
          tone="red"
          hint={`${downloading + submitting} 个在准备阶段`}
        />
        <MetricCard label="已归档" value={archived} tone="gray" />
      </div>

      {/* ── Stage pipeline ── */}
      <SectionCard className="p-4">
        <div className="flex items-center gap-0">
          {(['DOWNLOAD', 'SUBMIT', 'OPENING', 'EVALUATING', 'ARCHIVED'] as const).map((stage, i) => {
            const count = stageDistribution[stage] ?? 0;
            const label = STAGE_LABEL[stage];
            const color = STAGE_COLOR[stage];
            const isCurrent = stageFilter === stage;
            return (
              <div key={stage} className="flex items-center gap-0 flex-1">
                <button
                  onClick={() => setStageFilter(isCurrent ? '' : stage)}
                  className={`flex-1 rounded-xl px-3 py-3 text-center transition-all ${
                    isCurrent
                      ? 'shadow-md'
                      : 'hover:shadow-sm'
                  }`}
                  style={{
                    backgroundColor: isCurrent ? `${color}15` : `${color}06`,
                    border: isCurrent ? `2px solid ${color}` : `1px solid ${color}25`,
                  }}
                  title={`${label}: ${count} 个项目`}
                >
                  <div className="text-2xl font-black tracking-tight" style={{ color }}>
                    {count}
                  </div>
                  <div className="text-[10px] font-semibold mt-0.5" style={{ color: isCurrent ? color : '#5a6d8a' }}>
                    {label}
                  </div>
                </button>
                {i < 4 && (
                  <div className="flex-shrink-0 mx-0.5 text-[#cbd5e1]">
                    <svg width="16" height="16" viewBox="0 0 16 16">
                      <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {stageFilter && (
          <div className="mt-3 text-center">
            <button
              onClick={() => setStageFilter('')}
              className="text-[10px] font-semibold text-[#5a6d8a] hover:text-[#18243a] transition"
            >
              清除阶段筛选
            </button>
          </div>
        )}
      </SectionCard>

      {/* ── Filter bar ── */}
      <DataToolbar>
        <div className="relative flex-1 min-w-[180px]">
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
          onChange={e => { setStageFilter(e.target.value); setReadinessFilter(''); }}
          className="workbench-input cursor-pointer"
        >
          <option value="">全部阶段</option>
          {Object.entries(STAGE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={readinessFilter}
          onChange={e => setReadinessFilter(e.target.value)}
          className="workbench-input cursor-pointer"
        >
          <option value="">全部状态</option>
          <option value="ready">🟢 就绪</option>
          <option value="partial">🟡 部分就绪</option>
          <option value="not-ready">🔴 未就绪</option>
          <option value="archived">⚪ 已归档</option>
        </select>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-xl border border-[#dce6f3] px-3 py-1.5 text-xs font-bold text-[#5a6d8a] hover:bg-[#f8fafc] hover:text-[#18243a] transition"
        >
          <Plus size={12} strokeWidth={1.5} />
          手动创建
        </button>
      </DataToolbar>

      {/* ── Project table ── */}
      <SectionCard title="项目状态" className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-5 space-y-3">
              {/* Skeleton table */}
              <div className="h-8 bg-[#f3f7fc] rounded" />
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-11 bg-[#f8fafc] rounded animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <p className="text-sm text-[#8a96aa]">暂无匹配的项目</p>
              {projects.length === 0 && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#064ea2] px-4 py-2 text-xs font-bold text-[#064ea2] hover:bg-[#eff6ff] transition"
                >
                  <Plus size={12} strokeWidth={1.5} />
                  创建第一个项目
                </button>
              )}
            </div>
          ) : (
            <table className="workbench-table">
              <thead>
                <tr className="bg-[#f3f7fc]">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#5a6d8a] whitespace-nowrap">项目编号</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#5a6d8a]">项目名称</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#5a6d8a] whitespace-nowrap">采购方式</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#5a6d8a] whitespace-nowrap">截标 · 开标</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#5a6d8a] whitespace-nowrap">准备进度</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#5a6d8a] whitespace-nowrap">阶段</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#5a6d8a] whitespace-nowrap">就绪</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#5a6d8a] whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(p => {
                  const stageLabel = STAGE_LABEL[p.stage] || p.stage;
                  const stageColor = STAGE_COLOR[p.stage] || '#94a3b8';
                  const readinessLabel = READINESS_LABEL[p.readiness] || p.readiness;
                  const readinessColor = READINESS_COLOR[p.readiness] || '#94a3b8';
                  const risks = getRisks(p);
                  const deadlineOverdue = p.stage !== 'ARCHIVED' && isOverdue(p.deadline);
                  const clickable = !!STAGE_ROUTE[p.stage];

                  return (
                    <Fragment key={p.id}>
                    <tr
                      onClick={() => clickable && handleRowClick(p)}
                      className={`transition-colors ${clickable ? 'cursor-pointer hover:bg-[#f8fafc]' : ''} ${risks.length > 0 ? 'bg-[#fef9f5]' : ''}`}
                    >
                      {/* 项目编号 */}
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm font-semibold text-[#064ea2]">{p.projectCode}</span>
                        {p.riskNote?.includes('来自公告') ? (
                          <span className="ml-2 inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold text-[#11a874] bg-[#11a87412]">公告</span>
                        ) : (
                          <span className="ml-2 inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold text-[#5a6d8a] bg-[#5a6d8a10]">手动</span>
                        )}
                      </td>

                      {/* 项目名称 + risk icons */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-[#18243a]">{p.name}</span>
                          {risks.map(r => (
                            <span
                              key={r}
                              className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold text-[#e74c3c] bg-[#fef2f2] border border-[#fecaca]"
                              title={r}
                            >
                              <AlertTriangle size={9} strokeWidth={2} />
                              {r}
                            </span>
                          ))}
                        </div>
                      </td>

                      {/* 采购方式 */}
                      <td className="px-4 py-3 text-sm text-[#5a6d8a]">{p.procurementMethod}</td>

                      {/* 截标 · 开标 */}
                      <td className="px-4 py-3">
                        <div className="space-y-0.5 text-xs font-mono">
                          <div className={`flex items-center gap-1 ${deadlineOverdue ? 'text-[#e74c3c] font-bold' : 'text-[#5a6d8a]'}`}>
                            <Clock size={10} strokeWidth={1.5} />
                            <span>截 {fmtDateTime(p.deadline)}</span>
                            {deadlineOverdue && <span className="text-[9px] text-[#e74c3c]">逾期</span>}
                          </div>
                          <div className="flex items-center gap-1 text-[#8a96aa]">
                            <span className="inline-block w-2.5" />
                            <span>开 {fmtDateTime(p.openTime)}</span>
                          </div>
                        </div>
                      </td>

                      {/* 准备进度：供应商 + 专家 */}
                      <td className="px-4 py-3">
                        <div className="space-y-1.5">
                          {/* 供应商进度条 */}
                          <div className="flex items-center gap-1.5">
                            <Users size={10} strokeWidth={1.5} className="text-[#8a96aa] shrink-0" />
                            {p.supplierCount > 0 ? (
                              <>
                                <div className="w-14 h-1.5 bg-[#e8f0fa] rounded-full overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all"
                                    style={{
                                      width: `${(p.supplierSubmitted / p.supplierCount) * 100}%`,
                                      backgroundColor:
                                        p.supplierSubmitted === p.supplierCount ? '#11a874' :
                                        p.supplierSubmitted > 0 ? '#f5a623' : '#d1d5db',
                                    }}
                                  />
                                </div>
                                <span className="text-[10px] font-mono text-[#5a6d8a]">
                                  {p.supplierSubmitted}/{p.supplierCount}
                                </span>
                              </>
                            ) : (
                              <span className="text-[10px] text-[#94a3b8]">—</span>
                            )}
                          </div>
                          {/* 专家签到 */}
                          <div className="flex items-center gap-1.5">
                            <UserCheck size={10} strokeWidth={1.5} className="text-[#8a96aa] shrink-0" />
                            {p.expertCount > 0 ? (
                              <span className="text-[10px] font-mono text-[#5a6d8a]">
                                {p.expertSignedIn}/{p.expertCount}
                                {p.expertSignedIn === p.expertCount && p.expertCount > 0 ? (
                                  <span className="ml-0.5 text-[#11a874]">✓</span>
                                ) : (
                                  <span className="ml-0.5 text-[#94a3b8]">
                                    {p.expertSignedIn > 0 ? '…' : ''}
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="text-[10px] text-[#94a3b8]">—</span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* 阶段 */}
                      <td className="px-4 py-3">
                        <span
                          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap"
                          style={{ color: stageColor, backgroundColor: `${stageColor}18` }}
                        >
                          {stageLabel}
                        </span>
                      </td>

                      {/* 就绪状态 */}
                      <td className="px-4 py-3">
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap"
                          style={{ color: readinessColor, backgroundColor: `${readinessColor}15` }}
                        >
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: readinessColor }}
                          />
                          {readinessLabel}
                        </span>
                      </td>

                      {/* 操作 */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {/* Primary action: context-aware based on stage */}
                          {p.stage === 'OPENING' && p.readiness === 'ready' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/bid/project/${p.id}?tab=open`);
                              }}
                              className="flex items-center gap-1 rounded-lg bg-[#11a874] px-2.5 py-1 text-[10px] font-bold text-white hover:bg-[#0f9f6e] transition"
                            >
                              启动开标
                            </button>
                          )}
                          {p.stage === 'OPENING' && p.readiness !== 'ready' && (
                            <span className="text-[10px] text-[#8a96aa] italic">等待就绪</span>
                          )}
                          {p.stage === 'EVALUATING' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/bid/project/${p.id}?tab=evaluate`);
                              }}
                              className="flex items-center gap-1 rounded-lg bg-[#7c3aed] px-2.5 py-1 text-[10px] font-bold text-white hover:bg-[#6d28d9] transition"
                            >
                              进入评标
                            </button>
                          )}
                          {p.stage === 'ARCHIVED' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/bid/project/${p.id}?tab=open`);
                              }}
                              className="flex items-center gap-1 rounded-lg border border-[#dce6f3] px-2.5 py-1 text-[10px] font-bold text-[#5a6d8a] hover:bg-[#f8fafc] transition"
                            >
                              查看归档
                            </button>
                          )}
                          {(p.stage === 'DOWNLOAD' || p.stage === 'SUBMIT') && (
                            <span className="text-[10px] text-[#8a96aa]">准备中</span>
                          )}

                          {/* Edit button */}
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditProject(p); }}
                            className="rounded-lg p-1.5 text-[#5a6d8a] hover:bg-[#f8fafc] hover:text-[#064ea2] transition"
                            title="编辑"
                          >
                            <Pencil size={13} strokeWidth={1.5} />
                          </button>

                          {/* Workspace inspect toggle */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleWorkspace(p.id);
                            }}
                            className="flex items-center gap-1 rounded-lg border border-[#dce6f3] px-2 py-1 text-[10px] font-bold text-[#5a6d8a] hover:bg-[#f8fafc] transition"
                            title="检查工作区"
                          >
                            {expandedIds.has(p.id) ? <ChevronDown size={11} strokeWidth={2} /> : <ChevronRight size={11} strokeWidth={2} />}
                            检查
                          </button>
                        </div>
                      </td>
                    </tr>
                    {/* Inline workspace expansion */}
                    {expandedIds.has(p.id) && (() => {
                      const wd = workspaceMap.get(p.id);
                      const isLoaded = !!wd;
                      return (
                        <tr key={`${p.id}-ws`} className="bg-[#f8fafb] border-b border-[#edf2f7]">
                          <td colSpan={8} className="px-5 py-4">
                            {!isLoaded ? (
                              <div className="flex items-center gap-2 py-2">
                                <div className="w-4 h-4 border-2 border-[#bfdbfe] border-t-[#064ea2] rounded-full animate-spin" />
                                <span className="text-xs text-[#8a96aa]">加载工作区数据…</span>
                              </div>
                            ) : (
                              <div className="space-y-4">
                                <div className="flex items-center gap-6">
                                  <div className="flex-1 max-w-xs">
                                    <div className="flex items-center justify-between mb-1.5">
                                      <span className="text-xs font-bold text-[#18243a]">供应商提交进度</span>
                                      <span className="text-[10px] font-mono text-[#5a6d8a]">
                                        {wd?.stats?.submitted ?? 0} / {wd?.stats?.supplierTotal ?? 0}
                                      </span>
                                    </div>
                                    <div className="w-full h-1.5 bg-[#e8f0fa] rounded-full overflow-hidden">
                                      <div
                                        className="h-full rounded-full transition-all duration-300"
                                        style={{
                                          width: `${(wd?.stats?.supplierTotal ?? 0) > 0 ? ((wd?.stats?.submitted ?? 0) / wd.stats.supplierTotal) * 100 : 0}%`,
                                          backgroundColor: (wd?.stats?.submitted ?? 0) === (wd?.stats?.supplierTotal ?? 0) && (wd?.stats?.supplierTotal ?? 0) > 0
                                            ? '#11a874' : (wd?.stats?.submitted ?? 0) > 0 ? '#f5a623' : '#d1d5db',
                                        }}
                                      />
                                    </div>
                                  </div>
                                  <div>
                                    <span className="text-xs font-bold text-[#18243a] mr-3">专家签到</span>
                                    <span className="text-xs font-mono text-[#064ea2] font-semibold">
                                      {wd?.stats?.expertSignedIn ?? 0}
                                    </span>
                                    <span className="text-xs text-[#8a96aa]"> / {wd?.stats?.expertCount ?? 0} 已签到</span>
                                    <span className="text-xs text-[#8a96aa] ml-3">
                                      回避：{wd?.experts?.filter((e: any) => e.avoidanceConfirmed).length ?? 0}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 pt-3 border-t border-[#edf2f7]">
                                  {(() => {
                                    const sub = wd?.stats?.submitted ?? 0;
                                    const sTot = wd?.stats?.supplierTotal ?? 0;
                                    const sig = wd?.stats?.expertSignedIn ?? 0;
                                    const eTot = wd?.stats?.expertCount ?? 0;
                                    const allSub = sub === sTot && sTot > 0;
                                    const allSig = sig === eTot && eTot > 0;
                                    if (allSub && allSig) {
                                      return <><span className="w-2 h-2 rounded-full bg-[#11a874]" /><span className="text-xs font-bold text-[#11a874]">就绪 — 所有供应商已提交，所有专家已签到</span></>;
                                    }
                                    if (allSub || allSig || sub > 0 || sig > 0) {
                                      return <><span className="w-2 h-2 rounded-full bg-[#f5a623]" /><span className="text-xs font-bold text-[#f5a623]">部分就绪 — 仍有环节未完成</span></>;
                                    }
                                    return <><span className="w-2 h-2 rounded-full bg-[#e74c3c]" /><span className="text-xs font-bold text-[#e74c3c]">未就绪 — 等待供应商提交和专家签到</span></>;
                                  })()}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })()}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {!loading && filtered.length > 0 && (
          <Pagination page={projectsPage} totalPages={Math.ceil(filtered.length / PAGE_SIZE)}
            totalItems={filtered.length} pageSize={PAGE_SIZE} onPage={setProjectsPage} />
        )}
      </SectionCard>

      <CreateProjectDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          setShowCreate(false);
          fetchData();
        }}
      />

      <EditProjectDialog
        open={!!editProject}
        project={editProject}
        onClose={() => setEditProject(null)}
        onUpdated={() => {
          setEditProject(null);
          fetchData();
        }}
      />
    </div>
  );
}
