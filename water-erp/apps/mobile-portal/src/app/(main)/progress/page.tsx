"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertCircle, BarChart3, Lightbulb, Sparkles, Target, TrendingUp } from "lucide-react";
import { fetchCompanies, type CompanyOption } from "@/lib/api/auth";
import { fetchProgressStats, fetchProgressAiInsights, type ProgressStats, type ProgressAiInsights, type ProjectProgress } from "@/lib/api/progress";
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
};

const DEFAULT_STAGE_META: StageMeta = { label: "未设置阶段", color: "var(--stage-default)", softColor: "var(--stage-default-soft)" };

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

/* ── 紧凑阶段步进条 ── */

function StageStepper({ project }: { project: ProjectProgress }) {
  const stages = useMemo(
    () => [...(project.stages ?? [])].sort((a, b) => a.stageOrder - b.stageOrder),
    [project.stages],
  );
  if (!stages.length) return null;
  return (
    <div className="mt-2.5 flex items-center gap-1" aria-label="阶段进度">
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
  const [companyId, setCompanyId] = useState<string>(
    () => readSavedFilters<{ companyId: string }>("progress").companyId ?? "all",
  );

  const [stats, setStats] = useState<ProgressStats | null>(null);
  const [insights, setInsights] = useState<ProgressAiInsights | null>(null);
  const [insightsError, setInsightsError] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [insightsTick, setInsightsTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const [activeProject, setActiveProject] = useState<ProjectProgress | null>(null);

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

  const filterCompanyId = companyId === "all" ? undefined : companyId;

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

  /* 洞察懒加载：展开时自动请求（未展开不耗 AI 调用）；公司口径变化/重试/下拉刷新使旧结果作废 */
  useEffect(() => {
    if (!aiOpen || insights) return;
    let active = true;
    setAiLoading(true);
    setInsightsError(false);
    fetchProgressAiInsights(filterCompanyId)
      .then((i) => {
        if (active) setInsights(i);
      })
      .catch(() => {
        if (active) {
          setInsights(null);
          setInsightsError(true);
        }
      })
      .finally(() => {
        if (active) setAiLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiOpen, insights, filterCompanyId, insightsTick]);

  function retryInsights() {
    setInsights(null);
    setInsightsTick((t) => t + 1);
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
      setRetryTick((t) => t + 1);
      setInsights(null); // 下拉刷新使旧洞察作废（展开态自动重取）
      await new Promise((r) => window.setTimeout(r, 300));
    }, []),
  );

  return (
    <div>
      <PullIndicator pull={pull} refreshing={refreshing} />
      {role === "admin" ? (
        <CompanyPicker
          value={companyId}
          options={companies}
          onChange={(next) => {
            setCompanyId(next);
            setInsights(null); // 口径变化，旧洞察作废（展开态自动重取）
            saveFilters("progress", { companyId: next });
          }}
        />
      ) : null}

      {error ? <ErrorBanner message={error} onRetry={() => setRetryTick((t) => t + 1)} /> : null}

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
            <MetricCard label="本月新增" value={String(stats.monthlyAdded)} sub={`上月 ${stats.lastMonthAdded}`} />
            <MetricCard label="本月完成" value={String(stats.monthlyCompleted)} tone="success" sub={`上月 ${stats.lastMonthCompleted}`} />
          </div>
          <div className="mb-3 flex items-center justify-between rounded-[12px] m-tile px-3 py-2 text-[11px]">
            <span className="text-[var(--muted-foreground)]">
              累计完成 <span className="font-bold tabular-nums text-[var(--success)]">{stats.totalCompleted}</span> 项
            </span>
            <span className="text-[var(--muted-foreground)]">
              平均阶段耗时 <span className="font-bold tabular-nums text-[var(--accent)]">{stats.avgDaysPerStage}</span> 天
            </span>
          </div>

          {/* ── 执行态势（阶段分布，按标准采购流程顺位）── */}
          <SectionCard icon={BarChart3} title="执行态势 · 阶段分布" index={0}>
            {stats.stageDistribution.length ? (
              <div className="space-y-2">
                {sortedStageDistribution.map((d, i) => {
                  const meta = getStageMeta(d.stage);
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-[5.5rem] shrink-0 truncate text-[11px] font-medium text-[var(--foreground)]">{meta.label}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)]">
                        <div className="h-full rounded-full" style={{ width: `${(d.count / maxStageCount) * 100}%`, background: meta.color }} />
                      </div>
                      <span className="w-10 shrink-0 text-right text-[11px] font-bold tabular-nums text-[var(--foreground)]">
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

          {/* ── 进度洞察（AI，与数据库页 AI 综合分析同款折叠卡；展开即自动请求）── */}
          <SectionCard
            icon={Sparkles}
            index={1}
            title="进度洞察"
            right={
              <button type="button" onClick={() => setAiOpen((v) => !v)} className="neu-btn-soft h-8 rounded-[9px] px-2.5 text-[11px]">
                {aiOpen ? "收起" : "展开"}
              </button>
            }
          >
            {aiOpen ? (
              <div className="space-y-2.5">
                {aiLoading ? (
                  <div className="flex items-center justify-center gap-2 py-5 text-xs text-[var(--muted-foreground)]">
                    <Activity size={13} className="animate-pulse" /> 正在生成进度洞察...
                  </div>
                ) : insightsError ? (
                  <div className="flex items-center gap-2.5 rounded-[12px] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-3 py-2.5">
                    <AlertCircle size={13} className="shrink-0 text-[var(--danger)]" />
                    <span className="min-w-0 flex-1 text-xs text-[var(--danger)]">洞察生成失败，请重试</span>
                    <button
                      type="button"
                      onClick={retryInsights}
                      className="neu-btn-soft is-danger h-8 shrink-0 rounded-[9px] px-2.5 text-[11px] active:scale-95"
                    >
                      重试
                    </button>
                  </div>
                ) : insights ? (
                  <>
                    {insights.overview ? (
                      <div className="m-tile rounded-[12px] px-3.5 py-3">
                        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] text-[var(--accent)]">
                          <Target size={11} /> 综合研判
                        </div>
                        <p className="text-[13px] font-medium leading-relaxed text-[var(--foreground)]">{insights.overview}</p>
                      </div>
                    ) : null}
                    {INSIGHT_GROUPS.map((g) => {
                      const items = insights.insights.filter((it) => it.urgency === g.key);
                      if (!items.length) return null;
                      return (
                        <div key={g.key} className="m-tile rounded-[12px] px-3.5 py-3">
                          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold tracking-[0.08em]" style={{ color: g.color }}>
                            <g.icon size={11} /> {g.label}
                          </div>
                          {items.map((it, i) => (
                            <div key={i} className="flex items-start gap-2 py-0.5">
                              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: g.color }} />
                              <span className="text-[12px] leading-relaxed text-[var(--foreground)]">
                                {it.message}
                                <span className="ml-1.5 text-[10px] text-[var(--muted-foreground)]">[{INSIGHT_TYPE_LABELS[it.type] ?? it.type}]</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                    {!insights.overview && insights.insights.length === 0 ? <EmptyState text="当前无特别洞察" /> : null}
                  </>
                ) : (
                  <EmptyState text="正在准备洞察..." />
                )}
              </div>
            ) : (
              <p className="px-1 text-[11px] text-[var(--muted-foreground)]">展开后自动获取 AI 进度洞察（综合研判 + 分级提示）</p>
            )}
          </SectionCard>

          {/* ── 项目清单 ── */}
          <SectionCard title="项目清单" right={<span className="shrink-0 text-[10px] font-semibold text-[var(--muted-foreground)]">{stats.projects.length} 项</span>} index={2}>
            {stats.projects.length ? (
              <div className="space-y-2">
                {stats.projects.map((p) => {
                  const meta = getStageMeta(p.currentStage);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setActiveProject(p)}
                      className="w-full rounded-[14px] m-tile px-3 py-2.5 text-left active:scale-[0.99]"
                    >
                      <div className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 line-clamp-2 text-[12.5px] font-semibold leading-snug text-[var(--foreground)]">{p.title}</span>
                        <span
                          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
                          style={{
                            color: meta.color,
                            background: meta.softColor,
                            border: `1px solid color-mix(in oklch, ${meta.color} 30%, transparent)`,
                          }}
                        >
                          {meta.label}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
                        <span className="shrink-0 rounded-full bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">
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
            <div className="space-y-0.5 rounded-[12px] m-tile px-3 py-2.5 text-[12px]">
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

            <div>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">阶段时间线</div>
              <div className="space-y-1.5">
                {[...(activeProject.stages ?? [])]
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
                        <span className={`min-w-0 flex-1 truncate text-[12px] ${isCurrent ? "font-bold text-[var(--foreground)]" : "font-medium text-[var(--foreground)]"}`}>
                          {s.stageName}
                          {isCurrent ? "（当前）" : ""}
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums text-[var(--muted-foreground)]">
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
