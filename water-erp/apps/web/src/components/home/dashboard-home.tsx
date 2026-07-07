"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart3,
  CalendarRange,
  ChevronRight,
  Eye,
  FolderKanban,
  Layers,
  Lightbulb,
  PieChart,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
  X,
} from "lucide-react";
import { type AuthRole } from "@/lib/api/auth";
import {
  fetchDashboardData,
  type DashboardData,
} from "@/lib/api/dashboard";
import {
  fetchDashboardAnalysis,
  fetchAiCalibration,
  type DashboardAnalysisPayload,
  type DashboardAnalysisResult,
  type AiCalibration,
} from "@/lib/api/ai";

const easeOutQuint: [number, number, number, number] = [0.22, 1, 0.36, 1];

const accentMap = {
  blue: "rgba(96,139,239,1)",
  blueLight: "rgba(96,139,239,0.12)",
  blueMid: "rgba(96,139,239,0.22)",
  teal: "rgba(92,181,150,1)",
  tealLight: "rgba(92,181,150,0.12)",
  gold: "rgba(234,188,110,1)",
  goldLight: "rgba(234,188,110,0.14)",
  coral: "rgba(230,129,102,1)",
  coralLight: "rgba(230,129,102,0.12)",
  indigo: "rgba(119,129,219,1)",
  emerald: "rgba(104,193,156,1)",
  amber: "rgba(241,171,92,1)",
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

type SupplierDetail = {
  id: string;
  name: string;
  participatedCount: number;
  winCount: number;
  awardAmount: number;
  awardAmountLabel: string;
  hitRate: number;
  topMethod: string;
  topDepartment: string;
  tags: string[];
  recentProcurements: {
    project: string;
    date: string;
    method: string;
    department: string;
    budgetLabel: string;
    result: string;
  }[];
  winProjects: {
    project: string;
    date: string;
    method: string;
    department: string;
    awardAmountLabel: string;
  }[];
};

type SectionVariant = "default" | "highlight" | "alert" | "success" | "insight";

// ─── Utilities ────────────────────────────────────────────────────────────────

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

function polarToCartesian(cx: number, cy: number, radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: Number((cx + radius * Math.cos(radians)).toFixed(3)),
    y: Number((cy + radius * Math.sin(radians)).toFixed(3)),
  };
}

function arcPath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

type TrendChartPoint = { x: number; y: number; label: string; value: number };

function buildTrendPoints(
  items: Array<{ label: string; value: number }>,
  width: number,
  height: number,
  frame: { left: number; right: number; top: number; bottom: number },
) {
  if (items.length === 0) return [];
  const max = Math.max(...items.map((item) => item.value), 1);
  const innerWidth = width - frame.left - frame.right;
  const innerHeight = height - frame.top - frame.bottom;
  const step = items.length === 1 ? 0 : innerWidth / (items.length - 1);
  return items.map((item, index) => ({
    label: item.label,
    value: item.value,
    x: Number((frame.left + index * step).toFixed(2)),
    y: Number((height - frame.bottom - (item.value / max) * innerHeight).toFixed(2)),
  }));
}

function buildSmoothTrendPath(points: TrendChartPoint[]) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const path = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    path.push(`C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`);
  }
  return path.join(" ");
}

function buildAreaPath(points: TrendChartPoint[], baselineY: number) {
  if (points.length === 0) return "";
  return `${buildSmoothTrendPath(points)} L ${points[points.length - 1].x} ${baselineY} L ${points[0].x} ${baselineY} Z`;
}

// ─── Section Wrapper ─────────────────────────────────────────────────────────

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
    <section className={className}>
      <div className="flex h-full flex-col p-4">{children}</div>
    </section>
  );
}

function SectionHeader({
  eyebrow,
  title,
  action,
  variant = "default",
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
  variant?: SectionVariant;
}) {
  const eyebrowColors: Record<SectionVariant, string> = {
    default: "text-[rgba(84,104,139,0.7)]",
    highlight: "text-[rgba(96,139,239,0.8)]",
    alert: "text-[rgba(230,129,102,0.85)]",
    success: "text-[rgba(92,181,150,0.85)]",
    insight: "text-[rgba(234,188,110,0.85)]",
  };

  return (
    <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-0">
      <div>
        {eyebrow && (
          <div className={["text-xs uppercase tracking-[0.18em] font-bold", eyebrowColors[variant]].join(" ")}>
            {eyebrow}
          </div>
        )}
        <h2 className="mt-0.5 text-[0.92rem] font-semibold tracking-[-0.025em] text-[color:var(--foreground)]">
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}

// ─── KPI Metric Card ─────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  signal,
  trend,
  trendLabel,
  index,
  reducedMotion,
  accent,
  showDivider,
}: {
  label: string;
  value: string;
  sub?: string;
  signal?: "normal" | "warning" | "danger" | "success";
  trend?: "up" | "down" | "flat";
  trendLabel?: string;
  index: number;
  reducedMotion: boolean;
  accent: string;
  showDivider?: "right";
}) {
  const { initial, animate, transition } = fadeIn(index, reducedMotion, 0.05);

  // 根据 accent 颜色映射到对应的 Tailwind 类名
  const colorMap: Record<string, { border: string; bg: string; labelColor: string; valueColor: string; hoverBorder: string; hoverShadow: string }> = {
    "rgba(96,139,239,1)": {
      border: "border-[rgba(96,139,239,0.15)]",
      bg: "bg-[linear-gradient(160deg,rgba(96,139,239,0.08),rgba(255,255,255,0.95))]",
      labelColor: "text-[rgba(96,139,239,0.85)]",
      valueColor: "text-[rgba(96,139,239,1)]",
      hoverBorder: "hover:border-[rgba(96,139,239,0.4)]",
      hoverShadow: "hover:shadow-[0_8px_20px_rgba(96,139,239,0.15)]",
    },
    "rgba(92,181,150,1)": {
      border: "border-[rgba(92,181,150,0.15)]",
      bg: "bg-[linear-gradient(160deg,rgba(92,181,150,0.08),rgba(255,255,255,0.95))]",
      labelColor: "text-[rgba(92,181,150,0.85)]",
      valueColor: "text-[rgba(92,181,150,1)]",
      hoverBorder: "hover:border-[rgba(92,181,150,0.4)]",
      hoverShadow: "hover:shadow-[0_8px_20px_rgba(92,181,150,0.15)]",
    },
    "rgba(234,188,110,1)": {
      border: "border-[rgba(234,188,110,0.2)]",
      bg: "bg-[linear-gradient(160deg,rgba(234,188,110,0.1),rgba(255,255,255,0.95))]",
      labelColor: "text-[rgba(205,155,70,0.9)]",
      valueColor: "text-[rgba(205,155,70,1)]",
      hoverBorder: "hover:border-[rgba(234,188,110,0.45)]",
      hoverShadow: "hover:shadow-[0_8px_20px_rgba(234,188,110,0.15)]",
    },
    "rgba(230,129,102,1)": {
      border: "border-[rgba(230,129,102,0.15)]",
      bg: "bg-[linear-gradient(160deg,rgba(230,129,102,0.08),rgba(255,255,255,0.95))]",
      labelColor: "text-[rgba(230,129,102,0.85)]",
      valueColor: "text-[rgba(230,129,102,1)]",
      hoverBorder: "hover:border-[rgba(230,129,102,0.4)]",
      hoverShadow: "hover:shadow-[0_8px_20px_rgba(230,129,102,0.15)]",
    },
    "rgba(119,129,219,1)": {
      border: "border-[rgba(119,129,219,0.15)]",
      bg: "bg-[linear-gradient(160deg,rgba(119,129,219,0.08),rgba(255,255,255,0.95))]",
      labelColor: "text-[rgba(119,129,219,0.85)]",
      valueColor: "text-[rgba(119,129,219,1)]",
      hoverBorder: "hover:border-[rgba(119,129,219,0.4)]",
      hoverShadow: "hover:shadow-[0_8px_20px_rgba(119,129,219,0.15)]",
    },
    "rgba(150,165,195,1)": {
      border: "border-[rgba(150,165,195,0.2)]",
      bg: "bg-[linear-gradient(160deg,rgba(150,165,195,0.08),rgba(255,255,255,0.95))]",
      labelColor: "text-[rgba(111,128,160,0.85)]",
      valueColor: "text-[rgba(111,128,160,1)]",
      hoverBorder: "hover:border-[rgba(150,165,195,0.4)]",
      hoverShadow: "hover:shadow-[0_8px_20px_rgba(150,165,195,0.12)]",
    },
  };

  const colorStyle = colorMap[accent] || colorMap["rgba(96,139,239,1)"];

  return (
    <motion.div {...{ initial, animate, transition }} className="relative">
      <div className={`group relative flex flex-col justify-between rounded-[14px] border p-3 min-h-[72px] transition-all duration-300 ${colorStyle.border} ${colorStyle.bg} ${colorStyle.hoverBorder} ${colorStyle.hoverShadow}`}>
        <span className={`text-[11px] font-medium ${colorStyle.labelColor}`}>{label}</span>
        <span className={`mt-1 text-[1.4rem] font-bold tracking-[-0.03em] leading-none ${colorStyle.valueColor}`}>{value}</span>
        {sub && (
          <span className="mt-0.5 text-xs font-medium text-[color:var(--muted-foreground)]">{sub}</span>
        )}
        {signal && (
          <div className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={{ backgroundColor: signal === "success" || signal === "normal" ? "rgba(92,181,150,0.1)" : signal === "warning" ? "rgba(234,188,110,0.12)" : "rgba(230,129,102,0.12)", color: signal === "success" || signal === "normal" ? "rgba(92,181,150,1)" : signal === "warning" ? "rgba(205,155,70,1)" : "rgba(210,100,70,1)" }}>
            <span className="h-1 w-1 rounded-full" style={{ backgroundColor: signal === "success" || signal === "normal" ? "rgba(92,181,150,1)" : signal === "warning" ? "rgba(234,188,110,1)" : "rgba(230,129,102,1)" }} />
            {signal === "normal" ? "正常" : signal === "warning" ? "预警" : signal === "danger" ? "告警" : "达标"}
          </div>
        )}
        {trend && trendLabel && (
          <div className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold w-fit" style={{ backgroundColor: trend === "up" ? "rgba(92,181,150,0.08)" : trend === "down" ? "rgba(230,129,102,0.08)" : "rgba(150,165,195,0.08)", color: trend === "up" ? "rgba(92,181,150,1)" : trend === "down" ? "rgba(230,129,102,1)" : "rgba(150,165,195,1)" }}>
            {trend === "up" ? <ArrowUp size={9} /> : trend === "down" ? <ArrowDown size={9} /> : <ArrowRight size={9} />}
            {trendLabel}
          </div>
        )}
      </div>
      {/* 分组分隔线 */}
      {showDivider === "right" && (
        <div className="absolute -right-[9px] top-2 bottom-2 w-[6px] flex items-center justify-center">
          <div className="h-full w-[2px] rounded-full bg-gradient-to-b from-transparent via-[rgba(96,139,239,0.5)] to-transparent shadow-[0_0_8px_rgba(96,139,239,0.3)]" />
        </div>
      )}
    </motion.div>
  );
}

// ─── AI Intelligence Panel ───────────────────────────────────────────────────

function IntelligencePanel({
  analysis,
  loading,
  error,
  onRefresh,
  index,
  reducedMotion,
}: {
  analysis: DashboardAnalysisResult | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  index: number;
  reducedMotion: boolean;
}) {
  const { initial, animate, transition } = fadeIn(index, reducedMotion, 0.06);

  return (
    <motion.div {...{ initial, animate, transition }} className="h-full">
      <Panel variant="highlight">
        <div className="flex items-start justify-between px-4 pt-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-[rgba(96,139,239,0.3)] bg-[linear-gradient(145deg,rgba(238,245,255,0.96),rgba(228,238,255,0.9))] shadow-[0_4px_10px_rgba(96,139,239,0.08)]">
              <Sparkles size={15} className="text-[rgba(96,139,239,1)]" />
            </div>
            <h2 className="text-[0.92rem] font-semibold tracking-[-0.025em] text-[color:var(--foreground)]">
              综合分析报告
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {loading && (
              <div className="flex items-center gap-1.5 text-[11px] text-[color:var(--muted-foreground)]">
                <RefreshCw size={12} className="animate-spin" />
                分析中...
              </div>
            )}
            <button
              onClick={onRefresh}
              className="flex h-7 w-7 items-center justify-center rounded-[8px] border border-[rgba(96,139,239,0.2)] bg-[rgba(238,245,255,0.8)] text-[rgba(96,139,239,1)] shadow-[0_2px_6px_rgba(96,139,239,0.06)] transition-all duration-200 hover:border-[rgba(96,139,239,0.4)] hover:shadow-[0_4px_10px_rgba(96,139,239,0.12)] active:scale-95"
              title="刷新分析"
            >
              <RefreshCw size={12} />
            </button>
          </div>
        </div>

        {error && !analysis ? (
          <div className="mx-4 mb-4 mt-3 flex items-center gap-2 rounded-[12px] border border-[rgba(230,129,102,0.25)] bg-[rgba(255,248,246,0.8)] px-3 py-2.5 text-xs text-[rgba(200,90,70,1)]">
            <AlertCircle size={13} />
            {error}
          </div>
        ) : null}

        <div className="mt-3 flex flex-1 flex-col gap-3 px-4 pb-4">
          {/* Overview - 综合研判 */}
          {analysis?.overview ? (
            <div className="intel-sheen-line intel-block-glow rounded-[14px] border border-[rgba(96,139,239,0.18)] bg-[linear-gradient(145deg,rgba(246,250,255,0.98),rgba(240,246,255,0.94))] px-4 py-3.5">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex h-5 w-5 items-center justify-center rounded-[6px] bg-[rgba(96,139,239,0.12)] transition-transform duration-200 hover:scale-110">
                  <Target size={10} className="text-[rgba(96,139,239,1)]" />
                </div>
                <span className="text-[11px] font-bold tracking-[0.08em] text-[rgba(96,139,239,0.8)]">综合研判</span>
              </div>
              <p className="text-[0.85rem] font-medium leading-[1.6] tracking-[-0.01em] text-[color:var(--foreground)]">
                {analysis.overview}
              </p>
            </div>
          ) : loading ? (
            <div className="flex h-[60px] items-center justify-center rounded-[14px] border border-dashed border-[rgba(180,195,225,0.4)]">
              <span className="text-[11px] text-[color:var(--muted-foreground)]">正在生成分析...</span>
            </div>
          ) : null}

          {/* Highlights - 核心亮点 */}
          {analysis?.highlights && analysis.highlights.length > 0 && (
            <div className="intel-block-glow rounded-[12px] border border-[rgba(92,181,150,0.2)] bg-[linear-gradient(160deg,rgba(250,255,252,0.95),rgba(245,252,250,0.88))] px-3.5 py-3">
              <div className="flex items-center gap-1.5 mb-2.5">
                <TrendingUp size={12} className="text-[rgba(92,181,150,1)] transition-transform duration-200 hover:scale-110" />
                <span className="text-xs font-bold tracking-[0.1em] text-[rgba(92,181,150,0.85)]">核心亮点</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {analysis.highlights.map((item, i) => (
                  <div key={i} className="bullet-animated flex items-start gap-2 transition-all duration-200 hover:translate-x-1">
                    <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[rgba(92,181,150,1)] transition-transform duration-200 hover:scale-150" />
                    <span className="text-[11px] leading-[1.5] text-[color:var(--foreground)]">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Concerns + Suggestions 两列布局 */}
          <div className="grid grid-cols-2 gap-2.5">
            {/* Concerns - 待关注项 */}
            <div className="intel-block-glow rounded-[12px] border border-[rgba(234,188,110,0.22)] bg-[linear-gradient(160deg,rgba(255,252,248,0.94),rgba(252,250,245,0.88))] px-3.5 py-3">
              <div className="flex items-center gap-1.5 mb-2.5">
                <Eye size={12} className="text-[rgba(210,165,80,1)] transition-transform duration-200 hover:scale-110" />
                <span className="text-xs font-bold tracking-[0.1em] text-[rgba(210,165,80,0.85)]">待关注项</span>
              </div>
              <div className="space-y-1.5">
                {analysis?.concerns && analysis.concerns.length > 0 ? (
                  analysis.concerns.map((item, i) => (
                    <div key={i} className="bullet-animated flex items-start gap-2 transition-all duration-200 hover:translate-x-1">
                      <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[rgba(210,165,80,1)] transition-transform duration-200 hover:scale-150" />
                      <span className="text-[11px] leading-[1.5] text-[color:var(--foreground)]">{item}</span>
                    </div>
                  ))
                ) : (
                  <span className="text-xs text-[color:var(--muted-foreground)]">当前运行平稳</span>
                )}
              </div>
            </div>

            {/* Suggestions - 建议方向 */}
            <div className="intel-block-glow rounded-[12px] border border-[rgba(96,139,239,0.2)] bg-[linear-gradient(160deg,rgba(248,252,255,0.94),rgba(244,250,255,0.88))] px-3.5 py-3">
              <div className="flex items-center gap-1.5 mb-2.5">
                <Lightbulb size={12} className="text-[rgba(96,139,239,1)] icon-rotate-hover cursor-pointer" />
                <span className="text-xs font-bold tracking-[0.1em] text-[rgba(96,139,239,0.85)]">建议方向</span>
              </div>
              <div className="space-y-1.5">
                {analysis?.suggestions && analysis.suggestions.length > 0 ? (
                  analysis.suggestions.map((item, i) => (
                    <div key={i} className="bullet-animated flex items-start gap-2 transition-all duration-200 hover:translate-x-1">
                      <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] bg-[rgba(96,139,239,0.12)] text-[10px] font-bold text-[rgba(96,139,239,1)] transition-all duration-200 hover:bg-[rgba(96,139,239,0.18)] hover:scale-110">
                        {i + 1}
                      </div>
                      <span className="text-[11px] leading-[1.5] text-[color:var(--foreground)]">{item}</span>
                    </div>
                  ))
                ) : (
                  <span className="text-xs text-[color:var(--muted-foreground)]">暂无具体建议</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </Panel>
    </motion.div>
  );
}

// ─── Savings Rate Ranking ────────────────────────────────────────────────────

type SavingsRankingItem = {
  project: string;
  department: string;
  controlAmount: number;
  awardAmount: number;
  savings: number;
  savingsRate: number;
  controlAmountLabel: string;
  awardAmountLabel: string;
  savingsLabel: string;
  method: string;
  date: string;
};

function SavingsRankingPanel({
  items,
  index,
  reducedMotion,
}: {
  items: SavingsRankingItem[];
  index: number;
  reducedMotion: boolean;
}) {
  const { initial, animate, transition } = fadeIn(index, reducedMotion, 0.05);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [flipUp, setFlipUp] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Measure available space below clicked item and decide float direction
  const handleExpand = (idx: number, btnEl: HTMLButtonElement) => {
    const next = expandedIdx === idx ? null : idx;
    setExpandedIdx(next);
    if (next === null) return;

    // Defer measurement until the render cycle settles
    requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const btnRect = btnEl.getBoundingClientRect();
      const spaceBelow = containerRect.bottom - btnRect.bottom;
      // Approximate detail card height: ~140px
      setFlipUp(spaceBelow < 140);
    });
  };

  const rateColor = (rate: number) =>
    rate >= 15 ? "rgba(92,181,150,1)" : rate >= 8 ? "rgba(96,139,239,1)" : "rgba(234,188,110,1)";
  const rateBg = (rate: number) =>
    rate >= 15 ? "bg-[rgba(92,181,150,0.1)]" : rate >= 8 ? "bg-[rgba(96,139,239,0.1)]" : "bg-[rgba(234,188,110,0.1)]";

  const maxSavings = Math.max(...items.map((i) => i.savings), 1);
  const displayItems = items.slice(0, 5);
  const activeItem = expandedIdx !== null ? displayItems[expandedIdx] : null;

  return (
    <motion.div {...{ initial, animate, transition }} className="h-full">
      <Panel variant="success">
        <div className="flex items-start justify-between px-4 pt-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-[rgba(92,181,150,0.3)] bg-[linear-gradient(145deg,rgba(246,255,250,0.96),rgba(242,251,247,0.9))] shadow-[0_4px_10px_rgba(70,155,120,0.08)]">
              <TrendingUp size={15} className="text-[rgba(92,181,150,1)]" />
            </div>
            <h2 className="text-[0.92rem] font-semibold tracking-[-0.025em] text-[color:var(--foreground)]">
              节资率项目排行
            </h2>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-[rgba(92,181,150,0.25)] bg-[rgba(246,255,250,0.8)] px-2.5 py-1 text-[10px] font-bold text-[rgba(92,181,150,1)]">
            <Target size={10} />
            Top 5
          </div>
        </div>

        <div ref={containerRef} className="mt-3 flex flex-1 flex-col space-y-2 overflow-y-auto px-4 pb-4 relative">
          {displayItems.map((item, idx) => (
            <button
              key={idx}
              ref={(el) => { rowRefs.current[idx] = el; }}
              onClick={() => handleExpand(idx, rowRefs.current[idx]!)}
              className={[
                "group w-full text-left flex items-start gap-2.5 rounded-[12px] border px-3 py-2.5 shadow-[0_4px_10px_rgba(70,155,120,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_18px_rgba(70,155,120,0.10)]",
                idx === 0
                  ? "border-[rgba(92,181,150,0.35)] bg-[linear-gradient(160deg,rgba(246,255,250,0.97),rgba(242,251,247,0.93))]"
                  : "border-[rgba(92,181,150,0.18)] bg-[linear-gradient(160deg,rgba(255,255,255,0.97),rgba(250,252,255,0.93))]"
              ].join(" ")}
            >
              {/* Rank + Rate */}
              <div className="flex shrink-0 flex-col items-center gap-1">
                <div className={["flex h-6 w-6 items-center justify-center rounded-[7px] text-[10px] font-bold", rateBg(item.savingsRate)].join(" ")} style={{ color: rateColor(item.savingsRate) }}>
                  {idx + 1}
                </div>
                <div className="floating-indicator text-xs font-semibold" style={{ color: rateColor(item.savingsRate) }}>{item.savingsRate}%</div>
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold leading-snug text-[color:var(--foreground)] line-clamp-2 transition-colors duration-200 group-hover:text-[rgba(92,181,150,0.95)]">
                  {item.project}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(96,139,239,0.2)] bg-[rgba(96,139,239,0.06)] px-1.5 py-0.5 text-[10px] font-medium text-[rgba(96,139,239,0.9)]">
                    {item.department}
                  </span>
                  <span className="text-xs text-[color:var(--muted-foreground)]">节约 {item.savingsLabel}</span>
                </div>
              </div>

              <ChevronRight
                size={13}
                className={["shrink-0 transition-transform duration-200", expandedIdx === idx ? "rotate-90" : ""].join(" ")}
                style={{ color: "rgba(150,165,195,1)" }}
              />
            </button>
          ))}

          {/* Floating detail overlay — positioned near clicked item */}
          {activeItem && expandedIdx !== null && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96, filter: "blur(4px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 0.96, filter: "blur(4px)" }}
              transition={{ duration: 0.2, ease: easeOutQuint }}
              className="absolute left-4 right-4 z-10 rounded-[14px] border border-[rgba(92,181,150,0.3)] bg-[linear-gradient(160deg,rgba(246,255,250,0.98),rgba(242,251,247,0.96))] px-3.5 py-3 shadow-[0_12px_32px_rgba(70,155,120,0.15)] backdrop-blur-sm"
              style={{
                top: flipUp
                  ? (() => {
                      const btn = rowRefs.current[expandedIdx];
                      if (!btn || !containerRef.current) return "0px";
                      const btnTop = btn.offsetTop - containerRef.current.scrollTop;
                      return Math.max(0, btnTop - 160) + "px";
                    })()
                  : (() => {
                      const btn = rowRefs.current[expandedIdx];
                      if (!btn || !containerRef.current) return "0px";
                      return (btn.offsetTop - containerRef.current.scrollTop + btn.offsetHeight + 4) + "px";
                    })(),
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="text-[11px] font-semibold text-[color:var(--foreground)] line-clamp-2 flex-1 pr-2">{activeItem.project}</div>
                <button
                  onClick={() => setExpandedIdx(null)}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border border-[rgba(92,181,150,0.2)] bg-[rgba(92,181,150,0.06)] text-[rgba(92,181,150,0.7)] transition-all duration-200 hover:bg-[rgba(92,181,150,0.12)] hover:text-[rgba(92,181,150,1)]"
                >
                  <X size={11} />
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
                <div className="rounded-[8px] border border-[rgba(180,195,225,0.25)] bg-white/60 px-2.5 py-1.5">
                  <div className="text-xs text-[color:var(--muted-foreground)]">预算金额</div>
                  <div className="mt-0.5 text-[11px] font-semibold text-[color:var(--foreground)]">{activeItem.controlAmountLabel}</div>
                </div>
                <div className="rounded-[8px] border border-[rgba(92,181,150,0.25)] bg-white/60 px-2.5 py-1.5">
                  <div className="text-xs text-[color:var(--muted-foreground)]">成交金额</div>
                  <div className="mt-0.5 text-[11px] font-semibold text-[rgba(92,181,150,1)]">{activeItem.awardAmountLabel}</div>
                </div>
                <div className="rounded-[8px] border border-[rgba(234,188,110,0.25)] bg-white/60 px-2.5 py-1.5">
                  <div className="text-xs text-[color:var(--muted-foreground)]">节资率</div>
                  <div className="mt-0.5 text-[11px] font-bold" style={{ color: rateColor(activeItem.savingsRate) }}>{activeItem.savingsRate}%</div>
                </div>
              </div>

              <div className="mb-1">
                <div className="text-xs font-bold uppercase tracking-[0.1em] text-[rgba(92,181,150,0.85)]">节资额对比</div>
                <div className="mt-1 h-3 overflow-hidden rounded-full bg-[rgba(226,232,246,0.5)]">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${(activeItem.savings / maxSavings) * 100}%`,
                      backgroundColor: rateColor(activeItem.savingsRate),
                    }}
                  />
                </div>
                <div className="mt-0.5 text-xs font-semibold" style={{ color: rateColor(activeItem.savingsRate) }}>节约 {activeItem.savingsLabel}</div>
              </div>

              <div className="flex items-center gap-3 text-xs text-[color:var(--muted-foreground)]">
                <span>采购方式: {activeItem.method}</span>
                <span>日期: {activeItem.date}</span>
              </div>
            </motion.div>
          )}

          {displayItems.length === 0 && (
            <div className="flex flex-1 items-center justify-center text-[11px] text-[color:var(--muted-foreground)]">
              暂无已成交项目数据
            </div>
          )}
        </div>
      </Panel>
    </motion.div>
  );
}

// ─── Risk Projects Panel ───────────────────────────────────────────────────────

function RiskProjectsPanel({
  profile,
  index,
  reducedMotion,
}: {
  profile: DashboardData;
  index: number;
  reducedMotion: boolean;
}) {
  const { initial, animate, transition } = fadeIn(index, reducedMotion, 0.05);

  const severityColors = {
    高: { bg: "bg-[rgba(230,129,102,0.12)]", text: "text-[rgba(230,129,102,1)]" },
    中: { bg: "bg-[rgba(234,188,110,0.12)]", text: "text-[rgba(234,188,110,1)]" },
    低: { bg: "bg-[rgba(96,139,239,0.12)]", text: "text-[rgba(96,139,239,1)]" },
  };

  const displayItems = profile.riskProjects.slice(0, 5);

  return (
    <motion.div {...{ initial, animate, transition }} className="h-full">
      <Panel variant="alert">
        <div className="flex items-start justify-between px-4 pt-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-[rgba(230,129,102,0.3)] bg-[linear-gradient(145deg,rgba(255,248,246,0.96),rgba(250,243,240,0.9))] shadow-[0_4px_10px_rgba(230,129,102,0.08)]">
              <AlertCircle size={15} className="text-[rgba(230,129,102,1)]" />
            </div>
            <h2 className="text-[0.92rem] font-semibold tracking-[-0.025em] text-[color:var(--foreground)]">
              风险项目预警
            </h2>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-[rgba(230,129,102,0.25)] bg-[rgba(255,248,246,0.8)] px-2.5 py-1 text-[10px] font-bold text-[rgba(230,129,102,1)]">
            <AlertCircle size={10} />
            {profile.riskProjects.length} 项
          </div>
        </div>

        <div className="mt-3 flex flex-1 flex-col space-y-2 overflow-y-auto px-4 pb-4">
          {displayItems.map((item, idx) => {
            const colors = severityColors[item.severity as keyof typeof severityColors] || severityColors.中;

            return (
              <div
                key={idx}
                className={[
                  "group w-full text-left flex items-start gap-2.5 rounded-[12px] border px-3 py-2.5 shadow-[0_4px_10px_rgba(230,129,102,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_18px_rgba(230,129,102,0.10)]",
                  idx === 0
                    ? "border-[rgba(230,129,102,0.35)] bg-[linear-gradient(160deg,rgba(255,252,250,0.97),rgba(252,248,245,0.93))]"
                    : "border-[rgba(230,129,102,0.18)] bg-[linear-gradient(160deg,rgba(255,255,255,0.97),rgba(250,252,255,0.93))]"
                ].join(" ")}
              >
                {/* Severity Badge + Days */}
                <div className="flex shrink-0 flex-col items-center gap-1">
                  <div className={["flex h-6 w-6 items-center justify-center rounded-[7px] text-[10px] font-bold", colors.bg, colors.text].join(" ")}>
                    {idx + 1}
                  </div>
                  <div className="text-xs font-semibold text-[rgba(230,129,102,1)]">{item.pendingDays}天</div>
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold leading-snug text-[color:var(--foreground)] line-clamp-2 transition-colors duration-200 group-hover:text-[rgba(230,129,102,0.95)]">
                    {item.project}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(96,139,239,0.2)] bg-[rgba(96,139,239,0.06)] px-1.5 py-0.5 text-[10px] font-medium text-[rgba(96,139,239,0.9)]">
                      {item.department}
                    </span>
                    <span className="text-xs text-[rgba(230,129,102,0.85)]">{item.reason}</span>
                  </div>
                </div>

                {/* Severity indicator */}
                <div className="flex shrink-0 items-center justify-center">
                  <div className={["flex h-5 w-5 items-center justify-center rounded-[6px] text-[10px] font-bold", colors.bg, colors.text].join(" ")}>
                    {item.severity === "高" ? "!" : item.severity === "中" ? "·" : "○"}
                  </div>
                </div>
              </div>
            );
          })}
          {displayItems.length === 0 && (
            <div className="flex flex-1 items-center justify-center text-[11px] text-[color:var(--muted-foreground)]">
              暂无风险项目
            </div>
          )}
        </div>
      </Panel>
    </motion.div>
  );
}

// ─── Project Scale Distribution Panel ─────────────────────────────────────────

type ScaleSegment = {
  label: string;
  range: string;
  min: number;
  max: number;
  count: number;
  amount: number;
  amountLabel: string;
  share: number;
  color: string;
};

function computeProjectScaleSegments(profile: DashboardData): ScaleSegment[] {
  const segments: ScaleSegment[] = [
    { label: "小额", range: "<10万", min: 0, max: 100000, count: 0, amount: 0, amountLabel: "", share: 0, color: "rgba(96,139,239,1)" },
    { label: "中小", range: "10-50万", min: 100000, max: 500000, count: 0, amount: 0, amountLabel: "", share: 0, color: "rgba(92,181,150,1)" },
    { label: "中型", range: "50-200万", min: 500000, max: 2000000, count: 0, amount: 0, amountLabel: "", share: 0, color: "rgba(234,188,110,1)" },
    { label: "大型", range: ">200万", min: 2000000, max: Infinity, count: 0, amount: 0, amountLabel: "", share: 0, color: "rgba(230,129,102,1)" },
  ];

  // Use trendSeries which contains all projects with budget info
  profile.trendSeries.forEach((trendItem) => {
    trendItem.projects.forEach((project) => {
      const budgetStr = project.budgetLabel;
      let budget = 0;

      // Parse budget label (e.g., "123.45 万", "1,234元")
      if (budgetStr.includes("万")) {
        budget = parseFloat(budgetStr.replace("万", "").replace(",", "").trim()) * 10000;
      } else if (budgetStr.includes("元")) {
        budget = parseFloat(budgetStr.replace("元", "").replace(/,/g, ""));
      }

      for (const seg of segments) {
        if (budget >= seg.min && budget < seg.max) {
          seg.count++;
          seg.amount += budget;
          break;
        }
      }
    });
  });

  const total = segments.reduce((sum, s) => sum + s.count, 0);
  const totalAmount = segments.reduce((sum, s) => sum + s.amount, 0);
  segments.forEach((seg) => {
    seg.share = total > 0 ? Math.round((seg.count / total) * 100) : 0;
    if (seg.amount >= 10000) {
      seg.amountLabel = `${(seg.amount / 10000).toFixed(1)}万`;
    } else {
      seg.amountLabel = `${seg.amount.toFixed(0)}元`;
    }
  });

  return segments;
}

function ProjectScalePanel({
  profile,
  index,
  reducedMotion,
}: {
  profile: DashboardData;
  index: number;
  reducedMotion: boolean;
}) {
  const { initial, animate, transition } = fadeIn(index, reducedMotion, 0.05);
  const segments = useMemo(() => computeProjectScaleSegments(profile), [profile]);
  const [activeSegment, setActiveSegment] = useState<ScaleSegment | null>(null);

  const total = segments.reduce((sum, s) => sum + s.count, 0);
  const totalAmount = segments.reduce((sum, s) => sum + s.amount, 0);
  const maxCount = Math.max(...segments.map((s) => s.count), 1);

  // Format total amount
  const totalAmountLabel = totalAmount >= 10000
    ? `${(totalAmount / 10000).toFixed(1)}万`
    : `${totalAmount.toFixed(0)}元`;

  // Get projects for a specific segment
  const getProjectsForSegment = (seg: ScaleSegment) => {
    const projects: Array<{ name: string; date: string; department: string; budgetLabel: string; status: string }> = [];
    profile.trendSeries.forEach((trendItem) => {
      trendItem.projects.forEach((project) => {
        const budgetStr = project.budgetLabel;
        let budget = 0;
        if (budgetStr.includes("万")) {
          budget = parseFloat(budgetStr.replace("万", "").replace(",", "").trim()) * 10000;
        } else if (budgetStr.includes("元")) {
          budget = parseFloat(budgetStr.replace("元", "").replace(/,/g, ""));
        }
        if (budget >= seg.min && budget < seg.max) {
          projects.push(project);
        }
      });
    });
    return projects;
  };

  return (
    <>
      <motion.div {...{ initial, animate, transition }} className="h-full">
        <Panel variant="insight">
          <div className="flex items-start justify-between px-4 pt-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-[rgba(234,188,110,0.3)] bg-[linear-gradient(145deg,rgba(255,252,244,0.96),rgba(252,248,240,0.9))] shadow-[0_4px_10px_rgba(234,188,110,0.08)]">
                <BarChart3 size={15} className="text-[rgba(234,188,110,1)]" />
              </div>
              <h2 className="text-[0.92rem] font-semibold tracking-[-0.025em] text-[color:var(--foreground)]">
                项目规模分析
              </h2>
            </div>
            <div className="flex items-center gap-1.5 rounded-full border border-[rgba(234,188,110,0.25)] bg-[rgba(255,252,244,0.8)] px-2.5 py-1 text-[10px] font-bold text-[rgba(234,188,110,1)]">
              {total} 项 · {totalAmountLabel}
            </div>
          </div>

          {/* Horizontal Bar Chart */}
          <div className="mt-3 flex flex-1 flex-col gap-2 px-4 pb-4">
            {segments.map((seg, i) => {
              const barWidth = (seg.count / maxCount) * 100;

              return (
                <button
                  key={seg.label}
                  onClick={() => setActiveSegment(seg)}
                  className="group flex items-center gap-3 rounded-[10px] border border-[rgba(234,188,110,0.12)] bg-[linear-gradient(160deg,rgba(255,255,255,0.97),rgba(252,252,255,0.93))] px-3 py-2 transition-all duration-200 hover:border-[rgba(234,188,110,0.3)] hover:bg-[linear-gradient(160deg,rgba(255,252,248,0.97),rgba(252,250,245,0.93))] hover:shadow-[0_4px_14px_rgba(234,188,110,0.08)]"
                >
                  {/* Label */}
                  <div className="shrink-0 w-[36px]">
                    <div className="text-[11px] font-semibold text-[color:var(--foreground)]">{seg.label}</div>
                    <div className="text-xs text-[color:var(--muted-foreground)]">{seg.range}</div>
                  </div>

                  {/* Bar */}
                  <div className="flex-1 h-[20px] rounded-[6px] bg-[rgba(200,215,235,0.15)] overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${barWidth}%` }}
                      transition={{ duration: 0.6, delay: i * 0.1, ease: easeOutQuint }}
                      className="h-full rounded-[6px] transition-opacity duration-200 group-hover:opacity-100"
                      style={{ backgroundColor: seg.color, opacity: 0.85 }}
                    />
                  </div>

                  {/* Stats */}
                  <div className="shrink-0 text-right w-[50px]">
                    <div className="text-[11px] font-bold" style={{ color: seg.color }}>{seg.count}项</div>
                    <div className="text-xs text-[color:var(--muted-foreground)]">{seg.share}%</div>
                  </div>

                  {/* Arrow */}
                  <ChevronRight size={14} className="shrink-0 text-[rgba(150,165,195,1)] transition-transform duration-200 group-hover:translate-x-0.5" />
                </button>
              );
            })}

            {total === 0 && (
              <div className="flex flex-1 items-center justify-center text-[11px] text-[color:var(--muted-foreground)]">
                暂无项目数据
              </div>
            )}
          </div>
        </Panel>
      </motion.div>

      {/* Segment Detail Modal */}
      {activeSegment && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
          onClick={() => setActiveSegment(null)}
        >
          <div
            className="relative max-w-[min(480px,90vw)] w-full max-h-[80vh] overflow-y-auto rounded-[24px] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,252,255,0.95))] shadow-[0_24px_80px_rgba(62,92,150,0.28)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="sticky top-0 bg-[linear-gradient(180deg,rgba(255,255,255,1),rgba(255,255,255,0.95))] px-5 pt-5 pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-[rgba(234,188,110,0.25)] bg-[rgba(234,188,110,0.12)]">
                    <BarChart3 size={20} style={{ color: activeSegment.color }} />
                  </div>
                  <div>
                    <div className="text-base font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">{activeSegment.label}项目</div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="text-[11px] font-bold" style={{ color: activeSegment.color }}>{activeSegment.count} 项</span>
                      <span className="text-xs text-[color:var(--muted-foreground)]">预算范围 {activeSegment.range}</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setActiveSegment(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-[rgba(234,188,110,0.15)] bg-[rgba(234,188,110,0.06)] text-[rgba(234,188,110,0.7)] transition-all duration-200 hover:bg-[rgba(234,188,110,0.12)] hover:text-[rgba(234,188,110,1)]"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Stats */}
            <div className="px-5 pb-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div className="rounded-[12px] border border-[rgba(234,188,110,0.12)] bg-[rgba(234,188,110,0.04)] px-3 py-2 text-center">
                  <div className="text-xs uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">项目数</div>
                  <div className="mt-1 text-[14px] font-bold" style={{ color: activeSegment.color }}>{activeSegment.count}</div>
                </div>
                <div className="rounded-[12px] border border-[rgba(96,139,239,0.12)] bg-[rgba(96,139,239,0.04)] px-3 py-2 text-center">
                  <div className="text-xs uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">占比</div>
                  <div className="mt-1 text-[14px] font-bold text-[rgba(96,139,239,1)]">{activeSegment.share}%</div>
                </div>
                <div className="rounded-[12px] border border-[rgba(92,181,150,0.12)] bg-[rgba(92,181,150,0.04)] px-3 py-2 text-center">
                  <div className="text-xs uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">金额</div>
                  <div className="mt-1 text-[14px] font-bold text-[rgba(92,181,150,1)]">{activeSegment.amountLabel}</div>
                </div>
              </div>
            </div>

            {/* Projects List */}
            <div className="px-5 pb-5">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[rgba(234,188,110,0.85)]">
                <FolderKanban size={12} style={{ color: activeSegment.color }} />
                项目列表
              </div>
              <div className="mt-2 space-y-1.5 max-h-[300px] overflow-y-auto">
                {getProjectsForSegment(activeSegment).map((project, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-3 rounded-[10px] border border-white/50 bg-white/40 px-3 py-2 transition-all duration-200 hover:bg-white/60"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-[11px] font-medium text-[color:var(--foreground)]">{project.name}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
                        <span>{project.date}</span>
                        <span>·</span>
                        <span>{project.department}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-bold text-[color:var(--foreground)]">{project.budgetLabel}</div>
                      <div className={["text-xs", project.status === '已成交' ? "text-[rgba(92,181,150,1)]" : project.status === '待定' ? "text-[rgba(234,188,110,1)]" : "text-[rgba(230,129,102,1)]"].join(" ")}>
                        {project.status}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Procurement Method Pie Chart Panel ─────────────────────────────────────────

type MethodDetail = {
  name: string;
  count: number;
  amount: number;
  amountLabel: string;
  share: number;
  projects: Array<{
    name: string;
    date: string;
    department: string;
    budgetLabel: string;
    awardLabel: string;
    status: string;
  }>;
};

function MethodPieChartPanel({
  profile,
  index,
  reducedMotion,
}: {
  profile: DashboardData;
  index: number;
  reducedMotion: boolean;
}) {
  const { initial, animate, transition } = fadeIn(index, reducedMotion, 0.05);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [activeMethod, setActiveMethod] = useState<MethodDetail | null>(null);

  const colors = [
    "rgba(96,139,239,1)",
    "rgba(92,181,150,1)",
    "rgba(234,188,110,1)",
    "rgba(119,129,219,1)",
    "rgba(230,129,102,1)",
    "rgba(104,193,156,1)",
  ];

  const total = profile.methodStats.reduce((sum, m) => sum + m.count, 0);

  // Build pie chart segments
  const buildPieSegments = () => {
    let currentAngle = 0;
    return profile.methodStats.map((method, i) => {
      const angle = (method.share / 100) * 360;
      const segment = {
        startAngle: currentAngle,
        endAngle: currentAngle + angle,
        color: colors[i % colors.length],
        method,
      };
      currentAngle += angle;
      return segment;
    });
  };

  const segments = buildPieSegments();
  const cx = 100, cy = 100, radius = 70, innerRadius = 45;

  const handleMethodClick = (method: MethodDetail) => {
    setActiveMethod(method);
  };

  return (
    <>
      <motion.div {...{ initial, animate, transition }} className="h-full">
        <Panel variant="highlight">
          <div className="flex items-start justify-between px-4 pt-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-[rgba(92,181,150,0.3)] bg-[linear-gradient(145deg,rgba(246,255,250,0.96),rgba(242,251,247,0.9))] shadow-[0_4px_10px_rgba(92,181,150,0.08)]">
                <Layers size={15} className="text-[rgba(92,181,150,1)]" />
              </div>
              <h2 className="text-[0.92rem] font-semibold tracking-[-0.025em] text-[color:var(--foreground)]">
                采购方式分布
              </h2>
            </div>
            <div className="flex items-center gap-1.5 rounded-full border border-[rgba(92,181,150,0.25)] bg-[rgba(92,181,150,0.08)] px-2.5 py-1 text-[10px] font-bold text-[rgba(92,181,150,1)]">
              {total} 项
            </div>
          </div>

          <div className="mt-2 flex flex-1 items-center gap-4 px-4 pb-4">
            {/* Donut Chart */}
            <div className="relative shrink-0">
              <svg width="200" height="200" viewBox="0 0 200 200">
                <defs>
                  <filter id="pieGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="2" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>
                {segments.map((seg, i) => {
                  const startRad = ((seg.startAngle - 90) * Math.PI) / 180;
                  const endRad = ((seg.endAngle - 90) * Math.PI) / 180;
                  const largeArc = seg.endAngle - seg.startAngle > 180 ? 1 : 0;

                  const x1 = cx + radius * Math.cos(startRad);
                  const y1 = cy + radius * Math.sin(startRad);
                  const x2 = cx + radius * Math.cos(endRad);
                  const y2 = cy + radius * Math.sin(endRad);
                  const x3 = cx + innerRadius * Math.cos(endRad);
                  const y3 = cy + innerRadius * Math.sin(endRad);
                  const x4 = cx + innerRadius * Math.cos(startRad);
                  const y4 = cy + innerRadius * Math.sin(startRad);

                  const path = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4} ${y4} Z`;

                  return (
                    <path
                      key={i}
                      d={path}
                      fill={seg.color}
                      opacity={hoveredIndex === i ? 1 : 0.85}
                      filter={hoveredIndex === i ? "url(#pieGlow)" : undefined}
                      className="cursor-pointer transition-all duration-200"
                      onMouseEnter={() => setHoveredIndex(i)}
                      onMouseLeave={() => setHoveredIndex(null)}
                      onClick={() => handleMethodClick(seg.method as MethodDetail)}
                      style={{ transform: hoveredIndex === i ? "scale(1.02)" : "scale(1)", transformOrigin: "center" }}
                    />
                  );
                })}
                {/* Center text */}
                <text x={cx} y={cy - 5} textAnchor="middle" style={{ fontSize: "18px", fontWeight: "700", fill: "rgba(50,70,110,1)" }}>
                  {total}
                </text>
                <text x={cx} y={cy + 12} textAnchor="middle" style={{ fontSize: "10px", fill: "rgba(100,120,150,0.7)" }}>
                  总项目
                </text>
              </svg>
            </div>

            {/* Legend */}
            <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
              {profile.methodStats.slice(0, 6).map((method, i) => (
                <button
                  key={method.name}
                  className={["flex items-center gap-2 rounded-[8px] px-2 py-1.5 transition-all duration-200 cursor-pointer text-left w-full", hoveredIndex === i ? "bg-[rgba(92,181,150,0.08)]" : "hover:bg-[rgba(92,181,150,0.04)]"].join(" ")}
                  onMouseEnter={() => setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  onClick={() => handleMethodClick(method as MethodDetail)}
                >
                  <div className="h-3 w-3 shrink-0 rounded-[4px]" style={{ backgroundColor: colors[i % colors.length] }} />
                  <span className="flex-1 truncate text-[11px] font-medium text-[color:var(--foreground)]">{method.name}</span>
                  <span className="text-[11px] font-bold" style={{ color: colors[i % colors.length] }}>{method.share}%</span>
                </button>
              ))}
            </div>
          </div>
        </Panel>
      </motion.div>

      {/* Method Detail Modal */}
      {activeMethod && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
          onClick={() => setActiveMethod(null)}
        >
          <div
            className="relative max-w-[min(480px,90vw)] w-full max-h-[80vh] overflow-y-auto rounded-[24px] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,252,255,0.95))] shadow-[0_24px_80px_rgba(62,92,150,0.28)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="sticky top-0 bg-[linear-gradient(180deg,rgba(255,255,255,1),rgba(255,255,255,0.95))] px-5 pt-5 pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-[rgba(92,181,150,0.25)] bg-[rgba(92,181,150,0.12)]">
                    <Layers size={20} className="text-[rgba(92,181,150,1)]" />
                  </div>
                  <div>
                    <div className="text-base font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">{activeMethod.name}</div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="text-[11px] font-bold text-[rgba(92,181,150,1)]">{activeMethod.count} 项</span>
                      <span className="text-xs text-[color:var(--muted-foreground)]">采购金额 {activeMethod.amountLabel}</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setActiveMethod(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-[rgba(92,181,150,0.15)] bg-[rgba(92,181,150,0.06)] text-[rgba(92,181,150,0.7)] transition-all duration-200 hover:bg-[rgba(92,181,150,0.12)] hover:text-[rgba(92,181,150,1)]"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Stats */}
            <div className="px-5 pb-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div className="rounded-[12px] border border-[rgba(92,181,150,0.12)] bg-[rgba(92,181,150,0.04)] px-3 py-2 text-center">
                  <div className="text-xs uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">占比</div>
                  <div className="mt-1 text-[14px] font-bold text-[rgba(92,181,150,1)]">{activeMethod.share}%</div>
                </div>
                <div className="rounded-[12px] border border-[rgba(96,139,239,0.12)] bg-[rgba(96,139,239,0.04)] px-3 py-2 text-center">
                  <div className="text-xs uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">项目数</div>
                  <div className="mt-1 text-[14px] font-bold text-[rgba(96,139,239,1)]">{activeMethod.count}</div>
                </div>
                <div className="rounded-[12px] border border-[rgba(234,188,110,0.12)] bg-[rgba(234,188,110,0.04)] px-3 py-2 text-center">
                  <div className="text-xs uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">金额</div>
                  <div className="mt-1 text-[14px] font-bold text-[rgba(234,188,110,1)]">{activeMethod.amountLabel}</div>
                </div>
              </div>
            </div>

            {/* Projects List */}
            <div className="px-5 pb-5">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[rgba(92,181,150,0.85)]">
                <BarChart3 size={12} className="text-[rgba(92,181,150,0.8)]" />
                采购项目
              </div>
              <div className="mt-2 space-y-1.5">
                {(activeMethod.projects ?? []).map((project, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-3 rounded-[10px] border border-white/50 bg-white/40 px-3 py-2 transition-all duration-200 hover:bg-white/60"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-[11px] font-medium text-[color:var(--foreground)]">{project.name}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
                        <span>{project.date}</span>
                        <span>·</span>
                        <span>{project.department}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-bold text-[color:var(--foreground)]">{project.awardLabel || project.budgetLabel}</div>
                      <div className={["text-xs", project.status === '已成交' ? "text-[rgba(92,181,150,1)]" : project.status === '待定' ? "text-[rgba(234,188,110,1)]" : "text-[rgba(230,129,102,1)]"].join(" ")}>
                        {project.status}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Non-Award Reasons Donut Chart Panel ─────────────────────────────────────────

type NonAwardReasonDetail = {
  label: string;
  count: number;
  detail: string;
  projects: Array<{
    name: string;
    date: string;
    department: string;
    budgetLabel: string;
    reason: string;
  }>;
};

function NonAwardDonutPanel({
  profile,
  index,
  reducedMotion,
}: {
  profile: DashboardData;
  index: number;
  reducedMotion: boolean;
}) {
  const { initial, animate, transition } = fadeIn(index, reducedMotion, 0.05);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [activeReason, setActiveReason] = useState<NonAwardReasonDetail | null>(null);

  const colors = [
    "rgba(230,129,102,1)",
    "rgba(234,188,110,1)",
    "rgba(96,139,239,1)",
    "rgba(119,129,219,1)",
    "rgba(150,165,195,1)",
  ];

  const total = profile.nonAwardReasons.reduce((sum, r) => sum + r.count, 0);

  // Build pie chart segments
  const buildPieSegments = () => {
    if (total === 0) return [];
    let currentAngle = 0;
    return profile.nonAwardReasons.map((reason, i) => {
      const share = (reason.count / total) * 100;
      const angle = (share / 100) * 360;
      const segment = {
        startAngle: currentAngle,
        endAngle: currentAngle + angle,
        color: colors[i % colors.length],
        reason,
        share,
      };
      currentAngle += angle;
      return segment;
    });
  };

  const segments = buildPieSegments();
  const cx = 100, cy = 100, radius = 70, innerRadius = 45;

  const handleReasonClick = (reason: NonAwardReasonDetail) => {
    setActiveReason(reason);
  };

  return (
    <>
      <motion.div {...{ initial, animate, transition }} className="h-full">
        <Panel variant="alert">
          <div className="flex items-start justify-between px-4 pt-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-[rgba(230,129,102,0.3)] bg-[linear-gradient(145deg,rgba(255,248,246,0.96),rgba(250,243,240,0.9))] shadow-[0_4px_10px_rgba(230,129,102,0.08)]">
                <AlertCircle size={15} className="text-[rgba(230,129,102,1)]" />
              </div>
              <h2 className="text-[0.92rem] font-semibold tracking-[-0.025em] text-[color:var(--foreground)]">
                未成交原因分析
              </h2>
            </div>
            <div className="flex items-center gap-1.5 rounded-full border border-[rgba(230,129,102,0.25)] bg-[rgba(230,129,102,0.08)] px-2.5 py-1 text-[10px] font-bold text-[rgba(230,129,102,1)]">
              {total} 项
            </div>
          </div>

          <div className="mt-2 flex flex-1 items-center gap-4 px-4 pb-4">
            {/* Donut Chart */}
            <div className="relative shrink-0">
              <svg width="200" height="200" viewBox="0 0 200 200">
                <defs>
                  <filter id="nonAwardGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="2" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>
                {total === 0 ? (
                  // Empty state
                  <circle cx={cx} cy={cy} r={radius - 10} fill="none" stroke="rgba(200,215,235,0.3)" strokeWidth="20" strokeDasharray="8 4" />
                ) : (
                  segments.map((seg, i) => {
                    const startRad = ((seg.startAngle - 90) * Math.PI) / 180;
                    const endRad = ((seg.endAngle - 90) * Math.PI) / 180;
                    const largeArc = seg.endAngle - seg.startAngle > 180 ? 1 : 0;

                    const x1 = cx + radius * Math.cos(startRad);
                    const y1 = cy + radius * Math.sin(startRad);
                    const x2 = cx + radius * Math.cos(endRad);
                    const y2 = cy + radius * Math.sin(endRad);
                    const x3 = cx + innerRadius * Math.cos(endRad);
                    const y3 = cy + innerRadius * Math.sin(endRad);
                    const x4 = cx + innerRadius * Math.cos(startRad);
                    const y4 = cy + innerRadius * Math.sin(startRad);

                    const path = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4} ${y4} Z`;

                    return (
                      <path
                        key={i}
                        d={path}
                        fill={seg.color}
                        opacity={hoveredIndex === i ? 1 : 0.85}
                        filter={hoveredIndex === i ? "url(#nonAwardGlow)" : undefined}
                        className="cursor-pointer transition-all duration-200"
                        onMouseEnter={() => setHoveredIndex(i)}
                        onMouseLeave={() => setHoveredIndex(null)}
                        onClick={() => handleReasonClick(seg.reason as NonAwardReasonDetail)}
                        style={{ transform: hoveredIndex === i ? "scale(1.02)" : "scale(1)", transformOrigin: "center" }}
                      />
                    );
                  })
                )}
                {/* Center text */}
                <text x={cx} y={cy - 5} textAnchor="middle" style={{ fontSize: "18px", fontWeight: "700", fill: "rgba(50,70,110,1)" }}>
                  {total}
                </text>
                <text x={cx} y={cy + 12} textAnchor="middle" style={{ fontSize: "10px", fill: "rgba(100,120,150,0.7)" }}>
                  未成交
                </text>
              </svg>
            </div>

            {/* Legend */}
            <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
              {total === 0 ? (
                <div className="text-[11px] text-[color:var(--muted-foreground)]">无未成交项目</div>
              ) : (
                profile.nonAwardReasons.map((reason, i) => {
                  const share = ((reason.count / total) * 100).toFixed(1);
                  return (
                    <button
                      key={reason.label}
                      className={["flex items-center gap-2 rounded-[8px] px-2 py-1.5 transition-all duration-200 cursor-pointer text-left w-full", hoveredIndex === i ? "bg-[rgba(230,129,102,0.08)]" : "hover:bg-[rgba(230,129,102,0.04)]"].join(" ")}
                      onMouseEnter={() => setHoveredIndex(i)}
                      onMouseLeave={() => setHoveredIndex(null)}
                      onClick={() => handleReasonClick(reason as NonAwardReasonDetail)}
                    >
                      <div className="h-3 w-3 shrink-0 rounded-[4px]" style={{ backgroundColor: colors[i % colors.length] }} />
                      <span className="flex-1 truncate text-[11px] font-medium text-[color:var(--foreground)]">{reason.label}</span>
                      <span className="text-[11px] font-bold" style={{ color: colors[i % colors.length] }}>{reason.count}项</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </Panel>
      </motion.div>

      {/* Reason Detail Modal */}
      {activeReason && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
          onClick={() => setActiveReason(null)}
        >
          <div
            className="relative max-w-[min(480px,90vw)] w-full max-h-[80vh] overflow-y-auto rounded-[24px] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,252,255,0.95))] shadow-[0_24px_80px_rgba(62,92,150,0.28)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="sticky top-0 bg-[linear-gradient(180deg,rgba(255,255,255,1),rgba(255,255,255,0.95))] px-5 pt-5 pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-[rgba(230,129,102,0.25)] bg-[rgba(230,129,102,0.12)]">
                    <AlertCircle size={20} className="text-[rgba(230,129,102,1)]" />
                  </div>
                  <div>
                    <div className="text-base font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">{activeReason.label}</div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="text-[11px] font-bold text-[rgba(230,129,102,1)]">{activeReason.count} 项</span>
                      <span className="text-xs text-[color:var(--muted-foreground)]">未成交项目</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setActiveReason(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-[rgba(230,129,102,0.15)] bg-[rgba(230,129,102,0.06)] text-[rgba(230,129,102,0.7)] transition-all duration-200 hover:bg-[rgba(230,129,102,0.12)] hover:text-[rgba(230,129,102,1)]"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Stats */}
            <div className="px-5 pb-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-[12px] border border-[rgba(230,129,102,0.12)] bg-[rgba(230,129,102,0.04)] px-3 py-2 text-center">
                  <div className="text-xs uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">项目数</div>
                  <div className="mt-1 text-[14px] font-bold text-[rgba(230,129,102,1)]">{activeReason.count}</div>
                </div>
                <div className="rounded-[12px] border border-[rgba(234,188,110,0.12)] bg-[rgba(234,188,110,0.04)] px-3 py-2 text-center">
                  <div className="text-xs uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">占比</div>
                  <div className="mt-1 text-[14px] font-bold text-[rgba(234,188,110,1)]">{((activeReason.count / total) * 100).toFixed(1)}%</div>
                </div>
              </div>
            </div>

            {/* Projects List */}
            <div className="px-5 pb-5">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[rgba(230,129,102,0.85)]">
                <BarChart3 size={12} className="text-[rgba(230,129,102,0.8)]" />
                相关项目
              </div>
              <div className="mt-2 space-y-1.5">
                {(activeReason.projects ?? []).map((project, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-3 rounded-[10px] border border-white/50 bg-white/40 px-3 py-2 transition-all duration-200 hover:bg-white/60"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-[11px] font-medium text-[color:var(--foreground)]">{project.name}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
                        <span>{project.date}</span>
                        <span>·</span>
                        <span>{project.department}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-bold text-[color:var(--foreground)]">{project.budgetLabel}</div>
                      <div className="text-xs text-[rgba(230,129,102,1)]">{project.reason}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Supplier Cards ──────────────────────────────────────────────────────────

function SupplierCards({
  suppliers,
  index,
  reducedMotion,
}: {
  suppliers: SupplierDetail[];
  index: number;
  reducedMotion: boolean;
}) {
  const { initial, animate, transition } = fadeIn(index, reducedMotion, 0.06);
  const [activeSupplier, setActiveSupplier] = useState<SupplierDetail | null>(null);
  const displaySuppliers = suppliers.slice(0, 6);

  return (
    <>
      <motion.div {...{ initial, animate, transition }} className="h-full">
        <Panel>
          <div className="flex items-start justify-between px-4 pt-4 pb-2">
            <h2 className="text-[0.92rem] font-semibold tracking-[-0.025em] text-[color:var(--foreground)]">重点供应商动态</h2>
            <span className="badge-color-cycle flex h-7 w-7 items-center justify-center rounded-[8px] border border-[rgba(96,139,239,0.2)] bg-[rgba(96,139,239,0.06)] text-[10px] font-bold text-[rgba(96,139,239,1)]">
              {suppliers.length}
            </span>
          </div>

          <div className="flex flex-1 flex-col overflow-hidden px-4 pb-4">
            <div className="grid grid-cols-2 grid-rows-3 gap-2 flex-1">
              {displaySuppliers.map((supplier) => {
                return (
                  <button
                    key={supplier.id}
                    onClick={() => setActiveSupplier(supplier)}
                    className="supplier-card-glow card-edge-light group w-full h-full text-left rounded-[12px] border border-white/55 bg-[linear-gradient(160deg,rgba(255,255,255,0.96),rgba(250,252,255,0.92))] px-3 py-2.5 shadow-[0_4px_10px_rgba(79,108,161,0.05)] transition-all duration-300 hover:-translate-y-1 hover:border-[rgba(96,139,239,0.3)] hover:shadow-[0_10px_24px_rgba(96,139,239,0.12)]"
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-[rgba(96,139,239,0.2)] bg-[rgba(96,139,239,0.08)] text-[10px] font-bold text-[rgba(96,139,239,1)] transition-all duration-200 group-hover:bg-[rgba(96,139,239,0.15)] group-hover:scale-105">
                        {supplier.name.slice(0, 2)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] font-semibold text-[color:var(--foreground)] transition-colors duration-200 group-hover:text-[rgba(96,139,239,1)]">{supplier.name}</div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span className="text-xs font-bold transition-all duration-200 group-hover:scale-105" style={{ color: accentMap.teal }}>{supplier.winCount}/{supplier.participatedCount}</span>
                          <span className="text-xs text-[color:var(--muted-foreground)]">中標</span>
                          <span className="number-pop-in ml-auto text-xs font-bold text-[color:var(--foreground)]">{supplier.awardAmountLabel}</span>
                        </div>
                      </div>
                    </div>

                    {/* Tags */}
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {supplier.tags.slice(0, 2).map((tag) => (
                        <span key={tag} className="supplier-tag-bounce inline-flex items-center rounded-full border border-[rgba(96,139,239,0.15)] bg-[rgba(96,139,239,0.05)] px-1.5 py-0.5 text-[10px] text-[rgba(96,139,239,0.85)] transition-all duration-200 hover:bg-[rgba(96,139,239,0.12)] hover:text-[rgba(96,139,239,1)]">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </Panel>
      </motion.div>

      {/* Supplier Detail Modal */}
      {activeSupplier && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => setActiveSupplier(null)}
        >
          {/* Modal Content */}
          <div
            className="relative max-w-[420px] w-full rounded-[24px] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,252,255,0.95))] shadow-[0_24px_80px_rgba(62,92,150,0.28)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between px-5 pt-5 pb-3">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-[rgba(96,139,239,0.25)] bg-[rgba(96,139,239,0.12)] text-[14px] font-bold text-[rgba(96,139,239,1)]">
                  {activeSupplier.name.slice(0, 2)}
                </div>
                <div>
                  <div className="text-base font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">{activeSupplier.name}</div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="text-[11px] font-bold" style={{ color: accentMap.teal }}>{activeSupplier.winCount}/{activeSupplier.participatedCount}</span>
                    <span className="text-xs text-[color:var(--muted-foreground)]">中标</span>
                    <span className="text-[11px] font-bold text-[color:var(--foreground)]">{activeSupplier.awardAmountLabel}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setActiveSupplier(null)}
                className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-[rgba(96,139,239,0.15)] bg-[rgba(96,139,239,0.06)] text-[rgba(96,139,239,0.7)] transition-all duration-200 hover:bg-[rgba(96,139,239,0.12)] hover:text-[rgba(96,139,239,1)]"
              >
                <X size={16} />
              </button>
            </div>

            {/* Tags */}
            <div className="px-5 pb-3">
              <div className="flex flex-wrap gap-1.5">
                {activeSupplier.tags.map((tag) => (
                  <span key={tag} className="inline-flex items-center rounded-full border border-[rgba(96,139,239,0.15)] bg-[rgba(96,139,239,0.06)] px-2 py-0.5 text-[10px] text-[rgba(96,139,239,0.85)]">
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Stats */}
            <div className="px-5 pb-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div className="rounded-[12px] border border-[rgba(96,139,239,0.12)] bg-[rgba(96,139,239,0.04)] px-3 py-2 text-center">
                  <div className="text-xs uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">中标率</div>
                  <div className="mt-1 text-[14px] font-bold" style={{ color: accentMap.teal }}>{activeSupplier.hitRate}%</div>
                </div>
                <div className="rounded-[12px] border border-[rgba(92,181,150,0.12)] bg-[rgba(92,181,150,0.04)] px-3 py-2 text-center">
                  <div className="text-xs uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">中标数</div>
                  <div className="mt-1 text-[14px] font-bold text-[rgba(92,181,150,1)]">{activeSupplier.winCount}</div>
                </div>
                <div className="rounded-[12px] border border-[rgba(234,188,110,0.12)] bg-[rgba(234,188,110,0.04)] px-3 py-2 text-center">
                  <div className="text-xs uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">参与数</div>
                  <div className="mt-1 text-[14px] font-bold text-[rgba(234,188,110,1)]">{activeSupplier.participatedCount}</div>
                </div>
              </div>
            </div>

            {/* Profile Summary */}
            <div className="px-5 pb-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[rgba(96,139,239,0.85)]">
                <BarChart3 size={12} className="text-[rgba(96,139,239,0.8)]" />
                活跃特征
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <div className="flex items-start gap-2 rounded-[10px] border border-[rgba(92,181,150,0.12)] bg-[rgba(92,181,150,0.04)] px-3 py-2">
                  <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[rgba(92,181,150,1)]" />
                  <div>
                    <div className="text-xs text-[color:var(--muted-foreground)]">主要采购方式</div>
                    <div className="text-[11px] font-medium text-[color:var(--foreground)]">{activeSupplier.topMethod}</div>
                  </div>
                </div>
                <div className="flex items-start gap-2 rounded-[10px] border border-[rgba(96,139,239,0.12)] bg-[rgba(96,139,239,0.04)] px-3 py-2">
                  <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[rgba(96,139,239,1)]" />
                  <div>
                    <div className="text-xs text-[color:var(--muted-foreground)]">活跃部门</div>
                    <div className="text-[11px] font-medium text-[color:var(--foreground)]">{activeSupplier.topDepartment}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Procurements */}
            {activeSupplier.recentProcurements.length > 0 && (
              <div className="px-5 pb-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[rgba(96,139,239,0.85)]">
                  <FolderKanban size={12} className="text-[rgba(96,139,239,0.8)]" />
                  近期参与项目
                </div>
                <div className="mt-2 space-y-1.5">
                  {activeSupplier.recentProcurements.slice(0, 4).map((p, i) => (
                    <div key={i} className="rounded-[10px] border border-[rgba(96,139,239,0.12)] bg-[rgba(96,139,239,0.04)] px-3 py-2">
                      <div className="truncate text-[11px] font-medium text-[color:var(--foreground)]">{p.project}</div>
                      <div className="mt-0.5 flex items-center justify-between text-xs">
                        <span className="text-[color:var(--muted-foreground)]">{p.date}</span>
                        <span className="font-bold" style={{ color: p.result.includes("未") || p.result.includes("审查") ? accentMap.coral : accentMap.teal }}>{p.result}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Win Projects */}
            {activeSupplier.winProjects.length > 0 && (
              <div className="px-5 pb-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[rgba(96,139,239,0.85)]">
                  <FolderKanban size={12} className="text-[rgba(96,139,239,0.8)]" />
                  中标项目
                </div>
                <div className="mt-2 space-y-1.5">
                  {activeSupplier.winProjects.slice(0, 3).map((wp) => (
                    <div key={wp.project} className="rounded-[10px] border border-[rgba(96,139,239,0.12)] bg-[rgba(96,139,239,0.04)] px-3 py-2">
                      <div className="truncate text-[11px] font-medium text-[color:var(--foreground)]">{wp.project}</div>
                      <div className="mt-0.5 text-xs font-bold" style={{ color: accentMap.teal }}>{wp.awardAmountLabel}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Trend Chart ─────────────────────────────────────────────────────────────

type TrendDetail = {
  date: string;
  label: string;
  count: number;
  amount: number;
  projects: Array<{
    name: string;
    date: string;
    department: string;
    method: string;
    budgetLabel: string;
    awardLabel: string;
    status: string;
  }>;
};

function TrendChartPanel({
  profile,
  index,
  reducedMotion,
}: {
  profile: DashboardData;
  index: number;
  reducedMotion: boolean;
}) {
  const { initial, animate, transition } = fadeIn(index, reducedMotion, 0.05);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [activeTrend, setActiveTrend] = useState<TrendDetail | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1400);

  // Update container width on resize
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // Calculate stats
  const totalCount = profile.trendSeries.reduce((s, i) => s + i.count, 0);
  const totalAmount = profile.trendSeries.reduce((s, i) => s + i.amount, 0);
  const maxCount = Math.max(...profile.trendSeries.map(i => i.count), 1);
  const maxAmount = Math.max(...profile.trendSeries.map(i => i.amount), 1);

  // Find peak indices
  const peakCountIdx = profile.trendSeries.reduce((best, item, i, arr) =>
    item.count > arr[best].count ? i : best, 0);
  const peakAmountIdx = profile.trendSeries.reduce((best, item, i, arr) =>
    item.amount > arr[best].amount ? i : best, 0);

  // Chart dimensions - fully responsive
  const chartHeight = 220;
  const leftPadding = 50;
  const rightPadding = 50;
  const topPadding = 30;
  const bottomPadding = 50;
  const chartAreaWidth = containerWidth - leftPadding - rightPadding;
  const chartAreaHeight = chartHeight - topPadding - bottomPadding;

  // Dynamic bar width based on data count
  const dataCount = profile.trendSeries.length || 1;
  const maxBarWidth = 48;
  const minBarWidth = 16;
  const idealBarWidth = Math.min(maxBarWidth, (chartAreaWidth / dataCount) * 0.6);
  const barWidth = Math.max(minBarWidth, idealBarWidth);
  const gap = Math.max(4, Math.min(12, barWidth * 0.3));

  // Calculate bar positions - centered
  const totalBarsWidth = dataCount * (barWidth + gap) - gap;
  const startX = leftPadding + Math.max(0, (chartAreaWidth - totalBarsWidth) / 2);

  const handleBarClick = (trend: TrendDetail) => {
    setActiveTrend(trend);
  };

  return (
    <>
      <motion.div {...{ initial, animate, transition }} className="h-full">
        <Panel>
        {/* Header */}
        <div className="flex items-start justify-between px-4 pt-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-[rgba(96,139,239,0.25)] bg-[linear-gradient(145deg,rgba(238,245,255,0.96),rgba(228,238,255,0.9))] shadow-[0_4px_10px_rgba(96,139,239,0.08)]">
              <BarChart3 size={15} className="text-[rgba(96,139,239,1)]" />
            </div>
            <div>
              <h2 className="text-[0.92rem] font-semibold tracking-[-0.025em] text-[color:var(--foreground)]">采购执行趋势</h2>
              <div className="text-xs text-[color:var(--muted-foreground)]">
                按日期统计采购项目数量与成交金额
              </div>
            </div>
          </div>

          {/* Summary Stats */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 rounded-[8px] border border-[rgba(96,139,239,0.15)] bg-[rgba(96,139,239,0.04)] px-2.5 py-1">
              <div className="h-2 w-2 rounded-[3px] bg-[rgba(96,139,239,1)]" />
              <span className="text-xs font-bold text-[rgba(96,139,239,1)]">{totalCount}项</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-[8px] border border-[rgba(92,181,150,0.15)] bg-[rgba(92,181,150,0.04)] px-2.5 py-1">
              <div className="h-2 w-2 rounded-[3px] bg-[rgba(92,181,150,1)]" />
              <span className="text-xs font-bold text-[rgba(92,181,150,1)]">{totalAmount.toFixed(1)}万</span>
            </div>
          </div>
        </div>

        {/* Chart */}
        <div ref={containerRef} className="mt-2 flex flex-1 flex-col px-4 pb-4 sm:px-6">
          <div className="relative flex-1 overflow-hidden rounded-[14px] border border-[rgba(200,215,235,0.25)] bg-[linear-gradient(180deg,rgba(252,254,255,0.98),rgba(248,252,253,0.95))] shadow-[inset_0_1px_4px_rgba(255,255,255,0.8),0_2px_8px_rgba(100,130,170,0.04)]">
            <svg
              width="100%"
              height={chartHeight}
              viewBox={`0 0 ${containerWidth} ${chartHeight}`}
              preserveAspectRatio="xMidYMid meet"
              className="overflow-visible"
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <defs>
                {/* Bar gradient - refined blue */}
                <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(96,139,239,1)" />
                  <stop offset="100%" stopColor="rgba(126,169,249,0.8)" />
                </linearGradient>
                {/* Line gradient - refined teal */}
                <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="rgba(92,181,150,1)" />
                  <stop offset="100%" stopColor="rgba(112,201,170,1)" />
                </linearGradient>
                {/* Area gradient */}
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(92,181,150,0.2)" />
                  <stop offset="100%" stopColor="rgba(92,181,150,0.02)" />
                </linearGradient>
                {/* Glow filters */}
                <filter id="barGlow" x="-30%" y="-10%" width="160%" height="120%">
                  <feGaussianBlur stdDeviation="2" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
                <filter id="dotGlow" x="-100%" y="-100%" width="300%" height="300%">
                  <feGaussianBlur stdDeviation="2" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Grid lines - subtle */}
              {[0, 0.5, 1].map((t, i) => {
                const y = topPadding + (1 - t) * chartAreaHeight;
                return (
                  <line
                    key={i}
                    x1={leftPadding}
                    y1={y}
                    x2={containerWidth - rightPadding}
                    y2={y}
                    stroke="rgba(200,215,235,0.25)"
                    strokeWidth="1"
                    strokeDasharray={t === 0 ? "none" : "4 3"}
                  />
                );
              })}

              {/* Y-axis labels - left (count) */}
              {[0, 0.5, 1].map((t, i) => {
                const y = topPadding + (1 - t) * chartAreaHeight;
                const value = Math.round(t * maxCount);
                return (
                  <text
                    key={`count-${i}`}
                    x={leftPadding - 6}
                    y={y + 3}
                    textAnchor="end"
                    style={{ fontSize: "9px", fill: "rgba(96,139,239,0.6)", fontWeight: "500" }}
                  >
                    {value}
                  </text>
                );
              })}

              {/* Y-axis labels - right (amount) */}
              {[0, 0.5, 1].map((t, i) => {
                const y = topPadding + (1 - t) * chartAreaHeight;
                const value = (t * maxAmount).toFixed(0);
                return (
                  <text
                    key={`amount-${i}`}
                    x={containerWidth - rightPadding + 6}
                    y={y + 3}
                    textAnchor="start"
                    style={{ fontSize: "9px", fill: "rgba(92,181,150,0.6)", fontWeight: "500" }}
                  >
                    {value}万
                  </text>
                );
              })}

              {/* Bars */}
              {profile.trendSeries.map((item, i) => {
                const barHeight = Math.max(2, (item.count / maxCount) * chartAreaHeight);
                const x = startX + i * (barWidth + gap);
                const y = topPadding + chartAreaHeight - barHeight;
                const isHovered = hoveredIndex === i;
                const isPeak = i === peakCountIdx;

                return (
                  <g key={`bar-${i}`}>
                    {/* Bar */}
                    <rect
                      x={x}
                      y={y}
                      width={barWidth}
                      height={barHeight}
                      rx={4}
                      fill={isPeak ? "url(#barGrad)" : "rgba(96,139,239,0.5)"}
                      opacity={isHovered ? 1 : 0.85}
                      filter={isPeak || isHovered ? "url(#barGlow)" : undefined}
                      className="cursor-pointer transition-all duration-200"
                      onMouseEnter={() => setHoveredIndex(i)}
                      onClick={() => handleBarClick(item as TrendDetail)}
                    />
                    {/* X-axis label */}
                    <text
                      x={x + barWidth / 2}
                      y={chartHeight - bottomPadding + 14}
                      textAnchor="middle"
                      style={{ fontSize: "9px", fill: "rgba(100,120,150,0.6)", fontWeight: "500" }}
                    >
                      {item.label}
                    </text>
                  </g>
                );
              })}

              {/* Amount line path */}
              {(() => {
                const points = profile.trendSeries.map((item, i) => {
                  const x = startX + i * (barWidth + gap) + barWidth / 2;
                  const y = topPadding + (1 - item.amount / maxAmount) * chartAreaHeight;
                  return { x, y };
                });

                if (points.length === 0) return null;

                // Build smooth path
                const pathD = points.map((p, i) => {
                  if (i === 0) return `M ${p.x} ${p.y}`;
                  const prev = points[i - 1];
                  const cp1x = prev.x + (p.x - prev.x) * 0.4;
                  const cp1y = prev.y;
                  const cp2x = p.x - (p.x - prev.x) * 0.4;
                  const cp2y = p.y;
                  return `C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p.x} ${p.y}`;
                }).join(" ");

                // Area path
                const areaD = `${pathD} L ${points[points.length - 1].x} ${topPadding + chartAreaHeight} L ${points[0].x} ${topPadding + chartAreaHeight} Z`;

                return (
                  <>
                    {/* Area fill */}
                    <path
                      d={areaD}
                      fill="url(#areaGrad)"
                    />
                    {/* Line */}
                    <path
                      d={pathD}
                      fill="none"
                      stroke="url(#lineGrad)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {/* Data points */}
                    {points.map((p, i) => {
                      const isPeak = i === peakAmountIdx;
                      const isHovered = hoveredIndex === i;
                      return (
                        <circle
                          key={`dot-${i}`}
                          cx={p.x}
                          cy={p.y}
                          r={isPeak ? 5 : isHovered ? 4 : 3}
                          fill="rgba(92,181,150,1)"
                          stroke="rgba(255,255,255,0.95)"
                          strokeWidth="2"
                          filter={isPeak || isHovered ? "url(#dotGlow)" : undefined}
                          className="cursor-pointer"
                          onMouseEnter={() => setHoveredIndex(i)}
                          onClick={() => handleBarClick(profile.trendSeries[i] as TrendDetail)}
                        />
                      );
                    })}
                  </>
                );
              })()}

              {/* Tooltip */}
              {hoveredIndex !== null && profile.trendSeries[hoveredIndex] && (
                <g>
                  {/* Vertical guide line */}
                  <line
                    x1={startX + hoveredIndex * (barWidth + gap) + barWidth / 2}
                    y1={topPadding}
                    x2={startX + hoveredIndex * (barWidth + gap) + barWidth / 2}
                    y2={topPadding + chartAreaHeight}
                    stroke="rgba(96,139,239,0.2)"
                    strokeWidth="1"
                    strokeDasharray="3 2"
                  />
                  {/* Tooltip background */}
                  <rect
                    x={startX + hoveredIndex * (barWidth + gap) + barWidth / 2 - 45}
                    y={topPadding - 5}
                    width="90"
                    height="40"
                    rx="8"
                    fill="rgba(255,255,255,0.95)"
                    stroke="rgba(200,215,235,0.4)"
                    strokeWidth="1"
                    filter="url(#dotGlow)"
                  />
                  {/* Tooltip content */}
                  <text
                    x={startX + hoveredIndex * (barWidth + gap) + barWidth / 2}
                    y={topPadding + 10}
                    textAnchor="middle"
                    style={{ fontSize: "10px", fill: "rgba(96,139,239,1)", fontWeight: "700" }}
                  >
                    {profile.trendSeries[hoveredIndex].count}项
                  </text>
                  <text
                    x={startX + hoveredIndex * (barWidth + gap) + barWidth / 2}
                    y={topPadding + 24}
                    textAnchor="middle"
                    style={{ fontSize: "9px", fill: "rgba(92,181,150,1)", fontWeight: "600" }}
                  >
                    {profile.trendSeries[hoveredIndex].amount.toFixed(1)}万
                  </text>
                </g>
              )}
            </svg>

            {/* Legend */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <div className="h-2.5 w-2.5 rounded-[3px] bg-[rgba(96,139,239,1)]" />
                <span className="text-xs text-[color:var(--muted-foreground)]">采购数量</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-0.5 w-4 rounded-full bg-[rgba(92,181,150,1)]" />
                <span className="text-xs text-[color:var(--muted-foreground)]">成交金额</span>
              </div>
            </div>
          </div>
        </div>
      </Panel>
    </motion.div>

    {/* Trend Detail Modal */}
    {activeTrend && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
        onClick={() => setActiveTrend(null)}
      >
        <div
          className="relative max-w-[min(520px,90vw)] w-full max-h-[80vh] overflow-y-auto rounded-[24px] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,252,255,0.95))] shadow-[0_24px_80px_rgba(62,92,150,0.28)]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="sticky top-0 bg-[linear-gradient(180deg,rgba(255,255,255,1),rgba(255,255,255,0.95))] px-5 pt-5 pb-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-[rgba(96,139,239,0.25)] bg-[rgba(96,139,239,0.12)]">
                  <CalendarRange size={20} className="text-[rgba(96,139,239,1)]" />
                </div>
                <div>
                  <div className="text-base font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">{activeTrend.label}</div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="text-[11px] font-bold text-[rgba(96,139,239,1)]">{activeTrend.count} 项</span>
                    <span className="text-xs text-[color:var(--muted-foreground)]">成交金额 {activeTrend.amount.toFixed(1)}万</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setActiveTrend(null)}
                className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-[rgba(96,139,239,0.15)] bg-[rgba(96,139,239,0.06)] text-[rgba(96,139,239,0.7)] transition-all duration-200 hover:bg-[rgba(96,139,239,0.12)] hover:text-[rgba(96,139,239,1)]"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Projects List */}
          <div className="px-5 pb-5">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[rgba(96,139,239,0.85)]">
              <FolderKanban size={12} className="text-[rgba(96,139,239,0.8)]" />
              当日项目
            </div>
            <div className="mt-2 space-y-1.5">
              {(activeTrend.projects ?? []).map((project, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 rounded-[10px] border border-white/50 bg-white/40 px-3 py-2 transition-all duration-200 hover:bg-white/60"
                >
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-[11px] font-medium text-[color:var(--foreground)]">{project.name}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
                      <span>{project.department}</span>
                      <span>·</span>
                      <span>{project.method}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-bold text-[color:var(--foreground)]">{project.awardLabel || project.budgetLabel}</div>
                    <div className={["text-xs", project.status === '已成交' ? "text-[rgba(92,181,150,1)]" : project.status === '待定' ? "text-[rgba(234,188,110,1)]" : "text-[rgba(230,129,102,1)]"].join(" ")}>
                      {project.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )}
  </>
  );
}

// ─── Department Performance ───────────────────────────────────────────────────

type DepartmentDetail = {
  name: string;
  amount: number;
  amountLabel: string;
  completedRate: number;
  topMethod: string;
  projects: Array<{
    name: string;
    date: string;
    method: string;
    budgetLabel: string;
    awardLabel: string;
    status: string;
  }>;
};

function DepartmentPanel({
  profile,
  index,
  reducedMotion,
}: {
  profile: DashboardData;
  index: number;
  reducedMotion: boolean;
}) {
  const { initial, animate, transition } = fadeIn(index, reducedMotion, 0.05);
  const maxAmount = Math.max(...profile.departmentStats.map((d) => d.amount), 1);
  const totalAmount = profile.departmentStats.reduce((s, d) => s + d.amount, 0);
  const [activeDept, setActiveDept] = useState<DepartmentDetail | null>(null);

  return (
    <>
      <motion.div {...{ initial, animate, transition }} className="h-full">
        <Panel>
          <SectionHeader title="各部门采购分布" variant="default" />
          <div className="mt-3 flex flex-1 flex-col space-y-2 overflow-y-auto px-4 pb-4">
            {profile.departmentStats.slice(0, 6).map((dept, i) => {
              const pct = (dept.amount / maxAmount) * 100;
              const share = (dept.amount / totalAmount) * 100;
              const barColor = i === 0 ? accentMap.blue : i === 1 ? accentMap.teal : i === 2 ? accentMap.gold : "rgba(119,129,219,0.8)";
              return (
                <button
                  key={dept.name}
                  onClick={() => setActiveDept(dept as DepartmentDetail)}
                  className="group dept-bar-animated w-full text-left transition-all duration-200 hover:translate-y-[-1px]"
                  style={{ animationDelay: `${0.1 + i * 0.1}s` }}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="dept-rank-badge flex h-4 w-4 items-center justify-center rounded-[4px] border border-white/50 bg-white/60 text-[10px] font-bold text-[color:var(--muted-foreground)]">
                        {i + 1}
                      </span>
                      <span className="text-[11px] font-medium text-[color:var(--foreground)] transition-colors duration-200 group-hover:font-semibold group-hover:text-[rgba(96,139,239,1)]">{dept.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="badge-color-cycle text-xs text-[color:var(--muted-foreground)]">{share.toFixed(0)}%</span>
                      <span className="number-pop-in text-[11px] font-bold text-[color:var(--foreground)]" style={{ animationDelay: `${0.2 + i * 0.1}s` }}>{dept.amountLabel}</span>
                    </div>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[rgba(226,232,246,0.5)] transition-all duration-200 group-hover:h-2">
                    <div
                      className="progress-glow-bar h-full rounded-full transition-all duration-700 group-hover:brightness-110"
                      style={{ width: `${pct}%`, backgroundColor: barColor }}
                    />
                  </div>
                  <div className="mt-0.5 flex items-center justify-between">
                    <span className="text-xs text-[color:var(--muted-foreground)]">完成率 {dept.completedRate}%</span>
                    <div className={["floating-indicator h-1 w-1 rounded-full transition-all duration-200", dept.completedRate >= 80 ? "bg-[rgba(92,181,150,1)]" : dept.completedRate >= 60 ? "bg-[rgba(234,188,110,1)]" : "bg-[rgba(230,129,102,1)]"].join(" ")} />
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>
      </motion.div>

      {/* Department Detail Modal */}
      {activeDept && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
          onClick={() => setActiveDept(null)}
        >
          <div
            className="relative max-w-[min(480px,90vw)] w-full max-h-[80vh] overflow-y-auto rounded-[24px] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,252,255,0.95))] shadow-[0_24px_80px_rgba(62,92,150,0.28)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="sticky top-0 bg-[linear-gradient(180deg,rgba(255,255,255,1),rgba(255,255,255,0.95))] px-5 pt-5 pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-[rgba(96,139,239,0.25)] bg-[rgba(96,139,239,0.12)]">
                    <FolderKanban size={20} className="text-[rgba(96,139,239,1)]" />
                  </div>
                  <div>
                    <div className="text-base font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">{activeDept.name}</div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="text-[11px] font-bold text-[rgba(96,139,239,1)]">{activeDept.amountLabel}</span>
                      <span className="text-xs text-[color:var(--muted-foreground)]">采购金额</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setActiveDept(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-[rgba(96,139,239,0.15)] bg-[rgba(96,139,239,0.06)] text-[rgba(96,139,239,0.7)] transition-all duration-200 hover:bg-[rgba(96,139,239,0.12)] hover:text-[rgba(96,139,239,1)]"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Stats */}
            <div className="px-5 pb-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div className="rounded-[12px] border border-[rgba(96,139,239,0.12)] bg-[rgba(96,139,239,0.04)] px-3 py-2 text-center">
                  <div className="text-xs uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">完成率</div>
                  <div className="mt-1 text-[14px] font-bold text-[rgba(96,139,239,1)]">{activeDept.completedRate}%</div>
                </div>
                <div className="rounded-[12px] border border-[rgba(92,181,150,0.12)] bg-[rgba(92,181,150,0.04)] px-3 py-2 text-center">
                  <div className="text-xs uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">项目数</div>
                  <div className="mt-1 text-[14px] font-bold text-[rgba(92,181,150,1)]">{(activeDept.projects ?? []).length}</div>
                </div>
                <div className="rounded-[12px] border border-[rgba(234,188,110,0.12)] bg-[rgba(234,188,110,0.04)] px-3 py-2 text-center">
                  <div className="text-xs uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">主要方式</div>
                  <div className="mt-1 text-xs font-bold text-[rgba(234,188,110,1)]">{activeDept.topMethod ?? '-'}</div>
                </div>
              </div>
            </div>

            {/* Projects List */}
            <div className="px-5 pb-5">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[rgba(96,139,239,0.85)]">
                <BarChart3 size={12} className="text-[rgba(96,139,239,0.8)]" />
                采购项目
              </div>
              <div className="mt-2 space-y-1.5">
                {(activeDept.projects ?? []).map((project, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-3 rounded-[10px] border border-white/50 bg-white/40 px-3 py-2 transition-all duration-200 hover:bg-white/60"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-[11px] font-medium text-[color:var(--foreground)]">{project.name}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
                        <span>{project.date}</span>
                        <span>·</span>
                        <span>{project.method}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-bold text-[color:var(--foreground)]">{project.awardLabel || project.budgetLabel}</div>
                      <div className={["text-xs", project.status === '已成交' ? "text-[rgba(92,181,150,1)]" : project.status === '待定' ? "text-[rgba(234,188,110,1)]" : "text-[rgba(230,129,102,1)]"].join(" ")}>
                        {project.status}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

type DashboardHomeProps = {
  currentUserRole: AuthRole;
};

const ANALYSIS_CACHE_KEY = "dashboard_analysis_cache";

type AnalysisCache = {
  dataHash: string;
  result: DashboardAnalysisResult;
  timestamp: number;
};

// 生成数据的简化哈希（基于关键字段）
function generateDataHash(data: DashboardData): string {
  const keyData = {
    totalBudget: data.summary.totalBudget,
    totalAward: data.summary.totalAward,
    totalSavings: data.summary.totalSavings,
    totalCount: data.summary.totalCount,
    completedCount: data.summary.completedCount,
    startDate: data.range.startDate,
    endDate: data.range.endDate,
  };
  return JSON.stringify(keyData);
}

export function DashboardHome({ currentUserRole }: DashboardHomeProps) {
  const reducedMotion = useReducedMotion() ?? false;

  // 数据状态
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // AI 分析相关状态
  const [analysis, setAnalysis] = useState<DashboardAnalysisResult | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [dataHash, setDataHash] = useState<string | null>(null);

  // P1-E：AI 评分校准
  const [calibration, setCalibration] = useState<AiCalibration | null>(null);
  useEffect(() => {
    fetchAiCalibration().then(setCalibration).catch(() => {});
  }, []);

  // 日期范围选择状态
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  // 将 dashboardData 转换为 AI 分析 payload
  const buildAnalysisPayload = useCallback(
    (data: DashboardData): DashboardAnalysisPayload => ({
      rangeLabel: data.range.startDate && data.range.endDate
        ? `${data.range.startDate} ~ ${data.range.endDate}`
        : "全部",
      startDate: data.range.startDate ?? "",
      endDate: data.range.endDate ?? "",
      summary: {
        totalCount: data.summary.totalCount,
        completedCount: data.summary.completedCount,
        abnormalCount: data.summary.abnormalCount,
        totalBudget: data.summary.totalBudgetLabel,
        totalAward: data.summary.totalAwardLabel,
        totalSavings: data.summary.totalSavingsLabel,
      },
      trendSeries: data.trendSeries.map((t) => ({
        label: t.label,
        count: t.count,
        amount: t.amount,
      })),
      departmentStats: data.departmentStats.map((d) => ({
        name: d.name,
        amount: d.amountLabel,
      })),
      methodStats: data.methodStats.map((m) => ({
        name: m.name,
        share: `${m.share}%`,
      })),
      attachmentProgress: data.attachmentProgress.map((a) => ({
        label: a.label,
        rate: `${a.rate}%`,
      })),
      supplierStats: data.supplierStats.map((s) => ({
        name: s.name,
        participatedCount: s.participatedCount,
        winCount: s.winCount,
        awardAmount: s.awardAmountLabel,
      })),
      resultStats: data.resultStats.map((r) => ({
        label: r.label,
        count: r.count,
        amount: r.amountLabel,
      })),
      nonAwardReasons: data.nonAwardReasons.map((n) => ({
        label: n.label,
        count: n.count,
        detail: n.detail,
      })),
      riskProjects: data.riskProjects.map((r) => ({
        project: r.project,
        department: r.department,
        reason: r.reason,
        pendingDays: r.pendingDays,
        severity: r.severity,
      })),
    }),
    [],
  );

  const handleRefreshAnalysis = useCallback(async (forceRefresh = false) => {
    if (!dashboardData) return;

    const newHash = generateDataHash(dashboardData);

    // 如果不是强制刷新，先检查缓存
    if (!forceRefresh) {
      try {
        const cached = localStorage.getItem(ANALYSIS_CACHE_KEY);
        if (cached) {
          const cache: AnalysisCache = JSON.parse(cached);
          const valid = cache.dataHash === newHash && cache.result
            && Array.isArray(cache.result.highlights)
            && Array.isArray(cache.result.concerns)
            && Array.isArray(cache.result.suggestions);
          if (valid) {
            setAnalysis(cache.result);
            setDataHash(newHash);
            return;
          }
          // 缓存格式不对，清除
          localStorage.removeItem(ANALYSIS_CACHE_KEY);
        }
      } catch {
        // 缓存解析失败，继续请求新分析
      }
    }

    setAnalysis(null);
    setAnalysisError(null);
    setAnalysisLoading(true);
    try {
      const payload = buildAnalysisPayload(dashboardData);
      const result = await fetchDashboardAnalysis(payload);
      setAnalysis(result);
      setDataHash(newHash);
      // 缓存结果
      try {
        const cache: AnalysisCache = {
          dataHash: newHash,
          result,
          timestamp: Date.now(),
        };
        localStorage.setItem(ANALYSIS_CACHE_KEY, JSON.stringify(cache));
      } catch {
        // 缓存写入失败，忽略
      }
    } catch (err) {
      setAnalysisError(
        err instanceof Error ? err.message : "分析请求失败，请稍后重试",
      );
    } finally {
      setAnalysisLoading(false);
    }
  }, [dashboardData, buildAnalysisPayload]);

  // Map supplier stats to display format - 必须在条件返回之前调用
  const displaySuppliers: SupplierDetail[] = useMemo(() => {
    if (!dashboardData) return [];
    return dashboardData.supplierStats.map((stat) => ({
      ...stat,
      id: stat.name,
    }));
  }, [dashboardData]);

  // 加载仪表盘数据
  const loadData = useCallback(async (start?: string, end?: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchDashboardData(start, end);
      setDashboardData(data);
      // 重置分析缓存
      setAnalysis(null);
      setDataHash(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "加载仪表盘数据失败",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始加载
  useEffect(() => {
    loadData();
  }, [loadData]);

  // 应用日期范围
  const handleApplyDateRange = useCallback(() => {
    const start = startDate || undefined;
    const end = endDate || undefined;
    loadData(start, end);
    setShowDatePicker(false);
  }, [startDate, endDate, loadData]);

  // 重置日期范围
  const handleResetDateRange = useCallback(() => {
    setStartDate("");
    setEndDate("");
    loadData();
    setShowDatePicker(false);
  }, [loadData]);

  // 快捷选择：本月
  const selectThisMonth = useCallback(() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const lastDay = new Date(year, month, 0).getDate();
    setStartDate(`${year}-${String(month).padStart(2, "0")}-01`);
    setEndDate(`${year}-${String(month).padStart(2, "0")}-${lastDay}`);
  }, []);

  // 快捷选择：本季度
  const selectThisQuarter = useCallback(() => {
    const d = new Date();
    const year = d.getFullYear();
    const q = Math.floor(d.getMonth() / 3);
    const startMonth = q * 3 + 1;
    const endMonth = q * 3 + 3;
    const lastDay = new Date(year, endMonth, 0).getDate();
    setStartDate(`${year}-${String(startMonth).padStart(2, "0")}-01`);
    setEndDate(`${year}-${String(endMonth).padStart(2, "0")}-${lastDay}`);
  }, []);

  // 快捷选择：上半年
  const selectFirstHalfYear = useCallback(() => {
    const y = new Date().getFullYear();
    setStartDate(`${y}-01-01`);
    setEndDate(`${y}-06-30`);
  }, []);

  // 快捷选择：全年
  const selectFullYear = useCallback(() => {
    const y = new Date().getFullYear();
    setStartDate(`${y}-01-01`);
    setEndDate(`${y}-12-31`);
  }, []);

  // 快捷选择：上月
  const selectLastMonth = useCallback(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const lastDay = new Date(year, month, 0).getDate();
    setStartDate(`${year}-${String(month).padStart(2, "0")}-01`);
    setEndDate(`${year}-${String(month).padStart(2, "0")}-${lastDay}`);
  }, []);

  // 快捷选择：上季度
  const selectLastQuarter = useCallback(() => {
    const d = new Date();
    const year = d.getFullYear();
    const q = Math.floor(d.getMonth() / 3);
    if (q === 0) {
      setStartDate(`${year - 1}-10-01`);
      setEndDate(`${year - 1}-12-31`);
    } else {
      const startMonth = (q - 1) * 3 + 1;
      const endMonth = q * 3;
      const lastDay = new Date(year, endMonth, 0).getDate();
      setStartDate(`${year}-${String(startMonth).padStart(2, "0")}-01`);
      setEndDate(`${year}-${String(endMonth).padStart(2, "0")}-${lastDay}`);
    }
  }, []);

  // 当数据加载完成后，自动触发 AI 分析（有缓存则使用缓存）
  useEffect(() => {
    if (dashboardData && !analysis && !analysisLoading) {
      handleRefreshAnalysis(false);
    }
  }, [dashboardData, analysis, analysisLoading, handleRefreshAnalysis]);

  if (loading || !dashboardData) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[rgba(96,139,239,0.3)] border-t-[rgba(96,139,239,1)]" />
          <span className="text-sm text-[color:var(--muted-foreground)]">加载中...</span>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-4 rounded-[24px] border border-red-200 bg-red-50 px-8 py-10 text-center">
          <p className="text-sm font-semibold text-red-600">数据加载失败</p>
          <p className="text-xs text-[color:var(--muted-foreground)]">{loadError}</p>
          <button
            type="button"
            onClick={() => { setLoadError(null); setLoading(true); }}
            className="neu-btn-primary"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  const completionRate = (dashboardData.summary.completedCount / Math.max(dashboardData.summary.totalCount, 1)) * 100;
  const bidOpeningCount = Math.max(dashboardData.summary.totalCount - dashboardData.summary.completedCount, 0);
  const savingsRate = (dashboardData.summary.totalSavings / Math.max(dashboardData.summary.awardedBudget, 1)) * 100;

  const { initial: cmdInitial, animate: cmdAnimate, transition: cmdTransition } = fadeIn(0, reducedMotion, 0.04);

  return (
    <>
    <motion.div
      animate={reducedMotion ? undefined : { opacity: 1 }}
      transition={{ duration: 0.28, ease: easeOutQuint }}
    >
        {/* ── Header Section with Component Frame ── */}
        <motion.div {...{ initial: cmdInitial, animate: cmdAnimate, transition: cmdTransition }} className="mb-3">
            <div className="flex items-center justify-between gap-3 mb-3 pb-3 border-b border-[rgba(184,199,227,0.4)]">
              <div className="flex items-center gap-3">
                <BarChart3 size={20} className="text-[var(--accent)]" />
                <div>
                  <h1 className="text-lg font-black tracking-[-0.02em] text-[var(--foreground)]">采购中心仪表盘</h1>
                </div>
              </div>

              {/* Date Range Selector */}
              <div className="relative">
                <button
                  onClick={() => setShowDatePicker(!showDatePicker)}
                  className="flex items-center gap-1.5 rounded-full border border-[rgba(92,181,150,0.3)] bg-[rgba(92,181,150,0.08)] px-2.5 py-1 text-[10px] font-medium text-[rgba(70,155,120,1)] transition-all duration-200 hover:border-[rgba(92,181,150,0.5)] hover:bg-[rgba(92,181,150,0.12)]"
                >
                  <CalendarRange size={10} />
                  {dashboardData.range.startDate ?? "起始"} ~ {dashboardData.range.endDate ?? "至今"}
                </button>

                {/* Dropdown Panel */}
                {showDatePicker && (
                  <div className="absolute right-0 top-full mt-2 z-50 w-[280px] rounded-[14px] border border-[rgba(200,215,235,0.4)] bg-white shadow-[0_12px_40px_rgba(62,92,150,0.18)]">
                    {/* Quick Options */}
                    <div className="p-3 border-b border-[rgba(200,215,235,0.3)]">
                      <div className="text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)] mb-2">快捷选择</div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <button onClick={selectThisMonth} className="rounded-[6px] border border-[rgba(92,181,150,0.2)] bg-[rgba(92,181,150,0.04)] px-2 py-1 text-[10px] text-[rgba(92,181,150,1)] hover:bg-[rgba(92,181,150,0.1)]">本月</button>
                        <button onClick={selectThisQuarter} className="rounded-[6px] border border-[rgba(92,181,150,0.2)] bg-[rgba(92,181,150,0.04)] px-2 py-1 text-[10px] text-[rgba(92,181,150,1)] hover:bg-[rgba(92,181,150,0.1)]">本季度</button>
                        <button onClick={selectFirstHalfYear} className="rounded-[6px] border border-[rgba(92,181,150,0.2)] bg-[rgba(92,181,150,0.04)] px-2 py-1 text-[10px] text-[rgba(92,181,150,1)] hover:bg-[rgba(92,181,150,0.1)]">上半年</button>
                        <button onClick={selectFullYear} className="rounded-[6px] border border-[rgba(92,181,150,0.2)] bg-[rgba(92,181,150,0.04)] px-2 py-1 text-[10px] text-[rgba(92,181,150,1)] hover:bg-[rgba(92,181,150,0.1)]">全年</button>
                        <button onClick={selectLastMonth} className="rounded-[6px] border border-[rgba(96,139,239,0.2)] bg-[rgba(96,139,239,0.04)] px-2 py-1 text-[10px] text-[rgba(96,139,239,1)] hover:bg-[rgba(96,139,239,0.1)]">上月</button>
                        <button onClick={selectLastQuarter} className="rounded-[6px] border border-[rgba(96,139,239,0.2)] bg-[rgba(96,139,239,0.04)] px-2 py-1 text-[10px] text-[rgba(96,139,239,1)] hover:bg-[rgba(96,139,239,0.1)]">上季度</button>
                      </div>
                    </div>

                    {/* Custom Date Inputs */}
                    <div className="p-3 border-b border-[rgba(200,215,235,0.3)]">
                      <div className="text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)] mb-2">自定义范围</div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-[color:var(--muted-foreground)] mb-1 block">起始</label>
                          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-[6px] border border-[rgba(200,215,235,0.4)] bg-[rgba(248,252,255,0.8)] px-2 py-1 text-[10px] focus:border-[rgba(92,181,150,0.5)] focus:outline-none" />
                        </div>
                        <div>
                          <label className="text-xs text-[color:var(--muted-foreground)] mb-1 block">结束</label>
                          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full rounded-[6px] border border-[rgba(200,215,235,0.4)] bg-[rgba(248,252,255,0.8)] px-2 py-1 text-[10px] focus:border-[rgba(92,181,150,0.5)] focus:outline-none" />
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="p-3 flex items-center justify-between">
                      <button onClick={handleResetDateRange} className="rounded-[6px] border border-[rgba(200,215,235,0.4)] bg-white px-3 py-1 text-[10px] text-[color:var(--muted-foreground)] hover:bg-[rgba(200,215,235,0.1)]">重置</button>
                      <button onClick={handleApplyDateRange} className="rounded-[6px] border border-[rgba(92,181,150,0.3)] bg-[rgba(92,181,150,0.12)] px-3 py-1 text-[10px] font-medium text-[rgba(92,181,150,1)] hover:bg-[rgba(92,181,150,0.2)]">应用</button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* P1-E：AI 评分校准（采纳率 + 维度偏差条 + top 偏差项） */}
            {calibration && (
              <div className="mb-3 rounded-[14px] border border-[rgba(234,188,110,0.3)] bg-[linear-gradient(160deg,rgba(255,252,244,0.97),rgba(252,248,240,0.93))] p-4 shadow-[0_8px_24px_rgba(200,155,80,0.06)]">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-[var(--foreground)]">AI 评分校准</span>
                    <span className="text-[9px] text-[color:var(--muted-foreground)]">· 专家 vs AI 建议分差异</span>
                  </div>
                  <span className="text-[10px] text-[color:var(--muted-foreground)]">{calibration.overall.total} 项已确认</span>
                </div>

                <div className="flex items-stretch gap-5 mb-3">
                  {/* 总体采纳率 */}
                  <div className="flex flex-col justify-center min-w-[90px]">
                    <span className="text-3xl font-black tabular-nums text-[var(--foreground)] leading-none">{Math.round(calibration.overall.adoptionRate * 100)}<span className="text-base">%</span></span>
                    <span className="text-[10px] text-[color:var(--muted-foreground)] mt-1">建议采纳率</span>
                  </div>

                  {/* 按维度偏差条（双向 bar，正=AI 偏高 红，负=AI 偏低 蓝） */}
                  <div className="w-48 flex flex-col gap-1.5">
                    {(() => {
                      const maxAbs = Math.max(...calibration.byCategory.map((x) => Math.abs(x.avgDelta)), 1);
                      return calibration.byCategory.map((c) => {
                        const widthPct = Math.min((Math.abs(c.avgDelta) / maxAbs) * 50, 50);
                        const isPos = c.avgDelta > 0;
                        return (
                          <div key={c.category} className="flex items-center gap-2">
                            <span className="w-14 text-[10px] text-[color:var(--muted-foreground)] shrink-0">{({ BUSINESS: '商务', TECHNICAL: '技术', PRICE: '价格', QUALIFICATION: '资格', RESPONSIVE: '响应' } as Record<string, string>)[c.category] ?? c.category}</span>
                            <div className="flex-1 h-3.5 rounded-[3px] bg-[rgba(200,210,230,0.12)] relative overflow-hidden">
                              <div className="absolute top-0 bottom-0 left-1/2 w-px bg-[rgba(120,130,150,0.3)]" />
                              <div
                                className="absolute top-0 bottom-0 rounded-[3px] transition-all duration-500"
                                style={{
                                  width: `${widthPct}%`,
                                  left: isPos ? '50%' : `${50 - widthPct}%`,
                                  background: isPos ? 'linear-gradient(90deg,rgba(200,100,100,0.5),rgba(200,80,80,0.85))' : 'linear-gradient(270deg,rgba(90,130,200,0.5),rgba(80,120,190,0.85))',
                                }}
                              />
                            </div>
                            <span className={`w-9 text-[10px] font-bold tabular-nums text-right ${isPos ? 'text-[rgba(200,80,80,1)]' : c.avgDelta < 0 ? 'text-[rgba(80,130,200,1)]' : 'text-[color:var(--muted-foreground)]'}`}>
                              {isPos ? '+' : ''}{c.avgDelta}
                            </span>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>

                {/* 偏差最大的评分项 */}
                {calibration.topDeviations.length > 0 && (
                  <div className="border-t border-[rgba(234,188,110,0.2)] pt-2">
                    <div className="text-[9px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)] mb-1.5">偏差最大的评分项</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      {calibration.topDeviations.slice(0, 4).map((d) => (
                        <div key={d.scoreItemId} className="flex items-center justify-between text-[10px]">
                          <span className="text-[color:var(--foreground)] truncate">{d.name}</span>
                          <span className={`font-bold tabular-nums ml-2 shrink-0 ${d.avgDelta > 0 ? 'text-[rgba(200,80,80,1)]' : 'text-[rgba(80,130,200,1)]'}`}>
                            {d.avgDelta > 0 ? '+' : ''}{d.avgDelta}
                            <span className="text-[color:var(--muted-foreground)] font-normal ml-0.5">({d.count})</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── KPI Cards Grid ── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-8 items-stretch gap-x-3 gap-y-1.5">
              {/* Group 1: 预算概览 (1-4) */}
              <KpiCard
                label="预算总金额"
                value={dashboardData.summary.totalBudgetLabel}
                signal="normal"
                index={1}
                reducedMotion={reducedMotion}
                accent={accentMap.blue}
              />
              <KpiCard
                label="未成交预算"
                value={dashboardData.summary.pendingBudgetLabel}
                signal={dashboardData.summary.pendingBudget > 0 ? "warning" : "normal"}
                index={2}
                reducedMotion={reducedMotion}
                accent={accentMap.coral}
              />
              <KpiCard
                label="已成交预算"
                value={dashboardData.summary.awardedBudgetLabel}
                signal="success"
                index={3}
                reducedMotion={reducedMotion}
                accent={accentMap.teal}
              />
              <KpiCard
                label="合同金额"
                value={dashboardData.summary.totalAwardLabel}
                signal="normal"
                index={4}
                reducedMotion={reducedMotion}
                accent={accentMap.indigo}
                showDivider="right"
              />

              {/* Group 2: 节资成效 (5-6) */}
              <KpiCard
                label="节约资金"
                value={dashboardData.summary.totalSavingsLabel}
                signal={dashboardData.summary.totalSavings > 0 ? "success" : "normal"}
                index={5}
                reducedMotion={reducedMotion}
                accent={accentMap.gold}
              />
              <KpiCard
                label="节资率"
                value={`${savingsRate.toFixed(1)}%`}
                signal={savingsRate > 5 ? "success" : "warning"}
                index={6}
                reducedMotion={reducedMotion}
                accent={accentMap.gold}
                showDivider="right"
              />

              {/* Group 3: 项目进度 (7-8) */}
              <KpiCard
                label="开评标项目"
                value={`${dashboardData.summary.completedCount}/${dashboardData.summary.totalCount}`}
                signal={bidOpeningCount > 0 ? "warning" : "success"}
                index={7}
                reducedMotion={reducedMotion}
                accent={accentMap.coral}
              />
              <KpiCard
                label="项目推进率"
                value={`${completionRate.toFixed(0)}%`}
                signal={completionRate >= 70 ? "success" : completionRate >= 50 ? "warning" : "danger"}
                index={8}
                reducedMotion={reducedMotion}
                accent={accentMap.blue}
              />
            </div>
        </motion.div>

        {/* ── Row 2: AI Intelligence (wider) + Savings + Risk (equal width) ── */}
        <div className="mb-3 grid grid-cols-1 items-stretch gap-2 md:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]">
          <div className="flex h-full flex-col min-h-[280px] md:min-h-[300px]">
            <IntelligencePanel
              analysis={analysis}
              loading={analysisLoading}
              error={analysisError}
              onRefresh={() => handleRefreshAnalysis(true)}
              index={7}
              reducedMotion={reducedMotion}
            />
          </div>
          <div className="flex h-full flex-col min-h-[280px] md:min-h-[300px]">
            <SavingsRankingPanel
              items={dashboardData.savingsRanking as SavingsRankingItem[]}
              index={8}
              reducedMotion={reducedMotion}
            />
          </div>
          <div className="flex h-full flex-col min-h-[280px] md:min-h-[300px] md:col-span-2 lg:col-span-1">
            <RiskProjectsPanel profile={dashboardData} index={9} reducedMotion={reducedMotion} />
          </div>
        </div>

        {/* ── Row 3: Supplier + Department ── */}
        <div className="mb-3 grid grid-cols-1 items-stretch gap-2 md:grid-cols-2 lg:grid-cols-[1fr_1fr]">
          <div className="h-full min-h-[240px]">
            <SupplierCards suppliers={displaySuppliers} index={13} reducedMotion={reducedMotion} />
          </div>
          <div className="h-full min-h-[240px]">
            <DepartmentPanel profile={dashboardData} index={14} reducedMotion={reducedMotion} />
          </div>
        </div>

        {/* ── Row 4: Project Scale + Method Pie + NonAward Donut (three columns) ── */}
        <div className="mb-3 grid grid-cols-1 items-stretch gap-2 md:grid-cols-2 lg:grid-cols-3">
          <div className="min-h-[280px]">
            <ProjectScalePanel profile={dashboardData} index={10} reducedMotion={reducedMotion} />
          </div>
          <div className="min-h-[280px]">
            <MethodPieChartPanel profile={dashboardData} index={11} reducedMotion={reducedMotion} />
          </div>
          <div className="min-h-[280px] md:col-span-2 lg:col-span-1">
            <NonAwardDonutPanel profile={dashboardData} index={12} reducedMotion={reducedMotion} />
          </div>
        </div>

        {/* ── Row 5: Trend Chart (Full Width) ── */}
        <div className="mb-3">
          <TrendChartPanel profile={dashboardData} index={15} reducedMotion={reducedMotion} />
        </div>

        {/* ── Bottom Spacer ── */}
      <div className="h-2" />
    </motion.div>

  </>
  );
}
