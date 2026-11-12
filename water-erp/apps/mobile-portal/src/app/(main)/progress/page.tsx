"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Activity, AlertCircle, BarChart3, CalendarClock, FolderKanban, Lightbulb, Radio, RefreshCw, Sparkles, Target, TrendingUp } from "lucide-react";
import { fetchCompanies, type CompanyOption } from "@/lib/api/auth";
import { fetchProgressStats, fetchProgressAiInsights, fetchUpcoming, type ProgressStats, type ProgressAiInsights, type ProjectProgress, type UpcomingResult } from "@/lib/api/progress";
import { useAuth } from "@/components/m/auth-context";
import { CompanyPicker } from "@/components/m/company-picker";
import { BottomSheet } from "@/components/m/bottom-sheet";
import { SectionCard } from "@/components/m/section-card";
import { MetricCard } from "@/components/m/metric-card";
import { ErrorBanner } from "@/components/m/error-banner";
import { EmptyState } from "@/components/m/empty-state";
import { Skeleton } from "@/components/m/skeleton";
import { PullIndicator } from "@/components/m/pull-indicator";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { usePolling } from "@/hooks/use-polling";
import { fetchBidLiveProjects, type BidLiveProject } from "@/lib/api/cockpit";
import { readSavedFilters, saveFilters } from "@/lib/filter-store";

/* ── 阶段元数据（移植自 web progress-content STAGE_META——oklch 阶段色令牌）── */

type StageMeta = { label: string; color: string; softColor: string };

const STAGE_META: Record<string, StageMeta> = {
  PROCUREMENT_DEMAND: { label: "采购需求", color: "var(--stage-demand)", softColor: "var(--stage-demand-soft)" },
  INITIATION: { label: "采购立项", color: "var(--stage-initiation)", softColor: "var(--stage-initiation-soft)" },
  TENDER_DOCUMENT: { label: "采购文件", color: "var(--stage-tender)", softColor: "var(--stage-tender-soft)" },
  SUPPLIER_INVITATION: { label: "供应商邀请", color: "var(--stage-announce)", softColor: "var(--stage-announce-soft)" },
  PUBLIC_ANNOUNCEMENT: { label: "采购公告公示", color: "var(--stage-announce)", softColor: "var(--stage-announce-soft)" },
  EXPERT_SELECTION: { label: "专家抽取", color: "var(--stage-expert)", softColor: "var(--stage-expert-soft)" },
  BID_EVALUATION: { label: "开标评标", color: "var(--stage-evaluation)", softColor: "var(--stage-evaluation-soft)" },
  AWARD_DECISION: { label: "定标", color: "var(--stage-award)", softColor: "var(--stage-award-soft)" },
  CONTRACT: { label: "合同", color: "var(--stage-contract)", softColor: "var(--stage-contract-soft)" },
  // 直接采购专属尾段（09 备案表）：getStagesForMethod('直接采购') 会产出，漏配则兜底渲染原始键（与 :3005 同源）
  DIRECT_PURCHASE_FILING: { label: "直接采购备案表", color: "var(--stage-filing)", softColor: "var(--stage-filing-soft)" },
};

const DEFAULT_STAGE_META: StageMeta = { label: "未设置阶段", color: "var(--stage-default)", softColor: "var(--stage-default-soft)" };

/** 当前轮阶段（流标再采适配 2026-10-26，与 :3005 卡片/进展页同口径）：
 *  多轮项目每轮各有一行同 stageKey，展示只看当前轮；轮数据缺失兜底全量 */
function currentRoundStages(project: ProjectProgress) {
  const round = project.currentRound ?? 1;
  const scoped = (project.stages ?? []).filter((s) => (s.round ?? 1) === round);
  return { round, stages: scoped.length > 0 ? scoped : (project.stages ?? []) };
}

function getStageMeta(stageKey?: string | null): StageMeta {
  if (!stageKey) return DEFAULT_STAGE_META;
  return STAGE_META[stageKey] ?? { ...DEFAULT_STAGE_META, label: stageKey };
}

const INSIGHT_TYPE_LABELS: Record<string, string> = {
  risk: "风险",
  bottleneck: "瓶颈",
  budget: "预算",
  completion: "完成度",
  rhythm: "节奏",
};

const URGENCY_COLOR: Record<string, string> = {
  high: "var(--danger)",
  medium: "var(--warning)",
  low: "var(--accent)",
};

/* 洞察分组（与数据库页 AI 卡「亮点/待关注/建议」同款三段式语言，按紧急度分层） */
const INSIGHT_GROUPS: Array<{ key: "high" | "medium" | "low"; label: string; color: string; icon: typeof AlertCircle }> = [
  { key: "high", label: "高优先关注", color: URGENCY_COLOR.high, icon: AlertCircle },
  { key: "medium", label: "关注事项", color: URGENCY_COLOR.medium, icon: TrendingUp },
  { key: "low", label: "常规提示", color: URGENCY_COLOR.low, icon: Lightbulb },
];

function fmtBudget(v: number): string {
  return v >= 10000
    ? `${(v / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} 万`
    : `${v.toLocaleString("zh-CN")} 元`;
}

/** 环比箭头语义配色：成交/完成/节资↑=good，异常↑=bad，预算=neutral（数据库页同款本地一份） */
function deltaOf(cur: number, prev: number | undefined, goodWhenUp: boolean | null): { pct: number; tone: "good" | "bad" | "neutral" } | undefined {
  if (prev == null || prev === 0) return undefined;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return { pct: 0, tone: "neutral" };
  const up = pct > 0;
  const tone = goodWhenUp == null ? "neutral" : (up === goodWhenUp ? "good" : "bad");
  return { pct: Math.max(Math.min(pct, 999), -99), tone };
}

/* ── 紧凑阶段步进条 ── */

function StageStepper({ project }: { project: ProjectProgress }) {
  const { round, stages: scoped } = useMemo(() => currentRoundStages(project), [project]);
  const stages = useMemo(() => [...scoped].sort((a, b) => a.stageOrder - b.stageOrder), [scoped]);
  if (!stages.length) return null;
  return (
    <div className="mt-2.5 flex items-center gap-1" aria-label="阶段进度">
      {round > 1 && (
        <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-bold"
          style={{ background: "color-mix(in oklch, var(--warning) 14%, transparent)", color: "var(--warning)" }}>
          第 {round} 轮
        </span>
      )}
      {stages.map((s) => {
        const isCurrent = s.stageKey === project.currentStage;
        const done = s.status === "COMPLETED" || s.completedAt;
        return (
          <span
            key={s.stageKey}
            title={`${s.stageName}${s.completedAt ? ` · ${s.completedAt.slice(0, 10)}` : ""}`}
            className="m-step"
            data-state={done ? "done" : isCurrent ? "current" : "pending"}
            style={{ "--step-color": getStageMeta(s.stageKey).color } as React.CSSProperties}
          />
        );
      })}
    </div>
  );
}

/* ── 主页面 ── */

export default function ProgressPage() {
  const { user } = useAuth();
  const role = user?.role ?? null;
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [companyIds, setCompanyIds] = useState<string[]>(
    () => readSavedFilters<{ companyIds: string[] }>("progress").companyIds ?? [],
  );

  const [stats, setStats] = useState<ProgressStats | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingResult | null>(null);
  const [insights, setInsights] = useState<ProgressAiInsights | null>(null);
  const [insightsError, setInsightsError] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const [activeProject, setActiveProject] = useState<ProjectProgress | null>(null);
  const router = useRouter();

  /* 开评标进行时（2026-11-03）：30s 轮询——「现在正在发生什么」是驾驶舱此前完全
     缺席的时效维度；失败保旧数据，页面隐藏暂停 */
  const [live, setLive] = useState<{ projects: BidLiveProject[] } | null>(null);
  usePolling(
    useCallback(async () => {
      setLive(await fetchBidLiveProjects());
    }, []),
    30_000,
  );
  const openingNow = live?.projects.filter((p) => p.stage === "OPENING") ?? [];
  const evaluatingNow = live?.projects.filter((p) => p.stage === "EVALUATING") ?? [];
  const submittingNow = live?.projects.filter((p) => p.stage === "SUBMIT") ?? [];

  /* URL 预置（:3011 两步铁律桥，2026-11-03）：?focusPmi=<PMI id> 直开项目弹层——
     台账详情「查看进展」的落地端 */
  const searchParams = useSearchParams();
  const [focusConsumed, setFocusConsumed] = useState(false);
  useEffect(() => {
    if (focusConsumed || !stats) return;
    const pmi = searchParams.get("focusPmi");
    if (!pmi) { setFocusConsumed(true); return; }
    const target = stats.projects.find((p) => p.id === pmi);
    setFocusConsumed(true);
    if (target) setActiveProject(target);
  }, [stats, searchParams, focusConsumed]);

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

  const filterCompanyId = companyIds.length ? companyIds.join(",") : undefined;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchProgressStats(undefined, undefined, filterCompanyId)
      .then((s) => {
        if (active) setStats(s);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "加载进度统计失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filterCompanyId, retryTick]);

  /* 未来 14 天关键节点（截标/开标）：随公司口径/下拉刷新（retryTick）重取；静默失败（无节点不渲染，不占错误位） */
  useEffect(() => {
    let active = true;
    fetchUpcoming(14, filterCompanyId)
      .then((u) => {
        if (active) setUpcoming(u);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [filterCompanyId, retryTick]);

  /* 洞察手动生成（与数据库页 AI 综合分析同款：点「生成分析」才请求）；
     公司口径变化/下拉刷新使旧结果作废（置 null 后按钮态回归） */
  async function runInsights() {
    if (aiLoading) return;
    setAiLoading(true);
    setInsightsError(false);
    try {
      const i = await fetchProgressAiInsights(filterCompanyId);
      setInsights(i);
    } catch {
      setInsights(null);
      setInsightsError(true);
    } finally {
      setAiLoading(false);
    }
  }

  const maxStageCount = Math.max(...(stats?.stageDistribution.map((d) => d.count) ?? [1]), 1);

  /* 阶段分布按标准采购流程顺位排（STAGE_META 键序 = 采购需求→立项→文件→邀请→公示→专家→评标→定标→合同） */
  const STAGE_ORDER = Object.keys(STAGE_META);
  const sortedStageDistribution = useMemo(
    () =>
      [...(stats?.stageDistribution ?? [])].sort(
        (a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage),
      ),
    [stats],
  );

  const { pull, refreshing } = usePullToRefresh(
    useCallback(async () => {
      /* 下拉刷新只重取主数据——已生成的 AI 洞察保留（P2，2026-11-03：此前每次下拉
         丢弃洞察，领导刷个数据分析就没了还得手动重新生成）；口径变化才作废 */
      setRetryTick((t) => t + 1);
      await new Promise((r) => window.setTimeout(r, 300));
    }, []),
  );

  return (
    <div>
      <PullIndicator pull={pull} refreshing={refreshing} />
      {role === "admin" ? (
        <CompanyPicker
          value={companyIds}
          options={companies}
          onChange={(next) => {
            setCompanyIds(next);
            setInsights(null); // 口径变化，旧洞察作废（展开态自动重取）
            saveFilters("progress", { companyIds: next });
          }}
        />
      ) : null}

      {error ? <ErrorBanner message={error} onRetry={() => setRetryTick((t) => t + 1)} /> : null}

      {/* ── 未来 14 天关键节点（截标/开标横滑日卡；无节点不渲染）── */}
      {upcoming?.items.length ? (
        <SectionCard icon={CalendarClock} title="未来 14 天关键节点" index={0}>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {upcoming.items.map((d) => (
              <div key={d.date} className="w-[7.5rem] shrink-0 rounded-[12px] m-tile px-2.5 py-2">
                <div className="text-[12px] font-bold tabular-nums text-[var(--accent)]">{d.date.slice(5)}</div>
                {d.events.map((e, i) => (
                  <div key={i} className="mt-1 flex items-center gap-1">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${e.type === "OPENING" ? "bg-[var(--success)]" : "bg-[var(--warning)]"}`} />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--foreground)]">{e.name}</span>
                    <span className="shrink-0 text-[11px] text-[var(--muted-foreground)]">{e.type === "OPENING" ? "开标" : "截标"}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      {/* ── 开评标进行时（30s 轮询 + 呼吸点——驾驶舱的「现在时」）── */}
      {live && openingNow.length + evaluatingNow.length + submittingNow.length > 0 ? (
        <SectionCard
          icon={Radio}
          title="开评标进行时"
          index={0.5}
          right={
            <>
              <span className="shrink-0 text-[12px] font-semibold text-[var(--muted-foreground)]">不随公司筛选</span>
              {openingNow.length + evaluatingNow.length > 0 ? (
                <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--danger)] opacity-60 motion-reduce:animate-none" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--danger)]" />
                </span>
              ) : null}
            </>
          }
        >
          <div className="space-y-2">
            {[
              { label: "截标进行中", n: submittingNow.length, tone: "accent" },
              { label: "开标现场", n: openingNow.length, tone: "danger" },
              { label: "评标进行", n: evaluatingNow.length, tone: "warning" },
            ].map((r) => (
              <div key={r.label} className="flex items-center justify-between rounded-[12px] m-tile px-3 py-2.5">
                <span className="text-[14px] text-[var(--foreground)]">{r.label}</span>
                <span
                  className={`text-[16px] font-black tabular-nums ${
                    r.n > 0
                      ? r.tone === "danger"
                        ? "text-[var(--danger)]"
                        : r.tone === "warning"
                          ? "text-[var(--warning)]"
                          : "text-[var(--accent)]"
                      : "text-[var(--muted-foreground)]"
                  }`}
                >
                  {r.n} 场
                </span>
              </div>
            ))}
            {[...openingNow, ...evaluatingNow].slice(0, 3).map((p) => (
              <div key={p.id} className="flex items-center gap-2 px-1 text-[13px] text-[var(--muted-foreground)]">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: p.stage === "OPENING" ? "var(--danger)" : "var(--warning)" }}
                />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="shrink-0 tabular-nums">
                  已投 {p.supplierSubmitted}/{p.supplierCount} · 专家 {p.expertCount}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      {loading && !stats ? (
        <div className="neu-card-static rounded-[18px] p-3.5">
          <Skeleton lines={4} height={52} />
        </div>
      ) : null}

      {stats ? (
        <>
          {/* ── 概览 ── */}
          <div className="mb-3 grid grid-cols-2 gap-2">
            <MetricCard label="在办项目" value={String(stats.totalActive)} tone="accent" />
            <MetricCard label="近期活跃" value={String(stats.recentlyActive)} />
            <MetricCard label="本月新增" value={String(stats.monthlyAdded)} sub={`上月 ${stats.lastMonthAdded}`} delta={deltaOf(stats.monthlyAdded, stats.lastMonthAdded, true)} />
            <MetricCard label="本月完成" value={String(stats.monthlyCompleted)} tone="success" sub={`上月 ${stats.lastMonthCompleted}`} delta={deltaOf(stats.monthlyCompleted, stats.lastMonthCompleted, true)} />
          </div>
          <div className="mb-3 flex items-center justify-between rounded-[12px] m-tile px-3 py-2 text-[14px]">
            <span className="text-[var(--muted-foreground)]">
              累计完成 <span className="font-bold tabular-nums text-[var(--success)]">{stats.totalCompleted}</span> 项
            </span>
            <span className="text-[var(--muted-foreground)]">
              平均阶段耗时 <span className="font-bold tabular-nums text-[var(--accent)]">{stats.avgDaysPerStage}</span> 天
            </span>
          </div>

          {/* ── 执行态势（阶段分布，按标准采购流程顺位）── */}
          <SectionCard icon={BarChart3} title="执行态势 · 阶段分布" index={1}>
            {stats.stageDistribution.length ? (
              <div className="space-y-2">
                {sortedStageDistribution.map((d, i) => {
                  const meta = getStageMeta(d.stage);
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-[6.25rem] shrink-0 truncate text-[14px] font-medium text-[var(--foreground)]">{meta.label}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)]">
                        <div className="h-full rounded-full" style={{ width: `${(d.count / maxStageCount) * 100}%`, background: meta.color }} />
                      </div>
                      <span className="w-12 shrink-0 text-right text-[14px] font-bold tabular-nums text-[var(--foreground)]">
                        {d.count} <span className="font-medium text-[var(--muted-foreground)]">项</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState text="暂无在办项目" />
            )}
          </SectionCard>

          {/* ── 进度洞察（AI，与数据库页 AI 综合分析同款折叠卡；手动点「生成分析」请求）── */}
          <SectionCard
            icon={Sparkles}
            index={2}
            title="进度洞察"
            right={
              <button type="button" onClick={() => setAiOpen((v) => !v)} className="neu-btn-soft h-8 rounded-[9px] px-2.5 text-[14px]">
                {aiOpen ? "收起" : "展开"}
              </button>
            }
          >
            {aiOpen ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 text-[14px] text-[var(--muted-foreground)]">
                    {insights ? "以下为当前范围的分析结果" : "基于当前公司数据生成进度洞察"}
                  </span>
                  <button
                    type="button"
                    onClick={runInsights}
                    disabled={aiLoading}
                    className="neu-btn-primary h-9 shrink-0 rounded-[10px] px-3.5 text-[15px] disabled:opacity-60"
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
                {aiLoading ? (
                  <div className="flex items-center justify-center gap-2 py-5 text-[15px] text-[var(--muted-foreground)]">
                    <Activity size={13} className="animate-pulse" /> 正在生成进度洞察...
                  </div>
                ) : insightsError ? (
                  <div className="flex items-center gap-2.5 rounded-[12px] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-3 py-2.5">
                    <AlertCircle size={13} className="shrink-0 text-[var(--danger)]" />
                    <span className="min-w-0 flex-1 text-[15px] text-[var(--danger)]">洞察生成失败，请重试</span>
                    <button
                      type="button"
                      onClick={runInsights}
                      className="neu-btn-soft is-danger h-8 shrink-0 rounded-[9px] px-2.5 text-[14px] active:scale-95"
                    >
                      重试
                    </button>
                  </div>
                ) : insights ? (
                  <>
                    {insights.overview ? (
                      <div className="m-tile rounded-[12px] px-3.5 py-3">
                        <div className="mb-1.5 flex items-center gap-1.5 text-[14px] font-bold tracking-[0.08em] text-[var(--accent)]">
                          <Target size={11} /> 综合研判
                        </div>
                        <p className="text-[16px] font-medium leading-relaxed text-[var(--foreground)]">{insights.overview}</p>
                      </div>
                    ) : null}
                    {INSIGHT_GROUPS.map((g) => {
                      const items = insights.insights.filter((it) => it.urgency === g.key);
                      if (!items.length) return null;
                      return (
                        <div key={g.key} className="m-tile rounded-[12px] px-3.5 py-3">
                          <div className="mb-1.5 flex items-center gap-1.5 text-[14px] font-bold tracking-[0.08em]" style={{ color: g.color }}>
                            <g.icon size={11} /> {g.label}
                          </div>
                          {items.map((it, i) => (
                            <div key={i} className="flex items-start gap-2 py-0.5">
                              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: g.color }} />
                              <span className="text-[15px] leading-relaxed text-[var(--foreground)]">
                                {it.message}
                                <span className="ml-1.5 text-[13px] text-[var(--muted-foreground)]">[{INSIGHT_TYPE_LABELS[it.type] ?? it.type}]</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                    {!insights.overview && insights.insights.length === 0 ? <EmptyState text="当前无特别洞察" /> : null}
                  </>
                ) : (
                  <EmptyState text="点击「生成分析」获取 AI 进度洞察" />
                )}
              </div>
            ) : (
              <p className="px-1 text-[14px] text-[var(--muted-foreground)]">展开后可基于当前数据生成综合研判与分级提示</p>
            )}
          </SectionCard>

          {/* ── 项目清单 ── */}
          <SectionCard title="项目清单" right={<span className="shrink-0 text-[13px] font-semibold text-[var(--muted-foreground)]">{stats.projects.length} 项</span>} index={3}>
            {stats.projects.length ? (
              <div className="space-y-2">
                {stats.projects.map((p) => {
                  const meta = getStageMeta(p.currentStage);
                  const { round } = currentRoundStages(p);
                  const scopedName = currentRoundStages(p).stages.find((s) => s.stageKey === p.currentStage)?.stageName;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setActiveProject(p)}
                      className="w-full rounded-[14px] m-tile px-3 py-2.5 text-left active:scale-[0.99]"
                    >
                      <div className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 line-clamp-2 text-[15.5px] font-semibold leading-snug text-[var(--foreground)]">{p.title}</span>
                        <span
                          className="shrink-0 rounded-full px-2 py-0.5 text-[13px] font-bold"
                          style={{
                            color: meta.color,
                            background: meta.softColor,
                            border: `1px solid color-mix(in oklch, ${meta.color} 30%, transparent)`,
                          }}
                        >
                          {round > 1 ? `第 ${round} 轮 · ${scopedName ?? meta.label}` : (scopedName ?? meta.label)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[14px] text-[var(--muted-foreground)]">
                        <span className="shrink-0 rounded-full bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-1.5 py-0.5 text-[13px] text-[var(--accent)]">
                          {p.procurementMethod}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{p.requesterDepartment}</span>
                        <span className="shrink-0 tabular-nums">{fmtBudget(p.budgetAmount)}</span>
                      </div>
                      <StageStepper project={p} />
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptyState text="暂无在办项目" />
            )}
          </SectionCard>
        </>
      ) : null}

      {/* ── 项目详情弹层 ── */}
      <BottomSheet open={!!activeProject} onClose={() => setActiveProject(null)} title={<span className="line-clamp-2">{activeProject?.title ?? ""}</span>}>
        {activeProject ? (
          <div className="space-y-3">
            <div className="space-y-0.5 rounded-[12px] m-tile px-3 py-2.5 text-[15px]">
              {activeProject.projectName && activeProject.projectName !== activeProject.title ? (
                <div className="flex justify-between gap-3 py-1">
                  <span className="text-[var(--muted-foreground)]">关联项目</span>
                  <span className="min-w-0 flex-1 text-right font-medium text-[var(--foreground)]">{activeProject.projectName}</span>
                </div>
              ) : null}
              <div className="flex justify-between gap-3 py-1">
                <span className="text-[var(--muted-foreground)]">采购方式</span>
                <span className="font-medium text-[var(--foreground)]">{activeProject.procurementMethod}</span>
              </div>
              <div className="flex justify-between gap-3 py-1">
                <span className="text-[var(--muted-foreground)]">需求部门</span>
                <span className="font-medium text-[var(--foreground)]">{activeProject.requesterDepartment}</span>
              </div>
              {activeProject.requesterName ? (
                <div className="flex justify-between gap-3 py-1">
                  <span className="text-[var(--muted-foreground)]">申请人</span>
                  <span className="font-medium text-[var(--foreground)]">{activeProject.requesterName}</span>
                </div>
              ) : null}
              <div className="flex justify-between gap-3 py-1">
                <span className="text-[var(--muted-foreground)]">预算金额</span>
                <span className="font-bold tabular-nums text-[var(--accent)]">{fmtBudget(activeProject.budgetAmount)}</span>
              </div>
              {activeProject.companyName ? (
                <div className="flex justify-between gap-3 py-1">
                  <span className="text-[var(--muted-foreground)]">采购单位</span>
                  <span className="font-medium text-[var(--foreground)]">{activeProject.companyName}</span>
                </div>
              ) : null}
              <div className="flex justify-between gap-3 py-1">
                <span className="text-[var(--muted-foreground)]">创建 / 更新</span>
                <span className="font-medium tabular-nums text-[var(--foreground)]">
                  {activeProject.createdAt.slice(0, 10)} / {activeProject.updatedAt.slice(0, 10)}
                </span>
              </div>
            </div>

            {/* 台账↔进展互跳桥（2026-11-03）：两页各持同一项目半张信息，此处直达台账轮次明细；
                携 q=项目名兜底——目标轮次不在台账第 1 页时至少列表已按项目过滤可见（2026-11-03 稳健性） */}
            <button
              type="button"
              onClick={() =>
                router.push(
                  `/ledger?focusPmi=${activeProject.id}${
                    activeProject.projectName ? `&q=${encodeURIComponent(activeProject.projectName)}` : ""
                  }`,
                )
              }
              className="neu-btn-soft h-9 w-full rounded-[10px] px-3 text-[14px] active:scale-95"
            >
              <FolderKanban size={13} /> 查看台账
            </button>

            <div>
              <div className="mb-2 text-[14px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
                阶段时间线{(currentRoundStages(activeProject).round > 1) ? `（第 ${currentRoundStages(activeProject).round} 轮）` : ''}
              </div>
              <div className="space-y-1.5">
                {currentRoundStages(activeProject).stages
                  .slice()
                  .sort((a, b) => a.stageOrder - b.stageOrder)
                  .map((s) => {
                    const meta = getStageMeta(s.stageKey);
                    const isCurrent = s.stageKey === activeProject.currentStage;
                    const done = s.status === "COMPLETED" || s.completedAt;
                    return (
                      <div key={s.stageKey} className="flex items-center gap-2.5 rounded-[10px] m-tile px-3 py-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{
                            background: done
                              ? meta.color
                              : isCurrent
                                ? "var(--warning)"
                                : "color-mix(in oklch, var(--muted-foreground) 35%, transparent)",
                          }}
                        />
                        <span className={`min-w-0 flex-1 truncate text-[15px] ${isCurrent ? "font-bold text-[var(--foreground)]" : "font-medium text-[var(--foreground)]"}`}>
                          {s.stageName}
                          {isCurrent ? "（当前）" : ""}
                        </span>
                        <span className="shrink-0 text-[14px] tabular-nums text-[var(--muted-foreground)]">
                          {s.completedAt ? s.completedAt.slice(0, 10) : "未完成"}
                        </span>
                      </div>
                    );
                  })}
                {(activeProject.stages ?? []).length === 0 ? <EmptyState text="暂无阶段数据" /> : null}
              </div>
            </div>
          </div>
        ) : null}
      </BottomSheet>
    </div>
  );
}
