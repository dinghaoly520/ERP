"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChartNoAxesCombined,
  AlertCircle,
  AlertTriangle,
  BarChart3,
  NotebookText,
  Milestone,
  ListOrdered,
  ChartPie,
  Scale,
  ShieldAlert,
  Handshake,
  BookUser,
  Building2,
  CalendarRange,
  ChevronRight,
  FolderKanban,
  Layers,
  PieChart,
  Radio,
  Radar,
  Gauge,
  GraduationCap,
  Share2,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";
import {
  fetchBidStageProjects,
  fetchBidStageStatus,
  fetchCompanyRanking,
  fetchDashboardData,
  fetchProjectStatusCounts,
  type BidStageBucket,
  type BidStageProjectRow,
  type BidStageStatus,
  type CompanyRankingRange,
  type CompanyRankingView,
  type DashboardData,
  type ProjectStatusCounts,
} from "@/lib/api/dashboard";
import { fetchMobileBrief, type MobileBrief } from "@/lib/api/ai";
import {
  fetchAlertsOverview,
  fetchBidLiveProjects,
  fetchExpertCompanyCounts,
  fetchExpertLibraryStats,
  fetchPerformanceMetrics,
  type AlertsOverview,
  type BidLiveProject,
  type ExpertCompanyCount,
  type ExpertLibraryStats,
  type PerformanceMetrics,
} from "@/lib/api/cockpit";
import { fetchCompanies, type CompanyOption } from "@/lib/api/auth";
import { RANGES, shiftYearIso, todayIso, type PresetKey, type RangeKey } from "@/lib/ranges";
import { deltaOf, ratioCls, ratioTxt, type DeltaR } from "@/lib/ratios";

const BID_BUCKET_LABELS: Record<BidStageBucket, string> = {
  running: "运行中项目",
  pre: "标前项目",
  in: "标中项目",
  post: "标后项目",
};



import { InlineSelect } from "@/components/m/inline-select";
import { useAuth } from "@/components/m/auth-context";
import { BottomSheet } from "@/components/m/bottom-sheet";
import { SectionCard } from "@/components/m/section-card";
import { MetricCard } from "@/components/m/metric-card";
import { Chip } from "@/components/m/chip";
import { ErrorBanner } from "@/components/m/error-banner";
import { EmptyState } from "@/components/m/empty-state";
import { Skeleton } from "@/components/m/skeleton";
import { PullIndicator } from "@/components/m/pull-indicator";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { usePolling } from "@/hooks/use-polling";
import { copyToClipboard } from "@/lib/copy-to-clipboard";

export type AnalysisTileKey = "ledger" | "progress" | "trend" | "ranking" | "composition" | "company" | "risk" | "supplier" | "experts";
export const ANALYSIS_TILES: Array<{
  key: AnalysisTileKey;
  label: string;
  icon: typeof PieChart;
  color: string;
}> = [
  /* 九模块全窗口化（2026-11-19 用户裁定）：点击均以窗口呈现，标题=卡片标题 */
  { key: "ledger", label: "台账明细", icon: NotebookText, color: "var(--accent)" },
  { key: "progress", label: "项目进展", icon: Milestone, color: "var(--accent)" },
  { key: "trend", label: "执行趋势", icon: ChartNoAxesCombined, color: "var(--accent)" },
  { key: "ranking", label: "排行", icon: ListOrdered, color: "var(--gold)" },
  { key: "composition", label: "构成分析", icon: ChartPie, color: "var(--accent)" },
  { key: "company", label: "公司对比", icon: Scale, color: "var(--accent)" },
  { key: "risk", label: "风险告警", icon: ShieldAlert, color: "var(--danger)" },
  { key: "supplier", label: "供应商", icon: Handshake, color: "var(--success)" },
  { key: "experts", label: "专家库", icon: BookUser, color: "var(--gold)" },
];

/** 元数值格式化：过万转「N.N万」，不足万直出「N元」（龙虎榜成交额，后端口径=元） */
const fmtWan = (v: number) => (v >= 10000 ? `${(v / 10000).toFixed(1)}万` : `${v.toFixed(0)}元`);

function statusColor(s: string): string {
  if (/未成交|异常|终止|撤|废/.test(s)) return "text-[var(--danger)]";
  if (/成交|完成|归档/.test(s)) return "text-[var(--success)]";
  return "text-[var(--muted-foreground)]";
}

const DONUT_COLORS = [
  "var(--accent)",
  "var(--success)",
  "var(--warning)",
  "var(--danger)",
  "var(--gold)",
  "oklch(0.55 0.12 285)",
  "oklch(0.6 0.12 188)",
];

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function donutPath(cx: number, cy: number, r: number, ir: number, a0: number, a1: number): string {
  const large = a1 - a0 > 180 ? 1 : 0;
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const [x2, y2] = polar(cx, cy, ir, a1);
  const [x3, y3] = polar(cx, cy, ir, a0);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${ir} ${ir} 0 ${large} 0 ${x3} ${y3} Z`;
}

/* ── 项目规模分桶（移植自 web dashboard-home computeSegments——budgetLabel 字面值解析）── */

type ScaleSegment = { label: string; range: string; min: number; max: number; count: number; amount: number; amountLabel: string; share: number; color: string };

const SCALE_SEGS: Array<Pick<ScaleSegment, "label" | "range" | "min" | "max" | "color">> = [
  { label: "小额", range: "<10万", min: 0, max: 100000, color: "var(--accent)" },
  { label: "中小", range: "10-50万", min: 100000, max: 500000, color: "var(--success)" },
  { label: "中型", range: "50-200万", min: 500000, max: 2000000, color: "var(--warning)" },
  { label: "大型", range: ">200万", min: 2000000, max: Infinity, color: "var(--danger)" },
];

/** budgetLabel 字面值（“123.4万”/“1,234,567元”）解析为元数值 */
function parseBudgetLabel(bs: string): number {
  if (bs.includes("万")) return parseFloat(bs.replace("万", "").replace(",", "").trim()) * 10000;
  if (bs.includes("元")) return parseFloat(bs.replace("元", "").replace(/,/g, ""));
  return 0;
}

/** 数据总览 8 格单元（值 + 同比/环比子行 + 标签；可选强调色/点击跳转） */
type OverviewTile = {
  label: string;
  value: string;
  danger?: boolean;
  success?: boolean;
  onTap?: () => void;
  yoy?: DeltaR;
  hb?: DeltaR;
};

function computeSegments(data: DashboardData | null): ScaleSegment[] {
  const segs: ScaleSegment[] = SCALE_SEGS.map((s) => ({ ...s, count: 0, amount: 0, amountLabel: "", share: 0 }));
  (data?.trendSeries ?? []).forEach((ti) =>
    (ti.projects ?? []).forEach((p) => {
      const b = parseBudgetLabel(p.budgetLabel);
      for (const s of segs) {
        if (b >= s.min && b < s.max) {
          s.count++;
          s.amount += b;
          break;
        }
      }
    }),
  );
  const t = segs.reduce((sum, s) => sum + s.count, 0);
  segs.forEach((s) => {
    s.share = t > 0 ? Math.round((s.count / t) * 100) : 0;
    s.amountLabel = s.amount >= 10000 ? `${(s.amount / 10000).toFixed(1)}万` : `${s.amount.toFixed(0)}元`;
  });
  return segs;
}

function segmentProjects(data: DashboardData | null, seg: ScaleSegment) {
  const out: Array<{ name: string; date: string; department: string; budgetLabel: string; status: string }> = [];
  (data?.trendSeries ?? []).forEach((ti) =>
    (ti.projects ?? []).forEach((p) => {
      const b = parseBudgetLabel(p.budgetLabel);
      if (b >= seg.min && b < seg.max) {
        out.push({ name: p.name, date: p.date, department: p.department, budgetLabel: p.budgetLabel, status: p.status });
      }
    }),
  );
  return out;
}

/* ── 弹层内的项目行（各下钻共用）── */

function ProjectRow({
  name,
  meta,
  amount,
  status,
  extra,
}: {
  name: string;
  meta: string;
  amount: string;
  status: string;
  extra?: string;
}) {
  return (
    <div className="rounded-[10px] m-tile px-3 py-2.5">
      <div className="line-clamp-2 text-[15px] font-semibold leading-snug text-[var(--foreground)]">{name}</div>
      <div className="mt-1 flex items-center gap-2 text-[14px] text-[var(--muted-foreground)]">
        <span className="min-w-0 flex-1 truncate">{meta}</span>
        <span className="shrink-0 font-bold tabular-nums text-[var(--foreground)]">{amount}</span>
        <span className={`shrink-0 text-[14px] ${statusColor(status)}`}>{status}</span>
      </div>
      {extra ? <div className="mt-0.5 text-[14px] text-[var(--danger)]">{extra}</div> : null}
    </div>
  );
}

/* ── 驾驶舱主组件（2026-11-19 九板块页面化）：双模式——无 panel=首页全景；
 *  有 panel=单板块页面体（/analysis/[key] 页面套壳复用本组件）── */

export function DashboardHome({ panel }: { panel?: AnalysisTileKey }) {
  const { user } = useAuth();
  const router = useRouter();
  const role = user?.role ?? null;

  const [data, setData] = useState<DashboardData | null>(null);
  /* 同比窗（整窗前移一年）汇总——金额三格涨跌箭头数据源（2026-11-19 用户裁定：
     同比而非环比，替换原 compare=true 邻窗） */
  const [yoy, setYoy] = useState<DashboardData["summary"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  /* 分析中心开层目标（null=关）；页面模式（panel）恒定为目标板块 */
  const [manualOpen, setManualOpen] = useState<AnalysisTileKey | null>(null);
  const analysisOpen: AnalysisTileKey | null = panel ?? manualOpen;

  // 各下钻弹层
  const [activeTrend, setActiveTrend] = useState<DashboardData["trendSeries"][number] | null>(null);
  /** 趋势图按下高亮列（触摸反馈：按下列 → 竖参考线 + 放大点，松开出当日弹层） */
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  /* 节资趋势按下列（十字准线+值签）；点击开当月下钻 */
  const [savIdx, setSavIdx] = useState<number | null>(null);
  const [activeDept, setActiveDept] = useState<DashboardData["departmentStats"][number] | null>(null);
  const [activeMethod, setActiveMethod] = useState<DashboardData["methodStats"][number] | null>(null);
  const [activeReason, setActiveReason] = useState<DashboardData["nonAwardReasons"][number] | null>(null);
  const [activeSaving, setActiveSaving] = useState<DashboardData["savingsRanking"][number] | null>(null);
  const [activeSupplier, setActiveSupplier] = useState<DashboardData["supplierStats"][number] | null>(null);
  const [activeSeg, setActiveSeg] = useState<ScaleSegment | null>(null);

  // AI 综合分析（按需生成）
  /* 专家库（2026-11-19 用户裁定：AI 分析入口换专家库）——开层懒取，会话内缓存 */
  const [expertStats, setExpertStats] = useState<ExpertLibraryStats | null>(null);
  const [expertCompanies, setExpertCompanies] = useState<ExpertCompanyCount[] | null>(null);
  useEffect(() => {
    if (analysisOpen !== "experts" || expertStats) return;
    let active = true;
    Promise.all([fetchExpertLibraryStats(), fetchExpertCompanyCounts().catch(() => [])])
      .then(([st, co]) => { if (active) { setExpertStats(st); setExpertCompanies(co); } })
      .catch(() => undefined);
    return () => { active = false; };
  }, [analysisOpen, expertStats]);

  /* 数据口径（2026-11-19 用户裁定：卡片头两个原地选择器——区间档 + 公司多选各自独立，
     不合并不弹层）：公司选择 admin 专属（:3011 leader/staff 恒总数据无效不展示），
     名单进页即取 */
  const [rangeKey, setRangeKey] = useState<RangeKey>("all"); // 默认全部（2026-11-19 用户裁定）
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [companyIds, setCompanyIds] = useState<string[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[] | null>(null);
  useEffect(() => {
    if (role !== "admin") return;
    let active = true;
    fetchCompanies()
      .then((list) => { if (active) setCompanies(list); })
      .catch(() => { if (active) setCompanies([]); });
    return () => { active = false; };
  }, [role]);

  // 公司龙虎榜（跨公司榜单，admin 全榜/leader 排位卡；随区间/重试变化重取，失败保留旧数据）
  const [ranking, setRanking] = useState<CompanyRankingView | null>(null);
  /* 龙虎榜失败≠空数据（P2，2026-11-03）：失败保留旧数据 + 显式重试入口，不再伪装成空态 */
  const [rankingError, setRankingError] = useState(false);
  /* 资源告警 + 项目质效（2026-11-03 数据利用评审：后端现成、此前 :3011 零呈现） */
  const [alerts, setAlerts] = useState<AlertsOverview | null>(null);
  const [perf, setPerf] = useState<PerformanceMetrics | null>(null);
  /* 项目状态盘点（2026-11-19 用户裁定：数据总览首排）——PMI 当前状态快照，随重试重取 */
  const [projectStatus, setProjectStatus] = useState<ProjectStatusCounts | null>(null);
  /* 实时运行态势（2026-11-18 指挥台改版）：30s 轮询 bid live——进行中开评标实名录。
   * 四 KPI（2026-11-19 标段生命周期裁定）走 bid-stage-status，随本卡口径选择器重取 */
  const [live, setLive] = useState<{ projects: BidLiveProject[] } | null>(null);
  usePolling(
    useCallback(async () => {
      const l = await fetchBidLiveProjects().catch(() => null);
      if (l) setLive(l);
    }, []),
    30_000,
    !panel,
  );
  const openingNow = live?.projects.filter((p) => p.stage === "OPENING") ?? [];
  const evaluatingNow = live?.projects.filter((p) => p.stage === "EVALUATING") ?? [];
  /* 态势卡口径（2026-11-19 用户裁定：与数据总览同款双选择器，独立口径） */
  const [bidRangeKey, setBidRangeKey] = useState<RangeKey>("all");
  const [bidCustomRange, setBidCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [bidCompanyIds, setBidCompanyIds] = useState<string[]>([]);
  const [bidStage, setBidStage] = useState<BidStageStatus | null>(null);
  const queryBidRange = useMemo<{ startDate?: string; endDate?: string }>(
    () =>
      bidRangeKey === "custom"
        ? { startDate: bidCustomRange?.from, endDate: bidCustomRange?.to }
        : { startDate: RANGES[bidRangeKey].start() },
    [bidRangeKey, bidCustomRange],
  );
  useEffect(() => {
    let active = true;
    fetchBidStageStatus(bidCompanyIds.length ? bidCompanyIds.join(",") : undefined, queryBidRange.startDate, queryBidRange.endDate)
      .then((s) => { if (active) setBidStage(s); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [retryTick, bidCompanyIds, queryBidRange.startDate, queryBidRange.endDate]);
  /* KPI 下方项目列表（2026-11-19 用户裁定）：点 KPI 卡切桶，桶内最新 5 项+复合状态行 */
  const [bidBucket, setBidBucket] = useState<BidStageBucket>("running");
  const [bidRows, setBidRows] = useState<BidStageProjectRow[] | null>(null);
  useEffect(() => {
    let active = true;
    fetchBidStageProjects(bidBucket, bidCompanyIds.length ? bidCompanyIds.join(",") : undefined)
      .then((r) => { if (active) setBidRows(r.projects); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [bidBucket, bidCompanyIds, retryTick]);
  const [rankingRange, setRankingRange] = useState<CompanyRankingRange>("year");
  useEffect(() => {
    let active = true;
    fetchCompanyRanking(rankingRange)
      .then((r) => { if (active) { setRanking(r); setRankingError(false); } })
      .catch(() => { if (active) setRankingError(true); }); // 失败≠空数据——区分重试态（P2，2026-11-03）
    return () => { active = false; };
  }, [rankingRange, retryTick]);

  /* 口径窗（置于消费方 effect 之前——依赖数组渲染期取值不可前向引用） */
  const queryRange = useMemo<{ startDate?: string; endDate?: string }>(
    () =>
      rangeKey === "custom"
        ? { startDate: customRange?.from, endDate: customRange?.to }
        : { startDate: RANGES[rangeKey].start() },
    [rangeKey, customRange],
  );

  // 资源告警 + 项目质效 + 项目状态盘点：失败保留旧数据（告警）/静默隐藏（质效），随重试重取；
  // 项目盘点 headline 仅随公司口径（当前状态快照），flow 三窗随区间档（同比/环比子行）
  useEffect(() => {
    let active = true;
    fetchAlertsOverview().then((a) => { if (active) setAlerts(a); }).catch(() => undefined);
    fetchPerformanceMetrics().then((p) => { if (active) setPerf(p); }).catch(() => undefined);
    fetchProjectStatusCounts(companyIds.length ? companyIds.join(",") : undefined, queryRange.startDate, queryRange.endDate)
      .then((s) => { if (active) setProjectStatus(s); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [retryTick, companyIds, queryRange.startDate, queryRange.endDate]);

  /* 风险项目一键转发（2026-11-03 用户裁定：允许转发类——领导看得见也能推动）；
     share 优先、AbortError 静默、剪贴板降级（要报转发随三句卡撤销，2026-11-18） */
  const [riskShared, setRiskShared] = useState<"idle" | "ok" | "shared" | "fail">("idle");
  async function shareRisk(p: { project: string; pendingDays: number; reason: string }) {
    const text = `【风险提示】${p.project}已滞留 ${p.pendingDays} 天：${p.reason}——来自蜀水云采驾驶舱`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "蜀水云采·风险项目", text });
        setRiskShared("shared");
        window.setTimeout(() => setRiskShared("idle"), 2000);
        return;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }
    const ok = await copyToClipboard(text);
    setRiskShared(ok ? "ok" : "fail");
    window.setTimeout(() => setRiskShared("idle"), 2000);
  }

  // 今日关注条（一行事实句，随口径选择器/重试变化重取——区间对齐 2026-11-03：
  // brief 与总览指标同区间，消灭「本月 0 万 vs 本年数百万」同屏打架；effect 置于
  // queryRange 定义之后——依赖数组渲染期取值不可前向引用）
  const [brief, setBrief] = useState<MobileBrief | null>(null);

  useEffect(() => {
    let active = true;
    fetchMobileBrief(companyIds.length ? companyIds.join(",") : undefined, {
      startDate: queryRange.startDate,
      endDate: queryRange.endDate,
      /* 快捷档显式携带语义（「本日/全部」不在 F10 契约三档内，不传 rangeKey 只传日期） */
      rangeKey: rangeKey === "month" || rangeKey === "quarter" || rangeKey === "year" ? rangeKey : undefined,
    })
      .then((b) => { if (active) setBrief(b); })
      .catch(() => { if (active) setBrief({ available: false }); });
    return () => { active = false; };
  }, [queryRange.startDate, queryRange.endDate, rangeKey, companyIds, retryTick]);

  const loadData = useCallback(() => {
    setLoading(true);
    setError(null);
    const cid = companyIds.length ? companyIds.join(",") : undefined;
    const mainP = fetchDashboardData(queryRange.startDate, queryRange.endDate, cid, true);
    /* 同比窗=整窗前移一年（本月↔去年同月/本季↔去年同季/本年↔去年/自定义同移）；
       环比=主请求 compare 邻窗（紧邻等长前移）。「全部」档无起点不做同比（-）。
       主请求失败显横幅，同比失败静默降级（子行退 -） */
    const yoyP = queryRange.startDate
      ? fetchDashboardData(shiftYearIso(queryRange.startDate), shiftYearIso(queryRange.endDate ?? todayIso()), cid, false).catch(() => null)
      : Promise.resolve(null);
    return Promise.all([mainP, yoyP])
      .then(([d, y]) => {
        setData(d);
        setYoy(y?.summary ?? null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "加载仪表盘数据失败");
      })
      .finally(() => setLoading(false));
    /* retryTick 不入 deps（R1-3）：下拉回调已直接调 loadData()，若 deps 含 retryTick，
       bump 会重建 loadData 身份 → mount effect 二次触发 → 同轮双取。
       retryTick 仍驱动今日要报/龙虎榜两 effect 的重取。 */
  }, [queryRange.startDate, queryRange.endDate, companyIds]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 下拉刷新：主数据重载之外连带 bump retryTick——今日要报（deps 含 retryTick）与
  // 公司龙虎榜（deps [rankingRange, retryTick]）同轮重取，三卡一致
  const { pull, refreshing } = usePullToRefresh(
    useCallback(() => {
      setRetryTick((t) => t + 1);
      return loadData();
    }, [loadData]),
  );

  const summary = data?.summary;
  const cmp = data?.compare?.summary; // 环比邻窗汇总（compare=true 附带）
  /* 同比/环比子行数据源：金额=区间全量对比（同比窗 yoy / 环比邻窗 cmp）；
     首排=窗内新增流量（后端 flow 三窗；headline 是存量、子行是流量口径） */
  const f = projectStatus?.flow ?? null;
  const fstat = (k: "archived" | "active" | "terminated" | "total", good: boolean | null) => ({
    yoy: f ? deltaOf(f.cur[k], f.yoy[k], good) : undefined,
    hb: f ? deltaOf(f.cur[k], f.prev[k], good) : undefined,
  });
  const amtR = (labelVal: string, yoyV: number | undefined, hbV: number | undefined) => ({
    yoy: deltaOf(parseBudgetLabel(labelVal), yoyV, true),
    hb: deltaOf(parseBudgetLabel(labelVal), hbV, true),
  });
  /* 节资率本身也可同比/环比：率 vs 去年同窗率 / 邻窗率 */
  const rateOf = (s?: { totalSavings: number; awardedBudget: number }) =>
    s && s.awardedBudget > 0 ? s.totalSavings / s.awardedBudget : undefined;
  const rateNow = summary && summary.awardedBudget > 0 ? summary.totalSavings / summary.awardedBudget : undefined;
  /* 公司口径标签（全称——2026-11-19 用户裁定；两卡共用） */
  const companyLabelOf = (ids: string[]) =>
    ids.length === 0
      ? "全部公司"
      : (() => {
          const nameOf = (id: string) => companies?.find((c) => c.id === id)?.name ?? id;
          const names = ids.map(nameOf);
          return names.length <= 2 ? names.join("、") : `${names.slice(0, 2).join("、")} 等 ${names.length} 家`;
        })();
  const companyLabel = companyLabelOf(companyIds);
  const bidCompanyLabel = companyLabelOf(bidCompanyIds);

  /* KPI 点击 → 水叮当自动问询（2026-11-19 用户裁定）：/chat?ask=<问句> 挂载即发；
     问句带区间/公司口径语境（项目盘点为存量口径不带区间） */
  const kpiScope =
    companyIds.length > 0
      ? `${companyLabel}口径下`
      : rangeKey === "custom"
        ? "所选区间内"
        : rangeKey === "all"
          ? "全部时段"
          : `${RANGES[rangeKey as PresetKey].label}（至今）`;
  const askChat = (q: string) => router.push(`/chat?ask=${encodeURIComponent(q)}`);

  /* 数据总览 8 格（显式类型——异构字面量数组直接 .map 会丢可选属性类型）；
     仅 data 就绪后构建（挂载期 data=null 时空数组，勿无条件解构 summary） */
  const overviewTiles: OverviewTile[] = data && summary ? [
    /* 首排=项目盘点（2026-11-19 用户裁定）：项目总数=归档+进行中（不含异常项目）；归档项目=
       台账中的项目（全时段轮次行数，点跳台账）；进行中=PMI ACTIVE；异常项目=
       终止的项目（点跳台账终止留痕）。值随区间（flow.cur 窗内流量：归档=窗内轮次、进行中/异常=窗内立项；
       「全部」档回落全时段存量），同比/环比子行同流量口径对比 */
    { label: "项目总数", value: projectStatus ? String(projectStatus.flow?.cur.total ?? projectStatus.total) : "—", onTap: () => askChat("请介绍当前采购项目总数：归档、进行中、终止（异常）项目各有多少？分布在哪些公司？"), ...fstat("total", null) },
    { label: "归档项目", value: projectStatus ? String(projectStatus.flow?.cur.archived ?? projectStatus.archived) : "—", onTap: () => askChat("请概览台账：台账中的项目（轮次）总数、已成交与待处理的构成及金额情况如何？"), ...fstat("archived", null) },
    { label: "进行中项目", value: projectStatus ? String(projectStatus.flow?.cur.active ?? projectStatus.active) : "—", onTap: () => askChat("当前进行中的采购项目有哪些？分别处于哪个采购阶段？"), ...fstat("active", null) },
    { label: "异常项目", value: projectStatus ? String(projectStatus.flow?.cur.terminated ?? projectStatus.terminated) : "—", danger: (projectStatus?.flow?.cur.terminated ?? projectStatus?.terminated ?? 0) > 0, onTap: () => askChat("有哪些采购项目被终止了？终止原因分别是什么？"), ...fstat("terminated", false) },
    /* 次排金额（2026-11-19 用户裁定）：同比=整窗前移一年（本月↔去年同月/本季↔去年
       同季/本年↔去年），环比=紧邻等长前窗；值下方子行「同比x 环比x」，无数据 - */
    { label: "成交预算", value: summary.awardedBudgetLabel, onTap: () => askChat(`${kpiScope}，已成交项目的成交预算执行情况如何？成交额与节约资金各占多少？`), ...amtR(summary.awardedBudgetLabel, yoy?.awardedBudget, cmp?.awardedBudget) },
    { label: "成交额", value: summary.totalAwardLabel, onTap: () => askChat(`${kpiScope}，成交额表现如何？请分析趋势变化与主要构成。`), ...amtR(summary.totalAwardLabel, yoy?.totalAward, cmp?.totalAward) },
    { label: "节约资金", value: summary.totalSavingsLabel, success: true, onTap: () => askChat(`${kpiScope}，节约资金情况如何？节资率最高的项目有哪些？`), ...amtR(summary.totalSavingsLabel, yoy?.totalSavings, cmp?.totalSavings) },
    /* 节资率=节约资金/成交预算（红显）；率本身的同比/环比=率 vs 去年同窗率/邻窗率 */
    { label: "节资率", value: summary.awardedBudget > 0 ? `${((summary.totalSavings / summary.awardedBudget) * 100).toFixed(1)}%` : "—", danger: true, onTap: () => askChat(`${kpiScope}，节资率水平如何？哪些项目节资率最高？有什么值得关注的？`), yoy: deltaOf(rateNow, rateOf(yoy ?? undefined), true), hb: deltaOf(rateNow, rateOf(cmp ?? undefined), true) },
  ] : [];
  const scaleSegs = useMemo(() => computeSegments(data), [data]);
  const scaleTotal = scaleSegs.reduce((s, x) => s + x.count, 0);

  /* 趋势图几何 */
  const trend = useMemo(() => {
    const series = data?.trendSeries ?? [];
    const n = series.length;
    if (n === 0) return null;
    const W = 340;
    const H = 190;
    const padL = 34; // 左侧金额刻度留位
    const padR = 26; /* 右侧数量刻度留位（2026-11-19 双纵轴裁定） */
    const padT = 24; // 顶部留位给高亮值签
    const padB = 24;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const maxAmount = Math.max(...series.map((t) => t.amount), 1);
    const maxCount = Math.max(...series.map((t) => t.count), 1);
    const x = (i: number) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const colW = n > 0 ? plotW / n : plotW;
    const colX = (i: number) => padL + i * colW;
    const barW = Math.min(Math.round(colW * 0.42), 26);
    const amountY = (v: number) => padT + plotH - (v / maxAmount) * plotH * 0.88;
    const pts = series.map((t, i) => [x(i), amountY(t.amount)] as const);
    const linePath = pts.map(([px, py], i) => `${i === 0 ? "M" : "L"} ${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
    const baseline = padT + plotH;
    const areaPath = `${linePath} L ${pts[pts.length - 1][0].toFixed(1)} ${baseline} L ${pts[0][0].toFixed(1)} ${baseline} Z`;
    // 金额刻度两档（满值/半值）——横向发丝线 + 左侧小字
    const ticks = [maxAmount, maxAmount / 2].map((v) => ({ v, y: amountY(v) }));
    const labelStep = Math.max(1, Math.ceil(n / 5));
    return { W, H, padL, padR, padT, baseline, plotH, x, colW, colX, barW, amountY, maxCount, maxAmount, linePath, areaPath, ticks, series, labelStep };
  }, [data]);

  /* 节资趋势（2026-11-19 执行趋势优化裁定）：月度节约资金（AWARDED 且
   * budget>=award>0：Σ(预算-成交)）柱 + 节资率（节约/成交预算）线 */
  const savingsTrend = useMemo(() => {
    const series = (data?.trendSeries ?? []).map((t) => {
      let savings = 0;
      let budget = 0;
      (t.projects ?? []).forEach((p) => {
        const b = parseBudgetLabel(p.budgetLabel);
        const a = parseBudgetLabel(p.awardLabel || "");
        if (a > 0 && b >= a) {
          savings += b - a;
          budget += b;
        }
      });
      const rate = budget > 0 ? (savings / budget) * 100 : 0;
      return { label: t.label, count: t.count, savings: savings / 10000, rate, raw: t };
    });
    const total = series.reduce((sum, x) => sum + x.savings, 0);
    if (!total) return null;
    return { series, total };
  }, [data]);

  /* 环形图分段（采购方式） */
  const methodDonut = useMemo(() => {
    const stats = data?.methodStats ?? [];
    const total = stats.reduce((s, m) => s + m.count, 0);
    if (!total) return null;
    let acc = 0;
    const segs = stats.map((m, i) => {
      const sweep = (m.count / total) * 360;
      const seg = { m, a0: acc, a1: acc + Math.max(sweep, 0.001), color: DONUT_COLORS[i % DONUT_COLORS.length] };
      acc += sweep;
      return seg;
    });
    return { segs, total };
  }, [data]);


  const savingsTop = (data?.savingsRanking ?? []).slice(0, 5);

  /* 口径选择器（首页挂总览卡头；页面模式挂顶行） */
  const scopeSelectors = (
            <>
              <InlineSelect
                label={rangeKey === "custom" && customRange ? `${customRange.from.slice(5).replace("-", "/")}~${customRange.to.slice(5).replace("-", "/")}` : RANGES[rangeKey as PresetKey].label}
                active={rangeKey !== "all"}
                options={(Object.keys(RANGES) as PresetKey[]).reverse().map((k) => ({ value: k, label: RANGES[k].label }))}
                selected={[rangeKey]}
                onSelect={(next) => setRangeKey(next[0] as RangeKey)}
                onCustomApply={(from, to) => {
                  setCustomRange({ from, to });
                  setRangeKey("custom");
                }}
                customValue={customRange}
                customFirst
                ariaLabel="数据区间"
              />
              {role === "admin" ? (
                <InlineSelect
                  multiple
                  label={companyLabel}
                  active={companyIds.length > 0}
                  options={[
                    { value: "all", label: "全部公司" },
                    ...(companies ?? []).map((c) => ({ value: c.id, label: c.name })),
                  ]}
                  selected={companyIds.length === 0 ? ["all"] : companyIds}
                  onSelect={(next) => {
                    const hadAll = companyIds.length === 0; // 显示态「全部公司」已勾
                    if (next.includes("all") && !hadAll) setCompanyIds([]); // 点「全部公司」→ 清空
                    else setCompanyIds(next.filter((v) => v !== "all")); // 其余增减；全撤=全部
                  }}
                  ariaLabel={`公司口径：${companyLabel}`}
                />
              ) : null}
            </>
  );

  /* 七板块内容（首页=弹层呈现；页面模式=平铺） */
  const analysisGroups = (
    <>
        {analysisOpen && data ? (
          <>
            {analysisOpen === "trend" ? (
              <>

            {/* ── 采购执行趋势 ── */}
            <SectionCard
              icon={BarChart3}
              title="采购执行趋势"
              index={1}
              right={<span className="shrink-0 text-[13px] font-semibold text-[var(--muted-foreground)]">柱=数量 · 线=金额</span>}
            >
              {trend ? (
                <svg viewBox={`0 0 ${trend.W} ${trend.H}`} className="w-full" role="img" aria-label="采购执行趋势图">
                  <defs>
                    <linearGradient id="trendBarFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.07" />
                    </linearGradient>
                    <linearGradient id="trendAreaFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--success)" stopOpacity="0.15" />
                      <stop offset="100%" stopColor="var(--success)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {/* 金额刻度线（发丝线）+ 左侧刻度小字 */}
                  {trend.ticks.map((tk, i) => (
                    <g key={`tick-${i}`}>
                      <line x1={trend.padL} y1={tk.y} x2={trend.W - trend.padR} y2={tk.y} stroke="var(--muted-foreground)" strokeOpacity={0.16} strokeWidth={0.8} />
                      <text x={trend.padL - 5} y={tk.y + 3} textAnchor="end" fontSize={8.5} fill="var(--muted-foreground)">
                        {/* 单位自适应（2026-11-19 执行趋势优化裁定）：≥1亿以亿计 */}
                        {tk.v >= 10000 ? `${Math.round(tk.v / 1000) / 10}亿` : tk.v >= 100 ? Math.round(tk.v) : Math.round(tk.v * 10) / 10}
                      </text>
                    </g>
                  ))}
                  {/* 右纵轴=数量（柱刻度，双纵轴） */}
                  {[trend.maxCount, Math.max(1, Math.round(trend.maxCount / 2))].filter((v, i, a) => a.indexOf(v) === i).map((v, i) => (
                    <text key={`rc-${i}`} x={trend.W - 2} y={trend.baseline - (v / trend.maxCount) * (trend.plotH * 0.55) + 3} textAnchor="end" fontSize={8.5} fontWeight={600} fill="var(--accent-strong)">
                      {v}
                    </text>
                  ))}
                  <text x={trend.padL - 5} y={10} textAnchor="end" fontSize={8} fill="var(--muted-foreground)">金额</text>
                  <text x={trend.W - 2} y={10} textAnchor="end" fontSize={8} fill="var(--muted-foreground)">数量</text>
                  {/* 基线 */}
                  <line x1={trend.padL} y1={trend.baseline} x2={trend.W - trend.padR} y2={trend.baseline} stroke="var(--muted-foreground)" strokeOpacity={0.3} strokeWidth={1} />
                  {/* 数量柱（渐变圆角柱）+ 高亮列淡染 */}
                  {trend.series.map((t, i) => {
                    const barH = (t.count / trend.maxCount) * (trend.plotH * 0.55);
                    return (
                      <g key={`bar-${i}`}>
                        {activeIdx === i ? (
                          <rect x={trend.colX(i)} y={trend.padT - 6} width={trend.colW} height={trend.plotH + 6} rx={6} fill="var(--accent)" opacity={0.06} />
                        ) : null}
                        {barH > 0 ? (
                          <rect
                            x={trend.x(i) - trend.barW / 2}
                            y={trend.baseline - barH}
                            width={trend.barW}
                            height={Math.max(barH, 2)}
                            rx={3}
                            fill="url(#trendBarFill)"
                            className="m-bar"
                            style={{ animationDelay: `${i * 40}ms` }}
                          />
                        ) : null}
                      </g>
                    );
                  })}
                  {/* 金额面积 + 折线 */}
                  <path d={trend.areaPath} fill="url(#trendAreaFill)" className="m-fade-in" />
                  <path
                    d={trend.linePath}
                    fill="none"
                    stroke="var(--success)"
                    strokeWidth={2.2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    className="m-draw-line"
                    style={{ ["--m-path-len" as string]: "1200" }}
                  />
                  {/* 数据点 + 月份标签（高亮月加重） */}
                  {trend.series.map((t, i) => (
                    <g key={`pt-${i}`}>
                      {activeIdx === i ? (
                        <circle cx={trend.x(i)} cy={trend.amountY(t.amount)} r={5} fill="var(--success)" opacity={0.5} className="m-point-pulse" />
                      ) : null}
                      <circle cx={trend.x(i)} cy={trend.amountY(t.amount)} r={activeIdx === i ? 5.2 : 3.2} fill="var(--success)" stroke="white" strokeWidth={activeIdx === i ? 2 : 1.2} />
                      {i % trend.labelStep === 0 ? (
                        <text
                          x={trend.x(i)}
                          y={trend.H - 6}
                          textAnchor="middle"
                          fontSize={10.5}
                          fontWeight={activeIdx === i ? 700 : 400}
                          fill={activeIdx === i ? "var(--accent-strong)" : "var(--muted-foreground)"}
                        >
                          {t.label.slice(-5)}
                        </text>
                      ) : null}
                    </g>
                  ))}
                  {/* 触摸十字准线（2026-11-19 优化裁定）：按下列全高竖线 */}
                  {activeIdx != null ? (
                    <line className="m-chip-in" x1={trend.x(activeIdx)} y1={trend.padT - 6} x2={trend.x(activeIdx)} y2={trend.baseline} stroke="var(--accent)" strokeOpacity={0.45} strokeWidth={1} strokeDasharray="3 3" />
                  ) : null}
                  {/* 高亮值签：柱列上方的当期金额小胶囊（含金额环比小标注） */}
                  {activeIdx != null
                    ? (() => {
                        const t = trend.series[activeIdx];
                        const prev = activeIdx > 0 ? trend.series[activeIdx - 1].amount : 0;
                        const mom = prev > 0 ? Math.round(((t.amount - prev) / prev) * 100) : null;
                        const amtTxt = t.amount >= 10000 ? `${(t.amount / 10000).toFixed(2)}亿` : `${t.amount.toFixed(1)}万`;
                        const chip = mom != null ? `${amtTxt} ${mom > 0 ? "↑" : mom < 0 ? "↓" : ""}${Math.abs(mom)}%` : amtTxt;
                        const cw = chip.length * 7.5 + 12;
                        const cx = Math.min(Math.max(trend.x(activeIdx), trend.padL + cw / 2), trend.W - 8 - cw / 2);
                        const cy = Math.max(trend.amountY(t.amount) - 34, 1);
                        return (
                          <g className="m-chip-in">
                            <rect x={cx - cw / 2} y={cy} width={cw} height={18} rx={9} fill="var(--foreground)" />
                            <text x={cx} y={cy + 12.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--background)">
                              {chip}
                            </text>
                          </g>
                        );
                      })()
                    : null}
                  {/* 命中区：按下高亮、点按开下钻（click 开层——同拍 click 不会再打蒙层，见 BottomSheet 幽灵点击防护） */}
                  {trend.series.map((t, i) => (
                    <rect
                      key={`hit-${i}`}
                      x={trend.colX(i)}
                      y={trend.padT - 6}
                      width={trend.colW}
                      height={trend.plotH + 6}
                      fill="transparent"
                      style={{ cursor: "pointer" }}
                      onPointerDown={() => setActiveIdx(i)}
                      onPointerCancel={() => setActiveIdx(null)}
                      onClick={() => {
                        setActiveIdx(null);
                        setActiveTrend(t);
                      }}
                    />
                  ))}
                </svg>
              ) : (
                <EmptyState text="该范围内暂无趋势数据" />
              )}
            </SectionCard>

              </>
            ) : null}
            {/* ── 节资趋势（月度节约资金柱 + 节资率线，点柱开当月下钻）── */}
            {savingsTrend ? (
              <SectionCard
                icon={TrendingUp}
                title="节资趋势"
                index={1.5}
                right={<span className="shrink-0 text-[13px] font-semibold text-[var(--muted-foreground)]">柱=节约资金 · 线=节资率</span>}
              >
                {(() => {
                  const st = savingsTrend;
                  const n = st.series.length;
                  const W = 340;
                  const H = 140;
                  const padL = 34;
                  const padR = 26; /* 右侧让位节资率纵轴（2026-11-19 用户裁定） */
                  const padT = 14;
                  const padB = 22;
                  const plotW = W - padL - padR;
                  const plotH = H - padT - padB;
                  const maxSav = Math.max(...st.series.map((x) => x.savings), 1);
                  const maxRate = Math.max(...st.series.map((x) => x.rate), 1);
                  const x = (i: number) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
                  const colW = n > 0 ? plotW / n : plotW;
                  const colX = (i: number) => padL + i * colW;
                  const barW = Math.min(Math.round(colW * 0.42), 26);
                  const savY = (v: number) => padT + plotH - (v / maxSav) * plotH;
                  const rateY = (v: number) => padT + plotH - (v / maxRate) * plotH * 0.85;
                  const pts = st.series.map((t, i) => [x(i), rateY(t.rate)] as const);
                  const line = pts.map(([px, py], i) => `${i === 0 ? "M" : "L"} ${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
                  const labelStep = Math.max(1, Math.ceil(n / 5));
                  return (
                    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="节资趋势图">
                      <defs>
                        <linearGradient id="savBarFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--success)" stopOpacity="0.34" />
                          <stop offset="100%" stopColor="var(--success)" stopOpacity="0.08" />
                        </linearGradient>
                      </defs>
                      {[maxSav, maxSav / 2].map((v, i) => (
                        <g key={`st-${i}`}>
                          <line x1={padL} y1={savY(v)} x2={W - padR} y2={savY(v)} stroke="var(--muted-foreground)" strokeOpacity={0.16} strokeWidth={0.8} />
                          <text x={padL - 5} y={savY(v) + 3} textAnchor="end" fontSize={8.5} fill="var(--muted-foreground)">
                            {v >= 10000 ? `${Math.round(v / 1000) / 10}亿` : v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}
                          </text>
                        </g>
                      ))}
                      <text x={padL - 5} y={10} textAnchor="end" fontSize={8} fill="var(--muted-foreground)">节约</text>
                      <text x={W - 2} y={10} textAnchor="end" fontSize={8} fill="var(--muted-foreground)">节资率</text>
                      {/* 右纵轴=节资率（金），两档刻度随 rateY 线性位 */}
                      {[maxRate, maxRate / 2].map((v, i) => (
                        <text key={`sr-${i}`} x={W - 2} y={rateY(v) + 3} textAnchor="end" fontSize={8.5} fontWeight={600} fill="var(--gold)">
                          {`${Math.round(v)}%`}
                        </text>
                      ))}
                      <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke="var(--muted-foreground)" strokeOpacity={0.3} strokeWidth={1} />
                      {st.series.map((t, i) => {
                        const barH = (t.savings / maxSav) * plotH;
                        return barH > 0 ? (
                          <rect key={`sb-${i}`} x={x(i) - barW / 2} y={padT + plotH - barH} width={barW} height={Math.max(barH, 2)} rx={3} fill="url(#savBarFill)" className="m-bar" style={{ animationDelay: `${i * 40}ms` }} />
                        ) : null;
                      })}
                      <path d={line} fill="none" stroke="var(--gold)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="m-draw-line" style={{ ["--m-path-len" as string]: "800" }} />
                      {st.series.map((t, i) => (
                        <g key={`sp-${i}`}>
                          {savIdx === i ? <circle cx={x(i)} cy={rateY(t.rate)} r={5} fill="var(--gold)" opacity={0.5} className="m-point-pulse" /> : null}
                          <circle cx={x(i)} cy={rateY(t.rate)} r={savIdx === i ? 4.6 : 3} fill="var(--gold)" stroke="white" strokeWidth={savIdx === i ? 2 : 1.2} />
                          {i % labelStep === 0 ? (
                            <text x={x(i)} y={H - 6} textAnchor="middle" fontSize={10.5} fill="var(--muted-foreground)">
                              {t.label.slice(-5)}
                            </text>
                          ) : null}
                        </g>
                      ))}
                      {savIdx != null ? (
                        <>
                          <line className="m-chip-in" x1={x(savIdx)} y1={padT - 4} x2={x(savIdx)} y2={padT + plotH} stroke="var(--gold)" strokeOpacity={0.5} strokeWidth={1} strokeDasharray="3 3" />
                          {(() => {
                            const m = st.series[savIdx];
                            const prev = savIdx > 0 ? st.series[savIdx - 1].savings : 0;
                            const mom = prev > 0 ? Math.round(((m.savings - prev) / prev) * 100) : null;
                            const amtTxt = m.savings >= 10000 ? `${(m.savings / 10000).toFixed(2)}亿` : `${m.savings.toFixed(1)}万`;
                            const chip = `${amtTxt} · ${m.rate.toFixed(1)}%${mom != null ? ` ${mom > 0 ? "↑" : mom < 0 ? "↓" : ""}${Math.abs(mom)}%` : ""}`;
                            const cw = chip.length * 7 + 12;
                            const cx = Math.min(Math.max(x(savIdx), padL + cw / 2), W - padR - cw / 2);
                            const cy = Math.max(savY(m.savings) - 30, 1);
                            return (
                              <g className="m-chip-in">
                                <rect x={cx - cw / 2} y={cy} width={cw} height={18} rx={9} fill="var(--foreground)" />
                                <text x={cx} y={cy + 12.5} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="var(--background)">
                                  {chip}
                                </text>
                              </g>
                            );
                          })()}
                        </>
                      ) : null}
                      {st.series.map((t, i) => (
                        <rect
                          key={`sh-${i}`}
                          x={colX(i)}
                          y={padT - 4}
                          width={colW}
                          height={plotH + 4}
                          fill="transparent"
                          style={{ cursor: "pointer" }}
                          onPointerDown={() => setSavIdx(i)}
                          onPointerCancel={() => setSavIdx(null)}
                          onClick={() => {
                            setSavIdx(null);
                            setActiveTrend(t.raw);
                          }}
                        />
                      ))}
                    </svg>
                  );
                })()}
              </SectionCard>
            ) : null}

            {analysisOpen === "company" ? (
              <>

            {/* ── 各公司采购分布（2026-10-23：部门归属数据近乎全空，分布维度改用公司；非 admin 公司单一不展示） ── */}
            {role === "admin" ? (
            <SectionCard icon={Building2} title="各公司采购分布"
              index={2}
            >
              {data.companyStats.length ? (
                <div className="space-y-2">
                  {data.companyStats.map((d, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setActiveDept(d)}
                      className="w-full rounded-[12px] m-tile px-3 py-2.5 text-left active:scale-[0.99]"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[var(--foreground)]">{d.name}</span>
                        <span className="shrink-0 text-[15px] font-bold tabular-nums text-[var(--accent)]">{d.amountLabel}</span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--muted-foreground)_12%,transparent)]">
                          <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.min(d.completedRate, 100)}%` }} />
                        </div>
                        <span className="shrink-0 text-[13px] font-semibold tabular-nums text-[var(--muted-foreground)]">完成率 {d.completedRate}%</span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState text="暂无公司数据" />
              )}
            </SectionCard>
            ) : null}

            {/* ── 项目质效（近一年，/performance/metrics——与 :3005 质效评分卡同源口径）── */}
            {perf ? (
              <SectionCard
                icon={Gauge}
                title="项目质效"
                index={0.5}
                right={<span className="shrink-0 text-[13px] font-semibold text-[var(--muted-foreground)]">近一年 · 集团口径</span>}
              >
                <div className="grid grid-cols-2 gap-2">
                  <MetricCard label="项目数" value={String(perf.projectCount)} tone="accent" />
                  <MetricCard label="平均周期" value={perf.avgCycleDays != null ? `${perf.avgCycleDays} 天` : "—"} />
                  <MetricCard label="节资率" value={perf.savingsRate != null ? `${perf.savingsRate}%` : "—"} tone="success" />
                  <MetricCard label="竞争度" value={perf.competitionAvg != null ? `${perf.competitionAvg} 家/项` : "—"} />
                  <MetricCard label="异议率" value={perf.objectionRate != null ? `${perf.objectionRate}%` : "—"} tone={perf.objectionRate && perf.objectionRate > 0 ? "warning" : "default"} />
                  <MetricCard label="验收率" value={perf.acceptanceRate != null ? `${perf.acceptanceRate}%` : "—"} tone="success" />
                </div>
              </SectionCard>
            ) : null}

              </>
            ) : null}
            {analysisOpen === "composition" ? (
              <>

            {/* ── 采购方式分布（环形图）── */}
            <SectionCard icon={Layers} title="采购方式分布"
              index={3}
            >
              {methodDonut ? (
                <div className="flex items-center gap-3">
                  <svg viewBox="0 0 150 150" className="w-[130px] shrink-0" role="img" aria-label="采购方式分布环形图">
                    {methodDonut.segs.map((seg, i) => (
                      <path
                        key={i}
                        d={donutPath(75, 75, 64, 42, seg.a0, seg.a1)}
                        fill={seg.color}
                        opacity={0.88}
                        onClick={() => setActiveMethod(seg.m)}
                        className="m-seg-in"
                        style={{ cursor: "pointer", animationDelay: `${i * 60}ms` }}
                      />
                    ))}
                    <text x={75} y={71} textAnchor="middle" fontSize={20} fontWeight={700} fill="var(--foreground)">
                      {methodDonut.total}
                    </text>
                    <text x={75} y={86} textAnchor="middle" fontSize={12} fill="var(--muted-foreground)">
                      总项目
                    </text>
                  </svg>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    {methodDonut.segs.slice(0, 6).map((seg, i) => (
                      <button key={i} type="button" onClick={() => setActiveMethod(seg.m)} className="flex w-full items-center gap-2 text-left">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: seg.color }} />
                        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[var(--foreground)]">{seg.m.name}</span>
                        <span className="shrink-0 text-[14px] font-bold tabular-nums text-[var(--muted-foreground)]">{seg.m.share}%</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyState text="暂无采购方式数据" />
              )}
            </SectionCard>

            {/* ── 项目规模分析 ── */}
            <SectionCard
              icon={BarChart3}
              title="项目规模分析"
              index={4}
              right={<span className="shrink-0 text-[13px] font-bold text-[var(--warning)]">{scaleTotal} 项</span>}
            >
              {scaleTotal > 0 ? (
                <div className="space-y-1">
                  {(() => {
                    const maxSegCount = Math.max(...scaleSegs.map((s) => s.count), 1);
                    return scaleSegs.map((seg, i) => (
                      <button key={i} type="button" onClick={() => setActiveSeg(seg)} className="flex w-full items-center gap-2 rounded-[10px] px-1 py-1.5 text-left active:scale-[0.99]">
                        <span className="w-[4.5rem] shrink-0 leading-tight">
                          <span className="block text-[14px] font-semibold text-[var(--foreground)]">{seg.label}</span>
                          <span className="block text-[13px] text-[var(--muted-foreground)]">{seg.range}</span>
                        </span>
                        <span className="h-4 min-w-0 flex-1 overflow-hidden rounded-[5px] bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)]">
                          <span className="block h-full rounded-[5px] opacity-85" style={{ width: `${(seg.count / maxSegCount) * 100}%`, background: seg.color }} />
                        </span>
                        <span className="w-[3.25rem] shrink-0 text-right leading-tight">
                          <span className="block text-[14px] font-bold tabular-nums" style={{ color: seg.color }}>{seg.count}项</span>
                          <span className="block text-[13px] tabular-nums text-[var(--muted-foreground)]">{seg.share}%</span>
                        </span>
                      </button>
                    ));
                  })()}
                </div>
              ) : (
                <EmptyState text="暂无项目数据" />
              )}
            </SectionCard>

            {/* ── 结果构成 ── */}
            <SectionCard title="结果构成"
              index={5}
            >
              {data.resultStats.length ? (
                <div className="grid grid-cols-3 gap-1.5 min-[360px]:gap-2">
                  {data.resultStats.map((r, i) => (
                    <div key={i} className="rounded-[12px] m-tile px-2 py-2 text-center">
                      <div className="text-[13px] text-[var(--muted-foreground)]">{r.label}</div>
                      <div className="mt-1 text-[18px] font-black leading-none tabular-nums" style={{ color: r.accent }}>
                        {r.count}
                      </div>
                      <div className="mt-1 truncate text-[12px] tabular-nums text-[var(--muted-foreground)]">{r.amountLabel}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="暂无结果数据" />
              )}
            </SectionCard>

            {/* ── 未成交原因分析 ── */}
            {data.nonAwardReasons.length ? (
              <SectionCard icon={AlertCircle} title="未成交原因分析"
              index={6}
            >
                <div className="space-y-2">
                  {data.nonAwardReasons.map((r, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setActiveReason(r)}
                      className="flex w-full items-center gap-2.5 rounded-[12px] m-tile px-3 py-2.5 text-left active:scale-[0.99]"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] text-[14px] font-black text-[var(--danger)]">
                        {r.count}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold text-[var(--foreground)]">{r.label}</span>
                        <span className="mt-0.5 block truncate text-[14px] text-[var(--muted-foreground)]">{r.detail}</span>
                      </span>
                      <ChevronRight size={14} className="shrink-0 text-[var(--muted-foreground)]" />
                    </button>
                  ))}
                </div>
              </SectionCard>
            ) : null}

              </>
            ) : null}
            {analysisOpen === "ranking" ? (
              <>

            {/* ── 公司龙虎榜（admin 全榜 / leader 排位卡+集团均值；跨公司榜单不受公司选择器影响）── */}
            <SectionCard
              icon={Trophy}
              title="公司龙虎榜"
              index={6.5}
              right={
                <div className="flex gap-1.5">
                  {(["month", "year"] as const).map((k) => (
                    <Chip key={k} active={rankingRange === k} onClick={() => setRankingRange(k)}>
                      {k === "month" ? "本月" : "本年"}
                    </Chip>
                  ))}
                </div>
              }
            >
              {ranking?.rows?.length ? (
                <div className="space-y-1.5">
                  {ranking.rows.slice(0, 8).map((r, i) => (
                    <div key={r.companyId} className="flex items-center gap-2.5 rounded-[12px] m-tile px-3 py-2">
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] text-[12px] font-black ${i < 3 ? "bg-[color-mix(in_oklch,var(--gold)_14%,transparent)] text-[var(--gold)]" : "text-[var(--muted-foreground)]"}`}>{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[var(--foreground)]">{r.companyName}</span>
                      <span className="shrink-0 text-[13px] font-bold tabular-nums text-[var(--accent)]">{fmtWan(r.awardAmount)}</span>
                      <span className="shrink-0 text-[12px] tabular-nums text-[var(--muted-foreground)]">{r.totalCount} 轮</span>
                    </div>
                  ))}
                </div>
              ) : ranking?.self ? (
                <div className="rounded-[12px] m-tile px-3.5 py-3">
                  <div className="text-[14px] font-bold text-[var(--foreground)]">{ranking.self.companyName} · 集团第 {ranking.self.rank} 位</div>
                  <div className="mt-1 text-[13px] text-[var(--muted-foreground)]">
                    本公司成交 {fmtWan(ranking.self.awardAmount)} · 集团均值 {fmtWan(ranking.groupAvg?.awardAmount ?? 0)}
                  </div>
                </div>
              ) : rankingError ? (
                <button
                  type="button"
                  onClick={() => setRetryTick((t) => t + 1)}
                  className="w-full py-1 text-left text-[13px] text-[var(--danger)] active:scale-[0.99]"
                >
                  龙虎榜加载失败，点击重试
                </button>
              ) : (
                <EmptyState text="暂无可排名的公司数据" />
              )}
            </SectionCard>

            {/* ── 节资率排行 Top5 ── */}
            <SectionCard
              icon={TrendingUp}
              title="节资率项目排行"
              index={7}
              right={
                <span className="shrink-0 rounded-full bg-[color-mix(in_oklch,var(--success)_10%,transparent)] px-2 py-0.5 text-[13px] font-bold text-[var(--success)]">
                  Top 5
                </span>
              }
            >
              {savingsTop.length ? (
                <div className="space-y-2">
                  {savingsTop.map((item, idx) => {
                    const rc = item.savingsRate >= 15 ? "var(--success)" : item.savingsRate >= 8 ? "var(--accent)" : "var(--warning)";
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setActiveSaving(item)}
                        className="flex w-full items-center gap-2.5 rounded-[12px] m-tile px-3 py-2.5 text-left active:scale-[0.99]"
                      >
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-[14px] font-black leading-none ${
                            idx < 3 ? "bg-[color-mix(in_oklch,var(--gold)_14%,transparent)] text-[var(--gold)]" : "text-[var(--muted-foreground)]"
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-[15px] font-semibold leading-snug text-[var(--foreground)]">{item.project}</span>
                          <span className="mt-1 flex items-center gap-1.5">
                            {item.department && item.department !== "未归属部门" ? (
                              <span className="max-w-[7rem] truncate rounded-full bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-1.5 py-0.5 text-[13px] text-[var(--accent)]">
                                {item.department}
                              </span>
                            ) : null}
                            <span className="truncate text-[13px] text-[var(--muted-foreground)]">节约 {item.savingsLabel}</span>
                          </span>
                        </span>
                        <span className="shrink-0 text-right leading-tight" style={{ color: rc }}>
                          <span className="block text-[12px] font-semibold text-[var(--muted-foreground)]">节资率</span>
                          <span className="mt-0.5 block text-[18px] font-black tabular-nums tracking-[-0.02em]">{item.savingsRate}%</span>
                        </span>
                        <ChevronRight size={14} className="shrink-0 text-[var(--muted-foreground)]" />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <EmptyState text="暂无已成交项目数据" />
              )}
            </SectionCard>

              </>
            ) : null}
            {analysisOpen === "risk" ? (
              <>

            {/* ── 风险项目预警 ── */}
            {data.riskProjects.length ? (
              <SectionCard
                icon={AlertCircle}
                title="风险项目预警"
                index={8}
                right={
                  <span className="shrink-0 rounded-full bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] px-2 py-0.5 text-[13px] font-bold text-[var(--danger)]">
                    {data.riskProjects.length} 项
                  </span>
                }
              >
                <div className="space-y-2">
                  {data.riskProjects.map((p, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => router.push(`/ledger?q=${encodeURIComponent(p.project)}`)}
                        aria-label={`查看 ${p.project} 台账`}
                        className="min-w-0 flex-1 rounded-[12px] border border-[color-mix(in_oklch,var(--danger)_18%,transparent)] bg-[color-mix(in_oklch,var(--danger)_4%,transparent)] px-3 py-2.5 text-left active:scale-[0.99]"
                      >
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.severity === "high" ? "var(--danger)" : "var(--warning)" }} />
                          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[var(--foreground)]">{p.project}</span>
                          <span className="shrink-0 text-[13px] font-bold text-[var(--danger)]">滞留 {p.pendingDays} 天</span>
                        </div>
                        <p className="mt-1 line-clamp-2 pl-4 text-[14px] leading-snug text-[var(--muted-foreground)]">{p.reason}</p>
                      </button>
                      {/* 一键转发（2026-11-03 用户裁定：允许转发类）：riskShared 状态与要报转发同款反馈 */}
                      <button
                        type="button"
                        aria-label={`转发 ${p.project} 风险提示`}
                        onClick={() => shareRisk(p)}
                        className="neu-btn-soft h-10 w-10 shrink-0 rounded-[10px] p-0 active:scale-95"
                      >
                        <Share2 size={13} />
                      </button>
                    </div>
                  ))}
                  {riskShared !== "idle" ? (
                    <div className="px-1 text-[12px] text-[var(--muted-foreground)]">
                      {riskShared === "ok" ? "已复制转发文案" : riskShared === "shared" ? "已调起系统分享" : "复制失败"}
                    </div>
                  ) : null}
                </div>
              </SectionCard>
            ) : null}

            {/* ── 资源告警（/alerts/overview——项目风险之外的第二雷达：资质临期/专家过载；
                口径=登录人视野，不随公司选择器——副注明示防误读（评审 F4）── */}
            {alerts ? (
              <SectionCard
                icon={Radar}
                title="资源告警"
                index={8.5}
                right={<span className="shrink-0 text-[13px] font-semibold text-[var(--muted-foreground)]">不随公司筛选</span>}
              >
                <div className="space-y-2">
                  {[
                    { label: "供应商资质 90 天内到期", n: alerts.expiringQualifications },
                    { label: "在编专家项目过载", n: alerts.overloadedExperts },
                  ].map((a) => (
                    <div
                      key={a.label}
                      className="flex items-center justify-between rounded-[12px] border border-[color-mix(in_oklch,var(--warning)_18%,transparent)] bg-[color-mix(in_oklch,var(--warning)_4%,transparent)] px-3 py-2.5"
                    >
                      <span className="text-[14px] text-[var(--foreground)]">{a.label}</span>
                      <span className={`text-[16px] font-black tabular-nums ${a.n > 0 ? "text-[var(--warning)]" : "text-[var(--muted-foreground)]"}`}>
                        {a.n}
                      </span>
                    </div>
                  ))}
                </div>
              </SectionCard>
            ) : null}

              </>
            ) : null}
            {analysisOpen === "supplier" ? (
              <>

            {/* ── 重点供应商动态 ── */}
            <SectionCard icon={FolderKanban} title="重点供应商动态"
              index={9}
            >
              {data.supplierStats.length ? (
                <div className="space-y-2">
                  {data.supplierStats.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setActiveSupplier(s)}
                      className="flex w-full items-center gap-2.5 rounded-[12px] m-tile px-3 py-2.5 text-left active:scale-[0.99]"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] text-[14px] font-bold text-[var(--accent)]">
                        {s.name.slice(0, 2)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold text-[var(--foreground)]">{s.name}</span>
                        <span className="mt-0.5 block text-[13px] text-[var(--muted-foreground)]">
                          中标 <span className="font-bold text-[var(--success)]">{s.winCount}</span>/{s.participatedCount} · 中标率 {s.hitRate}% · {s.awardAmountLabel}
                        </span>
                      </span>
                      <ChevronRight size={14} className="shrink-0 text-[var(--muted-foreground)]" />
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState text="暂无供应商动态" />
              )}
            </SectionCard>

              </>
            ) : null}
            {analysisOpen === "experts" ? (
              <>
            {/* ── 专家库（2026-11-19 用户裁定：AI 分析入口换专家库；开层懒取）── */}
            <SectionCard icon={GraduationCap} title="专家库总览" index={0}>
              {expertStats ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <MetricCard label="在库专家" value={String(expertStats.total)} tone="accent" />
                    <MetricCard label="可抽取" value={String(expertStats.availability.available)} tone="success" />
                    <MetricCard label="评标占用" value={String(expertStats.availability.occupied)} tone="warning" />
                    <MetricCard label="已退库" value={String(expertStats.availability.disabled)} />
                  </div>
                  <div className="space-y-0.5 rounded-[12px] m-tile px-3 py-2.5 text-[14px]">
                    <div className="flex justify-between gap-3">
                      <span className="text-[var(--muted-foreground)]">可抽取率</span>
                      <span className="font-medium tabular-nums text-[var(--foreground)]">{expertStats.availability.availableRate}%</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-[var(--muted-foreground)]">履职优良率（A/B 占比）</span>
                      <span className="font-medium tabular-nums text-[var(--foreground)]">{expertStats.evaluation.excellentRatio}%</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-[var(--muted-foreground)]">平均评分偏离度</span>
                      <span className="font-medium tabular-nums text-[var(--foreground)]">{expertStats.evaluation.avgScoreDeviation}</span>
                    </div>
                  </div>
                  {expertStats.specialties.length ? (
                    <div>
                      <div className="mb-2 text-[14px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">专业分布 Top</div>
                      <div className="space-y-1.5">
                        {expertStats.specialties.map((sp) => (
                          <div key={sp.name ?? "未填"} className="flex items-center gap-2">
                            <span className="w-[7.5rem] shrink-0 truncate text-[14px] font-medium text-[var(--foreground)]">{sp.name ?? "未填"}</span>
                            <span className="h-4 min-w-0 flex-1 overflow-hidden rounded-[5px] bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)]">
                              <span className="block h-full rounded-[5px] bg-[var(--gold)] opacity-80" style={{ width: `${sp.pct}%` }} />
                            </span>
                            <span className="w-[2.5rem] shrink-0 text-right text-[14px] font-bold tabular-nums text-[var(--foreground)]">{sp.count}人</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {expertCompanies?.length ? (
                    <div>
                      <div className="mb-2 text-[14px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">各公司在库（全库口径）</div>
                      <div className="space-y-1.5">
                        {expertCompanies.map((c) => (
                          <div key={c.name} className="flex items-center justify-between gap-2 rounded-[10px] m-tile px-3 py-2">
                            <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[var(--foreground)]">{c.name}</span>
                            <span className="shrink-0 text-[14px] font-bold tabular-nums text-[var(--accent)]">{c.count} 人</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <Skeleton lines={5} height={40} />
              )}
            </SectionCard>

              </>
            ) : null}
          </>
        ) : null}
    </>
  );

  /* 下钻弹层（两模式共用） */
  const drillSheets = (
    <>
      {/* ══ 下钻弹层 ══ */}

      <BottomSheet
        open={!!activeTrend}
        onClose={() => setActiveTrend(null)}
        title={
          <span className="flex items-center gap-2">
            <CalendarRange size={16} className="text-[var(--accent)]" />
            {activeTrend?.label ?? ""}
          </span>
        }
      >
        {activeTrend ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <MetricCard label="采购" value={`${activeTrend.count} 项`} tone="accent" />
              <MetricCard label="成交额" value={`${activeTrend.amount.toFixed(1)} 万`} tone="success" />
              <MetricCard label="立项" value={`${activeTrend.initiated ?? 0} 项`} />
              <MetricCard label="归档" value={`${activeTrend.archived ?? 0} 项`} />
            </div>
            <div>
              <div className="mb-2 text-[14px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">当日项目</div>
              <div className="space-y-1.5">
                {(activeTrend.projects ?? []).length ? (
                  (activeTrend.projects ?? []).map((p, i) => (
                    <ProjectRow key={i} name={p.name} meta={`${p.department} · ${p.method}`} amount={p.awardLabel || p.budgetLabel} status={p.status} />
                  ))
                ) : (
                  <EmptyState text="当日无项目" />
                )}
              </div>
            </div>
          </div>
        ) : null}
      </BottomSheet>

      <BottomSheet
        open={!!activeDept}
        onClose={() => setActiveDept(null)}
        title={
          <span className="flex items-center gap-2">
            <FolderKanban size={16} className="text-[var(--accent)]" />
            {activeDept?.name ?? ""}
          </span>
        }
      >
        {activeDept ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <MetricCard label="完成率" value={`${activeDept.completedRate}%`} tone="accent" />
              <MetricCard label="采购金额" value={activeDept.amountLabel} />
              <MetricCard label="主要方式" value={activeDept.topMethod || "-"} />
            </div>
            <div>
              <div className="mb-2 text-[14px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">采购项目</div>
              <div className="space-y-1.5">
                {(activeDept.projects ?? []).length ? (
                  (activeDept.projects ?? []).map((p, i) => (
                    <ProjectRow key={i} name={p.name} meta={`${p.date} · ${p.method}`} amount={p.awardLabel || p.budgetLabel} status={p.status} />
                  ))
                ) : (
                  <EmptyState text="该部门暂无项目" />
                )}
              </div>
            </div>
          </div>
        ) : null}
      </BottomSheet>

      <BottomSheet
        open={!!activeMethod}
        onClose={() => setActiveMethod(null)}
        title={
          <span className="flex items-center gap-2">
            <Layers size={16} className="text-[var(--success)]" />
            {activeMethod?.name ?? ""}
          </span>
        }
      >
        {activeMethod ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <MetricCard label="占比" value={`${activeMethod.share}%`} tone="success" />
              <MetricCard label="项目数" value={String(activeMethod.count)} tone="accent" />
              <MetricCard label="成交金额" value={activeMethod.amountLabel} />
            </div>
            <div>
              <div className="mb-2 text-[14px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">采购项目</div>
              <div className="space-y-1.5">
                {(activeMethod.projects ?? []).length ? (
                  (activeMethod.projects ?? []).map((p, i) => (
                    <ProjectRow key={i} name={p.name} meta={`${p.date} · ${p.department}`} amount={p.awardLabel || p.budgetLabel} status={p.status} />
                  ))
                ) : (
                  <EmptyState text="该方式暂无项目" />
                )}
              </div>
            </div>
          </div>
        ) : null}
      </BottomSheet>

      <BottomSheet
        open={!!activeSeg}
        onClose={() => setActiveSeg(null)}
        title={
          <span className="flex items-center gap-2">
            <BarChart3 size={16} className="text-[var(--warning)]" />
            {activeSeg?.label ?? ""}项目（{activeSeg?.range ?? ""}）
          </span>
        }
      >
        {activeSeg ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <MetricCard label="项目数" value={String(activeSeg.count)} tone="warning" />
              <MetricCard label="占比" value={`${activeSeg.share}%`} />
              <MetricCard label="金额合计" value={activeSeg.amountLabel} />
            </div>
            <div>
              <div className="mb-2 text-[14px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">项目列表</div>
              <div className="space-y-1.5">
                {segmentProjects(data, activeSeg).length ? (
                  segmentProjects(data, activeSeg).map((p, i) => (
                    <ProjectRow key={i} name={p.name} meta={`${p.date} · ${p.department}`} amount={p.budgetLabel} status={p.status} />
                  ))
                ) : (
                  <EmptyState text="该区间暂无项目" />
                )}
              </div>
            </div>
          </div>
        ) : null}
      </BottomSheet>

      <BottomSheet
        open={!!activeReason}
        onClose={() => setActiveReason(null)}
        title={
          <span className="flex items-center gap-2">
            <AlertCircle size={16} className="text-[var(--danger)]" />
            {activeReason?.label ?? ""}
          </span>
        }
      >
        {activeReason ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <MetricCard label="项目数" value={String(activeReason.count)} tone="danger" />
              <MetricCard label="说明" value={activeReason.detail} />
            </div>
            <div>
              <div className="mb-2 text-[14px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">相关项目</div>
              <div className="space-y-1.5">
                {(activeReason.projects ?? []).length ? (
                  (activeReason.projects ?? []).map((p, i) => (
                    <ProjectRow key={i} name={p.name} meta={`${p.date} · ${p.department}`} amount={p.budgetLabel} status="未成交" extra={p.reason} />
                  ))
                ) : (
                  <EmptyState text="暂无相关项目" />
                )}
              </div>
            </div>
          </div>
        ) : null}
      </BottomSheet>

      <BottomSheet open={!!activeSaving} onClose={() => setActiveSaving(null)} title={<span className="line-clamp-2">{activeSaving?.project ?? ""}</span>}>
        {activeSaving ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <MetricCard label="控制价" value={activeSaving.controlAmountLabel} />
              <MetricCard label="中标价" value={activeSaving.awardAmountLabel} tone="accent" />
              <MetricCard label="节约额" value={activeSaving.savingsLabel} tone="success" />
              <MetricCard label="节资率" value={`${activeSaving.savingsRate}%`} tone="success" />
            </div>
            <div className="space-y-1 rounded-[12px] m-tile px-3 py-2.5 text-[15px]">
              <div className="flex justify-between gap-3">
                <span className="text-[var(--muted-foreground)]">采购部门</span>
                <span className="font-medium text-[var(--foreground)]">{activeSaving.department}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[var(--muted-foreground)]">采购方式</span>
                <span className="font-medium text-[var(--foreground)]">{activeSaving.method}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[var(--muted-foreground)]">成交日期</span>
                <span className="font-medium tabular-nums text-[var(--foreground)]">{activeSaving.date}</span>
              </div>
              {activeSaving.projectCode ? (
                <div className="flex justify-between gap-3">
                  <span className="text-[var(--muted-foreground)]">项目编号</span>
                  <span className="font-medium tabular-nums text-[var(--foreground)]">{activeSaving.projectCode}</span>
                </div>
              ) : null}
              {activeSaving.awardedSupplierName ? (
                <div className="flex justify-between gap-3">
                  <span className="shrink-0 text-[var(--muted-foreground)]">中标供应商</span>
                  <span className="truncate font-medium text-[var(--foreground)]">{activeSaving.awardedSupplierName}</span>
                </div>
              ) : null}
              <div className="flex justify-between gap-3">
                <span className="text-[var(--muted-foreground)]">参与家数</span>
                <span className="font-medium tabular-nums text-[var(--foreground)]">{activeSaving.participantCount} 家</span>
              </div>
            </div>
          </div>
        ) : null}
      </BottomSheet>

      <BottomSheet
        open={!!activeSupplier}
        onClose={() => setActiveSupplier(null)}
        title={
          <span className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[15px] font-bold text-[var(--accent)]">
              {activeSupplier?.name.slice(0, 2)}
            </span>
            <span className="min-w-0 flex-1">{activeSupplier?.name ?? ""}</span>
          </span>
        }
      >
        {activeSupplier ? (
          <div className="space-y-3">
            {activeSupplier.tags.length ? (
              <div className="flex flex-wrap gap-1.5">
                {activeSupplier.tags.map((t) => (
                  <span key={t} className="rounded-full border border-[color-mix(in_oklch,var(--accent)_15%,transparent)] bg-[color-mix(in_oklch,var(--accent)_6%,transparent)] px-2 py-0.5 text-[13px] text-[var(--accent)]">
                    {t}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="grid grid-cols-3 gap-2">
              <MetricCard label="中标率" value={`${activeSupplier.hitRate}%`} tone="success" />
              <MetricCard label="中标数" value={String(activeSupplier.winCount)} tone="success" />
              <MetricCard label="参与数" value={String(activeSupplier.participatedCount)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <MetricCard label="主要方式" value={activeSupplier.topMethod} />
              <MetricCard label="活跃部门" value={activeSupplier.topDepartment} />
            </div>
            {activeSupplier.recentProcurements.length ? (
              <div>
                <div className="mb-2 text-[14px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">近期参与</div>
                <div className="space-y-1.5">
                  {activeSupplier.recentProcurements.slice(0, 4).map((p, i) => (
                    <ProjectRow key={i} name={p.project} meta={`${p.date} · ${p.department}`} amount={p.budgetLabel} status={p.result} />
                  ))}
                </div>
              </div>
            ) : null}
            {activeSupplier.winProjects.length ? (
              <div>
                <div className="mb-2 text-[14px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">中标项目</div>
                <div className="space-y-1.5">
                  {activeSupplier.winProjects.slice(0, 3).map((p, i) => (
                    <ProjectRow key={i} name={p.project} meta={`${p.date} · ${p.department}`} amount={p.awardAmountLabel} status="已成交" />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </BottomSheet>
    </>
  );

  /* 页面模式（/analysis/[key] 页面套壳）：口径选择器 + 板块内容 + 下钻弹层 */
  if (panel) {
    return (
      <div>
        <div className="mb-3 flex items-center justify-end gap-2">{scopeSelectors}</div>
        {analysisGroups}
        {drillSheets}
      </div>
    );
  }

  return (
    <div>
      <PullIndicator pull={pull} refreshing={refreshing} />

      {/* ── 今日关注条（2026-11-18 用户裁定「AI 感太重」：三句小作文收为一行事实句——
          只报风险/拥堵事项；无事 focus:null、失败 available:false 均不渲染，无骨架态）── */}
      {brief?.available && brief.focus ? (
        <button
          type="button"
          onClick={() => router.push(brief.focus!.jump)}
          className="mb-3 flex w-full items-center gap-2 rounded-[14px] px-3.5 py-2.5 text-left active:scale-[0.99]"
          style={{ background: "color-mix(in oklch, var(--warning) 7%, oklch(0.99 0.005 258))" }}
        >
          <AlertTriangle size={15} className="shrink-0 text-[var(--warning)]" />
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[var(--foreground)]">{brief.focus.text}</span>
          <ChevronRight size={13} className="shrink-0 text-[var(--muted-foreground)]" />
        </button>
      ) : null}

      {error ? <ErrorBanner message={error} onRetry={() => setRetryTick((t) => t + 1)} /> : null}

      {loading && !data ? (
        <div className="neu-card-static rounded-[18px] p-3.5">
          <Skeleton lines={4} height={52} />
        </div>
      ) : null}


      {/* ── 数据总览（2026-11-19 v3 全景裁定：进门先给全量数字，8 格 4×2；同日用户裁定
           上移至实时态势上方、套同款 SectionCard 格式；卡片头右侧两个原地选择器（区间
           档+公司多选各自独立、锚定原地展开，默认全部·全部公司，「全部」档无区间不显同比/环比子行）。首排=项目盘点（总数/
           归档=台账全量/进行中/异常=终止，当前状态快照仅随公司口径）；次排=区间轮次
           金额四数；可点的两步到对应明细/分析）── */}
      {data && summary ? (
        <SectionCard
          icon={Gauge}
          title="数据总览"
          index={0}
          right={scopeSelectors}
        >
          {/* 总览卡重设计（2026-11-19 用户裁定「突兀」）：两排分区——项目盘点（存量）与
              金额（随区间）各带组标、排间 hairline；格内层级=值→标签→同比环比 */}
          {(() => {
            const tile = (m: (typeof overviewTiles)[number]) => {
              const inner = (
                <>
                  <div
                    className={`max-w-full truncate text-center text-[16px] font-black leading-none tabular-nums ${m.danger ? "text-[var(--danger)]" : m.success ? "text-[var(--success)]" : "text-[var(--foreground)]"}`}
                  >
                    {m.value}
                  </div>
                  <div className="mt-1 truncate text-center text-[12px] text-[var(--muted-foreground)]">{m.label}</div>
                  {queryRange.startDate ? (
                    <div className="mt-1 flex items-center justify-center gap-1.5 text-[10px] font-bold leading-none tabular-nums">
                      <span className={ratioCls(m.yoy)}>同比 {ratioTxt(m.yoy)}</span>
                      <span className={ratioCls(m.hb)}>环比 {ratioTxt(m.hb)}</span>
                    </div>
                  ) : null}
                </>
              );
              return m.onTap ? (
                <button key={m.label} type="button" onClick={m.onTap} className="rounded-[12px] m-tile px-1 py-2.5 text-center active:scale-[0.98]">
                  {inner}
                </button>
              ) : (
                <div key={m.label} className="rounded-[12px] m-tile px-1 py-2.5 text-center">
                  {inner}
                </div>
              );
            };
            const group = (caption: string, list: typeof overviewTiles) => (
              <div>
                <div className="mb-1.5 px-1 text-[11px] font-bold tracking-[0.08em] text-[var(--muted-foreground)]">{caption}</div>
                <div className="grid grid-cols-4 gap-2.5">{list.map(tile)}</div>
              </div>
            );
            return (
              <div className="space-y-3">
                {group(`项目盘点 · ${rangeKey === "custom" ? "所选区间" : RANGES[rangeKey as PresetKey].label}`, overviewTiles.slice(0, 4))}
                <div className="h-px bg-[color-mix(in_oklch,var(--border)_45%,transparent)]" aria-hidden />
                {group(`金额 · ${rangeKey === "custom" ? "所选区间" : RANGES[rangeKey as PresetKey].label}`, overviewTiles.slice(4))}
              </div>
            );
          })()}
        </SectionCard>
      ) : null}

      {/* ── 实时运行态势（2026-11-19 标段生命周期裁定：四 KPI=运行中/标前/标中/标后，
           卡片头同款双选择器；进行中开评标实名录 30s 轮询）── */}
      <SectionCard
        icon={Radio}
        title="实时运行态势"
        index={0.5}
        right={
          <>
            <InlineSelect
              label={bidRangeKey === "custom" && bidCustomRange ? `${bidCustomRange.from.slice(5).replace("-", "/")}~${bidCustomRange.to.slice(5).replace("-", "/")}` : RANGES[bidRangeKey as PresetKey].label}
              active={bidRangeKey !== "all"}
              options={(Object.keys(RANGES) as PresetKey[]).reverse().map((k) => ({ value: k, label: RANGES[k].label }))}
              selected={[bidRangeKey]}
              onSelect={(next) => setBidRangeKey(next[0] as RangeKey)}
              onCustomApply={(from, to) => {
                setBidCustomRange({ from, to });
                setBidRangeKey("custom");
              }}
              customValue={bidCustomRange}
              customFirst
              ariaLabel="态势数据区间"
            />
            {role === "admin" ? (
              <InlineSelect
                multiple
                label={bidCompanyLabel}
                active={bidCompanyIds.length > 0}
                options={[
                  { value: "all", label: "全部公司" },
                  ...(companies ?? []).map((c) => ({ value: c.id, label: c.name })),
                ]}
                selected={bidCompanyIds.length === 0 ? ["all"] : bidCompanyIds}
                onSelect={(next) => {
                  const hadAll = bidCompanyIds.length === 0;
                  if (next.includes("all") && !hadAll) setBidCompanyIds([]);
                  else setBidCompanyIds(next.filter((v) => v !== "all"));
                }}
                ariaLabel={`态势公司口径：${bidCompanyLabel}`}
              />
            ) : null}
            {openingNow.length + evaluatingNow.length > 0 ? (
              <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--danger)] opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--danger)]" />
              </span>
            ) : null}
          </>
        }
      >
        {/* 两排分区（2026-11-19 用户裁定「像数据总览一样」）：上=标段盘点 KPI、下=当前桶
            实名录，排间 hairline；格内层级=值→标签→同比环比（同总览 v3 重设计，选中桶 accent） */}
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 px-1 text-[11px] font-bold tracking-[0.08em] text-[var(--muted-foreground)]">
              标段盘点 · {bidRangeKey === "custom" ? "所选区间" : RANGES[bidRangeKey as PresetKey].label}
            </div>
            <div className="grid grid-cols-4 gap-2.5">
              {(() => {
                /* 标段四 KPI（2026-11-19 用户裁定）：运行中=标前+标中、标前=确认开标前
                   （DOWNLOAD/SUBMIT）、标中=已确认开标未完成开评标（OPENING/EVALUATING）、
                   标后=完成开评标（ARCHIVED）；「全部」档隐藏同比/环比子行（同总览裁定） */
                const bf = bidStage?.flow ?? null;
                const bstat = (k: "running" | "pre" | "in" | "post") => ({
                  yoy: bf ? deltaOf(bf.cur[k], bf.yoy[k], null) : undefined,
                  hb: bf ? deltaOf(bf.cur[k], bf.prev[k], null) : undefined,
                });
                return (Object.keys(BID_BUCKET_LABELS) as BidStageBucket[]).map((k) => {
                  const st = bstat(k);
                  const n = bidStage?.[k];
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setBidBucket(k)}
                      aria-pressed={bidBucket === k}
                      className={`rounded-[12px] m-tile px-1 py-2.5 text-center active:scale-[0.98] ${bidBucket === k ? "bg-[color-mix(in_oklch,var(--accent)_8%,transparent)]" : ""}`}
                      aria-label={`${BID_BUCKET_LABELS[k]} ${n ?? "—"} 项，点看最新项目`}
                    >
                      <div
                        className={`max-w-full truncate text-center text-[16px] font-black leading-none tabular-nums ${
                          n == null ? "text-[var(--muted-foreground)]" : bidBucket === k ? "text-[var(--accent)]" : "text-[var(--foreground)]"
                        }`}
                      >
                        {n ?? "—"}
                      </div>
                      <div className={`mt-1 truncate text-center text-[12px] ${bidBucket === k ? "font-semibold text-[var(--accent)]" : "text-[var(--muted-foreground)]"}`}>
                        {BID_BUCKET_LABELS[k]}
                      </div>
                      {queryBidRange.startDate ? (
                        <div className="mt-1 flex items-center justify-center gap-1.5 text-[10px] font-bold leading-none tabular-nums">
                          <span className={ratioCls(st.yoy)}>同比 {ratioTxt(st.yoy)}</span>
                          <span className={ratioCls(st.hb)}>环比 {ratioTxt(st.hb)}</span>
                        </div>
                      ) : null}
                    </button>
                  );
                });
              })()}
            </div>
          </div>

          <div className="h-px bg-[color-mix(in_oklch,var(--border)_45%,transparent)]" aria-hidden />

          <div>
            <div className="mb-1 px-1 text-[11px] font-bold tracking-[0.08em] text-[var(--muted-foreground)]">
              {BID_BUCKET_LABELS[bidBucket]} · 最新
            </div>
            <div className="space-y-1.5">
              {/* 桶内最新 5 项（2026-11-19 用户裁定）：状态行规则后端解析——
                  标后=中标单位·当前步骤；标前=当前步骤/已投·专家；标中=开标时间·等待开标/开标中/归档中 */}
              {(bidRows ?? []).slice(0, 5).map((r) => (
                <div key={r.id} className="flex items-center gap-2 px-1 text-[13px] text-[var(--muted-foreground)]">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: bidBucket === "in" ? "var(--warning)" : bidBucket === "post" ? "var(--success)" : "var(--accent)" }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[var(--foreground)]">{r.name}</span>
                  <span className="max-w-[55%] shrink-0 truncate tabular-nums">{r.status}</span>
                </div>
              ))}
              {bidRows && bidRows.length === 0 ? (
                <div className="py-0.5 text-center text-[13px] text-[var(--muted-foreground)]">该阶段暂无项目</div>
              ) : null}
            </div>
          </div>
        </div>
      </SectionCard>

      {data && summary ? (
        <>
          {/* ── 分析中心（一屏总览：其余分析卡分五组收进弹层，2026-11-17 spec）── */}
          <div className="mb-3 grid grid-cols-3 gap-2">
            {ANALYSIS_TILES.map((t, i) => (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  if (t.key === "ledger") router.push("/ledger");
                  else if (t.key === "progress") router.push("/progress");
                  else router.push(`/analysis/${t.key}`);
                }}
                className="neu-card-static m-rise flex flex-col items-center gap-2 rounded-[16px] px-2 py-3.5 active:scale-[0.98]"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-[13px]"
                  style={{ background: `color-mix(in oklch, ${t.color} 12%, transparent)`, color: t.color }}
                >
                  <t.icon size={20} strokeWidth={1.5} />
                </span>
                <span className="text-[14px] font-semibold text-[var(--foreground)]">{t.label}</span>
              </button>
            ))}
          </div>

        </>
      ) : null}


      {/* ══ 分析中心分组弹层（宫格入口；卡片原样搬入——本层挂在下钻弹层之前，同 z-50 时后开下钻层居上）══ */}
      <BottomSheet
        open={!!manualOpen}
        onClose={() => setManualOpen(null)}
        title={
          <span className="flex items-center gap-2">
            {(() => {
              const t = ANALYSIS_TILES.find((x) => x.key === analysisOpen);
              return t ? <t.icon size={16} style={{ color: t.color }} /> : null;
            })()}
            {ANALYSIS_TILES.find((x) => x.key === analysisOpen)?.label ?? ""}
          </span>
        }
      >
        {analysisGroups}
            </BottomSheet>

        {drillSheets}
    </div>
  );
}

export default function DashboardPage() {
  return <DashboardHome />;
}
