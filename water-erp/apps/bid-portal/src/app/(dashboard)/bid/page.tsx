'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Pagination } from '@/components/pagination';
import { getProjectsDashboard, openSubmission, generateEvaluationResults, nudgeSuppliers, nudgeExperts, type DashboardProject } from '@/lib/api/bid';
import {
  Plus, Search, Pencil, ChevronDown, ChevronRight, AlertTriangle, Clock, Users, UserCheck,
  Megaphone, BellRing, UserPlus, FlaskConical, MessageSquareText, ShieldCheck, ExternalLink,
  RefreshCw, Gauge, type LucideIcon,
} from 'lucide-react';
import { STAGE_LABEL, STAGE_COLOR } from '@water-erp/shared';
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

/** KPI 信号徽标颜色映射（cgzxui 语义令牌）*/
const SIGNAL_VAR: Record<string, string> = {
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
};
const SIGNAL_LABEL: Record<string, string> = {
  success: '达标',
  warning: '关注',
  danger: '风险',
};

/** page-hero 内的紧凑指标瓷片 */
function Kpi({
  label, value, sub, signal,
}: {
  label: string;
  value: number | string;
  sub?: string;
  signal?: 'success' | 'warning' | 'danger';
}) {
  return (
    <div className="kpi-card flex h-full flex-col gap-1.5 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">{label}</span>
        {signal && (
          <span
            className="kpi-signal inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold"
            style={{ '--s': SIGNAL_VAR[signal] } as React.CSSProperties}
          >
            <span className="kpi-signal-dot h-1 w-1 rounded-full" />
            {SIGNAL_LABEL[signal]}
          </span>
        )}
      </div>
      <span className="text-[1.55rem] font-black leading-none tracking-[-0.04em] tabular-nums text-[var(--foreground)]">{value}</span>
      {sub && <span className="text-[10px] font-medium text-[var(--muted-foreground)]">{sub}</span>}
    </div>
  );
}

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
  const archived = stageDistribution['ARCHIVED'] ?? 0;
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

  // ── 顶部健康度 KPI（与阶段分布互补：聚焦风险/就绪而非阶段计数）──
  const overdueCount = projects.filter(p => p.stage !== 'ARCHIVED' && isOverdue(p.deadline)).length;
  const riskCount = projects.filter(p => getRisks(p).length > 0).length;

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
      if (noExperts) {
        items.push({ key: 'extract', label: '尚未抽取专家 · 去抽取', icon: UserPlus, onClick: () => gotoExtract(p), tone: 'highlight' });
      }
      items.push({
        key: 'nudge-expert-score', label: '催促专家评分', icon: BellRing,
        onClick: () => handleNudgeExperts(p, 'score'),
        disabled: noExperts,
        disabledReason: '尚未抽取专家',
      });
      items.push({ key: 'supervise', label: '监督视图', icon: ShieldCheck, onClick: () => gotoTab(p, 'supervise') });
      items.push({ key: 'clarify', label: '发起澄清', icon: MessageSquareText, onClick: () => gotoTab(p, 'clarify') });
    }

    if (p.stage === 'ARCHIVED') {
      items.push({ key: 'supervise', label: '监督视图', icon: ShieldCheck, onClick: () => gotoTab(p, 'supervise') });
      items.push({ key: 'clarify', label: '查看澄清记录', icon: MessageSquareText, onClick: () => gotoTab(p, 'clarify') });
    }

    return items;
  };

  /** 进度条填充色（绿=完成 / 橙=进行中 / 灰=未开始）—— 通过 --bar 传入 CSS */
  const barColor = (done: number, totalN: number) =>
    done === totalN ? 'var(--success)' : done > 0 ? 'var(--warning)' : 'oklch(0.78 0.01 258)';

  return (
    <div className="space-y-5">
      {/* ── 页面标题卡片 .page-hero ── */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><Gauge size={17} strokeWidth={1.5} /></div>
            <div>
              <div className="page-hero__title">开评标总览</div>
              <div className="page-hero__sub">招投标项目全生命周期监控 · 阶段分布与就绪度一目了然</div>
            </div>
          </div>
          <div className="page-hero__right">
            <span className="page-hero__stat page-hero__stat--info">共 {total} 项目</span>
            {notReadyCount > 0 && (
              <span className="page-hero__stat page-hero__stat--warn">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--danger)]" />
                {notReadyCount} 待处理
              </span>
            )}
            <button onClick={fetchData} disabled={loading} className="neu-btn-xs" title="刷新"><RefreshCw size={13} strokeWidth={1.7} /></button>
            <button onClick={() => setShowCreate(true)} className="neu-btn-soft"><Plus size={15} strokeWidth={1.7} /> 手动创建</button>
          </div>
        </div>

        <div className="wb-section-rule" />

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Kpi label="项目总数" value={total} sub="全周期项目" />
          <Kpi label="就绪可开" value={readyCount} sub={`${opening} 个开标中`} signal={readyCount > 0 ? 'success' : undefined} />
          <Kpi label="准备中" value={notReadyCount} sub={`${downloading + submitting} 准备阶段`} signal={notReadyCount > 0 ? 'warning' : undefined} />
          <Kpi label="截标逾期" value={overdueCount} sub="需立即处理" signal={overdueCount > 0 ? 'danger' : undefined} />
          <Kpi label="风险项目" value={riskCount} sub="供应商/专家缺口" signal={riskCount > 0 ? 'danger' : undefined} />
        </div>
      </div>

      {/* ── 阶段分布 · 点击筛选（neumorphic 静态容器 + 阶段磁贴）── */}
      <div className="neu-card-static p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">阶段分布 · 点击筛选</span>
          {stageFilter && (
            <button onClick={() => setStageFilter('')} className="neu-btn-xs">清除筛选</button>
          )}
        </div>
        <div className="flex items-stretch">
          {(['DOWNLOAD', 'SUBMIT', 'OPENING', 'EVALUATING', 'ARCHIVED'] as const).map((stage, i) => {
            const count = stageDistribution[stage] ?? 0;
            const label = STAGE_LABEL[stage];
            const color = STAGE_COLOR[stage];
            const isCurrent = stageFilter === stage;
            return (
              <Fragment key={stage}>
                <button
                  aria-pressed={isCurrent}
                  onClick={() => setStageFilter(isCurrent ? '' : stage)}
                  className="bid-stage-tile"
                  style={{ '--stage-color': color } as React.CSSProperties}
                  title={`${label}: ${count} 个项目`}
                >
                  <span className="bid-stage-num">{count}</span>
                  <span className="bid-stage-label">{label}</span>
                </button>
                {i < 4 && (
                  <ChevronRight size={14} strokeWidth={1.5} className="mx-1 shrink-0 self-center text-[color:var(--muted-foreground)] opacity-30" />
                )}
              </Fragment>
            );
          })}
        </div>
      </div>

      {/* ── 数据表格卡片 .neu-table-card ── */}
      <div className="neu-table-card">
        {/* 工具栏：搜索 + 筛选 */}
        <div className="neu-table-card-header flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] flex-1">
            <Search size={14} strokeWidth={1.5} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--muted-foreground)]" />
            <input
              type="text"
              placeholder="搜索项目名称或编号…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="neu-input has-icon"
            />
          </div>
          <select
            value={stageFilter}
            onChange={e => { setStageFilter(e.target.value); setReadinessFilter(''); }}
            className="neu-select"
          >
            <option value="">全部阶段</option>
            {Object.entries(STAGE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            value={readinessFilter}
            onChange={e => setReadinessFilter(e.target.value)}
            className="neu-select"
          >
            <option value="">全部状态</option>
            <option value="ready">就绪</option>
            <option value="partial">部分就绪</option>
            <option value="not-ready">未就绪</option>
            <option value="archived">已归档</option>
          </select>
        </div>

        {/* 表格主体 */}
        <div className="overflow-x-auto">
          {loading ? (
            <TableSkeleton rows={8} cols={8} />
          ) : filtered.length === 0 ? (
            <div className="space-y-3 py-16 text-center">
              <p className="text-sm text-[var(--muted-foreground)]">暂无匹配的项目</p>
              {projects.length === 0 && (
                <button onClick={() => setShowCreate(true)} className="neu-btn-soft">
                  <Plus size={13} strokeWidth={1.7} /> 创建第一个项目
                </button>
              )}
            </div>
          ) : (
            <table className="neu-table is-dense min-w-[920px]">
              <thead>
                <tr>
                  <th>项目编号</th>
                  <th>项目名称</th>
                  <th>采购方式</th>
                  <th>截标 · 开标</th>
                  <th>准备进度</th>
                  <th>阶段</th>
                  <th>就绪</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(p => {
                  const stageLabel = STAGE_LABEL[p.stage] || p.stage;
                  const stageColor = STAGE_COLOR[p.stage] || '#94a3b8';
                  const readinessLabel = READINESS_LABEL[p.readiness] || p.readiness;
                  const readinessColor = p.readiness === 'ready' ? 'var(--success)'
                    : p.readiness === 'not-ready' ? 'var(--danger)'
                    : p.readiness === 'partial' ? 'var(--warning)'
                    : 'var(--muted-foreground)';
                  const risks = getRisks(p);
                  const deadlineOverdue = p.stage !== 'ARCHIVED' && isOverdue(p.deadline);
                  const clickable = !!STAGE_ROUTE[p.stage];

                  return (
                    <Fragment key={p.id}>
                      <tr
                        onClick={() => clickable && handleRowClick(p)}
                        className={clickable ? 'row-clickable' : ''}
                        data-risk={risks.length > 0 ? 'true' : undefined}
                      >
                        {/* 项目编号 */}
                        <td>
                          <span className="font-mono text-sm font-semibold text-[var(--accent-strong)]">{p.projectCode}</span>
                          {p.riskNote?.includes('来自公告') ? (
                            <span className="bid-pill ml-2" style={{ '--c': 'var(--success)' } as React.CSSProperties}>公告</span>
                          ) : (
                            <span className="bid-pill ml-2" style={{ '--c': 'var(--muted-foreground)' } as React.CSSProperties}>手动</span>
                          )}
                        </td>

                        {/* 项目名称 + risk pills */}
                        <td>
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium text-[var(--foreground)]">{p.name}</span>
                            {risks.map(r => (
                              <span
                                key={r}
                                className="bid-pill"
                                style={{ '--c': 'var(--danger)' } as React.CSSProperties}
                                title={r}
                              >
                                <AlertTriangle size={9} strokeWidth={2} />
                                {r}
                              </span>
                            ))}
                          </div>
                        </td>

                        {/* 采购方式 */}
                        <td className="text-sm text-[var(--muted-foreground)]">{p.procurementMethod}</td>

                        {/* 截标 · 开标 */}
                        <td>
                          <div className="space-y-0.5 font-mono text-xs">
                            <div className={`flex items-center gap-1 ${deadlineOverdue ? 'font-bold text-[var(--danger)]' : 'text-[var(--muted-foreground)]'}`}>
                              <Clock size={10} strokeWidth={1.5} />
                              <span>截 {fmtDateTime(p.deadline)}</span>
                              {deadlineOverdue && <span className="text-[9px]">逾期</span>}
                            </div>
                            <div className="flex items-center gap-1 text-[var(--muted-foreground)] opacity-70">
                              <span className="inline-block w-2.5" />
                              <span>开 {fmtDateTime(p.openTime)}</span>
                            </div>
                          </div>
                        </td>

                        {/* 准备进度：供应商 + 专家 */}
                        <td>
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5">
                              <Users size={10} strokeWidth={1.5} className="shrink-0 text-[var(--muted-foreground)] opacity-70" />
                              {p.supplierCount > 0 ? (
                                <>
                                  <div className="bid-bar w-14">
                                    <i style={{ width: `${(p.supplierSubmitted / p.supplierCount) * 100}%`, '--bar': barColor(p.supplierSubmitted, p.supplierCount) } as React.CSSProperties} />
                                  </div>
                                  <span className="font-mono text-[10px] text-[var(--muted-foreground)]">
                                    {p.supplierSubmitted}/{p.supplierCount}
                                  </span>
                                </>
                              ) : (
                                <span className="text-[10px] text-[var(--muted-foreground)] opacity-60">—</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <UserCheck size={10} strokeWidth={1.5} className="shrink-0 text-[var(--muted-foreground)] opacity-70" />
                              {p.expertCount > 0 ? (
                                <span className="font-mono text-[10px] text-[var(--muted-foreground)]">
                                  {p.expertSignedIn}/{p.expertCount}
                                  {p.expertSignedIn === p.expertCount && p.expertCount > 0 ? (
                                    <span className="ml-0.5 text-[var(--success)]">✓</span>
                                  ) : (
                                    <span className="ml-0.5 text-[var(--muted-foreground)] opacity-60">
                                      {p.expertSignedIn > 0 ? '…' : ''}
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span className="text-[10px] text-[var(--muted-foreground)] opacity-60">—</span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* 阶段 */}
                        <td>
                          <span className="bid-pill" style={{ '--c': stageColor } as React.CSSProperties}>
                            {stageLabel}
                          </span>
                        </td>

                        {/* 就绪状态 */}
                        <td>
                          <span className="bid-pill" style={{ '--c': readinessColor } as React.CSSProperties}>
                            <span className="bid-pill-dot" />
                            {readinessLabel}
                          </span>
                        </td>

                        {/* 操作 */}
                        <td>
                          <div className="flex items-center gap-1.5">
                            {p.stage === 'DOWNLOAD' && (
                              <button onClick={(e) => { e.stopPropagation(); handleOpenSubmission(p); }} className="neu-btn-xs is-success">开放投递</button>
                            )}
                            {p.stage === 'SUBMIT' && (
                              <button onClick={(e) => { e.stopPropagation(); gotoTab(p, 'standard'); }} className="neu-btn-xs">进入项目</button>
                            )}
                            {p.stage === 'OPENING' && p.readiness === 'ready' && (
                              <button onClick={(e) => { e.stopPropagation(); router.push(`/bid/project/${p.id}?tab=open`); }} className="neu-btn-xs is-success">启动开标</button>
                            )}
                            {p.stage === 'OPENING' && p.readiness !== 'ready' && (
                              <span className="text-[10px] italic text-[var(--muted-foreground)] opacity-70">等待就绪</span>
                            )}
                            {p.stage === 'EVALUATING' && (
                              <button onClick={(e) => { e.stopPropagation(); router.push(`/bid/project/${p.id}?tab=evaluate`); }} className="neu-btn-xs is-info">进入评标</button>
                            )}
                            {p.stage === 'ARCHIVED' && (
                              <button onClick={(e) => { e.stopPropagation(); router.push(`/bid/project/${p.id}?tab=open`); }} className="neu-btn-xs">查看归档</button>
                            )}

                            <button
                              onClick={(e) => { e.stopPropagation(); toggleActionMenu(p.id); }}
                              className="neu-btn-xs"
                              title="更多操作"
                            >
                              更多
                              <ChevronDown size={11} strokeWidth={2} className={`transition-transform ${actionExpandedIds.has(p.id) ? 'rotate-180' : ''}`} />
                            </button>

                            <button
                              onClick={(e) => { e.stopPropagation(); setEditProject(p); }}
                              className="neu-btn-xs"
                              title="编辑"
                            >
                              <Pencil size={12} strokeWidth={1.7} />
                            </button>

                            <button
                              onClick={(e) => { e.stopPropagation(); toggleWorkspace(p.id); }}
                              className="neu-btn-xs"
                              title="检查工作区"
                            >
                              {expandedIds.has(p.id) ? <ChevronDown size={11} strokeWidth={2} /> : <ChevronRight size={11} strokeWidth={2} />}
                              检查
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* 快捷操作横向展开 */}
                      {actionExpandedIds.has(p.id) && (() => {
                        const items = buildMenuItems(p);
                        if (items.length === 0) return null;
                        return (
                          <tr key={`${p.id}-actions`} className="bid-expand-row">
                            <td colSpan={8} className="!px-5 !py-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="mr-1 select-none text-[10px] font-bold text-[var(--muted-foreground)]">快捷操作</span>
                                {items.map(item => {
                                  const Icon = item.icon;
                                  const tone = item.tone ?? 'default';
                                  const variant = tone === 'danger' ? 'is-danger' : tone === 'highlight' ? 'is-warning' : '';
                                  return (
                                    <button
                                      key={item.key}
                                      disabled={item.disabled}
                                      title={item.disabled ? item.disabledReason : undefined}
                                      onClick={(e) => { e.stopPropagation(); if (!item.disabled) item.onClick(); }}
                                      className={`neu-btn-xs ${variant}`}
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

                      {/* 工作区检查展开 */}
                      {expandedIds.has(p.id) && (() => {
                        const wd = workspaceMap.get(p.id);
                        const isLoaded = !!wd;
                        return (
                          <tr key={`${p.id}-ws`} className="bid-expand-row">
                            <td colSpan={8} className="!px-5 !py-4">
                              {!isLoaded ? (
                                <div className="flex items-center gap-2 py-2">
                                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
                                  <span className="text-xs text-[var(--muted-foreground)]">加载工作区数据…</span>
                                </div>
                              ) : (
                                <div className="space-y-4">
                                  <div className="flex items-center gap-6">
                                    <div className="max-w-xs flex-1">
                                      <div className="mb-1.5 flex items-center justify-between">
                                        <span className="text-xs font-bold text-[var(--foreground)]">供应商提交进度</span>
                                        <span className="font-mono text-[10px] text-[var(--muted-foreground)]">
                                          {wd?.stats?.submitted ?? 0} / {wd?.stats?.supplierTotal ?? 0}
                                        </span>
                                      </div>
                                      <div className="bid-bar w-full">
                                        <i style={{
                                          width: `${(wd?.stats?.supplierTotal ?? 0) > 0 ? ((wd?.stats?.submitted ?? 0) / wd.stats.supplierTotal) * 100 : 0}%`,
                                          '--bar': barColor(wd?.stats?.submitted ?? 0, wd?.stats?.supplierTotal ?? 0),
                                        } as React.CSSProperties} />
                                      </div>
                                    </div>
                                    <div>
                                      <span className="mr-3 text-xs font-bold text-[var(--foreground)]">专家签到</span>
                                      <span className="font-mono text-xs font-semibold text-[var(--accent-strong)]">
                                        {wd?.stats?.expertSignedIn ?? 0}
                                      </span>
                                      <span className="text-xs text-[var(--muted-foreground)]"> / {wd?.stats?.expertCount ?? 0} 已签到</span>
                                      <span className="ml-3 text-xs text-[var(--muted-foreground)]">
                                        回避：{wd?.experts?.filter((e: any) => e.avoidanceConfirmed).length ?? 0}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="wb-section-rule" />
                                  <div className="flex items-center gap-2">
                                    {(() => {
                                      const sub = wd?.stats?.submitted ?? 0;
                                      const sTot = wd?.stats?.supplierTotal ?? 0;
                                      const sig = wd?.stats?.expertSignedIn ?? 0;
                                      const eTot = wd?.stats?.expertCount ?? 0;
                                      const allSub = sub === sTot && sTot > 0;
                                      const allSig = sig === eTot && eTot > 0;
                                      if (allSub && allSig) {
                                        return <><span className="h-2 w-2 rounded-full bg-[var(--success)]" /><span className="text-xs font-bold text-[var(--success)]">就绪 — 所有供应商已提交，所有专家已签到</span></>;
                                      }
                                      if (allSub || allSig || sub > 0 || sig > 0) {
                                        return <><span className="h-2 w-2 rounded-full bg-[var(--warning)]" /><span className="text-xs font-bold text-[var(--warning)]">部分就绪 — 仍有环节未完成</span></>;
                                      }
                                      return <><span className="h-2 w-2 rounded-full bg-[var(--danger)]" /><span className="text-xs font-bold text-[var(--danger)]">未就绪 — 等待供应商提交和专家签到</span></>;
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
          <div className="neu-table-card-footer">
            <Pagination page={projectsPage} totalPages={Math.ceil(filtered.length / PAGE_SIZE)}
              totalItems={filtered.length} pageSize={PAGE_SIZE} onPage={setProjectsPage} />
          </div>
        )}
      </div>

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
