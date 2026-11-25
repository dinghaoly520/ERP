"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/m/page-header";
import { Milestone, Radio, Search } from "lucide-react";
import { fetchCompanies, type CompanyOption } from "@/lib/api/auth";
import { fetchProgressStats, type ProgressStats, type ProjectProgress } from "@/lib/api/progress";
import { useAuth } from "@/components/m/auth-context";
import { InlineSelect } from "@/components/m/inline-select";
import { RANGES, type PresetKey, type RangeKey } from "@/lib/ranges";
import { deltaOf, ratioCls, ratioTxt } from "@/lib/ratios";
import { formatYuanExact } from "@/lib/amount-format";
import {
  fetchBidStageStatus,
  BID_BUCKET_LABELS,
  type BidStageBucket,
  type BidStageStatus,
} from "@/lib/api/dashboard";
import { fetchBidLiveProjects, type BidLiveProject } from "@/lib/api/cockpit";
import { usePolling } from "@/hooks/use-polling";
import { fetchProcurementDimensions, type ProcurementFilterDimensions } from "@/lib/api/procurements";
import { BottomSheet } from "@/components/m/bottom-sheet";
import { SectionCard } from "@/components/m/section-card";
import { ErrorBanner } from "@/components/m/error-banner";
import { EmptyState } from "@/components/m/empty-state";
import { Skeleton } from "@/components/m/skeleton";
import { PullIndicator } from "@/components/m/pull-indicator";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { readSavedFilters, saveFilters } from "@/lib/filter-store";

/* ── 阶段元数据（移植自 web progress-content STAGE_META——oklch 阶段色令牌）── */

type StageMeta = { label: string; color: string; softColor: string };

/** 预算精确显示（2026-11-25 用户裁定「预算保持原本数字——不四舍五入、不用万/亿」）：
 *  千分位分组 + 小数位原样 + 「元」，与 :3005 formatYuanExact 同款 */
function fmtBudget(v: number): string {
  return formatYuanExact(v);
}

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


/* 洞察分组（与驾驶舱页 AI 卡「亮点/待关注/建议」同款三段式语言，按紧急度分层） */
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
  /* 搜索+五筛选（2026-11-19 用户裁定：与台账明细同款设计；清单为全量内存列表，
     客户端过滤——PMI 维度：方式/立项部门（名匹配）/经办人（PMI 创建人）/立项日期窗） */
  const [searchInput, setSearchInput] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [rangeKey, setRangeKey] = useState<RangeKey>("all");
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [methodIds, setMethodIds] = useState<string[]>([]);
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [handlerIds, setHandlerIds] = useState<string[]>([]);
  const [dimensions, setDimensions] = useState<ProcurementFilterDimensions | null>(null);
  const [methods, setMethods] = useState<string[]>([]);
  useEffect(() => {
    const t = window.setTimeout(() => setSearchKeyword(searchInput), 350);
    return () => window.clearTimeout(t);
  }, [searchInput]);
  useEffect(() => {
    let active = true;
    fetchProcurementDimensions()
      .then((d) => { if (active) setDimensions(d); })
      .catch(() => undefined);
    import("@/lib/api/procurements").then((m) =>
      m.fetchProcurementMethods().then((list) => { if (active) setMethods(list); }).catch(() => undefined),
    );
    return () => { active = false; };
  }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const [activeProject, setActiveProject] = useState<ProjectProgress | null>(null);
  /* 开评标进行时已上移首页「实时运行态势」（2026-11-18 指挥台改版）——本页去重，
     30s 轮询随之移除（进展页聚焦项目阶段时间线与节点预告） */

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
  const queryRange =
    rangeKey === "custom"
      ? { startDate: customRange?.from, endDate: customRange?.to }
      : { startDate: RANGES[rangeKey].start(), endDate: undefined as string | undefined };
  const deptNameOf = (id: string) => dimensions?.departments.find((d) => d.id === id)?.name ?? id;
  const handlerNameOf = (id: string) => dimensions?.handlers.find((h) => h.id === id)?.name ?? id;
  const filteredProjects = useMemo(() => {
    const kw = searchKeyword.trim();
    return (stats?.projects ?? []).filter((p) => {
      if (kw && !p.title.includes(kw) && !p.projectName.includes(kw)) return false;
      if (methodIds.length && !methodIds.includes(p.procurementMethod)) return false;
      if (departmentIds.length && !departmentIds.map(deptNameOf).includes(p.requesterDepartment)) return false;
      if (handlerIds.length && !handlerIds.includes(p.createdById ?? "")) return false;
      if (queryRange.startDate) {
        const d = p.createdAt.slice(0, 10);
        if (d < queryRange.startDate) return false;
        if (queryRange.endDate && d > queryRange.endDate) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, searchKeyword, methodIds, departmentIds, handlerIds, queryRange.startDate, queryRange.endDate, dimensions]);

  /* 实时运行态势（2026-11-23 用户裁定：首页同卡移植到进展页，随后裁定去掉卡头时间/公司选择器与
     「最新项目」清单——口径直接跟随页级筛选：时间=rangeKey/customRange，公司=companyIds；
     方式/部门/经办人为 PMI 清单筛选，不作用于标段统计）。四 KPI=运行中(标前+标中)/标前/标中/标后，
     点选仅高亮；30s 轮询开评标实名录点亮红点 */
  const [bidStage, setBidStage] = useState<BidStageStatus | null>(null);
  /* 板块选择器 → 态势过滤（方式多选/部门按名/经办人按 id；dimensions 到达后部门 id 才能译出名） */
  const bidPmiFilter = useMemo(
    () => ({ procurementMethods: methodIds, departments: departmentIds.map(deptNameOf), createdBy: handlerIds }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [methodIds, departmentIds, handlerIds, dimensions],
  );
  useEffect(() => {
    let active = true;
    fetchBidStageStatus(filterCompanyId, queryRange.startDate, queryRange.endDate, bidPmiFilter)
      .then((st) => { if (active) setBidStage(st); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [retryTick, filterCompanyId, queryRange.startDate, queryRange.endDate, bidPmiFilter]);
  const [bidBucket, setBidBucket] = useState<BidStageBucket>("running");
  const [live, setLive] = useState<{ projects: BidLiveProject[] } | null>(null);
  usePolling(
    useCallback(async () => {
      const l = await fetchBidLiveProjects().catch(() => null);
      if (l) setLive(l);
    }, []),
    30_000,
  );
  const openingNow = live?.projects.filter((p) => p.stage === "OPENING") ?? [];
  const evaluatingNow = live?.projects.filter((p) => p.stage === "EVALUATING") ?? [];

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
      {/* 页头（2026-11-19 九板块页面化）：返回驾驶舱 + 页面名称 */}
      <PageHeader title="项目进展" icon={Milestone} />
      {/* ── 搜索+筛选（2026-11-19 用户裁定：与台账明细同款胶囊设计）── */}
      <div className="m-tile mb-2 flex h-10 items-center gap-2 rounded-full px-3.5">
        <Search size={14} className="shrink-0 text-[var(--muted-foreground)]" />
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="搜索项目名称"
          aria-label="搜索项目名称"
          className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
        />
        {searchInput ? (
          <button type="button" onClick={() => setSearchInput("")} className="shrink-0 text-[13px] font-semibold text-[var(--accent)] active:scale-95">
            清除
          </button>
        ) : null}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
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
          ariaLabel="按时间筛选"
        />
        {methods.length > 1 ? (
          <InlineSelect
            multiple
            label={methodIds.length === 0 ? "全部采购方式" : methodIds.length <= 2 ? methodIds.join("、") : `${methodIds.slice(0, 2).join("、")} 等${methodIds.length}项`}
            active={methodIds.length > 0}
            options={[{ value: "all", label: "全部采购方式" }, ...methods.map((m) => ({ value: m, label: m }))]}
            selected={methodIds.length === 0 ? ["all"] : methodIds}
            onSelect={(next) => {
              const hadAll = methodIds.length === 0;
              if (next.includes("all") && !hadAll) setMethodIds([]);
              else setMethodIds(next.filter((x) => x !== "all"));
            }}
            ariaLabel="按采购方式筛选（多选）"
          />
        ) : null}
        {/* 右组：公司 → 部门 → 经办人（与台账同款居右成组） */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {role === "admin" ? (
            <InlineSelect
              multiple
              label={companyIds.length === 0 ? "全部公司" : companyIds.length <= 2 ? companyIds.map((id) => companies.find((c) => c.id === id)?.name ?? id).join("、") : `${companyIds.length}家公司`}
              active={companyIds.length > 0}
              options={[{ value: "all", label: "全部公司" }, ...companies.map((c) => ({ value: c.id, label: c.name }))]}
              selected={companyIds.length === 0 ? ["all"] : companyIds}
              onSelect={(next) => {
                const hadAll = companyIds.length === 0;
                if (next.includes("all") && !hadAll) {
                  setCompanyIds([]);
                  saveFilters("progress", { companyIds: [] });
                } else {
                  const v = next.filter((x) => x !== "all");
                  setCompanyIds(v);
                  saveFilters("progress", { companyIds: v });
                }
              }}
              ariaLabel="公司口径"
            />
          ) : null}
          {dimensions && dimensions.departments.length > 0 ? (
            <InlineSelect
              multiple
              label={
                departmentIds.length === 0
                  ? "部门"
                  : departmentIds.length <= 2
                    ? departmentIds.map(deptNameOf).join("、")
                    : `部门 等${departmentIds.length}项`
              }
              active={departmentIds.length > 0}
              options={[{ value: "all", label: "全部部门" }, ...dimensions.departments.map((d) => ({ value: d.id, label: d.name }))]}
              selected={departmentIds.length === 0 ? ["all"] : departmentIds}
              onSelect={(next) => {
                const hadAll = departmentIds.length === 0;
                if (next.includes("all") && !hadAll) setDepartmentIds([]);
                else setDepartmentIds(next.filter((x) => x !== "all"));
              }}
              ariaLabel="按部门筛选"
            />
          ) : null}
          {dimensions && dimensions.handlers.length > 0 ? (
            <InlineSelect
              multiple
              label={
                handlerIds.length === 0
                  ? "经办人"
                  : handlerIds.length <= 2
                    ? handlerIds.map(handlerNameOf).join("、")
                    : `经办人 等${handlerIds.length}项`
              }
              active={handlerIds.length > 0}
              options={[{ value: "all", label: "全部经办人" }, ...dimensions.handlers.map((h) => ({ value: h.id, label: h.name }))]}
              selected={handlerIds.length === 0 ? ["all"] : handlerIds}
              onSelect={(next) => {
                const hadAll = handlerIds.length === 0;
                if (next.includes("all") && !hadAll) setHandlerIds([]);
                else setHandlerIds(next.filter((x) => x !== "all"));
              }}
              ariaLabel="按经办人筛选"
            />
          ) : null}
        </div>
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => setRetryTick((t) => t + 1)} /> : null}

      {loading && !stats ? (
        <div className="neu-card-static rounded-[18px] p-3.5">
          <Skeleton lines={4} height={52} />
        </div>
      ) : null}

      {stats ? (
        <>
          {/* ── 实时运行态势（首页同卡精简版，2026-11-23 用户裁定）：无卡头选择器、无最新清单——
              口径跟随页级时间/公司筛选；单排标段盘点四 KPI（选中桶 accent，非「全部」档带同比/环比子行）；
              开评标进行中时右上红点 ── */}
          <SectionCard
            icon={Radio}
            title="实时运行态势"
            index={0}
            right={
              openingNow.length + evaluatingNow.length > 0 ? (
                <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--danger)] opacity-60 motion-reduce:animate-none" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--danger)]" />
                </span>
              ) : null
            }
          >
            <div>
              <div className="mb-1.5 px-1 text-[11px] font-bold tracking-[0.08em] text-[var(--muted-foreground)]">
                标段盘点 · {rangeKey === "custom" ? "所选区间" : RANGES[rangeKey as PresetKey].label}
              </div>
              <div className="grid grid-cols-4 gap-2.5">
                {(() => {
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
                        aria-label={`${BID_BUCKET_LABELS[k]} ${n ?? "—"} 项`}
                      >
                        <div className={`max-w-full truncate text-center text-[16px] font-black leading-none tabular-nums ${n == null ? "text-[var(--muted-foreground)]" : bidBucket === k ? "text-[var(--accent)]" : "text-[var(--foreground)]"}`}>
                          {n ?? "—"}
                        </div>
                        <div className={`mt-1 truncate text-center text-[12px] ${bidBucket === k ? "font-semibold text-[var(--accent)]" : "text-[var(--muted-foreground)]"}`}>
                          {BID_BUCKET_LABELS[k]}
                        </div>
                        {queryRange.startDate ? (
                          <div className="mt-1 flex items-center justify-center gap-1.5 text-[11px] font-bold leading-none tabular-nums">
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
          </SectionCard>

          {/* ── 进行中项目（2026-11-19 用户裁定：撤「项目清单」卡壳直接平铺；卡片信息
              对齐台账语言：日期·名称·阶段胶囊 / 部门·方式·预算 / 采购人·经办人居右 + 步骤条）── */}
          {filteredProjects.length ? (
            <div className="space-y-2.5">
              {filteredProjects.map((p) => {
                const meta = getStageMeta(p.currentStage);
                const { round } = currentRoundStages(p);
                const scopedName = currentRoundStages(p).stages.find((s) => s.stageKey === p.currentStage)?.stageName;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setActiveProject(p)}
                    className="w-full rounded-[16px] m-tile px-3.5 py-3 text-left active:scale-[0.99]"
                  >
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 pt-0.5 text-[12px] tabular-nums text-[var(--muted-foreground)]">{p.createdAt.slice(5, 10)}</span>
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
                    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[14px] text-[var(--muted-foreground)]">
                      <span className="min-w-0 truncate">{p.companyName || "—"} · {p.requesterDepartment || "—"}</span>
                      <span className="font-semibold text-[var(--gold)]">{p.procurementMethod}</span>
                      <span className="tabular-nums">预算 <b className="font-semibold text-[var(--foreground)]">{fmtBudget(p.budgetAmount)}</b></span>
                    </div>
                    <div className="mt-1 flex flex-wrap justify-end gap-x-3 text-[12px] text-[var(--muted-foreground)]">
                      <span>采购人 <span className="font-medium text-[var(--foreground)]">{p.requesterName || "—"}</span></span>
                      <span>经办人 <span className="font-medium text-[var(--foreground)]">{p.createdBy?.displayName ?? "—"}</span></span>
                    </div>
                    <StageStepper project={p} />
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState text={searchKeyword || methodIds.length || departmentIds.length || handlerIds.length || rangeKey !== "all" ? "无符合筛选条件的项目" : "暂无在办项目"} />
          )}
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
