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
  accentClass: string;
};

type SectionVariant = "default" | "highlight" | "alert" | "success" | "insight";

const STAGE_META: Record<ProjectWorkflowStageKey, StageMeta> = {
  PROCUREMENT_DEMAND: {
    label: "采购需求",
    color: "rgba(96,139,239,1)",
    softColor: "rgba(96,139,239,0.12)",
    accentClass: "border-[rgba(96,139,239,0.28)] bg-[rgba(96,139,239,0.08)] text-[rgba(96,139,239,1)]",
  },
  INITIATION: {
    label: "采购立项",
    color: "rgba(96,139,239,1)",
    softColor: "rgba(96,139,239,0.12)",
    accentClass: "border-[rgba(96,139,239,0.28)] bg-[rgba(96,139,239,0.08)] text-[rgba(96,139,239,1)]",
  },
  TENDER_DOCUMENT: {
    label: "采购文件",
    color: "rgba(92,181,150,1)",
    softColor: "rgba(92,181,150,0.12)",
    accentClass: "border-[rgba(92,181,150,0.28)] bg-[rgba(92,181,150,0.08)] text-[rgba(92,181,150,1)]",
  },
  PUBLIC_ANNOUNCEMENT: {
    label: "采购公示",
    color: "rgba(92,181,150,1)",
    softColor: "rgba(92,181,150,0.12)",
    accentClass: "border-[rgba(92,181,150,0.28)] bg-[rgba(92,181,150,0.08)] text-[rgba(92,181,150,1)]",
  },
  EXPERT_SELECTION: {
    label: "专家抽取",
    color: "rgba(234,188,110,1)",
    softColor: "rgba(234,188,110,0.14)",
    accentClass: "border-[rgba(234,188,110,0.28)] bg-[rgba(234,188,110,0.10)] text-[rgba(205,155,70,1)]",
  },
  BID_EVALUATION: {
    label: "评标过程",
    color: "rgba(119,129,219,1)",
    softColor: "rgba(119,129,219,0.12)",
    accentClass: "border-[rgba(119,129,219,0.28)] bg-[rgba(119,129,219,0.08)] text-[rgba(119,129,219,1)]",
  },
  AWARD_DECISION: {
    label: "定标",
    color: "rgba(104,193,156,1)",
    softColor: "rgba(104,193,156,0.12)",
    accentClass: "border-[rgba(104,193,156,0.28)] bg-[rgba(104,193,156,0.08)] text-[rgba(76,160,126,1)]",
  },
  CONTRACT: {
    label: "合同",
    color: "rgba(150,165,195,1)",
    softColor: "rgba(150,165,195,0.12)",
    accentClass: "border-[rgba(150,165,195,0.28)] bg-[rgba(150,165,195,0.08)] text-[rgba(111,128,160,1)]",
  },
};

const DEFAULT_STAGE_META: StageMeta = {
  label: "未设置阶段",
  color: "rgba(150,165,195,1)",
  softColor: "rgba(150,165,195,0.12)",
  accentClass: "border-[rgba(150,165,195,0.28)] bg-[rgba(150,165,195,0.08)] text-[rgba(111,128,160,1)]",
};

function getStageMeta(stageKey?: string | null) {
  if (!stageKey) {
    return DEFAULT_STAGE_META;
  }

  return STAGE_META[stageKey as ProjectWorkflowStageKey] ?? {
    ...DEFAULT_STAGE_META,
    label: stageKey,
  };
}

function fadeIn(index: number, reducedMotion: boolean, baseDelay = 0.04) {
  if (reducedMotion) {
    return { initial: { opacity: 1, y: 0 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0 } };
  }

  return {
    initial: { opacity: 0, y: 18, scale: 0.98, filter: "blur(6px)" },
    animate: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" },
    transition: { duration: 0.5, delay: index * baseDelay, ease: easeOutQuint },
  };
}

function formatWan(value: number) {
  return `${(value / 10000).toFixed(1)} 万`;
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function getDaysSince(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function getRiskLevel(daysSinceUpdate: number): RiskLevel {
  if (daysSinceUpdate > 14) {
    return "danger";
  }
  if (daysSinceUpdate > 7) {
    return "warning";
  }
  return "normal";
}

function Panel({
  variant = "default",
  className = "",
  children,
}: {
  variant?: SectionVariant;
  className?: string;
  children: ReactNode;
}) {
  const variantStyles: Record<SectionVariant, string> = {
    default: "border-white/65 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(246,249,253,0.9))]",
    highlight: "border-[rgba(96,139,239,0.35)] bg-[linear-gradient(160deg,rgba(248,251,255,0.97),rgba(242,247,255,0.93))] shadow-[0_12px_28px_rgba(79,108,161,0.10)]",
    alert: "border-[rgba(230,129,102,0.45)] bg-[linear-gradient(160deg,rgba(255,248,246,0.97),rgba(252,246,243,0.93))] shadow-[0_12px_28px_rgba(200,90,70,0.10)]",
    success: "border-[rgba(92,181,150,0.40)] bg-[linear-gradient(160deg,rgba(246,255,250,0.97),rgba(242,251,247,0.93))] shadow-[0_12px_28px_rgba(70,155,120,0.08)]",
    insight: "border-[rgba(234,188,110,0.38)] bg-[linear-gradient(160deg,rgba(255,252,244,0.97),rgba(252,248,240,0.93))] shadow-[0_12px_28px_rgba(200,155,80,0.08)]",
  };

  return (
    <section
      className={[
        "glass-float card-edge-light relative flex flex-col overflow-hidden rounded-[20px] border",
        variantStyles[variant],
        "shadow-[0_10px_24px_rgba(79,108,161,0.07),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 hover:shadow-[0_16px_30px_rgba(79,108,161,0.11)]",
        className,
      ].join(" ")}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.8),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(113,150,232,0.08),transparent_34%)]" />
      <div className="relative flex h-full flex-col p-3.5">{children}</div>
    </section>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-2.5">
      <div>
        {eyebrow ? (
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-[rgba(84,104,139,0.72)]">
            {eyebrow}
          </div>
        ) : null}
        <h2 className="mt-0.5 text-[0.9rem] font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-xs leading-4.5 text-[color:var(--muted-foreground)]">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

const INSIGHT_TYPE_CONFIG: Record<string, { color: string; softBg: string; border: string; icon: typeof Lightbulb }> = {
  risk: {
    color: "rgba(230,129,102,1)",
    softBg: "rgba(230,129,102,0.06)",
    border: "rgba(230,129,102,0.2)",
    icon: ShieldAlert,
  },
  bottleneck: {
    color: "rgba(234,188,110,1)",
    softBg: "rgba(234,188,110,0.06)",
    border: "rgba(234,188,110,0.2)",
    icon: BarChart3,
  },
  budget: {
    color: "rgba(119,129,219,1)",
    softBg: "rgba(119,129,219,0.06)",
    border: "rgba(119,129,219,0.2)",
    icon: TrendingUp,
  },
  completion: {
    color: "rgba(92,181,150,1)",
    softBg: "rgba(92,181,150,0.06)",
    border: "rgba(92,181,150,0.2)",
    icon: CheckCircle2,
  },
  rhythm: {
    color: "rgba(96,139,239,1)",
    softBg: "rgba(96,139,239,0.06)",
    border: "rgba(96,139,239,0.2)",
    icon: Clock3,
  },
};

function AiInsightCard({
  insight,
  onFilter,
  reducedMotion,
}: {
  insight: ProgressAiInsight;
  onFilter: () => void;
  reducedMotion: boolean;
}) {
  const { initial, animate, transition } = fadeIn(0, reducedMotion, 0.02);

  const typeConfig = INSIGHT_TYPE_CONFIG[insight.type] ?? INSIGHT_TYPE_CONFIG.rhythm;
  const IconComponent = typeConfig.icon;

  const urgencyColor =
    insight.urgency === "high"
      ? "rgba(230,129,102,1)"
      : insight.urgency === "medium"
        ? "rgba(234,188,110,1)"
        : "rgba(92,181,150,1)";

  return (
    <motion.div
      {...{ initial, animate, transition }}
      className="flex items-start gap-2 rounded-[10px] p-2 transition-all duration-200 hover:bg-[rgba(255,255,255,0.5)]"
    >
      <div
        className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px]"
        style={{ backgroundColor: `${typeConfig.color}12`, color: typeConfig.color }}
      >
        <IconComponent size={11} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-[1.6] text-[color:var(--foreground)]">{insight.message}</p>
        <div className="mt-1 flex items-center gap-2">
          <span className="h-[5px] w-[5px] rounded-full" style={{ backgroundColor: urgencyColor }} />
          {insight.actionLabel && (
            <button
              onClick={onFilter}
              className="text-xs font-medium transition-opacity duration-200 hover:opacity-80"
              style={{ color: typeConfig.color }}
            >
              {insight.actionLabel}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

const PIE_PALETTE = [
  "rgba(96,139,239,1)",
  "rgba(92,181,150,1)",
  "rgba(234,188,110,1)",
  "rgba(119,129,219,1)",
  "rgba(230,129,102,1)",
  "rgba(150,165,195,1)",
  "rgba(104,193,156,1)",
  "rgba(200,120,180,1)",
];

function PieChart({
  items,
}: {
  items: Array<{ name: string; count: number }>;
}) {
  const total = items.reduce((s, i) => s + i.count, 0);

  const size = 80;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = 36;
  const innerR = 22;

  if (total === 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <circle cx={cx} cy={cy} r={outerR} fill="none" stroke="#e5e7eb" strokeWidth={8} />
        <circle cx={cx} cy={cy} r={innerR} fill="none" stroke="#f3f4f6" strokeWidth={6} />
        <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="central" className="fill-[#9ca3af] text-[9px] font-bold">
          0
        </text>
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

    const x1outer = cx + outerR * Math.cos(startRad);
    const y1outer = cy + outerR * Math.sin(startRad);
    const x2outer = cx + outerR * Math.cos(endRad);
    const y2outer = cy + outerR * Math.sin(endRad);
    const x1inner = cx + innerR * Math.cos(endRad);
    const y1inner = cy + innerR * Math.sin(endRad);
    const x2inner = cx + innerR * Math.cos(startRad);
    const y2inner = cy + innerR * Math.sin(startRad);

    const d = [
      `M ${x1outer} ${y1outer}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2outer} ${y2outer}`,
      `L ${x1inner} ${y1inner}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x2inner} ${y2inner}`,
      "Z",
    ].join(" ");

    const midRad = (((startAngle + endAngle) / 2 - 90) * Math.PI) / 180;
    const labelR = (outerR + innerR) / 2;
    const labelX = cx + labelR * Math.cos(midRad);
    const labelY = cy + labelR * Math.sin(midRad);
    const percent = Math.round((item.count / total) * 100);

    return {
      d,
      color: PIE_PALETTE[idx % PIE_PALETTE.length],
      label: percent >= 12 ? `${percent}%` : "",
      labelX,
      labelY,
      item,
    };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      {slices.map((s, i) => (
        <g key={i}>
          <path d={s.d} fill={s.color} stroke="white" strokeWidth="1.5" />
          {s.label && (
            <text
              x={s.labelX}
              y={s.labelY}
              textAnchor="middle"
              dominantBaseline="central"
              fill="white"
              fontSize="8"
              fontWeight="600"
            >
              {s.label}
            </text>
          )}
        </g>
      ))}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fill="var(--foreground)" fontSize="13" fontWeight="700">
        {total}
      </text>
    </svg>
  );
}

function PieChartBlock({
  icon,
  label,
  items,
  accent,
}: {
  icon: ReactNode;
  label: string;
  items: Array<{ name: string; count: number }>;
  accent: string;
}) {
  const topItems = items.slice(0, 6);

  return (
    <div className="rounded-[12px] border border-white/50 bg-white/35 p-2.5">
      <div className="flex items-center gap-1.5">
        <div
          className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px]"
          style={{ backgroundColor: `${accent}12`, color: accent }}
        >
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
              <span
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: PIE_PALETTE[idx % PIE_PALETTE.length] }}
              />
              <span className="min-w-0 flex-1 truncate text-xs text-[color:var(--foreground)]" title={item.name}>
                {item.name}
              </span>
              <span className="shrink-0 text-xs font-medium text-[color:var(--muted-foreground)]">
                {item.count}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  index,
  reducedMotion,
}: {
  project: DerivedProject;
  index: number;
  reducedMotion: boolean;
}) {
  const { initial, animate, transition } = fadeIn(index, reducedMotion, 0.03);
  const riskTone =
    project.riskLevel === "danger"
      ? {
          border: "border-[rgba(230,129,102,0.25)]",
          badge: "border-[rgba(230,129,102,0.24)] bg-[rgba(230,129,102,0.10)] text-[rgba(210,100,70,1)]",
        }
      : project.riskLevel === "warning"
        ? {
            border: "border-[rgba(234,188,110,0.25)]",
            badge: "border-[rgba(234,188,110,0.24)] bg-[rgba(234,188,110,0.10)] text-[rgba(205,155,70,1)]",
          }
        : {
            border: "border-[rgba(92,181,150,0.22)]",
            badge: "border-[rgba(92,181,150,0.22)] bg-[rgba(92,181,150,0.10)] text-[rgba(92,181,150,1)]",
          };

  const stageMap = new Map(project.stages.map((stage) => [stage.stageKey, stage]));

  return (
    <motion.div {...{ initial, animate, transition }}>
      <Link
        href={`/projects?id=${project.id}`}
        className={[
          "group block rounded-[18px] border bg-[linear-gradient(165deg,rgba(255,255,255,0.97),rgba(248,251,255,0.93))] px-3.5 py-3 shadow-[0_6px_16px_rgba(79,108,161,0.06)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_28px_rgba(79,108,161,0.12)]",
          riskTone.border,
        ].join(" ")}
      >
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="text-[14px] font-semibold tracking-[-0.03em] text-[color:var(--foreground)] transition-colors duration-200 group-hover:text-[rgba(96,139,239,1)]">
                {project.title}
              </h3>
              <span
                className="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                style={{
                  borderColor: `${project.currentStageMeta.color}30`,
                  backgroundColor: project.currentStageMeta.softColor,
                  color: project.currentStageMeta.color,
                }}
              >
                当前阶段 · {project.currentStageMeta.label}
              </span>
              <span className={["rounded-full border px-2 py-0.5 text-[10px] font-semibold", riskTone.badge].join(" ")}>
                {project.attentionLabel}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
              <span className="text-[rgba(96,139,239,1)]">所属项目：{project.projectName}</span>
              <span className="text-[rgba(92,181,150,1)]">申请人：{project.createdBy?.displayName || project.requesterName || "未登记"}</span>
              <span className="text-[rgba(234,188,110,1)]">归属部门：{project.requesterDepartment || "未设置"}</span>
              <span className="text-[rgba(119,129,219,1)]">采购方式：{project.procurementMethod || "未设置"}</span>
              <span className="font-medium text-[rgba(150,165,195,1)]">项目预算：{formatWan(project.budgetAmount)}</span>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="flex items-center justify-end gap-1 text-xs text-[color:var(--muted-foreground)]">
              <Clock3 size={12} />
              <span>{project.daysSinceUpdate === 0 ? "今日更新" : `${project.daysSinceUpdate} 天未更新`}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-end gap-1 text-xs font-medium text-[rgba(96,139,239,1)]">
              <span>查看详情</span>
              <ArrowUpRight size={13} />
            </div>
          </div>
        </div>

        <div className="mt-3 -mx-1 overflow-x-auto px-1 pb-0.5 scrollbar-thin">
          <div className="flex w-full">
            {project.projectStages.map((stage, stageIdx) => {
              const stageStatus = stageMap.get(stage.key);
              const stageMeta = getStageMeta(stage.key);
              const isCompleted = stageStatus?.status === "COMPLETED";
              const isCurrent = project.currentStage === stage.key;
              const isLast = stageIdx === project.projectStages.length - 1;

              return (
                <div key={stage.key} className="flex flex-1 min-w-0">
                  <div
                    className={[
                      "relative flex w-full flex-col items-center gap-1 rounded-[10px] border py-2 transition-all duration-300",
                      isCompleted
                        ? "border-[rgba(92,181,150,0.35)] bg-[linear-gradient(180deg,rgba(92,181,150,0.12),rgba(92,181,150,0.04))] text-[rgba(92,181,150,1)] shadow-[0_2px_8px_rgba(92,181,150,0.12)]"
                        : isCurrent
                          ? "border-[rgba(96,139,239,0.4)] bg-[linear-gradient(180deg,rgba(96,139,239,0.13),rgba(96,139,239,0.03))] text-[rgba(96,139,239,1)] shadow-[0_3px_14px_rgba(96,139,239,0.15)]"
                          : "border-[rgba(207,217,232,0.6)] bg-[rgba(250,252,255,0.6)] text-[rgba(180,190,210,1)]",
                    ].join(" ")}
                  >
                    {isCurrent && (
                      <div className="absolute inset-x-0 top-0 h-[3px] rounded-t-[10px] overflow-hidden">
                        <div
                          className="h-full w-full animate-pulse"
                          style={{ background: "rgba(96,139,239,0.8)" }}
                        />
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      {isCompleted ? (
                        <CheckCircle2 size={12} style={{ filter: "drop-shadow(0 1px 2px rgba(92,181,150,0.3))" }} />
                      ) : (
                        <div
                          className="h-[7px] w-[7px] rounded-full"
                          style={{
                            backgroundColor: isCurrent ? "rgba(96,139,239,1)" : "transparent",
                            border: isCurrent ? "none" : "1.5px solid rgba(207,217,232,0.8)",
                            boxShadow: isCurrent ? "0 0 6px rgba(96,139,239,0.4)" : "none",
                          }}
                        />
                      )}
                      <span className="text-[11px] truncate font-semibold">{stageMeta.label}</span>
                    </div>
                  </div>
                  {!isLast && (
                    <div className="flex items-center px-[2px]">
                      <div
                        className="h-[2px] w-full"
                        style={{
                          backgroundColor: isCompleted
                            ? "rgba(92,181,150,0.35)"
                            : isCurrent
                              ? "rgba(207,217,232,0.5)"
                              : "rgba(207,217,232,0.4)",
                        }}
                      />
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

export function ProgressContent({
  currentUserRole,
}: {
  currentUserRole?: AuthRole;
}) {
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
    setKeyword("");
    setSelectedProject("");
    setSelectedRequester("");

    if (insight.relatedStageKey) {
      setSelectedStage(insight.relatedStageKey);
    } else {
      setSelectedStage(null);
    }

    setSelectedProjectIds(
      insight.relatedProjectIds.length > 0
        ? new Set(insight.relatedProjectIds)
        : new Set<string>(),
    );

    const el = document.getElementById("project-list");
    if (el) {
      window.scrollTo({ top: el.offsetTop - 20, behavior: "smooth" });
    }
  };

  const loadData = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await fetchProgressStats();
      setStats(data);
      setLastRefreshedAt(
        new Intl.DateTimeFormat("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date()),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "项目进度汇总加载失败");
    } finally {
      setLoading(false);
    }
  };

  const AI_CACHE_KEY = "progress-ai-insights-cache-v2";

  const buildStatsFingerprint = (s: ProgressStats): string => {
    const tokens = s.projects.map((p) => `${p.id}:${p.currentStage}:${p.updatedAt}`).join("|");
    return `${s.totalActive}:${s.monthlyAdded}:${s.monthlyCompleted}:${tokens}`;
  };

  const loadAiInsights = useCallback(async (forceRefresh = false) => {
    if (!stats) return;

    const fingerprint = buildStatsFingerprint(stats);

    if (!forceRefresh) {
      try {
        const cached = localStorage.getItem(AI_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as { fingerprint: string; data: ProgressAiInsights };
          if (parsed.fingerprint === fingerprint && parsed.data) {
            setAiInsights(parsed.data);
            return;
          }
        }
      } catch {
        // cache corrupted, proceed to fetch
      }
    }

    setAiLoading(true);
    try {
      const data = await fetchProgressAiInsights();
      setAiInsights(data);
      try {
        localStorage.setItem(AI_CACHE_KEY, JSON.stringify({ fingerprint, data }));
      } catch {
        // localStorage full or unavailable
      }
    } catch {
      setAiInsights(null);
    } finally {
      setAiLoading(false);
    }
  }, [stats]);

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (stats) {
      void loadAiInsights();
    }
  }, [stats, loadAiInsights]);

  const derivedProjects = useMemo<DerivedProject[]>(() => {
    if (!stats) {
      return [];
    }

    const budgets = stats.projects
      .map((project) => project.budgetAmount || 0)
      .sort((a, b) => a - b);
    const thresholdIndex = Math.max(0, Math.floor(budgets.length * 0.7) - 1);
    const highBudgetThreshold = budgets[thresholdIndex] ?? 0;

    return stats.projects.map((project) => {
      const daysSinceUpdate = getDaysSince(project.updatedAt);
      const completedStages = project.stages.filter((stage) => stage.status === "COMPLETED").length;
      const totalStages = project.stages.length;
      const progressPercent = totalStages > 0 ? Math.round((completedStages / totalStages) * 100) : 0;
      const currentStageMeta = getStageMeta(project.currentStage);
      const riskLevel = getRiskLevel(daysSinceUpdate);
      const isHighBudget = (project.budgetAmount || 0) >= highBudgetThreshold && highBudgetThreshold > 0;
      const isEarlyStage = ["PROCUREMENT_DEMAND", "INITIATION", "TENDER_DOCUMENT"].includes(project.currentStage);
      const needsAttention = daysSinceUpdate > 7 || (isHighBudget && isEarlyStage);
      const attentionLabel =
        daysSinceUpdate > 14
          ? "停滞超 14 天"
          : daysSinceUpdate > 7
            ? "停滞超 7 天"
            : isHighBudget && isEarlyStage
              ? "高预算待推进"
              : "正常推进";

      // Get stages for this project's procurement method
      const projectStages = getStagesForMethod(project.procurementMethod as ProcurementMethod);

      return {
        ...project,
        daysSinceUpdate,
        completedStages,
        totalStages,
        progressPercent,
        currentStageMeta,
        riskLevel,
        needsAttention,
        isHighBudget,
        isEarlyStage,
        attentionLabel,
        projectStages,
      };
    });
  }, [stats]);

  const totalBudget = useMemo(
    () => derivedProjects.reduce((sum, project) => sum + (project.budgetAmount || 0), 0),
    [derivedProjects],
  );

  const attentionCount = useMemo(
    () => derivedProjects.filter((project) => project.needsAttention).length,
    [derivedProjects],
  );

  const dangerCount = useMemo(
    () => derivedProjects.filter((project) => project.daysSinceUpdate > 14).length,
    [derivedProjects],
  );

  const averageStalledDays = useMemo(() => {
    if (derivedProjects.length === 0) {
      return 0;
    }
    return Math.round(
      derivedProjects.reduce((sum, project) => sum + project.daysSinceUpdate, 0) / derivedProjects.length,
    );
  }, [derivedProjects]);

  const averageCompletion = useMemo(() => {
    if (derivedProjects.length === 0) {
      return 0;
    }
    return Math.round(
      derivedProjects.reduce((sum, project) => sum + project.progressPercent, 0) / derivedProjects.length,
    );
  }, [derivedProjects]);

  const orderedStageDistribution = useMemo(() => {
    const stageCountMap = new Map<string, number>();

    for (const project of derivedProjects) {
      stageCountMap.set(project.currentStage, (stageCountMap.get(project.currentStage) ?? 0) + 1);
    }

    return PROJECT_WORKFLOW_STAGES_ALL.map((stage) => {
      const count = stageCountMap.get(stage.key) ?? 0;
      const meta = getStageMeta(stage.key);
      const share = derivedProjects.length === 0 ? 0 : (count / derivedProjects.length) * 100;
      return {
        key: stage.key,
        count,
        share,
        ...meta,
      };
    });
  }, [derivedProjects]);

  const dominantStage = useMemo(() => {
    return orderedStageDistribution.reduce<(typeof orderedStageDistribution)[number] | null>((current, item) => {
      if (!current || item.count > current.count) {
        return item;
      }
      return current;
    }, null);
  }, [orderedStageDistribution]);

  const projectNames = useMemo(() => {
    const nameSet = new Set<string>();
    for (const project of derivedProjects) {
      nameSet.add(project.projectName);
    }
    return Array.from(nameSet).sort();
  }, [derivedProjects]);

  const requesterNames = useMemo(() => {
    const nameSet = new Set<string>();
    for (const project of derivedProjects) {
      const name = project.createdBy?.displayName || project.requesterName;
      if (name) {
        nameSet.add(name);
      }
    }
    return Array.from(nameSet).sort();
  }, [derivedProjects]);

  // 本月动态数据
  const monthlyStats = useMemo(() => {
    return {
      added: stats?.monthlyAdded ?? 0,
      completed: stats?.monthlyCompleted ?? 0,
      active: stats?.recentlyActive ?? 0,
    };
  }, [stats]);

  // 采购方式分布
  const methodDistribution = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of derivedProjects) {
      const key = p.procurementMethod || "未设置";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [derivedProjects]);

  // 部门分布
  const departmentDistribution = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of derivedProjects) {
      const key = p.requesterDepartment || "未设置";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [derivedProjects]);

  // 申请人分布
  const requesterDistribution = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of derivedProjects) {
      const key = p.createdBy?.displayName || p.requesterName || "未设置";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [derivedProjects]);

  // 归属项目分布
  const projectNameDistribution = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of derivedProjects) {
      const key = p.projectName || "未设置";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [derivedProjects]);

  const scaleDistribution = useMemo(() => {
    let smallCount = 0;
    let mediumCount = 0;
    let largeCount = 0;
    let xlargeCount = 0;
    for (const p of derivedProjects) {
      const budget = p.budgetAmount || 0;
      if (budget < 100000) smallCount++;
      else if (budget < 500000) mediumCount++;
      else if (budget < 1000000) largeCount++;
      else xlargeCount++;
    }
    return [
      { name: "小额（<10万）", count: smallCount },
      { name: "中额（10-50万）", count: mediumCount },
      { name: "大额（50-100万）", count: largeCount },
      { name: "特大（>100万）", count: xlargeCount },
    ].filter((d) => d.count > 0);
  }, [derivedProjects]);

  // 阶段分布（只显示有项目的阶段，按数量降序）
  const activeStages = useMemo(() => {
    return orderedStageDistribution
      .filter((stage) => stage.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [orderedStageDistribution]);

  const stageDistributionForChart = useMemo(() => {
    return activeStages.map((s) => ({ name: s.label, count: s.count }));
  }, [activeStages]);

  const activeFilterCount = [
    selectedStage,
    selectedProject,
    selectedRequester,
    keyword.trim(),
    selectedProjectIds.size > 0,
  ].filter(Boolean).length;

  const clearAllFilters = () => {
    setKeyword("");
    setSelectedStage(null);
    setSelectedProject("");
    setSelectedRequester("");
    setSelectedProjectIds(new Set());
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [keyword, selectedStage, selectedProject, selectedRequester, sortBy, selectedProjectIds]);

  const filteredProjects = useMemo(() => {
    const filtered = derivedProjects.filter((project) => {
      if (selectedProjectIds.size > 0 && !selectedProjectIds.has(project.id)) {
        return false;
      }
      if (selectedStage && project.currentStage !== selectedStage) {
        return false;
      }
      if (selectedProject && project.projectName !== selectedProject) {
        return false;
      }
      if (selectedRequester) {
        const requesterName = project.createdBy?.displayName || project.requesterName;
        if (requesterName !== selectedRequester) {
          return false;
        }
      }
      if (!keyword.trim()) {
        return true;
      }
      const normalized = keyword.trim().toLowerCase();
      return [
        project.title,
        project.requesterName,
        project.requesterDepartment,
        project.createdBy?.displayName,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });

    const sorters: Record<string, (a: DerivedProject, b: DerivedProject) => number> = {
      updatedAt: () => 0,
      budgetDesc: (a, b) => (b.budgetAmount || 0) - (a.budgetAmount || 0),
      progressAsc: (a, b) => a.progressPercent - b.progressPercent,
      stalledDesc: (a, b) => b.daysSinceUpdate - a.daysSinceUpdate,
    };

    return sorters[sortBy] ? filtered.sort(sorters[sortBy]) : filtered;
  }, [derivedProjects, keyword, selectedProject, selectedRequester, selectedStage, selectedProjectIds, sortBy]);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[rgba(96,139,239,0.3)] border-t-[rgba(96,139,239,1)]" />
          <span className="text-sm text-[color:var(--muted-foreground)]">正在汇总项目进展...</span>
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <AlertCircle size={32} className="text-[rgba(230,129,102,1)]" />
          <span className="text-sm text-[color:var(--muted-foreground)]">{error || "项目进度汇总加载失败"}</span>
          <button
            onClick={() => void loadData()}
            className="rounded-[10px] border border-[rgba(96,139,239,0.2)] bg-[rgba(96,139,239,0.08)] px-4 py-2 text-sm font-medium text-[rgba(96,139,239,1)] transition-all duration-200 hover:bg-[rgba(96,139,239,0.15)]"
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-3">
        <motion.div {...fadeIn(0, reducedMotion, 0.03)}>
          <div className="relative overflow-hidden rounded-[20px] border border-white/50 bg-[linear-gradient(165deg,rgba(255,255,255,0.95),rgba(248,251,255,0.9))] px-4 py-4 shadow-[0_8px_24px_rgba(79,108,161,0.08)]">
            <div className="absolute inset-y-0 right-[-8%] w-[35%] bg-[radial-gradient(circle_at_center,rgba(96,139,239,0.08),transparent_70%)]" />
            <div className="relative">
              <h1 className="text-base font-semibold tracking-[-0.02em] text-[color:var(--foreground)] mb-3">采购进度驾驶舱</h1>
              {/* KPI Grid - 7 cards with chroma-style design */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7">
                {/* 进行中项目 */}
                <motion.div {...fadeIn(1, reducedMotion, 0.03)}>
                  <div className="group relative flex flex-col justify-between rounded-[14px] border border-[rgba(96,139,239,0.15)] bg-[linear-gradient(160deg,rgba(96,139,239,0.08),rgba(255,255,255,0.95))] p-3 min-h-[72px] transition-all duration-300 hover:border-[rgba(96,139,239,0.4)] hover:shadow-[0_8px_20px_rgba(96,139,239,0.15)]">
                    <span className="text-xs font-medium text-[rgba(96,139,239,0.85)]">进行中项目</span>
                    <span className="mt-1 text-[1.4rem] font-bold tracking-[-0.03em] leading-none text-[rgba(96,139,239,1)]">{stats.totalActive}</span>
                  </div>
                </motion.div>

                {/* 平均完成度 */}
                <motion.div {...fadeIn(2, reducedMotion, 0.03)}>
                  <div className="group relative flex flex-col justify-between rounded-[14px] border border-[rgba(92,181,150,0.15)] bg-[linear-gradient(160deg,rgba(92,181,150,0.08),rgba(255,255,255,0.95))] p-3 min-h-[72px] transition-all duration-300 hover:border-[rgba(92,181,150,0.4)] hover:shadow-[0_8px_20px_rgba(92,181,150,0.15)]">
                    <span className="text-xs font-medium text-[rgba(92,181,150,0.85)]">平均完成度</span>
                    <span className="mt-1 text-[1.4rem] font-bold tracking-[-0.03em] leading-none text-[rgba(92,181,150,1)]">{formatPercent(averageCompletion)}</span>
                  </div>
                </motion.div>

                {/* 预算总额 */}
                <motion.div {...fadeIn(3, reducedMotion, 0.03)}>
                  <div className="group relative flex flex-col justify-between rounded-[14px] border border-[rgba(234,188,110,0.2)] bg-[linear-gradient(160deg,rgba(234,188,110,0.1),rgba(255,255,255,0.95))] p-3 min-h-[72px] transition-all duration-300 hover:border-[rgba(234,188,110,0.45)] hover:shadow-[0_8px_20px_rgba(234,188,110,0.15)]">
                    <span className="text-xs font-medium text-[rgba(205,155,70,0.9)]">预算总额</span>
                    <span className="mt-1 text-[1.4rem] font-bold tracking-[-0.03em] leading-none text-[rgba(205,155,70,1)]">{formatWan(totalBudget)}</span>
                  </div>
                </motion.div>

                {/* 待推进 */}
                <motion.div {...fadeIn(4, reducedMotion, 0.03)}>
                  <div className="group relative flex flex-col justify-between rounded-[14px] border border-[rgba(230,129,102,0.15)] bg-[linear-gradient(160deg,rgba(230,129,102,0.08),rgba(255,255,255,0.95))] p-3 min-h-[72px] transition-all duration-300 hover:border-[rgba(230,129,102,0.4)] hover:shadow-[0_8px_20px_rgba(230,129,102,0.15)]">
                    <span className="text-xs font-medium text-[rgba(230,129,102,0.85)]">待推进</span>
                    <span className="mt-1 text-[1.4rem] font-bold tracking-[-0.03em] leading-none text-[rgba(230,129,102,1)]">{attentionCount}</span>
                  </div>
                </motion.div>

                {/* 高风险项目 */}
                <motion.div {...fadeIn(5, reducedMotion, 0.03)}>
                  <div className="group relative flex flex-col justify-between rounded-[14px] border border-[rgba(220,80,80,0.15)] bg-[linear-gradient(160deg,rgba(220,80,80,0.06),rgba(255,255,255,0.95))] p-3 min-h-[72px] transition-all duration-300 hover:border-[rgba(220,80,80,0.4)] hover:shadow-[0_8px_20px_rgba(220,80,80,0.12)]">
                    <span className="text-xs font-medium text-[rgba(200,70,70,0.85)]">高风险项目</span>
                    <span className="mt-1 text-[1.4rem] font-bold tracking-[-0.03em] leading-none text-[rgba(200,70,70,1)]">{dangerCount}</span>
                  </div>
                </motion.div>

                {/* 平均停滞天数 */}
                <motion.div {...fadeIn(6, reducedMotion, 0.03)}>
                  <div className="group relative flex flex-col justify-between rounded-[14px] border border-[rgba(119,129,219,0.15)] bg-[linear-gradient(160deg,rgba(119,129,219,0.08),rgba(255,255,255,0.95))] p-3 min-h-[72px] transition-all duration-300 hover:border-[rgba(119,129,219,0.4)] hover:shadow-[0_8px_20px_rgba(119,129,219,0.15)]">
                    <span className="text-xs font-medium text-[rgba(119,129,219,0.85)]">平均停滞</span>
                    <span className="mt-1 text-[1.4rem] font-bold tracking-[-0.03em] leading-none text-[rgba(119,129,219,1)]">{averageStalledDays}<span className="text-[0.75rem] font-medium ml-0.5">天</span></span>
                  </div>
                </motion.div>

                {/* 集中阶段 */}
                <motion.div {...fadeIn(7, reducedMotion, 0.03)}>
                  <div className="group relative flex flex-col justify-between rounded-[14px] border border-[rgba(150,165,195,0.2)] bg-[linear-gradient(160deg,rgba(150,165,195,0.08),rgba(255,255,255,0.95))] p-3 min-h-[72px] transition-all duration-300 hover:border-[rgba(150,165,195,0.4)] hover:shadow-[0_8px_20px_rgba(150,165,195,0.12)]">
                    <span className="text-xs font-medium text-[rgba(111,128,160,0.85)]">集中阶段</span>
                    <span className="mt-1 text-[1.4rem] font-bold tracking-[-0.03em] leading-none text-[rgba(111,128,160,1)]">{dominantStage?.label ?? "暂无"}</span>
                  </div>
                </motion.div>
              </div>
            </div>
          </div>
        </motion.div>


        <div className="grid gap-3 xl:grid-cols-2">
          <motion.div {...fadeIn(5, reducedMotion, 0.03)}>
            <Panel variant="highlight" className="h-full">
              <SectionHeader title="执行态势" />
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <PieChartBlock
                  icon={<User size={12} />}
                  label="申请人"
                  items={requesterDistribution}
                  accent="rgba(96,139,239,1)"
                />
                <PieChartBlock
                  icon={<Gavel size={12} />}
                  label="采购方式"
                  items={methodDistribution}
                  accent="rgba(92,181,150,1)"
                />
                <PieChartBlock
                  icon={<Building2 size={12} />}
                  label="归属部门"
                  items={departmentDistribution}
                  accent="rgba(234,188,110,1)"
                />
                <PieChartBlock
                  icon={<LayoutGrid size={12} />}
                  label="归属项目"
                  items={projectNameDistribution}
                  accent="rgba(119,129,219,1)"
                />
                <PieChartBlock
                  icon={<BarChart3 size={12} />}
                  label="阶段分布"
                  items={stageDistributionForChart}
                  accent="rgba(104,193,156,1)"
                />
                <PieChartBlock
                  icon={<TrendingUp size={12} />}
                  label="项目规模"
                  items={scaleDistribution}
                  accent="rgba(230,129,102,1)"
                />
              </div>
            </Panel>
          </motion.div>

          <motion.div {...fadeIn(6, reducedMotion, 0.03)}>
            <Panel variant="insight" className="h-full">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-[8px] bg-[rgba(96,139,239,0.1)] text-[rgba(96,139,239,1)]">
                    <Sparkles size={13} />
                  </div>
                  <h2 className="text-[0.9rem] font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
                    进度洞察
                  </h2>
                </div>
                <button
                  onClick={() => void loadAiInsights(true)}
                  disabled={aiLoading}
                  className="inline-flex items-center gap-1 rounded-[8px] border border-[rgba(96,139,239,0.2)] bg-[rgba(96,139,239,0.06)] px-2 py-1 text-xs font-medium text-[rgba(96,139,239,1)] transition-all duration-200 hover:bg-[rgba(96,139,239,0.12)] disabled:opacity-50"
                >
                  <RefreshCw size={10} className={aiLoading ? "animate-spin" : ""} />
                  重新分析
                </button>
              </div>

              {aiLoading && !aiInsights ? (
                <div className="mt-4 flex flex-col items-center gap-2 py-6">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-[rgba(96,139,239,0.3)] border-t-[rgba(96,139,239,1)]" />
                  <span className="text-xs text-[color:var(--muted-foreground)]">正在分析项目数据...</span>
                </div>
              ) : aiInsights ? (
                <>
                  {aiInsights.overview && (
                    <div className="mt-3 rounded-[12px] border border-white/60 bg-white/50 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                      <p className="text-xs leading-[1.7] text-[color:var(--foreground)]">{aiInsights.overview}</p>
                    </div>
                  )}

                  <div className="mt-2.5 space-y-1.5">
                    {aiInsights.insights.map((insight) => (
                      <AiInsightCard
                        key={insight.id}
                        insight={insight}
                        onFilter={() => applyInsightFilter(insight)}
                        reducedMotion={reducedMotion}
                      />
                    ))}
                  </div>

                  {aiInsights.insights.length === 0 && aiInsights.overview === "" && (
                    <div className="mt-4 py-4 text-center text-xs text-[color:var(--muted-foreground)]">
                      暂无分析结果
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-4 py-4 text-center text-xs text-[color:var(--muted-foreground)]">
                  分析暂不可用
                </div>
              )}
            </Panel>
          </motion.div>
        </div>

        <motion.div {...fadeIn(7, reducedMotion, 0.03)}>
          <Panel>
            <div id="project-list" className="space-y-3">
              <div className="flex items-end justify-between gap-2.5">
                <SectionHeader
                  title="项目清单"
                  description={`共 ${derivedProjects.length} 个项目`}
                />
                <div className="flex items-center gap-2.5">
                  {lastRefreshedAt && (
                    <span className="text-xs text-[color:var(--muted-foreground)]">
                      {lastRefreshedAt}
                    </span>
                  )}
                  <button
                    onClick={() => void loadData()}
                    className="inline-flex items-center gap-1.5 rounded-[10px] border border-[rgba(96,139,239,0.2)] bg-[rgba(96,139,239,0.08)] px-3 py-1.5 text-xs font-medium text-[rgba(96,139,239,1)] transition-all duration-200 hover:bg-[rgba(96,139,239,0.15)]"
                  >
                    <RefreshCw size={13} />
                    刷新
                  </button>
                </div>
              </div>

              {/* 筛选与排序 */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[160px] flex-1">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[rgba(96,139,239,0.5)]" />
                  <input
                    type="text"
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="搜索项目、申请人、部门..."
                    className="w-full rounded-[10px] border border-[rgba(150,165,195,0.25)] bg-white/70 py-1.5 pl-8 pr-3 text-xs text-[color:var(--foreground)] outline-none transition-all duration-200 focus:border-[rgba(96,139,239,0.4)] focus:bg-white focus:shadow-[0_0_0_3px_rgba(96,139,239,0.06)]"
                  />
                </div>

                <select
                  value={selectedStage ?? ""}
                  onChange={(e) => setSelectedStage(e.target.value || null)}
                  className="cursor-pointer rounded-[10px] border border-[rgba(150,165,195,0.25)] bg-white/70 px-2.5 py-1.5 text-xs text-[color:var(--foreground)] outline-none transition-all duration-200 hover:border-[rgba(96,139,239,0.3)] focus:border-[rgba(96,139,239,0.4)] focus:bg-white"
                >
                  <option value="">全部阶段</option>
                  {PROJECT_WORKFLOW_STAGES_ALL.map((stage) => (
                    <option key={stage.key} value={stage.key}>{stage.label}</option>
                  ))}
                </select>

                <select
                  value={selectedProject}
                  onChange={(e) => setSelectedProject(e.target.value)}
                  className="cursor-pointer rounded-[10px] border border-[rgba(150,165,195,0.25)] bg-white/70 px-2.5 py-1.5 text-xs text-[color:var(--foreground)] outline-none transition-all duration-200 hover:border-[rgba(96,139,239,0.3)] focus:border-[rgba(96,139,239,0.4)] focus:bg-white"
                >
                  <option value="">全部项目</option>
                  {projectNames.map((name, idx) => (
                    <option key={`${name}-${idx}`} value={name}>{name}</option>
                  ))}
                </select>

                <select
                  value={selectedRequester}
                  onChange={(e) => setSelectedRequester(e.target.value)}
                  className="cursor-pointer rounded-[10px] border border-[rgba(150,165,195,0.25)] bg-white/70 px-2.5 py-1.5 text-xs text-[color:var(--foreground)] outline-none transition-all duration-200 hover:border-[rgba(96,139,239,0.3)] focus:border-[rgba(96,139,239,0.4)] focus:bg-white"
                >
                  <option value="">全部申请人</option>
                  {requesterNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>

                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="cursor-pointer rounded-[10px] border border-[rgba(150,165,195,0.25)] bg-white/70 px-2.5 py-1.5 text-xs text-[color:var(--foreground)] outline-none transition-all duration-200 hover:border-[rgba(96,139,239,0.3)] focus:border-[rgba(96,139,239,0.4)] focus:bg-white"
                >
                  <option value="updatedAt">按更新时间</option>
                  <option value="budgetDesc">预算 高→低</option>
                  <option value="progressAsc">完成度 低→高</option>
                  <option value="stalledDesc">停滞天数 高→低</option>
                </select>

                <span className="shrink-0 text-xs text-[color:var(--muted-foreground)]">
                  {filteredProjects.length}/{derivedProjects.length}
                </span>

                {activeFilterCount > 0 && (
                  <button
                    onClick={clearAllFilters}
                    className="shrink-0 rounded-[8px] border border-[rgba(230,129,102,0.25)] bg-[rgba(230,129,102,0.06)] px-2 py-1 text-xs font-medium text-[rgba(230,129,102,1)] transition-all duration-200 hover:bg-[rgba(230,129,102,0.12)]"
                  >
                    清除 {activeFilterCount} 项筛选
                  </button>
                )}
              </div>

              {filteredProjects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center text-[color:var(--muted-foreground)]">
                  <FolderKanban size={28} className="mb-2 text-[rgba(96,139,239,0.5)]" />
                  <div className="text-sm font-medium text-[color:var(--foreground)]">
                    {derivedProjects.length === 0 ? "当前暂无进行中的项目" : "暂无匹配项目"}
                  </div>
                  {activeFilterCount > 0 && (
                    <button
                      onClick={clearAllFilters}
                      className="mt-2 rounded-[8px] border border-[rgba(96,139,239,0.2)] bg-[rgba(96,139,239,0.06)] px-3 py-1 text-xs font-medium text-[rgba(96,139,239,1)] transition-all duration-200 hover:bg-[rgba(96,139,239,0.12)]"
                    >
                      清除筛选条件
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="space-y-2.5">
                    {filteredProjects.slice(0, currentPage * PAGE_SIZE).map((project, index) => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        index={index}
                        reducedMotion={reducedMotion}
                      />
                    ))}
                  </div>
                  {filteredProjects.length > currentPage * PAGE_SIZE && (
                    <div className="mt-3 flex items-center justify-between border-t border-[rgba(150,165,195,0.15)] pt-3">
                      <span className="text-xs text-[color:var(--muted-foreground)]">
                        已显示 {Math.min(currentPage * PAGE_SIZE, filteredProjects.length)} / {filteredProjects.length}
                      </span>
                      <button
                        onClick={() => setCurrentPage((p) => p + 1)}
                        className="rounded-[10px] border border-[rgba(96,139,239,0.2)] bg-[rgba(96,139,239,0.06)] px-3 py-1.5 text-xs font-medium text-[rgba(96,139,239,1)] transition-all duration-200 hover:bg-[rgba(96,139,239,0.12)]"
                      >
                        加载更多
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </Panel>
        </motion.div>
      </div>
  );
}
