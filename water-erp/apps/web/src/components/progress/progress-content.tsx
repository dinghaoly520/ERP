"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  Building2,
  CheckCircle2,
  Clock3,
  Filter,
  FolderKanban,
  Gavel,
  LayoutGrid,
  Lightbulb,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  User,
  X,
} from "lucide-react";
import Link from "next/link";
import { type AuthRole } from "@/lib/api/auth";
import {
  fetchProgressStats,
  fetchProgressAiInsights,
  type ProgressAiInsight,
  type ProgressAiInsights,
  type ProgressStats,
  type ProjectProgress,
} from "@/lib/api/progress";
import {
  PROJECT_WORKFLOW_STAGES_ALL,
  type ProjectWorkflowStageKey,
  getStagesForMethod,
  type ProcurementMethod,
} from "@/lib/types/project-management";

const easeOutQuint: [number, number, number, number] = [0.22, 1, 0.36, 1];
const PAGE_SIZE = 20;

type RiskLevel = "normal" | "warning" | "danger";

type DerivedProject = ProjectProgress & {
  daysSinceUpdate: number;
  completedStages: number;
  totalStages: number;
  progressPercent: number;
  currentStageMeta: StageMeta;
  riskLevel: RiskLevel;
  needsAttention: boolean;
  isHighBudget: boolean;
  isEarlyStage: boolean;
  attentionLabel: string;
  projectStages: { key: string; label: string }[];
};

type StageMeta = {
  label: string;
  color: string;
  softColor: string;
};

// ─── Stage colors in oklch() ────────────────────────────────────────────
const STAGE_META: Record<ProjectWorkflowStageKey, StageMeta> = {
  PROCUREMENT_DEMAND:  { label: "采购需求", color: "var(--stage-demand)",     softColor: "var(--stage-demand-soft)" },
  INITIATION:          { label: "采购立项", color: "var(--stage-initiation)",  softColor: "var(--stage-initiation-soft)" },
  TENDER_DOCUMENT:     { label: "采购文件", color: "var(--stage-tender)",      softColor: "var(--stage-tender-soft)" },
  PUBLIC_ANNOUNCEMENT: { label: "采购公示", color: "var(--stage-announce)",    softColor: "var(--stage-announce-soft)" },
  EXPERT_SELECTION:    { label: "专家抽取", color: "var(--stage-expert)",      softColor: "var(--stage-expert-soft)" },
  BID_EVALUATION:      { label: "评标过程", color: "var(--stage-evaluation)",  softColor: "var(--stage-evaluation-soft)" },
  AWARD_DECISION:      { label: "定标",     color: "var(--stage-award)",       softColor: "var(--stage-award-soft)" },
  CONTRACT:            { label: "合同",     color: "var(--stage-contract)",    softColor: "var(--stage-contract-soft)" },
};

const DEFAULT_STAGE_META: StageMeta = {
  label: "未设置阶段",
  color: "var(--stage-default)",
  softColor: "var(--stage-default-soft)",
};

function getStageMeta(stageKey?: string | null): StageMeta {
  if (!stageKey) return DEFAULT_STAGE_META;
  return STAGE_META[stageKey as ProjectWorkflowStageKey] ?? { ...DEFAULT_STAGE_META, label: stageKey };
}

// ─── KPI Card (matches dashboard KpiCard pattern) ─────────────────────────
function KpiCard({ label, value, sub, signal, index, reducedMotion }: {
  label: string; value: ReactNode; sub?: string;
  signal?: "success" | "warning" | "danger";
  index: number; reducedMotion: boolean;
}) {
  const { initial, animate, transition } = fadeIn(index, reducedMotion, 0.05);
  const sc = signal === "success" ? "bg-[var(--success)]" : signal === "warning" ? "bg-[var(--warning)]" : "bg-[var(--danger)]";
  const st = signal === "success" ? "text-[var(--success)]" : signal === "warning" ? "text-[var(--warning)]" : "text-[var(--danger)]";
  const sl = signal === "success" ? "达标" : signal === "warning" ? "关注" : "告警";
  return (
    <motion.div {...{ initial, animate, transition }}>
      <div className="kpi-card flex h-full flex-col gap-1.5 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">{label}</span>
          {signal && (
            <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold bg-[color-mix(in_oklch,var(--muted-foreground)_8%,transparent)] ${st}`}>
              <span className={`h-1 w-1 rounded-full shrink-0 ${sc}`} />{sl}
            </span>
          )}
        </div>

        <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{value}</span>
        <span className="text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">{sub || " "}</span>
      </div>
    </motion.div>
  );
}

function fadeIn(index: number, reducedMotion: boolean, baseDelay = 0.04) {
  if (reducedMotion) return { initial: { opacity: 1, y: 0 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0 } };
  return {
    initial: { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, delay: index * baseDelay, ease: easeOutQuint },
  };
}

function formatWan(value: number) { return `${(value / 10000).toFixed(1)} 万`; }
function formatPercent(value: number) { return `${Math.round(value)}%`; }
function getDaysSince(dateString: string) {
  const date = new Date(dateString);
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}
function getRiskLevel(daysSinceUpdate: number): RiskLevel {
  if (daysSinceUpdate > 14) return "danger";
  if (daysSinceUpdate > 7) return "warning";
  return "normal";
}

// ═══════════════════════════════════════════════════════════════════════════
// PieChart (SVG donut)
// ═══════════════════════════════════════════════════════════════════════════

const PIE_PALETTE = [
  "var(--accent)",
  "var(--success)",
  "var(--gold)",
  "var(--accent-strong)",
  "var(--danger)",
  "var(--muted-foreground)",
  "color-mix(in oklch, var(--success) 60%, var(--accent) 40%)",
  "color-mix(in oklch, var(--accent) 50%, var(--danger) 50%)",
];

function PieChart({ items }: { items: Array<{ name: string; count: number }> }) {
  const total = items.reduce((s, i) => s + i.count, 0);
  const size = 80, cx = 40, cy = 40, outerR = 36, innerR = 22;

  if (total === 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <circle cx={cx} cy={cy} r={outerR} fill="none" stroke="oklch(0.9 0.01 258)" strokeWidth={8} />
        <circle cx={cx} cy={cy} r={innerR} fill="none" stroke="oklch(0.95 0.005 258)" strokeWidth={6} />
        <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="central" fill="oklch(0.6 0.02 258)" fontSize="9" fontWeight="700">0</text>
      </svg>
    );
  }

  let cumulative = 0;
  const slices = items.slice(0, 6).map((item, idx) => {
    const startAngle = (cumulative / total) * 360;
    cumulative += item.count;
    const endAngle = (cumulative / total) * 360;
    const startRad = ((startAngle - 90) * Math.PI) / 180;
    const endRad = ((endAngle - 90) * Math.PI) / 180;
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    const x1o = cx + outerR * Math.cos(startRad), y1o = cy + outerR * Math.sin(startRad);
    const x2o = cx + outerR * Math.cos(endRad), y2o = cy + outerR * Math.sin(endRad);
    const x1i = cx + innerR * Math.cos(endRad), y1i = cy + innerR * Math.sin(endRad);
    const x2i = cx + innerR * Math.cos(startRad), y2i = cy + innerR * Math.sin(startRad);
    const d = `M ${x1o} ${y1o} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2o} ${y2o} L ${x1i} ${y1i} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x2i} ${y2i} Z`;
    const midRad = (((startAngle + endAngle) / 2 - 90) * Math.PI) / 180;
    const labelR = (outerR + innerR) / 2;
    const percent = Math.round((item.count / total) * 100);
    return { d, color: PIE_PALETTE[idx % PIE_PALETTE.length], label: percent >= 12 ? `${percent}%` : "", labelX: cx + labelR * Math.cos(midRad), labelY: cy + labelR * Math.sin(midRad), item };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      {slices.map((s, i) => (
        <g key={i}>
          <path d={s.d} fill={s.color} stroke="white" strokeWidth="1.5" />
          {s.label && <text x={s.labelX} y={s.labelY} textAnchor="middle" dominantBaseline="central" fill="white" fontSize="8" fontWeight="600">{s.label}</text>}
        </g>
      ))}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fill="var(--foreground)" fontSize="13" fontWeight="700">{total}</text>
    </svg>
  );
}

function PieChartBlock({ icon, label, items, accent }: { icon: ReactNode; label: string; items: Array<{ name: string; count: number }>; accent: string }) {
  const topItems = items.slice(0, 6);
  return (
    <div className="rounded-[10px] border border-[oklch(1_0_0_/_0.5)] bg-[oklch(1_0_0_/_0.3)] p-2.5">
      <div className="flex items-center gap-1.5">
        <div className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px]" style={{ backgroundColor: `color-mix(in oklch, ${accent} 8%, transparent)`, color: accent } as React.CSSProperties}>
          {icon}
        </div>
        <span className="text-xs font-semibold text-[color:var(--foreground)]">{label}</span>
        <span className="ml-auto text-xs text-[color:var(--muted-foreground)]">共{items.length}项</span>
      </div>
      <div className="mt-2 flex items-start gap-3">
        <PieChart items={topItems} />
        <div className="mt-0.5 min-w-0 flex-1 space-y-[3px]">
          {topItems.map((item, idx) => (
            <div key={item.name} className="flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: PIE_PALETTE[idx % PIE_PALETTE.length] }} />
              <span className="min-w-0 flex-1 truncate text-xs text-[color:var(--foreground)]" title={item.name}>{item.name}</span>
              <span className="shrink-0 text-xs font-medium text-[color:var(--muted-foreground)]">{item.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ProjectCard — neu-card (cgzxui glass + dual shadow + hover lift)
// ═══════════════════════════════════════════════════════════════════════════

function ProjectCard({ project, index, reducedMotion }: { project: DerivedProject; index: number; reducedMotion: boolean }) {
  const { initial, animate, transition } = fadeIn(index, reducedMotion, 0.03);
  const stageMap = new Map(project.stages.map((s) => [s.stageKey, s]));

  const riskColor = project.riskLevel === "danger"
    ? "var(--danger)"
    : project.riskLevel === "warning"
      ? "var(--warning)"
      : "var(--success)";

  return (
    <motion.div {...{ initial, animate, transition }}>
      <Link href={`/projects?id=${project.id}`} className="neu-card group block px-3.5 py-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="text-[14px] font-semibold tracking-[-0.03em] text-[color:var(--foreground)] transition-colors duration-200 group-hover:text-[var(--accent)]">
                {project.title}
              </h3>
              <span
                className="meta-tag"
                style={{ borderColor: project.currentStageMeta.color, backgroundColor: project.currentStageMeta.softColor, color: project.currentStageMeta.color } as React.CSSProperties}
              >
                当前阶段 · {project.currentStageMeta.label}
              </span>
              <span
                className="meta-tag"
                style={{ borderColor: riskColor, backgroundColor: `color-mix(in oklch, ${riskColor} 10%, transparent)`, color: riskColor } as React.CSSProperties}
              >
                {project.attentionLabel}
              </span>
            </div>
            {/* Metadata */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
              <span style={{ color: "var(--accent)" }}>所属项目：{project.projectName}</span>
              <span style={{ color: "var(--success)" }}>申请人：{project.createdBy?.displayName || project.requesterName || "未登记"}</span>
              <span style={{ color: "var(--gold)" }}>归属部门：{project.requesterDepartment || "未设置"}</span>
              <span style={{ color: "var(--accent-strong)" }}>采购方式：{project.procurementMethod || "未设置"}</span>
              <span className="font-medium" style={{ color: "var(--muted-foreground)" }}>项目预算：{formatWan(project.budgetAmount)}</span>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="flex items-center justify-end gap-1 text-xs text-[color:var(--muted-foreground)]">
              <Clock3 size={12} />
              <span>{project.daysSinceUpdate === 0 ? "今日更新" : `${project.daysSinceUpdate} 天未更新`}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-end gap-1 text-xs font-medium text-[var(--accent)]">
              <span>查看详情</span>
              <ArrowUpRight size={13} />
            </div>
          </div>
        </div>

        {/* Stage timeline */}
        <div className="mt-3 -mx-1 overflow-x-auto px-1 pb-0.5">
          <div className="flex w-full">
            {project.projectStages.map((stage, stageIdx) => {
              const ss = stageMap.get(stage.key);
              const sm = getStageMeta(stage.key);
              const isDone = ss?.status === "COMPLETED";
              const isCur = project.currentStage === stage.key;
              const isLast = stageIdx === project.projectStages.length - 1;
              const state = isDone ? "completed" : isCur ? "current" : "pending";
              const conn = isDone ? "done" : isCur ? "active" : "idle";

              return (
                <div key={stage.key} className="flex flex-1 min-w-0">
                  <div className={`stage-pill stage-pill--${state} relative`}>
                    {isCur && (
                      <div className="stage-pill__indicator">
                        <div className="stage-pill__indicator-bar" />
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      {isDone ? (
                        <CheckCircle2 size={11} />
                      ) : (
                        <div
                          className="h-[6px] w-[6px] rounded-full"
                          style={{
                            backgroundColor: isCur ? "var(--accent)" : "transparent",
                            border: isCur ? "none" : "1.5px solid color-mix(in oklch, var(--muted-foreground) 40%, transparent)",
                          }}
                        />
                      )}
                      <span className="truncate">{sm.label}</span>
                    </div>
                  </div>
                  {!isLast && (
                    <div className="stage-connector">
                      <div className={`stage-connector__line stage-connector__line--${conn}`} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 flex items-center justify-between px-1">
            <span className="text-xs text-[color:var(--muted-foreground)]">
              已推进 {project.completedStages}/{project.totalStages} 阶段
            </span>
            <span className="text-xs font-semibold" style={{ color: project.currentStageMeta.color }}>
              {formatPercent(project.progressPercent)}
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// AI Insight card — flat row, no neumorphism on text-level elements
// ═══════════════════════════════════════════════════════════════════════════

const INSIGHT_ICONS: Record<string, typeof Lightbulb> = {
  risk: ShieldAlert, bottleneck: BarChart3, budget: TrendingUp, completion: CheckCircle2, rhythm: Clock3,
};
const INSIGHT_COLORS: Record<string, string> = {
  risk: "oklch(0.67 0.14 32)", bottleneck: "oklch(0.78 0.12 84)", budget: "oklch(0.61 0.13 272)", completion: "oklch(0.68 0.11 162)", rhythm: "oklch(0.64 0.14 262)",
};

function AiInsightCard({ insight, onFilter, reducedMotion }: { insight: ProgressAiInsight; onFilter: () => void; reducedMotion: boolean }) {
  const { initial, animate, transition } = fadeIn(0, reducedMotion, 0.02);
  const typeColor = INSIGHT_COLORS[insight.type] ?? INSIGHT_COLORS.rhythm;
  const IconComponent = INSIGHT_ICONS[insight.type] ?? INSIGHT_ICONS.rhythm;
  const urgencyColor = insight.urgency === "high"
    ? "oklch(0.67 0.14 32)"
    : insight.urgency === "medium"
      ? "oklch(0.78 0.12 84)"
      : "oklch(0.68 0.11 162)";

  return (
    <motion.div {...{ initial, animate, transition }} className="insight-row">
      <div className="insight-row__icon" style={{ backgroundColor: `color-mix(in oklch, ${typeColor} 8%, transparent)`, color: typeColor } as React.CSSProperties}>
        <IconComponent size={11} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-[1.55] text-[color:var(--foreground)]">{insight.message}</p>
        <div className="mt-1 flex items-center gap-2">
          <span className="insight-row__dot" style={{ backgroundColor: urgencyColor }} />
          {insight.actionLabel && (
            <button onClick={onFilter} className="text-xs font-medium transition-opacity hover:opacity-80" style={{ color: typeColor }}>
              {insight.actionLabel}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ProgressContent — main page
// Layout: KPI hero → (execution + insights) 2-col → project list full-width
// All containers use .wb-panel (cgzxui workbench panel)
// ═══════════════════════════════════════════════════════════════════════════

export function ProgressContent({ currentUserRole }: { currentUserRole?: AuthRole }) {
  const reducedMotion = useReducedMotion() ?? false;
  const [stats, setStats] = useState<ProgressStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [selectedRequester, setSelectedRequester] = useState<string>("");
  const [sortBy, setSortBy] = useState<string>("updatedAt");
  const [currentPage, setCurrentPage] = useState(1);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [aiInsights, setAiInsights] = useState<ProgressAiInsights | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const applyInsightFilter = (insight: ProgressAiInsight) => {
    setKeyword(""); setSelectedProject(""); setSelectedRequester("");
    setSelectedStage(insight.relatedStageKey ?? null);
    setSelectedProjectIds(insight.relatedProjectIds.length > 0 ? new Set(insight.relatedProjectIds) : new Set());
    const el = document.getElementById("project-list"); if (el) window.scrollTo({ top: el.offsetTop - 20, behavior: "smooth" });
  };

  const loadData = async () => {
    setLoading(true); setError(null);
    try {
      const data = await fetchProgressStats(); setStats(data);
      setLastRefreshedAt(new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()));
    } catch (err) { setError(err instanceof Error ? err.message : "项目进度汇总加载失败"); }
    finally { setLoading(false); }
  };

  const AI_CACHE_KEY = "progress-ai-insights-cache-v2";
  const buildFp = (s: ProgressStats) => `${s.totalActive}:${s.monthlyAdded}:${s.monthlyCompleted}:${s.projects.map((p) => `${p.id}:${p.currentStage}:${p.updatedAt}`).join("|")}`;

  const loadAiInsights = useCallback(async (forceRefresh = false) => {
    if (!stats) return;
    const fp = buildFp(stats);
    if (!forceRefresh) {
      try {
        const c = localStorage.getItem(AI_CACHE_KEY);
        if (c) { const p = JSON.parse(c) as { fingerprint: string; data: ProgressAiInsights }; if (p.fingerprint === fp && p.data) { setAiInsights(p.data); return; } }
      } catch { /* ignore */ }
    }
    setAiLoading(true);
    try {
      const data = await fetchProgressAiInsights(); setAiInsights(data);
      try { localStorage.setItem(AI_CACHE_KEY, JSON.stringify({ fingerprint: fp, data })); } catch { /* ignore */ }
    } catch { setAiInsights(null); }
    finally { setAiLoading(false); }
  }, [stats]);

  useEffect(() => { void loadData(); }, []);
  useEffect(() => { if (stats) void loadAiInsights(); }, [stats, loadAiInsights]);

  // ─── Derived data ────────────────────────────────────────────────────────
  const derivedProjects = useMemo<DerivedProject[]>(() => {
    if (!stats) return [];
    const budgets = stats.projects.map((p) => p.budgetAmount || 0).sort((a, b) => a - b);
    const threshold = budgets[Math.max(0, Math.floor(budgets.length * 0.7) - 1)] ?? 0;
    return stats.projects.map((project) => {
      const days = getDaysSince(project.updatedAt);
      const done = project.stages.filter((s) => s.status === "COMPLETED").length;
      const total = project.stages.length;
      const meta = getStageMeta(project.currentStage);
      const isHigh = (project.budgetAmount || 0) >= threshold && threshold > 0;
      const isEarly = ["PROCUREMENT_DEMAND", "INITIATION", "TENDER_DOCUMENT"].includes(project.currentStage);
      const needsAttn = days > 7 || (isHigh && isEarly);
      return {
        ...project,
        daysSinceUpdate: days,
        completedStages: done,
        totalStages: total,
        progressPercent: total > 0 ? Math.round((done / total) * 100) : 0,
        currentStageMeta: meta,
        riskLevel: getRiskLevel(days),
        needsAttention: needsAttn,
        isHighBudget: isHigh,
        isEarlyStage: isEarly,
        attentionLabel: days > 14 ? "停滞超 14 天" : days > 7 ? "停滞超 7 天" : isHigh && isEarly ? "高预算待推进" : "正常推进",
        projectStages: getStagesForMethod(project.procurementMethod as ProcurementMethod),
      };
    });
  }, [stats]);

  const totalBudget = useMemo(() => derivedProjects.reduce((s, p) => s + (p.budgetAmount || 0), 0), [derivedProjects]);
  const attnCount = useMemo(() => derivedProjects.filter((p) => p.needsAttention).length, [derivedProjects]);
  const dangerCount = useMemo(() => derivedProjects.filter((p) => p.daysSinceUpdate > 14).length, [derivedProjects]);
  const avgStalled = useMemo(() => derivedProjects.length === 0 ? 0 : Math.round(derivedProjects.reduce((s, p) => s + p.daysSinceUpdate, 0) / derivedProjects.length), [derivedProjects]);
  const avgCompletion = useMemo(() => derivedProjects.length === 0 ? 0 : Math.round(derivedProjects.reduce((s, p) => s + p.progressPercent, 0) / derivedProjects.length), [derivedProjects]);

  const orderedStages = useMemo(() => {
    const m = new Map<string, number>(); for (const p of derivedProjects) m.set(p.currentStage, (m.get(p.currentStage) ?? 0) + 1);
    return PROJECT_WORKFLOW_STAGES_ALL.map((s) => ({ key: s.key, count: m.get(s.key) ?? 0, ...getStageMeta(s.key) }));
  }, [derivedProjects]);
  const dominantStage = useMemo(() => orderedStages.reduce<typeof orderedStages[number] | null>((c, i) => (!c || i.count > c.count ? i : c), null), [orderedStages]);

  const projectNames = useMemo(() => [...new Set(derivedProjects.map((p) => p.projectName))].sort(), [derivedProjects]);
  const requesterNames = useMemo(() => [...new Set(derivedProjects.map((p) => p.createdBy?.displayName || p.requesterName).filter(Boolean))].sort() as string[], [derivedProjects]);

  const methodDist = useMemo(() => { const m = new Map<string, number>(); for (const p of derivedProjects) m.set(p.procurementMethod || "未设置", (m.get(p.procurementMethod || "未设置") ?? 0) + 1); return [...m].map(([n, c]) => ({ name: n, count: c })).sort((a, b) => b.count - a.count); }, [derivedProjects]);
  const deptDist = useMemo(() => { const m = new Map<string, number>(); for (const p of derivedProjects) m.set(p.requesterDepartment || "未设置", (m.get(p.requesterDepartment || "未设置") ?? 0) + 1); return [...m].map(([n, c]) => ({ name: n, count: c })).sort((a, b) => b.count - a.count); }, [derivedProjects]);
  const requesterDist = useMemo(() => { const m = new Map<string, number>(); for (const p of derivedProjects) m.set(p.createdBy?.displayName || p.requesterName || "未设置", (m.get(p.createdBy?.displayName || p.requesterName || "未设置") ?? 0) + 1); return [...m].map(([n, c]) => ({ name: n, count: c })).sort((a, b) => b.count - a.count); }, [derivedProjects]);
  const projectDist = useMemo(() => { const m = new Map<string, number>(); for (const p of derivedProjects) m.set(p.projectName || "未设置", (m.get(p.projectName || "未设置") ?? 0) + 1); return [...m].map(([n, c]) => ({ name: n, count: c })).sort((a, b) => b.count - a.count); }, [derivedProjects]);
  const scaleDist = useMemo(() => { let s = 0, m = 0, l = 0, x = 0; for (const p of derivedProjects) { const b = p.budgetAmount || 0; if (b < 100000) s++; else if (b < 500000) m++; else if (b < 1000000) l++; else x++; } return [{ name: "小额（<10万）", count: s }, { name: "中额（10-50万）", count: m }, { name: "大额（50-100万）", count: l }, { name: "特大（>100万）", count: x }].filter((d) => d.count > 0); }, [derivedProjects]);
  const activeStages = useMemo(() => orderedStages.filter((s) => s.count > 0).sort((a, b) => b.count - a.count), [orderedStages]);
  const stageChartData = useMemo(() => activeStages.map((s) => ({ name: s.label, count: s.count })), [activeStages]);

  const activeFilterCount = [selectedStage, selectedProject, selectedRequester, keyword.trim(), selectedProjectIds.size > 0].filter(Boolean).length;
  const clearAll = () => { setKeyword(""); setSelectedStage(null); setSelectedProject(""); setSelectedRequester(""); setSelectedProjectIds(new Set()); };
  useEffect(() => { setCurrentPage(1); }, [keyword, selectedStage, selectedProject, selectedRequester, sortBy, selectedProjectIds]);

  const filteredProjects = useMemo(() => {
    let list = derivedProjects.filter((p) => {
      if (selectedProjectIds.size > 0 && !selectedProjectIds.has(p.id)) return false;
      if (selectedStage && p.currentStage !== selectedStage) return false;
      if (selectedProject && p.projectName !== selectedProject) return false;
      if (selectedRequester && (p.createdBy?.displayName || p.requesterName) !== selectedRequester) return false;
      if (!keyword.trim()) return true;
      return [p.title, p.requesterName, p.requesterDepartment, p.createdBy?.displayName].join(" ").toLowerCase().includes(keyword.trim().toLowerCase());
    });
    const sorters: Record<string, (a: DerivedProject, b: DerivedProject) => number> = {
      updatedAt: () => 0, budgetDesc: (a, b) => (b.budgetAmount || 0) - (a.budgetAmount || 0),
      progressAsc: (a, b) => a.progressPercent - b.progressPercent, stalledDesc: (a, b) => b.daysSinceUpdate - a.daysSinceUpdate,
    };
    return sorters[sortBy] ? list.sort(sorters[sortBy]) : list;
  }, [derivedProjects, keyword, selectedProject, selectedRequester, selectedStage, selectedProjectIds, sortBy]);

  // ════════════════════════════════════════════════════════════
  // Loading / Error
  // ════════════════════════════════════════════════════════════
  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[oklch(0.5_0.16_258_/_0.25)] border-t-[oklch(0.5_0.16_258)]" />
          <span className="text-sm text-[color:var(--muted-foreground)]">正在汇总项目进展...</span>
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertCircle size={32} className="text-[var(--danger)]" />
          <span className="text-sm text-[color:var(--muted-foreground)]">{error || "项目进度汇总加载失败"}</span>
          <button onClick={() => void loadData()} className="neu-btn-soft">重新加载</button>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // Main content
  // ════════════════════════════════════════════════════════════
  return (
    <div className="space-y-4 pb-4">
      {/* ── 标题栏 + KPI — page-hero neumorphic 玻璃卡片 ── */}
      <motion.div {...fadeIn(0, reducedMotion, 0.04)} className="page-hero">
        {/* 标题行 */}
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon">
              <BarChart3 size={20} strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <div className="page-hero__title">采购进度总览</div>
              <div className="page-hero__sub">项目阶段推进与健康监测</div>
            </div>
          </div>

          <div className="page-hero__right">
            <span className="page-hero__stat page-hero__stat--info">
              共 {stats.totalActive} 项
            </span>
            {attnCount > 0 && (
              <span className="page-hero__stat page-hero__stat--warn">
                <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-[var(--danger)]" />
                待推进 {attnCount}
              </span>
            )}
            <button onClick={() => void loadData()} className="neu-btn-xs">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {/* KPI 行 — 分割线 + 内容合并在同一容器，间距与项目管理统一 */}
        <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7">
          <KpiCard label="进行中项目" value={stats.totalActive} signal="success" index={1} reducedMotion={reducedMotion} />
          <KpiCard label="平均完成度" value={formatPercent(avgCompletion)} signal={avgCompletion >= 60 ? "success" : avgCompletion >= 40 ? "warning" : "danger"} sub="整体平均推进率" index={2} reducedMotion={reducedMotion} />
          <KpiCard label="预算总额" value={formatWan(totalBudget)} sub={`${derivedProjects.length}个项目预算合计`} index={3} reducedMotion={reducedMotion} />
          <KpiCard label="待推进" value={attnCount} signal={attnCount > 0 ? "warning" : "success"} sub="待跟进推进" index={4} reducedMotion={reducedMotion} />
          <KpiCard label="高风险项目" value={dangerCount} signal={dangerCount > 0 ? "danger" : "success"} sub="停滞超14天" index={5} reducedMotion={reducedMotion} />
          <KpiCard label="平均停滞" value={avgStalled} sub="天未更新" signal={avgStalled > 7 ? "danger" : avgStalled > 3 ? "warning" : undefined} index={6} reducedMotion={reducedMotion} />
          <KpiCard label="集中阶段" value={dominantStage?.label ?? "暂无"} sub="项目最密集阶段" index={7} reducedMotion={reducedMotion} />
        </div>
        </div>

        {/* 搜索 + 排序/筛选行 */}
        <div className="flex flex-wrap items-center gap-3" style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "0.8rem" }}>
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--muted-foreground)] z-10" />
            <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索项目、申请人、部门..." className="neu-input !pl-9" />
            {keyword && (
              <button onClick={() => setKeyword('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-[rgba(96,139,239,0.1)] text-[color:var(--muted-foreground)] z-10">
                <X size={14} />
              </button>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">排序</span>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="workbench-input !w-auto min-w-[110px]">
              <option value="updatedAt">按更新时间</option>
              <option value="budgetDesc">预算 高→低</option>
              <option value="progressAsc">完成度 低→高</option>
              <option value="stalledDesc">停滞天数 高→低</option>
            </select>
            <span className="ml-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">筛选</span>
            <select value={selectedStage ?? ""} onChange={(e) => setSelectedStage(e.target.value || null)} className="workbench-input !w-auto min-w-[110px]">
              <option value="">全部阶段</option>
              {PROJECT_WORKFLOW_STAGES_ALL.map((s) => (<option key={s.key} value={s.key}>{s.label}</option>))}
            </select>
            <select value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)} className="workbench-input !w-auto min-w-[110px]">
              <option value="">全部项目</option>
              {projectNames.map((n, i) => (<option key={`${n}-${i}`} value={n}>{n}</option>))}
            </select>
          </div>
          {activeFilterCount > 0 && (
            <button onClick={clearAll} className="neu-btn-soft is-danger"><Filter size={11} /> 清除</button>
          )}
        </div>
      </motion.div>

      {/* ── Two-column: execution + insights ── */}
      <div className="grid gap-4 xl:grid-cols-2">
        <motion.div {...fadeIn(2, reducedMotion, 0.03)}>
          <section className="wb-panel h-full">
            <div className="wb-panel-header">
              <h2 className="neu-section-heading">执行态势</h2>
            </div>
            <div className="wb-panel-body">
              <div className="grid grid-cols-2 gap-2">
                <PieChartBlock icon={<User size={12} />} label="申请人" items={requesterDist} accent="oklch(0.64 0.14 262)" />
                <PieChartBlock icon={<Gavel size={12} />} label="采购方式" items={methodDist} accent="oklch(0.68 0.11 162)" />
                <PieChartBlock icon={<Building2 size={12} />} label="归属部门" items={deptDist} accent="oklch(0.78 0.12 84)" />
                <PieChartBlock icon={<LayoutGrid size={12} />} label="归属项目" items={projectDist} accent="oklch(0.61 0.13 272)" />
                <PieChartBlock icon={<BarChart3 size={12} />} label="阶段分布" items={stageChartData} accent="oklch(0.71 0.10 166)" />
                <PieChartBlock icon={<TrendingUp size={12} />} label="项目规模" items={scaleDist} accent="oklch(0.67 0.14 32)" />
              </div>
            </div>
          </section>
        </motion.div>

        <motion.div {...fadeIn(3, reducedMotion, 0.03)}>
          <section className="wb-panel h-full">
            <div className="wb-panel-header">
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="text-[oklch(0.5_0.16_258)]" />
                <h2 className="neu-section-heading">进度洞察</h2>
              </div>
              <button onClick={() => void loadAiInsights(true)} disabled={aiLoading} className="neu-btn-xs">
                <RefreshCw size={12} className={aiLoading ? "animate-spin" : ""} />
              </button>
            </div>
            <div className="wb-panel-body">
              {aiLoading && !aiInsights ? (
                <div className="flex flex-col items-center gap-2 py-8 text-xs text-[color:var(--muted-foreground)]">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-[oklch(0.5_0.16_258_/_0.25)] border-t-[oklch(0.5_0.16_258)]" />
                  正在分析项目数据...
                </div>
              ) : aiInsights ? (
                <>
                  {aiInsights.overview && (
                    <div className="neu-card-static mb-3 !rounded-[12px] px-3 py-2.5">
                      <p className="text-xs leading-[1.65] text-[color:var(--foreground)]">{aiInsights.overview}</p>
                    </div>
                  )}
                  <div className="space-y-0.5">
                    {aiInsights.insights.map((insight) => (
                      <AiInsightCard key={insight.id} insight={insight} onFilter={() => applyInsightFilter(insight)} reducedMotion={reducedMotion} />
                    ))}
                  </div>
                  {aiInsights.insights.length === 0 && !aiInsights.overview && (
                    <div className="py-6 text-center text-xs text-[color:var(--muted-foreground)]">暂无分析结果</div>
                  )}
                </>
              ) : (
                <div className="py-6 text-center text-xs text-[color:var(--muted-foreground)]">分析暂不可用</div>
              )}
            </div>
          </section>
        </motion.div>
      </div>

      {/* ── Project List ── */}
      <motion.div {...fadeIn(4, reducedMotion, 0.03)} id="project-list">
        <section className="wb-panel">
          <div className="wb-panel-header">
            <div className="flex items-center gap-3">
              <h2 className="neu-section-heading">项目清单</h2>
              <span className="text-xs text-[color:var(--muted-foreground)]">共 {derivedProjects.length} 个项目</span>
            </div>
            <div className="flex items-center gap-2">
              {lastRefreshedAt && <span className="text-xs text-[color:var(--muted-foreground)]">{lastRefreshedAt}</span>}
              <button onClick={() => void loadData()} className="neu-btn-xs"><RefreshCw size={13} /></button>
            </div>
          </div>
          <div className="wb-panel-body space-y-3">
            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="search-box">
                <Search size={14} className="search-box__icon" />
                <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索项目、申请人、部门..." className="neu-input" />
              </div>
              <select value={selectedStage ?? ""} onChange={(e) => setSelectedStage(e.target.value || null)} className="workbench-input !h-[44px] !w-auto min-w-[110px]">
                <option value="">全部阶段</option>
                {PROJECT_WORKFLOW_STAGES_ALL.map((s) => (<option key={s.key} value={s.key}>{s.label}</option>))}
              </select>
              <select value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)} className="workbench-input !h-[44px] !w-auto min-w-[110px]">
                <option value="">全部项目</option>
                {projectNames.map((n, i) => (<option key={`${n}-${i}`} value={n}>{n}</option>))}
              </select>
              <select value={selectedRequester} onChange={(e) => setSelectedRequester(e.target.value)} className="workbench-input !h-[44px] !w-auto min-w-[110px]">
                <option value="">全部申请人</option>
                {requesterNames.map((n) => (<option key={n} value={n}>{n}</option>))}
              </select>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="workbench-input !h-[44px] !w-auto min-w-[110px]">
                <option value="updatedAt">按更新时间</option>
                <option value="budgetDesc">预算 高→低</option>
                <option value="progressAsc">完成度 低→高</option>
                <option value="stalledDesc">停滞天数 高→低</option>
              </select>
              <span className="text-xs text-[color:var(--muted-foreground)]">{filteredProjects.length}/{derivedProjects.length}</span>
              {activeFilterCount > 0 && (
                <button onClick={clearAll} className="neu-btn-soft is-danger"><Filter size={11} /> 清除 {activeFilterCount} 项</button>
              )}
            </div>

            {/* List / Empty */}
            {filteredProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <FolderKanban size={32} className="mb-2 text-[oklch(0.5_0.16_258_/_0.35)]" />
                <p className="text-sm font-medium text-[color:var(--foreground)]">{derivedProjects.length === 0 ? "当前暂无进行中的项目" : "暂无匹配项目"}</p>
                {activeFilterCount > 0 && <button onClick={clearAll} className="neu-btn-soft mt-3">清除筛选条件</button>}
              </div>
            ) : (
              <>
                <div className="space-y-2.5">
                  {filteredProjects.slice(0, currentPage * PAGE_SIZE).map((project, idx) => (
                    <ProjectCard key={project.id} project={project} index={idx} reducedMotion={reducedMotion} />
                  ))}
                </div>
                {filteredProjects.length > currentPage * PAGE_SIZE && (
                  <div className="flex items-center justify-between pt-3">
                    <span className="text-xs text-[color:var(--muted-foreground)]">已显示 {Math.min(currentPage * PAGE_SIZE, filteredProjects.length)} / {filteredProjects.length}</span>
                    <button onClick={() => setCurrentPage((p) => p + 1)} className="neu-btn-soft">加载更多</button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </motion.div>
    </div>
  );
}
