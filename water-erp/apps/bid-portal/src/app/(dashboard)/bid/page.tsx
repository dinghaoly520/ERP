'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Pagination } from '@/components/pagination';
import { getProjectsDashboard, openSubmission, generateEvaluationResults, nudgeSuppliers, nudgeExperts, type DashboardProject } from '@/lib/api/bid';
import { Plus, Search, Pencil, ChevronDown, ChevronRight, AlertTriangle, Clock, Users, UserCheck, Megaphone, BellRing, UserPlus, FlaskConical, MessageSquareText, ShieldCheck, ExternalLink, type LucideIcon } from 'lucide-react';
import { STAGE_LABEL, STAGE_COLOR } from '@water-erp/shared';
import { SectionCard, MetricCard, DataToolbar } from '@water-erp/ui';
import { portalURL } from '@water-erp/config';
import { TableSkeleton } from '@/components/skeleton';
import CreateProjectDialog from '@/components/create-project-dialog';
import EditProjectDialog from '@/components/edit-project-dialog';
import InviteSuppliersDialog from '@/components/invite-suppliers-dialog';
/** 操作列次操作项（点击「更多」后在行下方横向展开的快捷动作）。 */
interface ActionMenuItem {
  key: string;
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
  tone?: 'default' | 'danger' | 'highlight';
}

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
  DOWNLOAD: '/bid/project',
  SUBMIT: '/bid/project',
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
  const [inviteProject, setInviteProject] = useState<DashboardProject | null>(null);
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

  const [actionExpandedIds, setActionExpandedIds] = useState<Set<string>>(new Set());
  const toggleActionMenu = (id: string) => {
    setActionExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
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
      const defaultTab =
        p.stage === 'EVALUATING' ? 'evaluate'
        : (p.stage === 'DOWNLOAD' || p.stage === 'SUBMIT') ? 'standard'
        : 'open';
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

  // ── 操作列：阶段门控的快捷管理动作 ──

  const gotoTab = (p: DashboardProject, tab: string) => router.push(`/bid/project/${p.id}?tab=${tab}`);

  const gotoExtract = (p: DashboardProject) => {
    // 专家抽取保留在 web 门户（:3005），跨门户带 token_web session，透传 projectId 预填
    window.open(portalURL('web', `/expert/extract?projectId=${p.id}`), '_blank');
  };

  const handleOpenSubmission = (p: DashboardProject) => {
    openSubmission(p.id)
      .then(() => { toast.success('已开放投递（进入投标期）'); fetchData(); })
      .catch((e: any) => toast.error(e?.message || '开放投递失败'));
  };

  const handleNudgeSuppliers = (p: DashboardProject) => {
    nudgeSuppliers(p.id, true)
      .then(({ reached }) => toast.success(`已催促 ${reached} 位未提交供应商`))
      .catch((e: any) => toast.error(e?.message || '催促供应商失败'));
  };

  const handleNudgeExperts = (p: DashboardProject, reason: 'signin' | 'score') => {
    nudgeExperts(p.id, reason)
      .then(({ reached }) => toast.success(
        reason === 'signin' ? `已催促 ${reached} 位未签到专家` : `已催促 ${reached} 位未完成评分专家`,
      ))
      .catch((e: any) => toast.error(e?.message || '催促专家失败'));
  };

  const handleGenerateResults = (p: DashboardProject) => {
    generateEvaluationResults(p.id)
      .then(() => toast.success('评标结果已生成'))
      .catch((e: any) => toast.error(e?.message || '生成评标结果失败'));
  };

  /** 按阶段 + readiness 构建次操作下拉项（催办 / 跳转抽取 / 流转 / 导航）。 */
  const buildMenuItems = (p: DashboardProject): ActionMenuItem[] => {
    const items: ActionMenuItem[] = [];
    const suppliersPending = p.supplierCount > 0 && p.supplierSubmitted < p.supplierCount;
    const expertsPendingSignin = p.expertCount > 0 && p.expertSignedIn < p.expertCount;
    const noExperts = p.expertCount === 0;

    if (p.stage === 'DOWNLOAD' || p.stage === 'SUBMIT') {
      // 邀请招标且名册为空时高亮提示（必须先邀请才能投标/催办）
      const inviteHighlight = p.procurementMethod === '邀请招标' && p.supplierCount === 0;
      items.push({
        key: 'invite-suppliers', label: '邀请供应商', icon: UserPlus,
        onClick: () => setInviteProject(p),
        tone: inviteHighlight ? 'highlight' : 'default',
      });
      items.push({
        key: 'nudge-suppliers', label: '催促供应商投标', icon: Megaphone,
        onClick: () => handleNudgeSuppliers(p),
        disabled: !suppliersPending,
        disabledReason: p.supplierCount === 0 ? '暂无投标供应商' : '全部供应商已提交',
      });
      if (noExperts) {
        items.push({ key: 'extract', label: '尚未抽取专家 · 去抽取', icon: UserPlus, onClick: () => gotoExtract(p), tone: 'highlight' });
      }
      items.push({ key: 'detail', label: '编制评分标准', icon: ExternalLink, onClick: () => gotoTab(p, 'standard') });
    }

    if (p.stage === 'OPENING') {
      items.push({
        key: 'nudge-expert-signin', label: '催促专家签到', icon: BellRing,
        onClick: () => handleNudgeExperts(p, 'signin'),
        disabled: !expertsPendingSignin,
        disabledReason: noExperts ? '尚未抽取专家' : '全部专家已签到',
      });
      if (noExperts) {
        items.push({ key: 'extract', label: '尚未抽取专家 · 去抽取', icon: UserPlus, onClick: () => gotoExtract(p), tone: 'highlight' });
      }
      items.push({ key: 'dispute', label: '处理开标异议', icon: AlertTriangle, onClick: () => gotoTab(p, 'open') });
      items.push({ key: 'supervise', label: '监督视图', icon: ShieldCheck, onClick: () => gotoTab(p, 'supervise') });
    }

    if (p.stage === 'EVALUATING') {
      items.push({ key: 'gen-results', label: '生成评标结果', icon: FlaskConical, onClick: () => handleGenerateResults(p) });
      items.push({
        key: 'nudge-expert-score', label: '催促专家评分', icon: BellRing,
        onClick: () => handleNudgeExperts(p, 'score'),
        disabled: noExperts,
        disabledReason: '尚未抽取专家',
      });
      items.push({ key: 'clarify', label: '发起澄清', icon: MessageSquareText, onClick: () => gotoTab(p, 'clarify') });
    }

    if (p.stage === 'ARCHIVED') {
      items.push({ key: 'supervise', label: '监督视图', icon: ShieldCheck, onClick: () => gotoTab(p, 'supervise') });
      items.push({ key: 'clarify', label: '查看澄清记录', icon: MessageSquareText, onClick: () => gotoTab(p, 'clarify') });
    }

    return items;
  };

  return (
    <div className="space-y-6">
      {/* ── Key metrics ── */}
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="项目总数" value={total} tone="blue" />
        <MetricCard
          label="就绪可开"
          value={readyCount}
          tone="green"
          hint={`${opening} 个在开标阶段`}
        />
        <MetricCard
          label="准备中"
          value={notReadyCount}
          tone="red"
          hint={`${downloading + submitting} 个在准备阶段`}
        />
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
                  <ChevronRight size={14} strokeWidth={1.5} className="flex-shrink-0 text-[#cbd5e1]" />
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
          className="workbench-input cursor-pointer text-sm"
        >
          <option value="">全部阶段</option>
          {Object.entries(STAGE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={readinessFilter}
          onChange={e => setReadinessFilter(e.target.value)}
          className="workbench-input cursor-pointer text-sm"
        >
          <option value="">全部状态</option>
          <option value="ready">● 就绪</option>
          <option value="partial">● 部分就绪</option>
          <option value="not-ready">● 未就绪</option>
          <option value="archived">● 已归档</option>
        </select>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-xl border border-[#dce3eb] px-3 py-2 text-sm font-semibold text-[#5a6d8a] hover:bg-[#f8fafc] transition"
        >
          <Plus size={14} strokeWidth={1.5} />
          手动创建
        </button>
      </DataToolbar>

      {/* ── Project table ── */}
      <SectionCard title="项目状态" className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          {loading ? (
            <TableSkeleton rows={8} cols={8} />
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
                          {p.stage === 'DOWNLOAD' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleOpenSubmission(p); }}
                              className="flex items-center gap-1 rounded-lg bg-[#11a874] px-2.5 py-1 text-[10px] font-bold text-white hover:bg-[#0f9f6e] transition"
                            >
                              开放投递
                            </button>
                          )}
                          {p.stage === 'SUBMIT' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); gotoTab(p, 'standard'); }}
                              className="flex items-center gap-1 rounded-lg border border-[#dce6f3] px-2.5 py-1 text-[10px] font-bold text-[#5a6d8a] hover:bg-[#f8fafc] hover:text-[#18243a] transition"
                            >
                              进入项目
                            </button>
                          )}
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

                          {/* Secondary actions: toggle inline expansion row (在行下方横向展开) */}
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleActionMenu(p.id); }}
                            className="flex items-center gap-1 rounded-lg border border-[#dce6f3] px-2 py-1 text-[10px] font-bold text-[#5a6d8a] hover:bg-[#f8fafc] hover:text-[#18243a] transition"
                            title="更多操作"
                          >
                            更多
                            <ChevronDown size={11} strokeWidth={2} className={`transition-transform ${actionExpandedIds.has(p.id) ? 'rotate-180' : ''}`} />
                          </button>

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
                    {/* Inline action expansion：快捷操作横向展开（不挤压表格） */}
                    {actionExpandedIds.has(p.id) && (() => {
                      const items = buildMenuItems(p);
                      if (items.length === 0) return null;
                      return (
                        <tr key={`${p.id}-actions`} className="bg-[#f8fafb] border-b border-[#edf2f7]">
                          <td colSpan={8} className="px-5 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[10px] font-bold text-[#8a96aa] mr-1 select-none">快捷操作</span>
                              {items.map(item => {
                                const Icon = item.icon;
                                const tone = item.tone ?? 'default';
                                const toneText = tone === 'danger' ? 'text-[#e74c3c]' : tone === 'highlight' ? 'text-[#d97706]' : 'text-[#334155]';
                                const toneBorder = tone === 'highlight' ? 'border-[#fcd34d]' : 'border-[#dce6f3]';
                                return (
                                  <button
                                    key={item.key}
                                    disabled={item.disabled}
                                    title={item.disabled ? item.disabledReason : undefined}
                                    onClick={(e) => { e.stopPropagation(); if (!item.disabled) item.onClick(); }}
                                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-bold transition ${
                                      item.disabled
                                        ? 'border-[#e8edf3] text-[#cbd5e1] cursor-not-allowed'
                                        : `${toneBorder} ${toneText} hover:bg-white`
                                    }`}
                                  >
                                    {Icon && <Icon size={13} strokeWidth={1.5} />}
                                    {item.label}
                                  </button>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      );
                    })()}
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

      <InviteSuppliersDialog
        open={!!inviteProject}
        projectId={inviteProject?.id ?? ''}
        projectName={inviteProject?.name ?? ''}
        onClose={() => setInviteProject(null)}
        onInvited={() => {
          setInviteProject(null);
          fetchData();
        }}
      />
    </div>
  );
}
