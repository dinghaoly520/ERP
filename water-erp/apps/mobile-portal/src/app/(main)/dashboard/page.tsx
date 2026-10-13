"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  CalendarRange,
  ChevronRight,
  FolderKanban,
  Layers,
  Lightbulb,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { fetchCurrentUser, fetchCompanies, type AuthRole, type CompanyOption } from "@/lib/api/auth";
import { fetchDashboardData, type DashboardData } from "@/lib/api/dashboard";
import { fetchDashboardAnalysis, type DashboardAnalysisResult } from "@/lib/api/ai";
import { BottomSheet } from "@/components/m/bottom-sheet";
import { SectionCard } from "@/components/m/section-card";
import { MetricCard } from "@/components/m/metric-card";
import { Chip } from "@/components/m/chip";
import { ErrorBanner } from "@/components/m/error-banner";
import { EmptyState } from "@/components/m/empty-state";
import { Skeleton } from "@/components/m/skeleton";

/* ── 工具 ── */

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type RangeKey = "month" | "quarter" | "year" | "all";

const RANGE_LABELS: Record<string, string> = { month: "本月", quarter: "本季", year: "本年", all: "全部" };

function rangeFor(key: RangeKey): { startDate?: string; endDate?: string } {
  const now = new Date();
  const y = now.getFullYear();
  if (key === "month") return { startDate: iso(new Date(y, now.getMonth(), 1)) };
  if (key === "quarter") return { startDate: iso(new Date(y, Math.floor(now.getMonth() / 3) * 3, 1)) };
  if (key === "year") return { startDate: `${y}-01-01` };
  return {};
}

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
    <div className="rounded-[10px] border border-[var(--border)] bg-white/55 px-3 py-2.5">
      <div className="line-clamp-2 text-[12px] font-semibold leading-snug text-[var(--foreground)]">{name}</div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
        <span className="min-w-0 flex-1 truncate">{meta}</span>
        <span className="shrink-0 font-bold tabular-nums text-[var(--foreground)]">{amount}</span>
        <span className={`shrink-0 text-[11px] ${statusColor(status)}`}>{status}</span>
      </div>
      {extra ? <div className="mt-0.5 text-[11px] text-[var(--danger)]">{extra}</div> : null}
    </div>
  );
}

/* ── 主页面 ── */

export default function DashboardPage() {
  const [role, setRole] = useState<AuthRole | null>(null);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [companyId, setCompanyId] = useState<string>("all");

  const [rangeKey, setRangeKey] = useState<RangeKey>("year");
  const [showCustom, setShowCustom] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [customApplied, setCustomApplied] = useState<{ startDate?: string; endDate?: string }>({});

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  // 各下钻弹层
  const [activeTrend, setActiveTrend] = useState<DashboardData["trendSeries"][number] | null>(null);
  const [activeDept, setActiveDept] = useState<DashboardData["departmentStats"][number] | null>(null);
  const [activeMethod, setActiveMethod] = useState<DashboardData["methodStats"][number] | null>(null);
  const [activeReason, setActiveReason] = useState<DashboardData["nonAwardReasons"][number] | null>(null);
  const [activeSaving, setActiveSaving] = useState<DashboardData["savingsRanking"][number] | null>(null);
  const [activeSupplier, setActiveSupplier] = useState<DashboardData["supplierStats"][number] | null>(null);

  // AI 综合分析（按需生成）
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<DashboardAnalysisResult | null>(null);

  const effRange = rangeKey === "all" ? {} : rangeFor(rangeKey);
  const usingCustom = Boolean(customApplied.startDate || customApplied.endDate);
  const queryRange = usingCustom ? customApplied : effRange;

  useEffect(() => {
    let active = true;
    fetchCurrentUser()
      .then((u) => {
        if (active) setRole(u.role);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (role !== "admin") return;
    let active = true;
    fetchCompanies()
      .then((list) => {
        if (active) setCompanies(list);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [role]);

  const loadData = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchDashboardData(queryRange.startDate, queryRange.endDate, companyId === "all" ? undefined : companyId)
      .then((d) => {
        setData(d);
        setAiResult(null); // 口径变化后旧分析作废
        setAiError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "加载仪表盘数据失败");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryRange.startDate, queryRange.endDate, companyId, retryTick]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const summary = data?.summary;

  /* 趋势图几何 */
  const trend = useMemo(() => {
    const series = data?.trendSeries ?? [];
    const n = series.length;
    if (n === 0) return null;
    const W = 340;
    const H = 150;
    const padL = 6;
    const padR = 6;
    const padT = 14;
    const padB = 22;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const maxAmount = Math.max(...series.map((t) => t.amount), 1);
    const maxCount = Math.max(...series.map((t) => t.count), 1);
    const x = (i: number) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const amountY = (v: number) => padT + plotH - (v / maxAmount) * plotH * 0.86;
    const linePath = series
      .map((t, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${amountY(t.amount).toFixed(1)}`)
      .join(" ");
    const labelStep = Math.max(1, Math.ceil(n / 5));
    return { W, H, padT, plotH, x, amountY, maxCount, linePath, series, labelStep };
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

  async function runAnalysis() {
    if (!data || aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const result = await fetchDashboardAnalysis({
        rangeLabel: RANGE_LABELS[rangeKey] ?? "自定义",
        startDate: queryRange.startDate ?? "",
        endDate: queryRange.endDate ?? "",
        summary: {
          totalCount: data.summary.totalCount,
          completedCount: data.summary.completedCount,
          abnormalCount: data.summary.abnormalCount,
          totalBudget: data.summary.totalBudgetLabel,
          totalAward: data.summary.totalAwardLabel,
          totalSavings: data.summary.totalSavingsLabel,
        },
        trendSeries: data.trendSeries.map((t) => ({ label: t.label, count: t.count, amount: t.amount })),
        departmentStats: data.departmentStats.map((d) => ({ name: d.name, amount: d.amountLabel })),
        methodStats: data.methodStats.map((m) => ({ name: m.name, share: String(m.share) })),
        attachmentProgress: data.attachmentProgress.map((a) => ({ label: a.label, rate: String(a.rate) })),
        supplierStats: data.supplierStats.slice(0, 5).map((s) => ({
          name: s.name,
          participatedCount: s.participatedCount,
          winCount: s.winCount,
          awardAmount: s.awardAmountLabel,
        })),
        resultStats: data.resultStats.map((r) => ({ label: r.label, count: r.count, amount: r.amountLabel })),
        nonAwardReasons: data.nonAwardReasons.map((r) => ({ label: r.label, count: r.count, detail: r.detail })),
        riskProjects: data.riskProjects.map((r) => ({
          project: r.project,
          department: r.department,
          reason: r.reason,
          pendingDays: r.pendingDays,
          severity: r.severity,
        })),
      });
      setAiResult(result);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI 分析生成失败");
    } finally {
      setAiLoading(false);
    }
  }

  const savingsTop = (data?.savingsRanking ?? []).slice(0, 5);

  return (
    <div>
      {/* ── 顶部控制行：范围 + 公司 ── */}
      <div className="mb-3 space-y-2">
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {(Object.keys(RANGE_LABELS) as RangeKey[]).map((key) => (
            <Chip
              key={key}
              active={rangeKey === key && !usingCustom}
              onClick={() => {
                setRangeKey(key);
                setCustomApplied({});
                setCustomStart("");
                setCustomEnd("");
              }}
            >
              {RANGE_LABELS[key]}
            </Chip>
          ))}
          <Chip active={showCustom} onClick={() => setShowCustom((v) => !v)}>
            自定义
          </Chip>
        </div>
        {showCustom ? (
          <div className="neu-card-static flex items-center gap-2 rounded-[14px] p-2.5">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              aria-label="开始日期"
              className="h-10 min-w-0 flex-1 rounded-[9px] border border-[var(--border)] bg-white/70 px-2 text-[13px] tabular-nums text-[var(--foreground)]"
            />
            <span className="shrink-0 text-xs text-[var(--muted-foreground)]">至</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              aria-label="结束日期"
              className="h-10 min-w-0 flex-1 rounded-[9px] border border-[var(--border)] bg-white/70 px-2 text-[13px] tabular-nums text-[var(--foreground)]"
            />
            <button
              type="button"
              onClick={() => setCustomApplied({ startDate: customStart || undefined, endDate: customEnd || undefined })}
              className="neu-btn-soft h-10 shrink-0 !rounded-[9px] !px-3 text-xs"
            >
              应用
            </button>
          </div>
        ) : null}
        {role === "admin" ? (
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            aria-label="公司筛选"
            className="h-10 w-full rounded-[12px] border border-[var(--border)] bg-white/70 px-3 text-[13px] font-medium text-[var(--foreground)]"
          >
            <option value="all">全部公司</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.shortName || c.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => setRetryTick((t) => t + 1)} /> : null}

      {loading && !data ? (
        <div className="neu-card-static rounded-[18px] p-3.5">
          <Skeleton lines={4} height={52} />
        </div>
      ) : null}

      {data && summary ? (
        <>
          {/* ── 汇总指标 ── */}
          <div className="mb-3 grid grid-cols-2 gap-2">
            <MetricCard label="项目总数" value={String(summary.totalCount)} tone="accent" sub={`已完成 ${summary.completedCount}`} />
            <MetricCard label="异常项目" value={String(summary.abnormalCount)} tone="danger" />
            <MetricCard label="总预算" value={summary.totalBudgetLabel} />
            <MetricCard label="已成交预算" value={summary.awardedBudgetLabel} />
            <MetricCard label="成交总额" value={summary.totalAwardLabel} tone="success" />
            <MetricCard label="累计节资" value={summary.totalSavingsLabel} tone="success" />
          </div>

          {/* ── 采购执行趋势 ── */}
          <SectionCard
            icon={BarChart3}
            title="采购执行趋势"
            right={<span className="shrink-0 text-[10px] font-semibold text-[var(--muted-foreground)]">柱=数量 · 线=金额(万)</span>}
          >
            {trend ? (
              <svg viewBox="0 0 340 150" className="w-full" role="img" aria-label="采购执行趋势图">
                {trend.series.map((t, i) => {
                  const barH = (t.count / trend.maxCount) * (trend.plotH * 0.55);
                  return (
                    <rect
                      key={`bar-${i}`}
                      x={trend.x(i) - 6}
                      y={trend.padT + trend.plotH - barH}
                      width={12}
                      height={Math.max(barH, t.count > 0 ? 2 : 0)}
                      rx={2}
                      fill="var(--accent)"
                      opacity={0.22}
                    />
                  );
                })}
                <path d={trend.linePath} fill="none" stroke="var(--success)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {trend.series.map((t, i) => (
                  <g key={`pt-${i}`}>
                    <circle cx={trend.x(i)} cy={trend.amountY(t.amount)} r={3} fill="var(--success)" />
                    <circle
                      cx={trend.x(i)}
                      cy={trend.amountY(t.amount)}
                      r={11}
                      fill="transparent"
                      onClick={() => setActiveTrend(t)}
                      style={{ cursor: "pointer" }}
                    />
                    {i % trend.labelStep === 0 ? (
                      <text x={trend.x(i)} y={148} textAnchor="middle" fontSize={8.5} fill="var(--muted-foreground)">
                        {t.label.slice(-5)}
                      </text>
                    ) : null}
                  </g>
                ))}
              </svg>
            ) : (
              <EmptyState text="该范围内暂无趋势数据" />
            )}
          </SectionCard>

          {/* ── 各部门采购分布 ── */}
          <SectionCard icon={FolderKanban} title="各部门采购分布">
            {data.departmentStats.length ? (
              <div className="space-y-2">
                {data.departmentStats.map((d, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActiveDept(d)}
                    className="w-full rounded-[12px] border border-[var(--border)] bg-white/55 px-3 py-2.5 text-left active:scale-[0.99]"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--foreground)]">{d.name}</span>
                      <span className="shrink-0 text-[12px] font-bold tabular-nums text-[var(--accent)]">{d.amountLabel}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--muted-foreground)_12%,transparent)]">
                        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.min(d.completedRate, 100)}%` }} />
                      </div>
                      <span className="shrink-0 text-[10px] font-semibold tabular-nums text-[var(--muted-foreground)]">完成率 {d.completedRate}%</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState text="暂无部门数据" />
            )}
          </SectionCard>

          {/* ── 采购方式分布（环形图）── */}
          <SectionCard icon={Layers} title="采购方式分布">
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
                      style={{ cursor: "pointer" }}
                    />
                  ))}
                  <text x={75} y={71} textAnchor="middle" fontSize={17} fontWeight={700} fill="var(--foreground)">
                    {methodDonut.total}
                  </text>
                  <text x={75} y={86} textAnchor="middle" fontSize={9} fill="var(--muted-foreground)">
                    总项目
                  </text>
                </svg>
                <div className="min-w-0 flex-1 space-y-1.5">
                  {methodDonut.segs.slice(0, 6).map((seg, i) => (
                    <button key={i} type="button" onClick={() => setActiveMethod(seg.m)} className="flex w-full items-center gap-2 text-left">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: seg.color }} />
                      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--foreground)]">{seg.m.name}</span>
                      <span className="shrink-0 text-[11px] font-bold tabular-nums text-[var(--muted-foreground)]">{seg.m.share}%</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState text="暂无采购方式数据" />
            )}
          </SectionCard>

          {/* ── 结果构成 ── */}
          <SectionCard title="结果构成">
            {data.resultStats.length ? (
              <div className="grid grid-cols-3 gap-2">
                {data.resultStats.map((r, i) => (
                  <div key={i} className="rounded-[12px] border border-[var(--border)] bg-white/55 px-2 py-2 text-center">
                    <div className="text-[10px] text-[var(--muted-foreground)]">{r.label}</div>
                    <div className="mt-1 text-[16px] font-black leading-none tabular-nums" style={{ color: r.accent }}>
                      {r.count}
                    </div>
                    <div className="mt-1 truncate text-[9px] tabular-nums text-[var(--muted-foreground)]">{r.amountLabel}</div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="暂无结果数据" />
            )}
          </SectionCard>

          {/* ── 未成交原因分析 ── */}
          {data.nonAwardReasons.length ? (
            <SectionCard icon={AlertCircle} title="未成交原因分析">
              <div className="space-y-2">
                {data.nonAwardReasons.map((r, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setActiveReason(r)}
                    className="flex w-full items-center gap-2.5 rounded-[12px] border border-[var(--border)] bg-white/55 px-3 py-2.5 text-left active:scale-[0.99]"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] text-[11px] font-black text-[var(--danger)]">
                      {r.count}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold text-[var(--foreground)]">{r.label}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-[var(--muted-foreground)]">{r.detail}</span>
                    </span>
                    <ChevronRight size={14} className="shrink-0 text-[var(--muted-foreground)]" />
                  </button>
                ))}
              </div>
            </SectionCard>
          ) : null}

          {/* ── 节资率排行 Top5 ── */}
          <SectionCard
            icon={TrendingUp}
            title="节资率项目排行"
            right={
              <span className="shrink-0 rounded-full bg-[color-mix(in_oklch,var(--success)_10%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--success)]">
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
                      className="flex w-full items-start gap-2.5 rounded-[12px] border border-[var(--border)] bg-white/55 px-3 py-2.5 text-left active:scale-[0.99]"
                    >
                      <span className="flex h-8 w-8 shrink-0 flex-col items-center justify-center rounded-[9px] bg-[color-mix(in_oklch,var(--success)_10%,transparent)]">
                        <span className="text-[10px] font-black leading-none" style={{ color: rc }}>
                          {idx + 1}
                        </span>
                        <span className="mt-0.5 text-[9px] font-bold leading-none" style={{ color: rc }}>
                          {item.savingsRate}%
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-[12px] font-semibold leading-snug text-[var(--foreground)]">{item.project}</span>
                        <span className="mt-1 flex items-center gap-1.5">
                          <span className="max-w-[7rem] truncate rounded-full bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">
                            {item.department}
                          </span>
                          <span className="truncate text-[10px] text-[var(--muted-foreground)]">节约 {item.savingsLabel}</span>
                        </span>
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

          {/* ── 风险项目预警 ── */}
          {data.riskProjects.length ? (
            <SectionCard
              icon={AlertCircle}
              title="风险项目预警"
              right={
                <span className="shrink-0 rounded-full bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--danger)]">
                  {data.riskProjects.length} 项
                </span>
              }
            >
              <div className="space-y-2">
                {data.riskProjects.map((p, i) => (
                  <div key={i} className="rounded-[12px] border border-[color-mix(in_oklch,var(--danger)_18%,transparent)] bg-[color-mix(in_oklch,var(--danger)_4%,transparent)] px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.severity === "high" ? "var(--danger)" : "var(--warning)" }} />
                      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--foreground)]">{p.project}</span>
                      <span className="shrink-0 text-[10px] font-bold text-[var(--danger)]">滞留 {p.pendingDays} 天</span>
                    </div>
                    <p className="mt-1 line-clamp-2 pl-4 text-[11px] leading-snug text-[var(--muted-foreground)]">{p.reason}</p>
                  </div>
                ))}
              </div>
            </SectionCard>
          ) : null}

          {/* ── 重点供应商动态 ── */}
          <SectionCard icon={FolderKanban} title="重点供应商动态">
            {data.supplierStats.length ? (
              <div className="space-y-2">
                {data.supplierStats.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setActiveSupplier(s)}
                    className="flex w-full items-center gap-2.5 rounded-[12px] border border-[var(--border)] bg-white/55 px-3 py-2.5 text-left active:scale-[0.99]"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] text-[11px] font-bold text-[var(--accent)]">
                      {s.name.slice(0, 2)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold text-[var(--foreground)]">{s.name}</span>
                      <span className="mt-0.5 block text-[10px] text-[var(--muted-foreground)]">
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

          {/* ── AI 综合分析（折叠卡）── */}
          <SectionCard
            icon={Sparkles}
            title="AI 综合分析"
            right={
              <button type="button" onClick={() => setAiOpen((v) => !v)} className="neu-btn-soft !h-8 !rounded-[9px] !px-2.5 !text-[11px]">
                {aiOpen ? "收起" : "展开"}
              </button>
            }
          >
            {aiOpen ? (
              <div>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 text-[11px] text-[var(--muted-foreground)]">
                    {aiResult ? "以下为当前口径的分析结果" : "基于当前筛选数据生成综合研判"}
                  </span>
                  <button
                    type="button"
                    onClick={runAnalysis}
                    disabled={aiLoading || !data}
                    className="neu-btn-primary !h-9 !rounded-[10px] !px-3.5 text-xs disabled:opacity-60"
                  >
                    {aiLoading ? (
                      <>
                        <RefreshCw size={12} className="animate-spin" /> 分析中
                      </>
                    ) : (
                      "生成分析"
                    )}
                  </button>
                </div>
                {aiError ? (
                  <div className="mb-3 flex items-center gap-2 rounded-[12px] border border-[color-mix(in_oklch,var(--danger)_25%,transparent)] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-3 py-2.5 text-xs text-[var(--danger)]">
                    <AlertCircle size={13} /> {aiError}
                  </div>
                ) : null}
                {aiResult ? (
                  <div className="space-y-2.5">
                    <div className="rounded-[12px] border border-[var(--border)] bg-white/60 px-3.5 py-3">
                      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] text-[var(--accent)]">
                        <Target size={11} /> 综合研判
                      </div>
                      <p className="text-[13px] font-medium leading-relaxed text-[var(--foreground)]">{aiResult.overview}</p>
                    </div>
                    {aiResult.highlights.length ? (
                      <div className="rounded-[12px] border border-[var(--border)] bg-white/60 px-3.5 py-3">
                        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] text-[var(--success)]">
                          <TrendingUp size={11} /> 核心亮点
                        </div>
                        {aiResult.highlights.map((h, i) => (
                          <div key={i} className="flex items-start gap-2 py-0.5">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--success)]" />
                            <span className="text-[12px] leading-relaxed text-[var(--foreground)]">{h}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {aiResult.concerns.length ? (
                      <div className="rounded-[12px] border border-[var(--border)] bg-white/60 px-3.5 py-3">
                        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] text-[var(--warning)]">
                          <AlertCircle size={11} /> 待关注
                        </div>
                        {aiResult.concerns.map((c, i) => (
                          <div key={i} className="flex items-start gap-2 py-0.5">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--warning)]" />
                            <span className="text-[12px] leading-relaxed text-[var(--foreground)]">{c}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {aiResult.suggestions.length ? (
                      <div className="rounded-[12px] border border-[var(--border)] bg-white/60 px-3.5 py-3">
                        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] text-[var(--accent)]">
                          <Lightbulb size={11} /> 建议方向
                        </div>
                        {aiResult.suggestions.map((s, i) => (
                          <div key={i} className="flex items-start gap-2 py-0.5">
                            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[9px] font-bold text-[var(--accent)]">
                              {i + 1}
                            </span>
                            <span className="text-[12px] leading-relaxed text-[var(--foreground)]">{s}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <EmptyState text="点击「生成分析」获取 AI 综合研判" />
                )}
              </div>
            ) : (
              <p className="px-1 text-[11px] text-[var(--muted-foreground)]">展开后可基于当前数据生成综合研判 / 亮点 / 建议方向</p>
            )}
          </SectionCard>
        </>
      ) : null}

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
              <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">当日项目</div>
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
              <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">采购项目</div>
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
              <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">采购项目</div>
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
              <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">相关项目</div>
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
            <div className="space-y-1 rounded-[12px] border border-[var(--border)] bg-white/55 px-3 py-2.5 text-[12px]">
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
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[12px] font-bold text-[var(--accent)]">
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
                  <span key={t} className="rounded-full border border-[color-mix(in_oklch,var(--accent)_15%,transparent)] bg-[color-mix(in_oklch,var(--accent)_6%,transparent)] px-2 py-0.5 text-[10px] text-[var(--accent)]">
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
                <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">近期参与</div>
                <div className="space-y-1.5">
                  {activeSupplier.recentProcurements.slice(0, 4).map((p, i) => (
                    <ProjectRow key={i} name={p.project} meta={`${p.date} · ${p.department}`} amount={p.budgetLabel} status={p.result} />
                  ))}
                </div>
              </div>
            ) : null}
            {activeSupplier.winProjects.length ? (
              <div>
                <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">中标项目</div>
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
    </div>
  );
}
