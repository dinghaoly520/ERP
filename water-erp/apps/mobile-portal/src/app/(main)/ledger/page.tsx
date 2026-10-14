"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { fetchCompanies, type CompanyOption } from "@/lib/api/auth";
import { fetchProcurements, fetchLedgerStats, fetchProcurementMethods } from "@/lib/api/procurements";
import { RESULT_STATUS_CONFIG, type LedgerSummary, type ProcurementRoundItem, type ResultStatusKey } from "@/lib/types/procurement";
import { useAuth } from "@/components/m/auth-context";
import { BottomSheet } from "@/components/m/bottom-sheet";
import { Chip } from "@/components/m/chip";
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
  companyId: string;
};

const RETENTION_LABELS: Record<string, string> = { PERMANENT: "永久", Y30: "30 年", Y10: "10 年" };
const SOURCE_LABELS: Record<string, string> = {
  MANUAL: "手工录入",
  IMPORTED: "导入",
  PROJECT_MANAGEMENT: "项目管理提取",
};

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
  const [companyId, setCompanyId] = useState<string>(saved.companyId ?? "all");

  const [searchInput, setSearchInput] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<ResultStatusKey | null>(saved.statusFilter ?? null);
  const [methodFilter, setMethodFilter] = useState<string | null>(saved.methodFilter ?? null);
  const [methods, setMethods] = useState<string[]>([]);

  const [items, setItems] = useState<ProcurementRoundItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const [stats, setStats] = useState<LedgerSummary | null>(null);
  const [activeItem, setActiveItem] = useState<ProcurementRoundItem | null>(null);

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  /* 搜索 400ms 防抖 */
  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearchKeyword(searchInput.trim());
      setPage(1);
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

  const filterCompanyId = companyId === "all" ? undefined : companyId;

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
      procurementMethod: methodFilter ?? undefined,
      companyId: filterCompanyId,
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
  }, [page, searchKeyword, statusFilter, methodFilter, filterCompanyId, retryTick]);

  /* 汇总（与列表同筛选，不含分页） */
  useEffect(() => {
    let active = true;
    fetchLedgerStats(undefined, undefined, filterCompanyId)
      .then((s) => {
        if (active) setStats(s);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [filterCompanyId]);

  /* 触底自动加载 */
  const loadMore = useCallback(() => {
    if (loading || loadingMore || page >= totalPages) return;
    setPage((p) => p + 1);
  }, [loading, loadingMore, page, totalPages]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "120px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  const statusChips = useMemo(() => Object.values(RESULT_STATUS_CONFIG), []);

  /* 筛选变更：重置回第 1 页 + 记忆 */
  const changeFilter = (fn: () => void) => {
    fn();
    setPage(1);
  };

  const persistLedger = useCallback(
    (patch: Partial<LedgerSavedFilters>) => {
      saveFilters("ledger", { statusFilter, methodFilter, companyId, ...patch });
    },
    [statusFilter, methodFilter, companyId],
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
      {/* ── 汇总条 ── */}
      {stats ? (
        <div className="neu-card-static mb-3 rounded-[16px] p-3">
          <div className="grid grid-cols-4 gap-1.5 text-center">
            {[
              { l: "总数", v: stats.totalCount, t: "accent" },
              { l: "已成交", v: stats.awardedCount, t: "success" },
              { l: "待处理", v: stats.pendingCount, t: "warning" },
              { l: "异常", v: stats.abnormalCount, t: "danger" },
            ].map((m) => (
              <div key={m.l}>
                <div
                  className="text-[17px] font-black leading-none tabular-nums"
                  style={{
                    color:
                      m.t === "success" ? "var(--success)" : m.t === "danger" ? "var(--danger)" : m.t === "warning" ? "var(--warning)" : "var(--accent)",
                  }}
                >
                  {m.v}
                </div>
                <div className="mt-1 text-[10px] text-[var(--muted-foreground)]">{m.l}</div>
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex items-center justify-between border-t border-[color-mix(in_oklch,var(--border)_50%,transparent)] pt-2 text-[11px]">
            <span className="text-[var(--muted-foreground)]">
              总预算 <span className="font-bold tabular-nums text-[var(--foreground)]">{stats.totalBudgetLabel}</span>
            </span>
            <span className="text-[var(--muted-foreground)]">
              累计节资 <span className="font-bold tabular-nums text-[var(--success)]">{stats.totalSavingsLabel}</span>
            </span>
          </div>
        </div>
      ) : null}

      {/* ── 搜索 ── */}
      <div className="relative mb-2.5">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="搜索项目名称 / 编号"
          className="m-input h-11 w-full text-[14px] pl-10"
        />
        {searchInput ? (
          <button
            type="button"
            onClick={() => setSearchInput("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[var(--accent)] active:scale-95"
          >
            清除
          </button>
        ) : null}
      </div>

      {/* ── 筛选 chips ── */}
      <div className="mb-2 flex gap-2 overflow-x-auto pb-0.5">
        <Chip active={!statusFilter} onClick={() => changeFilter(() => { setStatusFilter(null); persistLedger({ statusFilter: null }); })}>
          全部状态
        </Chip>
        {statusChips.map((c) => (
          <Chip
            key={c.key}
            active={statusFilter === c.key}
            onClick={() =>
              changeFilter(() => {
                const next = statusFilter === c.key ? null : c.key;
                setStatusFilter(next);
                persistLedger({ statusFilter: next });
              })
            }
          >
            {c.label}
          </Chip>
        ))}
      </div>
      {methods.length > 1 ? (
        <div className="mb-2 flex gap-2 overflow-x-auto pb-0.5">
          <Chip active={!methodFilter} onClick={() => changeFilter(() => { setMethodFilter(null); persistLedger({ methodFilter: null }); })}>
            全部方式
          </Chip>
          {methods.map((m) => (
            <Chip
              key={m}
              active={methodFilter === m}
              onClick={() =>
                changeFilter(() => {
                  const next = methodFilter === m ? null : m;
                  setMethodFilter(next);
                  persistLedger({ methodFilter: next });
                })
              }
            >
              {m}
            </Chip>
          ))}
        </div>
      ) : null}
      {role === "admin" ? (
        <select
          value={companyId}
          onChange={(e) =>
            changeFilter(() => {
              setCompanyId(e.target.value);
              persistLedger({ companyId: e.target.value });
            })
          }
          aria-label="公司筛选"
          className="m-input mb-3 h-10 w-full text-[13px] font-medium"
        >
          <option value="all">全部公司</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.shortName || c.name}
            </option>
          ))}
        </select>
      ) : (
        <div className="mb-3" />
      )}

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
        {items.map((item) => {
          const cfg = RESULT_STATUS_CONFIG[item.resultStatus];
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveItem(item)}
              className="neu-card-static w-full rounded-[16px] p-3.5 text-left active:scale-[0.99]"
            >
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 line-clamp-2 text-[13px] font-semibold leading-snug text-[var(--foreground)]">{item.projectName}</span>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
                  style={{ color: cfg.color, background: cfg.bgColor, border: `1px solid ${cfg.borderColor}` }}
                >
                  {item.resultStatusLabel}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
                <span className="shrink-0 tabular-nums">{item.procurementDate || "—"}</span>
                <span>·</span>
                <span className="min-w-0 flex-1 truncate">{item.procurementMethod}</span>
                <span>·</span>
                <span className="max-w-[8rem] shrink-0 truncate">{item.departmentName}</span>
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-[color-mix(in_oklch,var(--border)_45%,transparent)] pt-2">
                <span className="text-[11px] text-[var(--muted-foreground)]">
                  预算 <span className="font-semibold tabular-nums text-[var(--foreground)]">{fmtAmount(item.budgetAmount)}</span>
                </span>
                {item.awardAmount !== null && item.awardAmount !== undefined && item.awardAmount !== "" ? (
                  <span className="text-[11px] text-[var(--muted-foreground)]">
                    中标 <span className="font-bold tabular-nums text-[var(--success)]">{fmtAmount(item.awardAmount)}</span>
                  </span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      {/* 触底哨兵 / 加载态 / 末尾 */}
      <div ref={sentinelRef} className="mt-3" />
      {loadingMore ? (
        <div className="flex items-center justify-center gap-2 py-2 text-xs text-[var(--muted-foreground)]">
          <Loader2 size={13} className="animate-spin" /> 加载中...
        </div>
      ) : items.length > 0 && page >= totalPages ? (
        <p className="py-2 text-center text-[11px] text-[var(--muted-foreground)]">已全部加载 {total} 条</p>
      ) : null}

      {/* ── 详情弹层 ── */}
      <BottomSheet open={!!activeItem} onClose={() => setActiveItem(null)} title={<span className="line-clamp-2">{activeItem?.projectName ?? ""}</span>}>
        {activeItem ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{
                  color: RESULT_STATUS_CONFIG[activeItem.resultStatus].color,
                  background: RESULT_STATUS_CONFIG[activeItem.resultStatus].bgColor,
                  border: `1px solid ${RESULT_STATUS_CONFIG[activeItem.resultStatus].borderColor}`,
                }}
              >
                {activeItem.resultStatusLabel}
              </span>
              <span className="rounded-full bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                {activeItem.procurementMethod}
              </span>
              {activeItem.retentionPeriod ? (
                <span className="rounded-full bg-[color-mix(in_oklch,var(--gold)_12%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--gold)]">
                  归档 · {RETENTION_LABELS[activeItem.retentionPeriod] ?? activeItem.retentionPeriod}
                </span>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <MetricCard label="预算金额" value={fmtAmount(activeItem.budgetAmount)} />
              <MetricCard label="中标金额" value={activeItem.awardAmount != null && activeItem.awardAmount !== "" ? fmtAmount(activeItem.awardAmount) : "—"} tone="success" />
              {activeItem.controlAmount != null ? <MetricCard label="控制价" value={fmtAmount(activeItem.controlAmount)} /> : null}
              {activeItem.contractAmount != null ? <MetricCard label="合同金额" value={fmtAmount(activeItem.contractAmount)} tone="accent" /> : null}
            </div>

            <div className="space-y-0.5 rounded-[12px] m-tile px-3 py-2.5 text-[12px]">
              <DetailRow label="项目编号" value={activeItem.projectCode} />
              <DetailRow label="采购轮次" value={`第 ${activeItem.roundNo} 轮`} />
              {activeItem.purchaserName ? <DetailRow label="采购单位" value={activeItem.purchaserName} /> : null}
              <DetailRow label="采购部门" value={activeItem.departmentName} />
              <DetailRow label="采购日期" value={activeItem.procurementDate ?? "—"} />
              {activeItem.initiationDate ? <DetailRow label="立项日期" value={activeItem.initiationDate} /> : null}
              {activeItem.awardedSupplierName ? <DetailRow label="中标供应商" value={activeItem.awardedSupplierName} tone="accent" /> : null}
              {activeItem.expertInfo ? <DetailRow label="评审专家" value={activeItem.expertInfo} /> : null}
              {activeItem.biddingUnits ? <DetailRow label="招标单位" value={activeItem.biddingUnits} /> : null}
              {activeItem.contractNumber ? <DetailRow label="合同编号" value={activeItem.contractNumber} /> : null}
              {activeItem.archivedAt ? <DetailRow label="归档时间" value={activeItem.archivedAt.slice(0, 10)} /> : null}
              {activeItem.terminationReason ? <DetailRow label="终止原因" value={activeItem.terminationReason} tone="danger" /> : null}
              <DetailRow label="数据来源" value={SOURCE_LABELS[activeItem.sourceType] ?? activeItem.sourceType} />
              {activeItem.createdByName ? <DetailRow label="录入人" value={activeItem.createdByName} /> : null}
            </div>

            {activeItem.supplierNames.length ? (
              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">参与供应商（{activeItem.supplierNames.length}）</div>
                <div className="flex flex-wrap gap-1.5">
                  {activeItem.supplierNames.map((n) => (
                    <span key={n} className="rounded-full bg-[color-mix(in_oklch,white_55%,transparent)] px-2.5 py-1 text-[11px] text-[var(--foreground)]">
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
