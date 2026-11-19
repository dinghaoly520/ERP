"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/m/page-header";
import { fetchArchiveDetail, fetchStepAnalysis, type ArchiveDetail } from "@/lib/api/project-management";
import { InlineSelect } from "@/components/m/inline-select";
import { RANGES, priorWindowIso, shiftYearIso, todayIso, type PresetKey, type RangeKey } from "@/lib/ranges";
import { deltaOf, ratioCls, ratioTxt, type DeltaR } from "@/lib/ratios";
import { FolderKanban, Loader2, NotebookText, Search } from "lucide-react";
import { fetchCompanies, type CompanyOption } from "@/lib/api/auth";
import { fetchProcurements, fetchProcurementDimensions, fetchLedgerStats, fetchProcurementMethods, type ProcurementFilterDimensions } from "@/lib/api/procurements";
import { RESULT_STATUS_CONFIG, type LedgerSummary, type ProcurementRoundItem, type ResultStatusKey } from "@/lib/types/procurement";
import { useAuth } from "@/components/m/auth-context";
import { BottomSheet } from "@/components/m/bottom-sheet";
import { MetricCard } from "@/components/m/metric-card";
import { ErrorBanner } from "@/components/m/error-banner";
import { EmptyState } from "@/components/m/empty-state";
import { Skeleton } from "@/components/m/skeleton";
import { PullIndicator } from "@/components/m/pull-indicator";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { readSavedFilters, saveFilters } from "@/lib/filter-store";

const PAGE_SIZE = 15;

type LedgerSavedFilters = {
  statusFilter: ResultStatusKey | null;
  methodFilter: string | null;
  companyIds: string[];
};

const RETENTION_LABELS: Record<string, string> = { PERMANENT: "永久", Y30: "30 年", Y10: "10 年" };
/** 金额展示：数字=元（千分位），字符串原样，空=— */
function fmtAmount(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return `${v.toLocaleString("zh-CN")} 元`;
  return v;
}

function DetailRow({ label, value, tone }: { label: string; value: string; tone?: "danger" | "accent" }) {
  if (!value || value === "—") return null;
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="shrink-0 text-[var(--muted-foreground)]">{label}</span>
      <span
        className={`min-w-0 flex-1 text-right font-medium tabular-nums ${
          tone === "danger" ? "text-[var(--danger)]" : tone === "accent" ? "text-[var(--accent)]" : "text-[var(--foreground)]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export default function LedgerPage() {
  const { user } = useAuth();
  const role = user?.role ?? null;
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const saved = useMemo(() => readSavedFilters<LedgerSavedFilters>("ledger"), []);
  const [companyIds, setCompanyIds] = useState<string[]>(saved.companyIds ?? []);

  const [searchInput, setSearchInput] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<ResultStatusKey | null>(saved.statusFilter ?? null);
  /* 方式筛选不回放（2026-11-19 用户裁定：进入默认全部采购方式），仅会话内生效 */
  const [methodIds, setMethodIds] = useState<string[]>([]);
  /* 时间档/部门/经办人筛选（2026-11-19 用户裁定：状态胶囊换时间，增部门+经办人，公司居右） */
  const [rangeKey, setRangeKey] = useState<RangeKey>("all");
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [handlerIds, setHandlerIds] = useState<string[]>([]);
  const [dimensions, setDimensions] = useState<ProcurementFilterDimensions | null>(null);
  useEffect(() => {
    let active = true;
    fetchProcurementDimensions()
      .then((d) => { if (active) setDimensions(d); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  /* 时间档窗（列表取数用） */
  const queryRange =
    rangeKey === "custom"
      ? { startDate: customRange?.from, endDate: customRange?.to }
      : { startDate: RANGES[rangeKey].start(), endDate: undefined as string | undefined };
  /* 异常四态快捷筛选（:3011 两步铁律，2026-11-03）——「异常 N」头条数字的一键明细 */
  const [abnormalFilter, setAbnormalFilter] = useState(false);
  const [methods, setMethods] = useState<string[]>([]);

  const [items, setItems] = useState<ProcurementRoundItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  /* 一屏总览（2026-11-17 spec）：拉取层不变（15/页），显示层默认 5 条、
     「展开更多」每次 +10；筛选/搜索变化重置回 5 */
  const VISIBLE_INIT = 5;
  const VISIBLE_STEP = 10;
  const [visibleCount, setVisibleCount] = useState(VISIBLE_INIT);

  /* 总览八项（2026-11-19 用户裁定：与驾驶舱数据总览同内容同版式，置于筛选项下方）——
     项目盘点走 project-status 存量、金额走 dashboard 汇总，恒全时段（台账页无区间选择器） */
  const [stats, setStats] = useState<LedgerSummary | null>(null);
  const [statsYoy, setStatsYoy] = useState<LedgerSummary | null>(null);
  const [statsPrev, setStatsPrev] = useState<LedgerSummary | null>(null);
  const [activeItem, setActiveItem] = useState<ProcurementRoundItem | null>(null);
  /* 归档/终止详情（2026-11-19 对齐 :3005）：开层按轮次 id 取 archive 载荷——
     basicInfo/extractedInfo/步骤+附件/简报；无 PMI 关联（Excel 导入）404 回退简版 */
  const [archiveDetail, setArchiveDetail] = useState<ArchiveDetail | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  useEffect(() => {
    if (!activeItem) {
      setArchiveDetail(null);
      return;
    }
    let active = true;
    setArchiveDetail(null);
    setArchiveLoading(true);
    fetchArchiveDetail(activeItem.id)
      .then((d) => { if (active) setArchiveDetail(d); })
      .catch(() => undefined)
      .finally(() => { if (active) setArchiveLoading(false); });
    return () => { active = false; };
  }, [activeItem]);

  /* 步骤分析懒生成（服务端缓存命中秒回）；stageKey → {content, loading} */
  const [stepAnalysis, setStepAnalysis] = useState<Record<string, { content: string; empty: boolean } | "loading">>({});
  const runStepAnalysis = (projectId: string, stageKey: string, round?: number | null) => {
    if (stepAnalysis[stageKey]) return;
    setStepAnalysis((m) => ({ ...m, [stageKey]: "loading" }));
    fetchStepAnalysis(projectId, stageKey, round ?? undefined)
      .then((r) => setStepAnalysis((m) => ({ ...m, [stageKey]: r })))
      .catch(() => setStepAnalysis((m) => ({ ...m, [stageKey]: { content: "分析生成失败，请重试", empty: true } })));
  };

  /* 搜索 400ms 防抖 */
  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearchKeyword(searchInput.trim());
      setPage(1);
      setVisibleCount(VISIBLE_INIT);
    }, 400);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    let active = true;
    fetchProcurementMethods()
      .then((list) => {
        if (active) setMethods(list);
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

  const filterCompanyId = companyIds.length ? companyIds.join(",") : undefined;

  /* URL 预置筛选（:3011 两步铁律，2026-11-03）——brief jump/异常卡/风险行经
     ?abnormal=1 / ?status=<key> / ?q=<词> 直达预置；?focusPmi=<id> 直开详情弹层 */
  const searchParams = useSearchParams();
  const [urlConsumed, setUrlConsumed] = useState(false);
  const [focusPmi, setFocusPmi] = useState<string | null>(null);
  useEffect(() => {
    if (urlConsumed) return;
    setUrlConsumed(true);
    const st = searchParams.get("status");
    const q = searchParams.get("q");
    const abnormal = searchParams.get("abnormal");
    const pmi = searchParams.get("focusPmi");
    /* URL 显式筛选优先且保证确定性落地：清掉本地记忆的状态/方式 chip——否则记忆
     * 筛选可能把 focusPmi 目标轮次挡在列表外（静默 miss），或 UI 双活而服务端
     * abnormalOnly 覆盖 resultStatus 口径打架（评审 F5/F6，2026-11-03） */
    const urlDriven = Boolean(st || q || abnormal === "1" || pmi);
    if (urlDriven) {
      setStatusFilter(st && RESULT_STATUS_CONFIG[st as ResultStatusKey] ? (st as ResultStatusKey) : null);
      setMethodIds([]);
    }
    if (q) setSearchInput(q);
    if (abnormal === "1") setAbnormalFilter(true);
    if (pmi) setFocusPmi(pmi);
  }, [searchParams, urlConsumed]);

  /* focusPmi：首页列表到达后直开对应详情弹层（跨页桥——进展页「查看台账」落地） */
  const [focusOpened, setFocusOpened] = useState(false);
  useEffect(() => {
    if (!focusPmi || focusOpened || !items.length) return;
    const it = items.find((x) => x.projectManagementId === focusPmi);
    if (it) {
      setActiveItem(it);
      setFocusOpened(true);
    }
  }, [focusPmi, focusOpened, items]);

  /* 列表（首页替换、翻页追加；失败保留旧数据） */
  useEffect(() => {
    let active = true;
    if (page === 1) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    setError(null);
    fetchProcurements({
      page,
      pageSize: PAGE_SIZE,
      searchKeyword: searchKeyword || undefined,
      resultStatus: statusFilter ?? undefined,
      procurementMethod: methodIds.length ? methodIds.join(",") : undefined,
      abnormalOnly: abnormalFilter || undefined,
      companyId: filterCompanyId,
      startDate: queryRange.startDate,
      endDate: queryRange.endDate,
      departmentId: departmentIds.length ? departmentIds.join(",") : undefined,
      createdById: handlerIds.length ? handlerIds.join(",") : undefined,
    })
      .then((res) => {
        if (!active) return;
        setTotal(res.pagination.total);
        setTotalPages(res.pagination.totalPages);
        setItems((prev) => (page === 1 ? res.data : [...prev, ...res.data]));
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "加载台账失败");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setLoadingMore(false);
        }
      });
    return () => {
      active = false;
    };
  }, [page, searchKeyword, statusFilter, methodIds, abnormalFilter, filterCompanyId, retryTick, queryRange.startDate, queryRange.endDate, departmentIds, handlerIds]);

  /* 总览八项（2026-11-19 所有下拉实时适配+同比环比实时计算裁定）：与列表同参三窗取数
     （本窗 + 同比窗=整窗前移一年 + 环比邻窗=紧邻等长前移）；「全部」档只取本窗无子行 */
  useEffect(() => {
    let active = true;
    const base = {
      searchKeyword: searchKeyword || undefined,
      resultStatus: statusFilter ?? undefined,
      procurementMethod: methodIds.length ? methodIds.join(",") : undefined,
      abnormalOnly: abnormalFilter || undefined,
      companyId: filterCompanyId,
      departmentId: departmentIds.length ? departmentIds.join(",") : undefined,
      createdById: handlerIds.length ? handlerIds.join(",") : undefined,
    };
    fetchLedgerStats({ ...base, startDate: queryRange.startDate, endDate: queryRange.endDate })
      .then((r) => { if (active) setStats(r); })
      .catch(() => undefined);
    if (queryRange.startDate) {
      fetchLedgerStats({ ...base, startDate: shiftYearIso(queryRange.startDate), endDate: shiftYearIso(queryRange.endDate ?? todayIso()) })
        .then((r) => { if (active) setStatsYoy(r); })
        .catch(() => undefined);
      const prev = priorWindowIso(queryRange.startDate, queryRange.endDate);
      if (prev) {
        fetchLedgerStats({ ...base, ...prev })
          .then((r) => { if (active) setStatsPrev(r); })
          .catch(() => undefined);
      } else if (active) setStatsPrev(null);
    } else if (active) {
      setStatsYoy(null);
      setStatsPrev(null);
    }
    return () => { active = false; };
  }, [searchKeyword, statusFilter, methodIds, abnormalFilter, filterCompanyId, queryRange.startDate, queryRange.endDate, departmentIds, handlerIds, retryTick]);


  /* 公司口径标签（全称短拼，2026-11-19 胶囊筛选） */
  const companyLabel =
    companyIds.length === 0
      ? "全部公司"
      : (() => {
          const names = companyIds.map((id) => companies.find((c) => c.id === id)?.name ?? id);
          return names.length <= 2 ? names.join("、") : `${names.slice(0, 2).join("、")} 等 ${names.length} 家`;
        })();

  const loadMore = useCallback(() => {
    if (loading || loadingMore || page >= totalPages) return;
    setPage((p) => p + 1);
  }, [loading, loadingMore, page, totalPages]);

  /* 筛选变更：重置回第 1 页 + 记忆 */
  const changeFilter = (fn: () => void) => {
    fn();
    setPage(1);
    setVisibleCount(VISIBLE_INIT);
  };

  const persistLedger = useCallback(
    (patch: Partial<LedgerSavedFilters>) => {
      saveFilters("ledger", { statusFilter, methodFilter: null, companyIds, ...patch });
    },
    [statusFilter, methodIds, companyIds],
  );

  const { pull, refreshing } = usePullToRefresh(
    useCallback(async () => {
      setPage(1);
      setRetryTick((t) => t + 1);
    }, []),
  );

  return (
    <div>
      <PullIndicator pull={pull} refreshing={refreshing} />
      <PageHeader title="台账明细" icon={NotebookText} />
      {/* ── 搜索（胶囊版式，2026-11-19 与下拉触发器同语言）── */}
      <div className="m-tile mb-2 flex h-10 items-center gap-2 rounded-full px-3.5">
        <Search size={14} className="shrink-0 text-[var(--muted-foreground)]" />
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="搜索项目名称 / 编号"
          aria-label="搜索项目名称或编号"
          className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
        />
        {searchInput ? (
          <button
            type="button"
            onClick={() => setSearchInput("")}
            className="shrink-0 text-[13px] font-semibold text-[var(--accent)] active:scale-95"
          >
            清除
          </button>
        ) : null}
      </div>

      {/* ── 筛选胶囊（2026-11-19：时间/采购方式/部门/经办人 + 公司居右；与驾驶舱下拉同语言）──
          状态胶囊已换时间（用户裁定）；?status= 预置仍兼容解析 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <InlineSelect
          label={rangeKey === "custom" && customRange ? `${customRange.from.slice(5).replace("-", "/")}~${customRange.to.slice(5).replace("-", "/")}` : RANGES[rangeKey as PresetKey].label}
          active={rangeKey !== "all"}
          options={(Object.keys(RANGES) as PresetKey[]).reverse().map((k) => ({ value: k, label: RANGES[k].label }))}
          selected={[rangeKey]}
          onSelect={(next) => changeFilter(() => setRangeKey(next[0] as RangeKey))}
          onCustomApply={(from, to) => changeFilter(() => { setCustomRange({ from, to }); setRangeKey("custom"); })}
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
            onSelect={(next) =>
              changeFilter(() => {
                const hadAll = methodIds.length === 0;
                if (next.includes("all") && !hadAll) setMethodIds([]);
                else setMethodIds(next.filter((x) => x !== "all"));
              })
            }
            ariaLabel="按采购方式筛选（多选）"
          />
        ) : null}
        {/* 右组（2026-11-19 用户裁定：公司→部门→经办人居右成组，换行不散） */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {role === "admin" ? (
          <div>
            <InlineSelect
              multiple
              label={companyLabel}
              active={companyIds.length > 0}
              options={[{ value: "all", label: "全部公司" }, ...companies.map((c) => ({ value: c.id, label: c.name }))]}
              selected={companyIds.length === 0 ? ["all"] : companyIds}
              onSelect={(next) =>
                changeFilter(() => {
                  const hadAll = companyIds.length === 0;
                  if (next.includes("all") && !hadAll) {
                    setCompanyIds([]);
                    persistLedger({ companyIds: [] });
                  } else {
                    const v = next.filter((x) => x !== "all");
                    setCompanyIds(v);
                    persistLedger({ companyIds: v });
                  }
                })
              }
              ariaLabel={`公司口径：${companyLabel}`}
            />
          </div>
        ) : null}        {dimensions && dimensions.departments.length > 0 ? (
          <InlineSelect
            multiple
            label={
              departmentIds.length === 0
                ? "部门"
                : departmentIds.length <= 2
                  ? departmentIds.map((id) => dimensions.departments.find((d) => d.id === id)?.name ?? id).join("、")
                  : `部门 等${departmentIds.length}项`
            }
            active={departmentIds.length > 0}
            options={[{ value: "all", label: "全部部门" }, ...dimensions.departments.map((d) => ({ value: d.id, label: d.name }))]}
            selected={departmentIds.length === 0 ? ["all"] : departmentIds}
            onSelect={(next) =>
              changeFilter(() => {
                const hadAll = departmentIds.length === 0;
                if (next.includes("all") && !hadAll) setDepartmentIds([]);
                else setDepartmentIds(next.filter((x) => x !== "all"));
              })
            }
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
                  ? handlerIds.map((id) => dimensions.handlers.find((h) => h.id === id)?.name ?? id).join("、")
                  : `经办人 等${handlerIds.length}项`
            }
            active={handlerIds.length > 0}
            options={[{ value: "all", label: "全部经办人" }, ...dimensions.handlers.map((h) => ({ value: h.id, label: h.name }))]}
            selected={handlerIds.length === 0 ? ["all"] : handlerIds}
            onSelect={(next) =>
              changeFilter(() => {
                const hadAll = handlerIds.length === 0;
                if (next.includes("all") && !hadAll) setHandlerIds([]);
                else setHandlerIds(next.filter((x) => x !== "all"));
              })
            }
            ariaLabel="按经办人筛选"
          />
        ) : null}
        </div>
      </div>

      {/* ── 总览八项（2026-11-19 所有下拉实时适配+同比环比实时计算裁定）——
          与列表同源同筛（台账轮次口径）：项目盘点=归档(AWARDED)/进行中(PENDING)/异常四态，
          总数=归档+进行中；金额=成交预算/成交额/节约资金/节资率。子行同比/环比随筛选三窗实算，
          「全部」档无区间概念不显子行 */}
      {stats ? (
        <div className="neu-card-static mb-3 rounded-[18px] p-3">
          {(() => {
            /* 组标=当前全部生效筛选项（2026-11-19 用户裁定）：时间档 + 方式/部门/经办人/公司，
               无筛选时仅显时间档「全部」 */
            const rangeLabel = rangeKey === "custom" ? "所选区间" : RANGES[rangeKey as PresetKey].label;
            const parts: string[] = [queryRange.startDate ? rangeLabel : "全部"];
            if (methodIds.length) parts.push(methodIds.length <= 2 ? methodIds.join("、") : `${methodIds.length}种方式`);
            if (departmentIds.length) {
              const names = departmentIds.map((id) => dimensions?.departments.find((d) => d.id === id)?.name ?? id);
              parts.push(names.length <= 2 ? names.join("、") : `${names.length}个部门`);
            }
            if (handlerIds.length) {
              const names = handlerIds.map((id) => dimensions?.handlers.find((h) => h.id === id)?.name ?? id);
              parts.push(names.length <= 2 ? names.join("、") : `${names.length}位经办人`);
            }
            if (companyIds.length) parts.push(companyLabel);
            const scopeText = parts.join(" · ");
            const showRatio = Boolean(queryRange.startDate);
            const tile = (value: string, label: string, opts?: { danger?: boolean; success?: boolean; yoy?: DeltaR; hb?: DeltaR }) => (
              <div key={label} className="rounded-[12px] m-tile px-1 py-2.5 text-center">
                <div className={`max-w-full truncate text-center text-[16px] font-black leading-none tabular-nums ${opts?.danger ? "text-[var(--danger)]" : opts?.success ? "text-[var(--success)]" : "text-[var(--foreground)]"}`}>{value}</div>
                <div className="mt-1 truncate text-center text-[12px] text-[var(--muted-foreground)]">{label}</div>
                {showRatio ? (
                  <div className="mt-1 flex items-center justify-center gap-1.5 text-[10px] font-bold leading-none tabular-nums">
                    <span className={ratioCls(opts?.yoy)}>同比 {ratioTxt(opts?.yoy)}</span>
                    <span className={ratioCls(opts?.hb)}>环比 {ratioTxt(opts?.hb)}</span>
                  </div>
                ) : null}
              </div>
            );
            const group = (caption: string, list: React.ReactNode[]) => (
              <div>
                <div className="mb-1.5 px-1 text-[11px] font-bold tracking-[0.08em] text-[var(--muted-foreground)]">{caption}</div>
                <div className="grid grid-cols-4 gap-2.5">{list}</div>
              </div>
            );
            const totalOf = (v?: LedgerSummary | null) => (v ? v.awardedCount + v.pendingCount : undefined);
            const rateOf = (v?: LedgerSummary | null) => (v && v.awardedBudget > 0 ? v.totalSavings / v.awardedBudget : undefined);
            const rateNow = stats.awardedBudget > 0 ? stats.totalSavings / stats.awardedBudget : undefined;
            return (
              <div className="space-y-3">
                {group(`项目盘点 · ${scopeText}`, [
                  tile(String(stats.awardedCount + stats.pendingCount), "项目总数", { yoy: deltaOf(totalOf(stats), totalOf(statsYoy), null), hb: deltaOf(totalOf(stats), totalOf(statsPrev), null) }),
                  tile(String(stats.awardedCount), "归档项目", { yoy: deltaOf(stats.awardedCount, statsYoy?.awardedCount, null), hb: deltaOf(stats.awardedCount, statsPrev?.awardedCount, null) }),
                  tile(String(stats.pendingCount), "进行中项目", { yoy: deltaOf(stats.pendingCount, statsYoy?.pendingCount, null), hb: deltaOf(stats.pendingCount, statsPrev?.pendingCount, null) }),
                  tile(String(stats.abnormalCount), "异常项目", { danger: stats.abnormalCount > 0, yoy: deltaOf(stats.abnormalCount, statsYoy?.abnormalCount, false), hb: deltaOf(stats.abnormalCount, statsPrev?.abnormalCount, false) }),
                ])}
                <div className="h-px bg-[color-mix(in_oklch,var(--border)_45%,transparent)]" aria-hidden />
                {group(`金额 · ${scopeText}`, [
                  tile(stats.awardedBudgetLabel, "成交预算", { yoy: deltaOf(stats.awardedBudget, statsYoy?.awardedBudget, true), hb: deltaOf(stats.awardedBudget, statsPrev?.awardedBudget, true) }),
                  tile(stats.totalAwardLabel, "成交额", { yoy: deltaOf(stats.totalAward, statsYoy?.totalAward, true), hb: deltaOf(stats.totalAward, statsPrev?.totalAward, true) }),
                  tile(stats.totalSavingsLabel, "节约资金", { success: true, yoy: deltaOf(stats.totalSavings, statsYoy?.totalSavings, true), hb: deltaOf(stats.totalSavings, statsPrev?.totalSavings, true) }),
                  tile(rateNow != null ? `${(rateNow * 100).toFixed(1)}%` : "—", "节资率", { danger: true, yoy: deltaOf(rateNow, rateOf(statsYoy), true), hb: deltaOf(rateNow, rateOf(statsPrev), true) }),
                ])}
              </div>
            );
          })()}
        </div>
      ) : null}

      {error ? <ErrorBanner message={error} onRetry={() => setRetryTick((t) => t + 1)} /> : null}

      {/* ── 卡片列表 ── */}
      {loading && items.length === 0 ? (
        <div className="neu-card-static rounded-[18px] p-3.5">
          <Skeleton lines={4} height={64} />
        </div>
      ) : null}

      {!loading && items.length === 0 && !error ? (
        <div className="neu-card-static rounded-[18px] p-3.5">
          <EmptyState text="该筛选条件下暂无采购记录" />
        </div>
      ) : null}

      <div className="space-y-2.5">
        {items.slice(0, visibleCount).map((item) => {
          const cfg = RESULT_STATUS_CONFIG[item.resultStatus];
          /* 台账卡字段（2026-11-19 九板块页面化用户裁定）：项目名称/编号、公司·部门、
           * 采购方式、预算·成交·节资率（现算）、采购人（PMI 需求提出人）、经办人（轮次创建人） */
          const budget = Number(item.budgetAmount ?? 0);
          const award = Number(item.awardAmount ?? 0);
          const rate = budget > 0 && award > 0 && budget >= award ? `${(((budget - award) / budget) * 100).toFixed(1)}%` : "—";
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveItem(item)}
              className="m-tile w-full rounded-[16px] p-3.5 text-left active:scale-[0.99]"
              /* 状态浅底色（2026-11-19 用户裁定）：内联承载 cfg.cardBg（类名无法带动态色） */
              style={{ background: cfg.cardBg }}
            >
              <div className="flex items-start gap-2">
                <span className="shrink-0 pt-0.5 text-[13px] tabular-nums text-[var(--muted-foreground)]">{item.procurementDate || "—"}</span>
                <span className="min-w-0 flex-1 line-clamp-2 text-[16px] font-semibold leading-snug text-[var(--foreground)]">{item.projectName}</span>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[13px] font-bold"
                  style={{ color: cfg.color, background: cfg.bgColor, border: `1px solid ${cfg.borderColor}` }}
                >
                  {item.resultStatusLabel}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px]">
                <span className="font-semibold tabular-nums text-[var(--accent)]">{item.projectCode || "—"}</span>
                <span className="min-w-0 truncate text-[var(--muted-foreground)]">{item.purchaserName || "—"} · {item.departmentName || "—"}</span>
              </div>
              {/* 字段配色（2026-11-19 用户裁定：鲜艳且搭配均匀）——方式=金、预算=墨、
                  成交=绿、节资率=红（与驾驶舱裁定一致）；缺值恒灰 */}
              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-[color-mix(in_oklch,var(--border)_45%,transparent)] pt-2 text-[14px] text-[var(--muted-foreground)]">
                <span className="font-semibold text-[var(--gold)]">{item.procurementMethod}</span>
                <span className="tabular-nums">预算 <b className="font-semibold text-[var(--foreground)]">{fmtAmount(item.budgetAmount)}</b></span>
                <span className="tabular-nums">成交 <b className={`font-semibold tabular-nums ${award > 0 ? "text-[var(--success)]" : ""}`}>{award > 0 ? fmtAmount(item.awardAmount) : "—"}</b></span>
                <span className="tabular-nums">节资率 <b className={`font-semibold tabular-nums ${rate !== "—" ? "text-[var(--danger)]" : ""}`}>{rate}</b></span>
              </div>
              {/* 采购人/经办人居右（2026-11-19 用户裁定） */}
              <div className="mt-1 flex flex-wrap justify-end gap-x-3 text-[12px] text-[var(--muted-foreground)]">
                <span>采购人 <span className="font-medium text-[var(--foreground)]">{item.requesterName ?? "—"}</span></span>
                <span>经办人 <span className="font-medium text-[var(--foreground)]">{item.createdByName ?? "—"}</span></span>
              </div>
            </button>
          );
        })}
      </div>

      {/* 展开更多 / 末尾（2026-11-17：触底自动加载改手动，防滚动即翻页回到长页） */}
      {loadingMore ? (
        <div className="flex items-center justify-center gap-2 py-2 text-[15px] text-[var(--muted-foreground)]">
          <Loader2 size={13} className="animate-spin" /> 加载中...
        </div>
      ) : visibleCount < items.length || page < totalPages ? (
        <button
          type="button"
          onClick={() => {
            setVisibleCount((c) => c + VISIBLE_STEP);
            /* 已载将尽且还有页 → 预取下一页（15/页），显示层与拉取层解耦 */
            if (visibleCount + VISIBLE_STEP > items.length - 3) loadMore();
          }}
          className="neu-btn-soft mt-3 h-10 w-full rounded-[12px] text-[15px] active:scale-[0.99]"
        >
          展开更多（已显 {Math.min(visibleCount, items.length)} / 共 {total} 条）
        </button>
      ) : items.length > 0 ? (
        <p className="py-2 text-center text-[14px] text-[var(--muted-foreground)]">已全部加载 {total} 条</p>
      ) : null}

      {/* ── 详情弹层 ── */}
      <BottomSheet open={!!activeItem} onClose={() => setActiveItem(null)} title={<span className="line-clamp-2">{activeItem?.projectName ?? ""}</span>}>
        {activeItem && archiveDetail ? (
          /* ── 归档/终止详情（:3005 同源载荷，2026-11-19 对齐裁定）── */
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className="rounded-full px-2 py-0.5 text-[13px] font-bold"
                style={{
                  color: RESULT_STATUS_CONFIG[activeItem.resultStatus].color,
                  background: RESULT_STATUS_CONFIG[activeItem.resultStatus].bgColor,
                  border: `1px solid ${RESULT_STATUS_CONFIG[activeItem.resultStatus].borderColor}`,
                }}
              >
                {activeItem.resultStatusLabel}
              </span>
              <span className="rounded-full bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-2 py-0.5 text-[13px] font-medium text-[var(--accent)]">
                {activeItem.procurementMethod}
              </span>
              <span className="rounded-full bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)] px-2 py-0.5 text-[13px] text-[var(--muted-foreground)]">
                {archiveDetail.kind === "terminated" ? "终止" : "归档"}：{(archiveDetail.archivedAt ?? activeItem.archivedAt ?? "").slice(0, 10) || "—"}
              </span>
            </div>

            {/* 项目步骤（全阶段+轮次+附件计数；点「分析」懒生成） */}
            <div>
              <div className="mb-1.5 px-1 text-[11px] font-bold tracking-[0.08em] text-[var(--muted-foreground)]">项目步骤</div>
              <div className="space-y-1.5 rounded-[12px] m-tile px-3 py-2.5">
                {archiveDetail.stages.map((st) => {
                  const done = st.status === "COMPLETED";
                  const ana = stepAnalysis[st.stageKey];
                  return (
                    <div key={`${st.stageKey}-${st.round ?? 1}`}>
                      <div className="flex items-center gap-2 py-0.5">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${done ? "bg-[var(--success)]" : st.status === "IN_PROGRESS" || st.stageKey === activeItem.resultStatus ? "bg-[var(--accent)]" : "bg-[color-mix(in_oklch,var(--muted-foreground)_35%,transparent)]"}`}
                        />
                        <span className={`min-w-0 flex-1 truncate text-[14px] ${done ? "font-medium text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}`}>
                          {st.stageName}
                          {(st.round ?? 1) > 1 ? <span className="ml-1 text-[12px] text-[var(--warning)]">第 {st.round} 轮</span> : null}
                        </span>
                        {st.attachments.length ? (
                          <span className="shrink-0 text-[12px] tabular-nums text-[var(--muted-foreground)]">文件 {st.attachments.length}</span>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => runStepAnalysis(archiveDetail.projectId, st.stageKey, st.round)}
                          className="neu-btn-soft h-7 shrink-0 rounded-[8px] px-2 text-[12px] active:scale-95"
                        >
                          {ana && ana !== "loading" ? "查看分析" : "分析"}
                        </button>
                      </div>
                      {/* 附件（文件名+大小） */}
                      {st.attachments.map((f) => (
                        <div key={f.id} className="ml-4 flex items-center gap-2 py-0.5 text-[13px] text-[var(--muted-foreground)]">
                          <FolderKanban size={12} className="shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{f.fileName}</span>
                          <span className="shrink-0 tabular-nums">{f.fileSize > 1048576 ? `${(f.fileSize / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(f.fileSize / 1024))} KB`}</span>
                        </div>
                      ))}
                      {ana ? (
                        <div className="ml-4 mt-1 rounded-[10px] bg-[color-mix(in_oklch,var(--accent)_6%,transparent)] px-2.5 py-2 text-[13px] leading-relaxed text-[var(--foreground)]">
                          {ana === "loading" ? "正在生成分析..." : ana.empty ? "暂无分析内容" : ana.content}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 关键指标（:3005 同五项；extractedInfo 优先，回退列表字段） */}
            <div className="grid grid-cols-2 gap-2">
              <MetricCard label="中标单位" value={archiveDetail.extractedInfo["中标单位"] || activeItem.awardedSupplierName || "-"} />
              <MetricCard label="预算金额" value={fmtAmount(activeItem.budgetAmount)} />
              <MetricCard label="合同金额" value={archiveDetail.extractedInfo["合同金额"] && archiveDetail.extractedInfo["合同金额"] !== "-" ? archiveDetail.extractedInfo["合同金额"] : fmtAmount(activeItem.contractAmount)} tone="accent" />
              <MetricCard label="节约资金" value={archiveDetail.extractedInfo["节约资金"] ?? "-"} tone="success" />
            </div>

            {/* 基本信息（basicInfo 全量 2 列） */}
            <div>
              <div className="mb-1.5 px-1 text-[11px] font-bold tracking-[0.08em] text-[var(--muted-foreground)]">基本信息</div>
              <div className="space-y-0.5 rounded-[12px] m-tile px-3 py-2.5 text-[15px]">
                {Object.entries(archiveDetail.basicInfo).map(([k, v]) => (
                  <DetailRow key={k} label={k} value={v || "-"} />
                ))}
              </div>
            </div>

            {/* 项目简报 */}
            {archiveDetail.summary ? (
              <div>
                <div className="mb-1.5 px-1 text-[11px] font-bold tracking-[0.08em] text-[var(--muted-foreground)]">项目简报</div>
                <div className={`rounded-[12px] px-3 py-2.5 text-[14px] leading-relaxed text-[var(--foreground)] ${archiveDetail.kind === "terminated" ? "border border-[color-mix(in_oklch,var(--danger)_18%,transparent)] bg-[color-mix(in_oklch,var(--danger)_5%,transparent)]" : "m-tile"}`}>
                  {archiveDetail.summary}
                </div>
              </div>
            ) : null}
          </div>
        ) : activeItem && archiveLoading ? (
          <div className="py-2">
            <Skeleton lines={6} height={40} />
          </div>
        ) : activeItem ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className="rounded-full px-2 py-0.5 text-[13px] font-bold"
                style={{
                  color: RESULT_STATUS_CONFIG[activeItem.resultStatus].color,
                  background: RESULT_STATUS_CONFIG[activeItem.resultStatus].bgColor,
                  border: `1px solid ${RESULT_STATUS_CONFIG[activeItem.resultStatus].borderColor}`,
                }}
              >
                {activeItem.resultStatusLabel}
              </span>
              <span className="rounded-full bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-2 py-0.5 text-[13px] font-medium text-[var(--accent)]">
                {activeItem.procurementMethod}
              </span>
              {activeItem.retentionPeriod ? (
                <span className="rounded-full bg-[color-mix(in_oklch,var(--gold)_12%,transparent)] px-2 py-0.5 text-[13px] font-medium text-[var(--gold)]">
                  归档 · {RETENTION_LABELS[activeItem.retentionPeriod] ?? activeItem.retentionPeriod}
                </span>
              ) : null}
            </div>

            {/* ── 金额（2×2 指标卡）── */}
            <div className="grid grid-cols-2 gap-2">
              <MetricCard label="预算金额" value={fmtAmount(activeItem.budgetAmount)} />
              <MetricCard label="中标金额" value={activeItem.awardAmount != null && activeItem.awardAmount !== "" ? fmtAmount(activeItem.awardAmount) : "—"} tone="success" />
              {activeItem.controlAmount != null ? <MetricCard label="控制价" value={fmtAmount(activeItem.controlAmount)} /> : null}
              {activeItem.contractAmount != null ? <MetricCard label="合同金额" value={fmtAmount(activeItem.contractAmount)} tone="accent" /> : null}
            </div>

            {/* ── 台账详情分组（2026-11-19 用户裁定：参考 :3005 重组，撤 15 行平铺）── */}
            {(() => {
              const group = (caption: string, rows: React.ReactNode[]) =>
                rows.length ? (
                  <div>
                    <div className="mb-1.5 px-1 text-[11px] font-bold tracking-[0.08em] text-[var(--muted-foreground)]">{caption}</div>
                    <div className="space-y-0.5 rounded-[12px] m-tile px-3 py-2.5 text-[15px]">{rows}</div>
                  </div>
                ) : null;
              return (
                <>
                  {group("基本信息", [
                    <DetailRow key="c" label="项目编号" value={activeItem.projectCode} />,
                    <DetailRow key="r" label="采购轮次" value={`第 ${activeItem.roundNo} 轮`} />,
                    activeItem.purchaserName ? <DetailRow key="u" label="采购单位" value={activeItem.purchaserName} /> : null,
                    <DetailRow key="d" label="采购部门" value={activeItem.departmentName} />,
                    <DetailRow key="pd" label="采购日期" value={activeItem.procurementDate ?? "—"} />,
                    activeItem.initiationDate ? <DetailRow key="id" label="立项日期" value={activeItem.initiationDate} /> : null,
                  ])}
                  {group(activeItem.resultStatus === "AWARDED" ? "成交与签约" : "评审信息", [
                    activeItem.awardedSupplierName ? <DetailRow key="s" label="中标供应商" value={activeItem.awardedSupplierName} tone="accent" /> : null,
                    activeItem.expertInfo ? <DetailRow key="e" label="评审专家" value={activeItem.expertInfo} /> : null,
                    activeItem.biddingUnits ? <DetailRow key="b" label="投标单位" value={activeItem.biddingUnits} /> : null,
                    activeItem.contractNumber ? <DetailRow key="n" label="合同编号" value={activeItem.contractNumber} /> : null,
                    activeItem.archivedAt ? <DetailRow key="a" label="归档时间" value={activeItem.archivedAt.slice(0, 10)} /> : null,
                  ])}
                  {group("经办信息", [
                    activeItem.requesterName ? <DetailRow key="rq" label="采购人" value={activeItem.requesterName} /> : null,
                    activeItem.createdByName ? <DetailRow key="cb" label="经办人" value={activeItem.createdByName} /> : null,
                  ])}
                  {activeItem.terminationReason ? (
                    <div>
                      <div className="mb-1.5 px-1 text-[11px] font-bold tracking-[0.08em] text-[var(--muted-foreground)]">终止信息</div>
                      <div className="rounded-[12px] border border-[color-mix(in_oklch,var(--danger)_18%,transparent)] bg-[color-mix(in_oklch,var(--danger)_5%,transparent)] px-3 py-2.5 text-[15px] text-[var(--foreground)]">
                        {activeItem.terminationReason}
                      </div>
                    </div>
                  ) : null}
                </>
              );
            })()}

            {activeItem.supplierNames.length ? (
              <div>
                <div className="mb-1.5 text-[14px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">参与供应商（{activeItem.supplierNames.length}）</div>
                <div className="flex flex-wrap gap-1.5">
                  {activeItem.supplierNames.map((n) => (
                    <span key={n} className="rounded-full bg-[color-mix(in_oklch,white_55%,transparent)] px-2.5 py-1 text-[14px] text-[var(--foreground)]">
                      {n}
                    </span>
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
