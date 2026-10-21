"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { isGroupedCompanyView, CompanySelect, readInitialCompanyId } from "@/components/company/company-select";
import { SasacExtractModal } from "@/components/procurements/sasac-extract-modal";
import { ProjectTimelineStrip } from "@/components/projects/project-timeline-strip";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  XCircle,
  FileEdit,
  Ban,
  Building2,
  Sparkles,
  X,
  Calendar,
  AlertCircle,
  Loader2,
  Trophy,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  FolderKanban,
  Trash2,
  RotateCcw,
  ClipboardCheck,
  FileArchive,
} from "lucide-react";
import { CompanySectionHeader, buildCompanyCounts, useCompanyName } from "@/components/company/company-tag";
import type { ProcurementRoundItem, ResultStatusKey, LedgerFilterState } from "@/lib/types/procurement";
import { RESULT_STATUS_CONFIG } from "@/lib/types/procurement";
import {
  fetchProcurements,
  fetchProcurementMethods,
  analyzeProcurementLedger,
  moveProcurementToRecycleBin,
  restoreProcurementFromRecycleBin,
  deleteProcurementPermanently,
  fetchLedgerCompanyCounts,
} from "@/lib/api/procurements";
import { fetchCurrentUser, fetchDepartments } from "@/lib/api/auth";
import { canAccessCockpit } from "@/lib/login/login-routing";
import { ArchiveDetailModal } from "@/components/procurements/archive-detail-modal";
import { ArchiveVolumeModal } from "@/components/procurements/archive-volume-modal";
import { AnalysisSelectionModal } from "@/components/procurements/analysis-selection-modal";
import { AnalysisResultModal } from "@/components/procurements/analysis-result-modal";
import type { AiAnalysisResult } from "@/components/procurements/ledger-analysis";
import { buildLedgerAnalysisSummary } from "@/components/procurements/ledger-analysis";
import { useAssistant } from "@/components/assistant/assistant-provider";
import { Modal } from "@/components/workbench";
import { useConfirm } from "@/components/workbench/use-confirm";
import { apiFetch } from '@/lib/api/api-fetch';
import { formatWan } from '@/lib/format';
import { toast } from "sonner";

const accentMap = {
  blue: "rgba(96,139,239,1)",
  blueLight: "rgba(96,139,239,0.12)",
  teal: "rgba(92,181,150,1)",
  tealLight: "rgba(92,181,150,0.12)",
  gold: "rgba(234,188,110,1)",
  goldLight: "rgba(234,188,110,0.14)",
  coral: "rgba(230,129,102,1)",
  coralLight: "rgba(230,129,102,0.12)",
  indigo: "rgba(119,129,219,1)",
};

// Status Badge
function StatusBadge({ status, resultText, terminationReason }: { status: ResultStatusKey; resultText?: string | null; terminationReason?: string | null }) {
  // 终止项目：红色「已终止」徽章（区分于普通「已取消」——后者是投标环节取消，非项目级终止）
  if (status === "CANCELLED" && terminationReason) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
        style={{ color: "rgba(220,90,80,1)", backgroundColor: "rgba(220,90,80,0.12)", border: "1px solid rgba(220,90,80,0.25)" }}>
        <Ban size={12} />
        已终止
      </span>
    );
  }

  const config = RESULT_STATUS_CONFIG[status];
  const icons: Record<string, React.ReactNode> = {
    check: <CheckCircle2 size={12} />,
    clock: <Clock size={12} />,
    x: <XCircle size={12} />,
    edit: <FileEdit size={12} />,
    alert: <AlertTriangle size={12} />,
    ban: <Ban size={12} />,
  };

  // 已成交和待处理显示通用标签，其他状态显示具体原因
  const displayLabel = (status === "AWARDED" || status === "PENDING" || !resultText)
    ? config.label
    : resultText;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
      style={{ color: config.color, backgroundColor: config.bgColor, border: `1px solid ${config.borderColor}` }}
    >
      {icons[config.icon]}
      {displayLabel}
    </span>
  );
}

// Unified Page Hero: title + KPI + search toolbar
function PageHero({
  filters,
  searchInput,
  onFilterChange,
  methods,
  onRefresh,
  onAnalyze,
  loading,
  pagination,
  data,
  sortBy,
  onSortChange,
  companyId,
  onCompanyChange,
  onOpenExtract,
  isAdmin,
  abnormalTotal,
  departments,
}: {
  filters: LedgerFilterState;
  // 搜索框即时回显值（与防抖后的 filters.searchKeyword 分离，见 handleFilterChange）
  searchInput: string;
  onFilterChange: (key: keyof LedgerFilterState, value: string | null) => void;
  methods: string[];
  onRefresh: () => void;
  onAnalyze: () => void;
  loading: boolean;
  pagination: { total: number; page: number; totalPages: number };
  data: ProcurementRoundItem[];
  sortBy: string;
  onSortChange: (value: string) => void;
  companyId: string;
  onCompanyChange: (value: string) => void;
  onOpenExtract: () => void;
  isAdmin: boolean;
  abnormalTotal?: number;
  departments: Array<{ id: string; name: string }>;
}) {
  // 异常=服务端全量口径（2026-09-28 审计 P2：此前只数当前页 12 条，与"共 total 条"并列打架）；
  // 旧后端无此字段时回退当前页推导
  const abnormalCount = abnormalTotal ?? data.filter(i =>
    ["FAILED_REVIEW", "FILE_REVISION_REQUIRED", "INVALID_RESPONSE", "CANCELLED"].includes(i.resultStatus)
  ).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="page-hero"
    >
      {/* 标题行 */}
      <div className="page-hero__row">
        <div className="page-hero__left">
          <div className="page-hero__icon">
            <FolderKanban size={17} />
          </div>
          <div>
            <div className="page-hero__title">采购台账</div>
            <div className="page-hero__sub">事项追踪与采购记录管理</div>
          </div>
        </div>

        <div className="page-hero__right">
          <CompanySelect value={companyId} onChange={onCompanyChange} countMode="projectsDone" />
          {isAdmin && (
          <button
            type="button"
            onClick={onOpenExtract}
            className="neu-btn-soft !h-9 !px-3 gap-1.5 text-xs"
            title="按国资监管九大领域业务数据指标库提取采购领域数据"
          >
            <ClipboardCheck size={14} strokeWidth={1.9} className="text-[var(--accent)]" />
            国资监管数据生成
          </button>
          )}
          <span className="page-hero__stat page-hero__stat--info">
            共 {pagination.total} 条
          </span>
          {abnormalCount > 0 && (
            <span className="page-hero__stat page-hero__stat--warn">
              <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-[oklch(0.67_0.14_32)]" />
              异常 {abnormalCount}
            </span>
          )}
          <button onClick={onRefresh} disabled={loading} className="neu-btn-xs">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* 搜索 + 筛选行 */}
      <div className="flex flex-wrap items-center gap-3" style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }}>
        <div className="relative w-[280px] shrink-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--muted-foreground)] z-10" />
          <input
            type="text"
            placeholder="搜索项目名称、供应商..."
            value={searchInput}
            onChange={(e) => onFilterChange("searchKeyword", e.target.value)}
            className="neu-input neu-input-sm !pl-9"
          />
          {searchInput && (
            <button onClick={() => onFilterChange("searchKeyword", null)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-[rgba(96,139,239,0.1)] text-[var(--muted-foreground)] z-10">
              <X size={14} />
            </button>
          )}
        </div>

        {filters.searchKeyword && filters.searchKeyword.length >= 2 && (
          <button onClick={onAnalyze} className="neu-btn-primary !h-9 !px-4">
            <Sparkles size={15} />
            分析
          </button>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">排序</span>
          <select
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value)}
            className="workbench-input workbench-input-sm !w-auto min-w-[100px]"
          >
            <option value="procurementDate">时间</option>
            <option value="amount">金额</option>
          </select>

          <span className="ml-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">筛选</span>
          <select
            value={filters.procurementMethod || ""}
            onChange={(e) => onFilterChange("procurementMethod", e.target.value || null)}
            className="workbench-input workbench-input-sm !w-auto min-w-[120px]"
          >
            <option value="">全部方式</option>
            {methods.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>

          {/* 日期区间 + 部门筛选（2026-09-28 审计 P2：后端支持、前端零入口——台账无法按时间段查） */}
          <input
            type="date"
            value={filters.startDate ?? ""}
            onChange={(e) => onFilterChange("startDate", e.target.value || null)}
            className="workbench-input workbench-input-sm !w-auto"
            aria-label="采购日期起"
            title="采购日期起"
          />
          <span className="text-[10px] text-[color:var(--muted-foreground)]">~</span>
          <input
            type="date"
            value={filters.endDate ?? ""}
            onChange={(e) => onFilterChange("endDate", e.target.value || null)}
            className="workbench-input workbench-input-sm !w-auto"
            aria-label="采购日期止"
            title="采购日期止"
          />
          {departments.length > 0 && (
            <select
              value={filters.departmentId || ""}
              onChange={(e) => onFilterChange("departmentId", e.target.value || null)}
              className="workbench-input workbench-input-sm !w-auto min-w-[110px]"
              aria-label="部门"
            >
              <option value="">全部部门</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}

          {/* 状态+类型+回收站 合一（单选收窄，互斥）：cat:=类型项、recycle:=回收站。
              选项按实际使用频率排序：常用在前、罕见审查类状态殿后 */}
          <select
            value={filters.recycleStatus === "RECYCLED" ? "recycle:RECYCLED" : filters.category ? `cat:${filters.category}` : filters.resultStatus || ""}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") {
                onFilterChange("resultStatus", null);
                onFilterChange("category", null);
                onFilterChange("recycleStatus", "ACTIVE");
              } else if (v.startsWith("cat:")) onFilterChange("category", v.slice(4) as "archived" | "terminated");
              else if (v.startsWith("recycle:")) onFilterChange("recycleStatus", "RECYCLED");
              else onFilterChange("resultStatus", v as ResultStatusKey);
            }}
            className="workbench-input workbench-input-sm !w-auto min-w-[110px]"
          >
            <option value="">全部</option>
            <option value="AWARDED">已成交</option>
            <option value="PENDING">待处理</option>
            <option value="cat:archived">已归档</option>
            <option value="cat:terminated">已终止</option>
            <option value="CANCELLED">已取消</option>
            {(["FAILED_REVIEW", "FILE_REVISION_REQUIRED", "INVALID_RESPONSE"] as ResultStatusKey[]).map((k) => (
              <option key={k} value={k}>{RESULT_STATUS_CONFIG[k].label}</option>
            ))}
            <option value="recycle:RECYCLED">回收站</option>
          </select>
        </div>
      </div>
    </motion.div>
  );
}

// Ledger Row (Full version for main list)
function LedgerRow({
  item,
  onExpand,
  isExpanded,
  projectSummary,
  summaryLoading,
  onViewArchive,
  onViewVolume,
  onMoveToRecycleBin,
  onRestore,
  onDeletePermanently,
  isAdmin,
  canManageVolume = false,
}: {
  item: ProcurementRoundItem;
  onExpand: () => void;
  isExpanded: boolean;
  projectSummary: string | null;
  summaryLoading: boolean;
  onViewArchive?: () => void;
  /** 打开归档卷弹窗（DA/T 103：勾稽/检测/ASIP 导出）——终态卡片 */
  onViewVolume?: () => void;
  onMoveToRecycleBin?: () => void;
  onRestore?: () => void;
  onDeletePermanently?: () => void;
  isAdmin: boolean;
  /** admin 或 PMI 属主（后端 assertItemScope 同口径）——显示「归档卷」按钮 */
  canManageVolume?: boolean;
}) {
  const formatDate = (date: string | null) => {
    if (!date) return "-";
    const d = new Date(date);
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
  };

  // 统一金额口径（2026-09-28 审计：此前同页三处两套小数位）——走 lib/format
  const formatAmount = (amount: number | null | string) =>
    formatWan(amount, { digits: 2, empty: "-" });

  // 中标单位（已成交时显示）- 优先使用项目管理提取的中标单位
  const awardedSupplier = item.sourceType === "PROJECT_MANAGEMENT" && item.pmAwardedSupplier
    ? item.pmAwardedSupplier
    : item.awardedSupplierName;
  // 成交金额 - 优先使用项目管理提取的合同金额
  const finalAwardAmount = item.sourceType === "PROJECT_MANAGEMENT" && item.contractAmount
    ? item.contractAmount
    : item.awardAmount;
  // 所有参与供应商
  const allSuppliers = item.supplierNames;
  // 未中标单位
  const nonAwardedSuppliers = allSuppliers.filter((n) => n !== awardedSupplier);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="group rounded-[14px] bg-[oklch(1_0_0_/_0.45)] backdrop-blur-[14px] transition-all hover:translate-y-[-2px]"
      style={{
        boxShadow: isExpanded
          ? "inset 2px 2px 5px oklch(0.55 0.03 258 / 0.15), inset -2px -2px 5px oklch(1 0 0 / 0.5)"
          : "inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.1), -2px -2px 6px oklch(1 0 0 / 0.8)",
        transition: "box-shadow 0.3s ease, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {/* Main Row */}
      <div className="p-3.5">
        {/* Header Row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Calendar size={11} style={{ color: accentMap.blue }} />
            <span className="text-[11px] font-semibold text-[rgba(96,139,239,1)]">{formatDate(item.procurementDate)}</span>
            <StatusBadge status={item.resultStatus} resultText={item.resultText} terminationReason={item.terminationReason} />
            <span className="rounded-full px-2 py-0.5 text-[10px] bg-[rgba(96,139,239,0.08)] text-[rgba(96,139,239,0.8)]">{item.procurementMethod}</span>
          </div>
          {/* 右上角：上传人 + 管理员操作 */}
          <div className="flex items-center gap-2">
            {isAdmin && !item.isRecycled && onMoveToRecycleBin && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveToRecycleBin();
                }}
                className="p-1 rounded-[6px] text-[rgba(230,129,102,0.7)] hover:text-[rgba(230,129,102,1)] hover:bg-[rgba(230,129,102,0.1)] transition-colors"
                title="移至回收站"
              >
                <Trash2 size={14} />
              </button>
            )}
            {isAdmin && item.isRecycled && onRestore && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRestore();
                }}
                className="p-1 rounded-[6px] text-[rgba(92,181,150,0.8)] hover:text-[rgba(92,181,150,1)] hover:bg-[rgba(92,181,150,0.12)] transition-colors"
                title="恢复台账"
              >
                <RotateCcw size={14} />
              </button>
            )}
            {isAdmin && item.isRecycled && onDeletePermanently && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeletePermanently();
                }}
                className="p-1 rounded-[6px] text-[rgba(230,129,102,0.7)] hover:text-[rgba(230,129,102,1)] hover:bg-[rgba(230,129,102,0.1)] transition-colors"
                title="彻底删除"
              >
                <Trash2 size={14} />
              </button>
            )}
            {item.createdByName && (
              <span className="text-[10px] text-[color:var(--muted-foreground)] bg-[oklch(1_0_0_/_0.4)] rounded-full px-2 py-0.5">
                {item.createdByName}
              </span>
            )}
          </div>
        </div>

        {/* Name（已终止项目红字）+ 项目编号徽章 */}
        <div className="mt-2 flex items-center gap-2">
          <span className={`min-w-0 flex-1 text-[0.9rem] font-semibold line-clamp-1 ${item.resultStatus === "CANCELLED" && item.terminationReason ? "text-[var(--danger)]" : "text-[color:var(--foreground)]"}`}>{item.projectName}</span>
          {item.projectCode && (
            <span className="shrink-0 rounded-[6px] bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] px-2 py-0.5 font-mono text-[10px] font-bold tracking-tight text-[color:var(--accent-strong)]">{item.projectCode}</span>
          )}
        </div>

        {/* 终止原因（项目终止的 CANCELLED 且带 terminationReason 时红字显示） */}
        {item.resultStatus === "CANCELLED" && item.terminationReason && (
          <div className="mt-1 flex items-start gap-1.5 text-xs">
            <span className="shrink-0 font-semibold text-[var(--danger)]">终止原因</span>
            <span className="min-w-0 flex-1 text-[var(--danger)]">{item.terminationReason}</span>
          </div>
        )}

        {/* Info: 部门 + 中标单位 */}
        <div className="mt-1.5 flex items-center gap-4 text-xs text-[color:var(--muted-foreground)]">
          <span className="flex items-center gap-1.5"><Building2 size={14} />{item.departmentName || "-"}</span>
          {awardedSupplier && (
            <span className="flex items-center gap-1.5 text-[rgba(92,181,150,1)]"><Trophy size={14} />{awardedSupplier}</span>
          )}
        </div>

        {/* Amount */}
        <div className="mt-2 flex items-center gap-4 pt-2" style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
          <div>
            <span className="text-[10px] uppercase text-[color:var(--muted-foreground)]">预算</span>
            <span className="ml-1.5 text-[0.85rem] font-bold text-[color:var(--foreground)]">{formatAmount(item.controlAmount ?? item.budgetAmount)}</span>
          </div>
          {finalAwardAmount && (
            <div>
              <span className="text-[10px] uppercase text-[rgba(92,181,150,0.8)]">成交</span>
              <span className="ml-1.5 text-[0.85rem] font-bold text-[rgba(92,181,150,1)]">{formatAmount(finalAwardAmount)}</span>
            </div>
          )}
          {/* 右下角：PM 终态卡片 → ASIP 徽标 + 归档卷 + 归档详情（两弹窗并存）；其余 → 展开 */}
          {item.sourceType === "PROJECT_MANAGEMENT" && item.projectManagementId && (item.resultStatus === "AWARDED" || (item.resultStatus === "CANCELLED" && item.terminationReason)) ? (
            <div className="ml-auto flex items-center gap-1.5">
              {item.archiveExportedAt && (
                <span
                  className="rounded-full bg-[color-mix(in_oklch,var(--success)_12%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--success)]"
                  title={`归档信息包导出于 ${new Date(item.archiveExportedAt).toLocaleString("zh-CN", { hour12: false })}`}
                >
                  ASIP 已导出
                </span>
              )}
              {canManageVolume && onViewVolume && (
                <button onClick={onViewVolume} className="flex items-center gap-1.5 neu-btn-xs">
                  <FileArchive size={14} />
                  归档卷
                </button>
              )}
              <button
                onClick={onViewArchive}
                className={`flex items-center gap-1.5 neu-btn-xs ${item.resultStatus === "CANCELLED" ? "!text-[var(--danger)]" : "!text-[rgba(92,181,150,1)]"}`}
              >
                <FolderOpen size={14} />
                {item.resultStatus === "CANCELLED" ? "终止详情" : "归档详情"}
              </button>
            </div>
          ) : (
            <button
              onClick={onExpand}
              className="ml-auto flex items-center gap-1.5 neu-btn-xs"
            >
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {isExpanded ? "收起" : "详情"}
            </button>
          )}
        </div>
      </div>

      {/* Expanded Details */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="px-4 py-3"
          style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)" }}
          >
            {/* 所属项目 + 项目编号 */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[color:var(--muted-foreground)]">
              <span>
                <span className="font-medium">所属项目：</span>
                <span className="ml-1 text-[color:var(--foreground)]">{item.projectName}</span>
              </span>
              {item.projectCode && (
                <span className="inline-flex items-center gap-1">
                  <span className="font-medium">项目编号：</span>
                  <span className="rounded-[5px] bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] px-1.5 py-0.5 font-mono font-bold tracking-tight text-[color:var(--accent-strong)]">{item.projectCode}</span>
                </span>
              )}
            </div>

            {/* 立项时间和归档时间 - 项目管理来源 */}
            {item.sourceType === "PROJECT_MANAGEMENT" && (
              <div className="mt-2.5 flex flex-wrap gap-4 text-[11px]">
                {item.initiationDate && (
                  <div className="text-[color:var(--muted-foreground)]">
                    <span className="font-medium">立项时间：</span>
                    <span className="ml-1 text-[color:var(--foreground)]">{item.initiationDate}</span>
                  </div>
                )}
                {item.archivedAt && (
                  <div className="text-[color:var(--muted-foreground)]">
                    <span className="font-medium">归档时间：</span>
                    <span className="ml-1 text-[color:var(--foreground)]">{item.archivedAt}</span>
                  </div>
                )}
              </div>
            )}

            {/* 项目时间轴（2026-10-13）：台账详情记录八类时间节点，与项目管理详情同源同款
                （立项/公告发布·供应商邀请/文件获取/截止/开标/中标公告/签约/归档，
                公告发布为最后一次发布口径）；条目自带「时间轴」前缀标签，失败静默灰显占位 */}
            {item.sourceType === "PROJECT_MANAGEMENT" && item.projectManagementId && (
              <div className="mt-2.5">
                <ProjectTimelineStrip pmiId={item.projectManagementId} />
              </div>
            )}

            {/* 专家信息 - 项目管理来源 */}
            {item.sourceType === "PROJECT_MANAGEMENT" && item.expertInfo && (
              <div className="mt-2.5">
                <div className="text-[10px] font-semibold text-[rgba(119,129,219,0.8)] uppercase tracking-wide">专家信息</div>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {item.expertInfo.split('\n').filter(Boolean).map((expertLine, i) => {
                    const parts = expertLine.split('|');
                    const name = parts[0] || '';
                    const department = parts[1] || '';
                    const specialty = parts[2] || '';
                    const title = parts[3] || '';
                    const hasDetails = department || specialty || title;
                    return (
                      <span
                        key={i}
                        className="group relative inline-flex items-center rounded-[6px] bg-[rgba(119,129,219,0.08)] px-2.5 py-1 text-[11px] text-[rgba(119,129,219,1)] cursor-default"
                      >
                        {name}
                        {hasDetails && (
                          <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-10 w-max max-w-[250px] rounded-[8px] bg-[rgba(50,50,60,0.95)] px-3 py-2 text-[10px] text-white shadow-lg">
                            <div className="font-medium mb-1">{name}</div>
                            {department && <div>部门：{department}</div>}
                            {specialty && <div>专业：{specialty}</div>}
                            {title && <div>职称：{title}</div>}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 投标单位 - 项目管理来源 */}
            {item.sourceType === "PROJECT_MANAGEMENT" && item.biddingUnits && (
              <div className="mt-2.5">
                <div className="text-[10px] font-semibold text-[color:var(--muted-foreground)] uppercase tracking-wide">投标单位</div>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {item.biddingUnits.split(/[、,\n]/).filter(u => u.trim()).map((unit, i) => (
                    <span key={i} className="rounded-[6px] bg-[rgba(96,139,239,0.08)] px-2.5 py-1 text-[11px] text-[color:var(--muted-foreground)]">
                      {unit.trim()}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 中标单位 */}
            {awardedSupplier && (
              <div className="mt-2.5">
                <div className="text-[10px] font-semibold text-[rgba(92,181,150,0.8)] uppercase tracking-wide">中标单位</div>
                <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-[8px] bg-[rgba(92,181,150,0.12)] px-3 py-1.5 text-xs font-medium text-[rgba(92,181,150,1)]">
                  <Trophy size={14} />
                  {awardedSupplier}
                </div>
              </div>
            )}

            {/* 未中标单位 - 仅非项目管理来源显示 */}
            {item.sourceType !== "PROJECT_MANAGEMENT" && nonAwardedSuppliers.length > 0 && (
              <div className="mt-2.5">
                <div className="text-[10px] font-semibold text-[color:var(--muted-foreground)] uppercase tracking-wide">未中标单位</div>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {nonAwardedSuppliers.map((name, i) => (
                    <span key={i} className="rounded-[6px] bg-[rgba(96,139,239,0.08)] px-2.5 py-1 text-[11px] text-[color:var(--muted-foreground)]">
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 项目简报 - 仅项目管理归档的项目显示 */}
            {item.sourceType === "PROJECT_MANAGEMENT" && (
              <div className="mt-3">
                <div className="text-[10px] font-semibold text-[rgba(147,112,219,0.8)] uppercase tracking-wide">项目简报</div>
                <div className="mt-1.5 rounded-[10px] bg-[rgba(147,112,219,0.04)] px-3 py-2.5">
                  {summaryLoading ? (
                    <div className="flex items-center gap-2 text-[11px] text-[color:var(--muted-foreground)]">
                      <Loader2 size={12} className="animate-spin" />
                      加载中...
                    </div>
                  ) : projectSummary ? (
                    <p className="text-[11px] leading-6 text-[color:var(--foreground)]">{projectSummary}</p>
                  ) : (
                    <p className="text-[11px] text-[color:var(--muted-foreground)]">暂无项目简报信息。</p>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// Recycle confirmation Modal
function RecycleConfirmModal({
  item,
  loading,
  error,
  onCancel,
  onConfirm,
}: {
  item: ProcurementRoundItem;
  loading: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open
      onClose={onCancel}
      closeOnBackdrop={!loading}
      closeOnEsc={!loading}
      size="md"
      title={
        <span className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-[rgba(230,129,102,0.25)] bg-[rgba(230,129,102,0.1)] text-[rgba(230,129,102,1)]">
            <Trash2 size={20} />
          </span>
          移至回收站
        </span>
      }
      description="请确认是否处理以下采购台账记录。"
      footer={
        <>
          <button
            onClick={onCancel}
            disabled={loading}
            className="neu-btn-soft !h-9 !text-[13px] disabled:opacity-40"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="neu-btn-primary is-danger !h-9 !text-[13px] disabled:opacity-60"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            确认移至回收站
          </button>
        </>
      }
    >
      <div className="rounded-[16px] bg-[linear-gradient(145deg,rgba(247,250,255,0.86),rgba(255,255,255,0.72))] p-4" style={{ border: "1px solid oklch(0.6 0.04 258 / 0.2)" }}>
        <div className="text-[0.92rem] font-semibold leading-6 text-[color:var(--foreground)]">
          {item.projectName}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--muted-foreground)]">
          <span className="rounded-full bg-[rgba(96,139,239,0.08)] px-2 py-1">{item.departmentName || "未填部门"}</span>
          <span className="rounded-full bg-[rgba(92,181,150,0.1)] px-2 py-1">{item.resultStatusLabel}</span>
          <span className="rounded-full bg-[rgba(234,188,110,0.12)] px-2 py-1">{item.procurementMethod}</span>
        </div>
      </div>

      <div className="rounded-[14px] bg-[rgba(230,129,102,0.07)] px-4 py-3 text-xs leading-5 text-[rgba(145,82,62,1)]">
        该记录将移入采购台账回收站，不会再出现在正常台账列表中。你可以在本页面切换到“回收站”后恢复或彻底删除。
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-[12px] border border-[rgba(230,129,102,0.22)] bg-[rgba(230,129,102,0.08)] px-3 py-2 text-xs leading-5 text-[rgba(190,88,68,1)]">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </Modal>
  );
}

// Main Page
export default function ProcurementsPage() {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [data, setData] = useState<ProcurementRoundItem[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 12, total: 0, totalPages: 0 });
  const loadReqIdRef = useRef(0);
  const [abnormalTotal, setAbnormalTotal] = useState<number | undefined>(undefined);
  const [methods, setMethods] = useState<string[]>([]);
  // 部门筛选数据源（端点不可用时隐藏该下拉，不阻塞台账）
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => { fetchDepartments().then(setDepartments).catch(() => setDepartments([])); }, []);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [filters, setFilters] = useState<LedgerFilterState>({
    startDate: null,
    endDate: null,
    procurementMethod: null,
    departmentId: null,
    resultStatus: null,
    searchKeyword: "",
    recycleStatus: "ACTIVE",
    category: null,
  });

  const [sortBy, setSortBy] = useState<'procurementDate' | 'amount'>('procurementDate');

  // Analysis states
  const [showAnalysisSelection, setShowAnalysisSelection] = useState(false);
  const [matchedItems, setMatchedItems] = useState<ProcurementRoundItem[]>([]);
  const [selectedAnalysisIds, setSelectedAnalysisIds] = useState<Set<string>>(new Set());
  const [showAnalysisResult, setShowAnalysisResult] = useState(false);
  const [aiAnalysisResult, setAiAnalysisResult] = useState<AiAnalysisResult | null>(null);

  // Expanded card states for inline details
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(new Set());
  const [itemSummaries, setItemSummaries] = useState<Record<string, string>>({});
  const [loadingSummaries, setLoadingSummaries] = useState<Set<string>>(new Set());
  const { setPageContext } = useAssistant();

  // Archive detail modal state
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [selectedArchiveRoundId, setSelectedArchiveRoundId] = useState<string | null>(null);

  // 归档卷弹窗（DA/T 103：范围勾稽/四性检测/ASIP 导出）+ 深链/提示
  const [volumeItem, setVolumeItem] = useState<ProcurementRoundItem | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const dataLoadedOnceRef = useRef(false); // 深链匹配须等首帧数据就绪（loading 初值 false 的竞态）

  // Admin check + 驾驶舱权限守卫（办公权限 staff 重定向到工作台）
  const [isAdmin, setIsAdmin] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [companyId, setCompanyId] = useState('all');
  // 按采购单位全量计数（后端聚合，与列表同 where）——分组标题显示全量口径，分页不失真
  const [companyCounts, setCompanyCounts] = useState<Array<{ name: string; count: number }> | null>(null);
  const selectedCompanyName = useCompanyName(companyId);
  // admin 全部公司视图：当前页行按采购单位（创建人所属公司）分组；
  // 标题计数用后端全量口径（company-counts，与列表同 where），分页不失真
  const ledgerGroups = useMemo(() => {
    if (!isAdmin || companyId !== "all") return [];
    return buildCompanyCounts(data.map((i) => ({ company: i.purchaserName }))).map((g) => ({
      name: g.name,
      fullCount: companyCounts?.find((c) => c.name === g.name)?.count ?? g.count,
      items: data.filter((i) => ((i.purchaserName ?? "").trim() || "未归属") === g.name),
    }));
  }, [isAdmin, companyId, data, companyCounts]);

  const [extractOpen, setExtractOpen] = useState(false);
  useEffect(() => {
    const loadCurrentUser = async () => {
      try {
        const user = await fetchCurrentUser();
        if (!canAccessCockpit(user.role)) {
          router.replace('/work-arrangements');
          return;
        }
        setIsAdmin(user.role === 'admin');
        setCurrentUserId(user.id); // 归档卷属主判定（后端 assertItemScope 同口径）
      } catch {
        setIsAdmin(false);
      } finally {
        setAuthChecked(true);
      }
    };

    void loadCurrentUser();
  }, [router]);

  // Move to recycle bin state
  const [movingToRecycleBinId, setMovingToRecycleBinId] = useState<string | null>(null);
  const [recycleTarget, setRecycleTarget] = useState<ProcurementRoundItem | null>(null);
  const [recycleError, setRecycleError] = useState<string | null>(null);

  const handleViewArchive = (item: ProcurementRoundItem) => {
    setSelectedArchiveRoundId(item.id);
    setShowArchiveModal(true);
  };

  // 归档卷入口门控：后端 archive assertItemScope 限 PMI 属主与 admin（snapshot/check/audit/导出
  // 全部按 pmiId 校验），与旧 /archive 页对非 admin 只列本人卷的口径一致；pmCreatedById 为 PMI
  // 属主（round 的 createdById 是归档操作人，代归档时错位），取不到时回退 round 创建人
  const canManageArchive = (item: ProcurementRoundItem) =>
    isAdmin || (item.pmCreatedById ?? item.createdById) === currentUserId;

  const handleOpenVolume = (item: ProcurementRoundItem) => {
    if (!item.projectManagementId) return;
    setVolumeItem(item);
  };

  const handleMoveToRecycleBin = (item: ProcurementRoundItem) => {
    setRecycleTarget(item);
    setRecycleError(null);
  };

  const closeRecycleModal = () => {
    if (movingToRecycleBinId) return;
    setRecycleTarget(null);
    setRecycleError(null);
  };

  const confirmMoveToRecycleBin = async () => {
    if (!recycleTarget) return;

    setMovingToRecycleBinId(recycleTarget.id);
    setRecycleError(null);
    try {
      await moveProcurementToRecycleBin(recycleTarget.id);
      setRecycleTarget(null);
      await loadData();
    } catch (err) {
      setRecycleError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setMovingToRecycleBinId(null);
    }
  };

  const handleRestoreFromRecycleBin = async (item: ProcurementRoundItem) => {
    setMovingToRecycleBinId(item.id);
    try {
      await restoreProcurementFromRecycleBin(item.id);
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : '恢复失败');
    } finally {
      setMovingToRecycleBinId(null);
    }
  };

  const handleDeletePermanently = async (item: ProcurementRoundItem) => {
    if (!(await confirm({ message: `确定要彻底删除「${item.projectName}」吗？此操作不可恢复。`, danger: true }))) return;

    setMovingToRecycleBinId(item.id);
    try {
      await deleteProcurementPermanently(item.id);
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : '删除失败');
    } finally {
      setMovingToRecycleBinId(null);
    }
  };

  // Handle expand toggle for card details
  const handleExpandToggle = async (item: ProcurementRoundItem) => {
    const itemId = item.id;
    const isCurrentlyExpanded = expandedItemIds.has(itemId);

    if (isCurrentlyExpanded) {
      // Collapse
      setExpandedItemIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(itemId);
        return newSet;
      });
      setPageContext({ selectedItemId: undefined, selectedItemType: undefined, selectedItemData: undefined });
    } else {
      // Expand
      setExpandedItemIds(prev => new Set(prev).add(itemId));
      setPageContext({
        selectedItemId: item.id,
        selectedItemType: "procurement",
        selectedItemData: {
          projectName: item.projectName,
          procurementMethod: item.procurementMethod,
          budgetAmount: item.budgetAmount,
          awardAmount: item.awardAmount,
          awardedSupplierName: item.awardedSupplierName,
          resultStatusLabel: item.resultStatusLabel,
        },
      });

      // Fetch project summary for PROJECT_MANAGEMENT items
      if (item.sourceType === "PROJECT_MANAGEMENT" && item.projectManagementId && !itemSummaries[itemId]) {
        setLoadingSummaries(prev => new Set(prev).add(itemId));
        try {
          const response = await apiFetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api'}/project-management/${item.projectManagementId}/summary`, {
            credentials: 'include',
          });
          if (response.ok) {
            const data = await response.json();
            setItemSummaries(prev => ({ ...prev, [itemId]: data.summary || '暂无项目简报。' }));
          } else {
            setItemSummaries(prev => ({ ...prev, [itemId]: '暂无项目简报信息。' }));
          }
        } catch (err) {
          console.error('Failed to load project summary:', err);
          setItemSummaries(prev => ({ ...prev, [itemId]: '项目简报加载失败。' }));
        } finally {
          setLoadingSummaries(prev => {
            const newSet = new Set(prev);
            newSet.delete(itemId);
            return newSet;
          });
        }
      }
    }
  };

  // Load data
  const loadData = useCallback(async () => {
    const rid = ++loadReqIdRef.current; // R7-4② 请求序守卫
    setLoading(true);
    setLoadError(null);
    try {
      // 统计接口曾在此并行拉取（四审 P2「统计卡与列表同筛选」）——统计卡 UI 一直未接，
      // ledgerStats 落 state 后无任何消费者，2026-10-21 清死请求
      const [listRes, methodsRes, countsRes] = await Promise.all([
        fetchProcurements({
          page: pagination.page,
          pageSize: pagination.pageSize,
          startDate: filters.startDate || undefined,
          endDate: filters.endDate || undefined,
          procurementMethod: filters.procurementMethod || undefined,
          departmentId: filters.departmentId || undefined,
          resultStatus: filters.resultStatus || undefined,
          searchKeyword: filters.searchKeyword || undefined,
          recycleStatus: filters.recycleStatus || "ACTIVE",
          category: filters.category || undefined,
          sortBy,
          sortOrder: 'desc',
          companyId,
        }),
        fetchProcurementMethods(),
        (isAdmin && isGroupedCompanyView(companyId))
          ? fetchLedgerCompanyCounts({
              startDate: filters.startDate || undefined,
              endDate: filters.endDate || undefined,
              procurementMethod: filters.procurementMethod || undefined,
              departmentId: filters.departmentId || undefined,
              resultStatus: filters.resultStatus || undefined,
              searchKeyword: filters.searchKeyword || undefined,
              recycleStatus: filters.recycleStatus || 'ACTIVE',
              category: filters.category || undefined,
            }).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (rid !== loadReqIdRef.current) return;
      setData(listRes.data); // R7 终审 P2：setData 原在守卫前——过期响应覆盖表格与新分页混合态
      setPagination(listRes.pagination);
      setAbnormalTotal(listRes.abnormalTotal);
      setMethods(methodsRes);
      setCompanyCounts(countsRes);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '加载采购台账失败，请稍后重试');
    } finally {
      setLoading(false);
      dataLoadedOnceRef.current = true; // 归档深链匹配门控（首帧数据就绪）
    }
    // isAdmin 入依赖（2026-10-21）：函数体分支读取它——缺列时 admin 登录态就位后
    // 闭包仍持 false，公司分组计数被跳过，直到其他依赖变化才追平
  }, [pagination.page, pagination.pageSize, filters, sortBy, companyId, isAdmin]);

  useEffect(() => { loadData(); }, [loadData]);
  // 以下两个 mount-once URL 深链同步保留 effect 写法：改 render 期初始化会引发
  // hydration 不匹配（服务端无 URL，select 受控值两侧不一致），抑制 set-state 警告
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setCompanyId(readInitialCompanyId()); }, []);
  // URL 深链：?category=archived|terminated 直接落到类型筛选（通知/外链直达终止列表）
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('category');
    if (c === 'archived' || c === 'terminated') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFilters((prev) => ({ ...prev, category: c, resultStatus: null }));
    }
  }, []);

  // 归档待办直达：/archive?pmi= 已重定向到本页，消费 archivePmi 自动开「归档卷」弹窗。
  // 深链参数走 ref（非渲染状态）：消费侧由 data/loading 变化驱动，无需触发重渲染，
  // 也免去 effect 内 setState（toast 提示改 sonner，不再落本地 state）
  const pendingArchivePmiRef = useRef<string | null>(null);
  useEffect(() => {
    const pmi = new URLSearchParams(window.location.search).get('archivePmi');
    if (pmi) pendingArchivePmiRef.current = pmi;
  }, []);
  useEffect(() => {
    const pmi = pendingArchivePmiRef.current;
    if (!pmi || loading || !authChecked || !dataLoadedOnceRef.current) return;
    const item = data.find((i) => i.projectManagementId === pmi);
    if (item && canManageArchive(item)) handleOpenVolume(item);
    else if (item) toast.info('该归档卷仅创建人或管理员可操作');
    else toast.info('未在当前页找到该归档卷，请清除筛选或翻页后从通知重新进入');
    pendingArchivePmiRef.current = null; // 一次性消费：清 ref + 清 URL 参（防翻页后误开）
    const url = new URL(window.location.href);
    url.searchParams.delete('archivePmi');
    window.history.replaceState(null, '', url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, loading, authChecked, isAdmin, currentUserId]);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 搜索框即时回显：受控输入的 value 若直接绑防抖后的 filters.searchKeyword，
  // 300ms 窗口内任何 re-render（上一轮查询返回/loading 翻转/部门数据就绪）都会把
  // 输入框打回旧值——打字丢字/回显错乱的根因。显示层即时落 state，仅查询条件走防抖。
  const [searchInput, setSearchInput] = useState('');
  useEffect(() => () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); }, []);

  const handleFilterChange = (key: keyof LedgerFilterState, value: string | null) => {
    if (key === 'searchKeyword') {
      setSearchInput(value ?? ''); // 立即回显
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      if (!value) {
        // 清空（X 按钮/删尽）不等防抖，立即生效
        setFilters(prev => ({ ...prev, searchKeyword: '' }));
        setPagination(prev => ({ ...prev, page: 1 }));
        return;
      }
      searchDebounceRef.current = setTimeout(() => {
        setFilters(prev => ({ ...prev, searchKeyword: value }));
        setPagination(prev => ({ ...prev, page: 1 }));
      }, 300);
      return;
    }
    // 状态/类型/回收站 三者互斥（合并下拉单选收窄）：任一选中即清其余两项。
    if (key === 'category' && value) {
      setFilters(prev => ({ ...prev, category: value as "archived" | "terminated", resultStatus: null, recycleStatus: 'ACTIVE' }));
    } else if (key === 'resultStatus' && value) {
      setFilters(prev => ({ ...prev, resultStatus: value as ResultStatusKey, category: null, recycleStatus: 'ACTIVE' }));
    } else if (key === 'recycleStatus' && value === 'RECYCLED') {
      setFilters(prev => ({ ...prev, recycleStatus: 'RECYCLED', resultStatus: null, category: null }));
    } else {
      setFilters(prev => ({ ...prev, [key]: value }));
    }
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  // Analysis handlers
  const handleAnalyze = async () => {
    if (!filters.searchKeyword) return;
    try {
      // R6-6⑥（2026-09-30 审计 B5）：带上当前筛选与公司视野——此前只传关键词，
      // 分析选集与所见列表脱节（回收站 tab 下分析的是 ACTIVE 数据）；截断显式提示
      const res = await fetchProcurements({
        page: 1,
        pageSize: 100,
        searchKeyword: filters.searchKeyword,
        startDate: filters.startDate || undefined,
        endDate: filters.endDate || undefined,
        procurementMethod: filters.procurementMethod || undefined,
        departmentId: filters.departmentId || undefined,
        resultStatus: filters.resultStatus || undefined,
        category: filters.category || undefined,
        recycleStatus: filters.recycleStatus || undefined,
        companyId,
      });
      setMatchedItems(res.data);
      if (res.data.length >= 100) {
        toast.info('匹配结果超过 100 条，仅载入前 100 条参与分析；可收窄筛选后重试');
      }
      setSelectedAnalysisIds(new Set());
      setShowAnalysisSelection(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '分析数据加载失败');
      console.error("Failed to fetch for analysis:", err);
    }
  };

  const toggleAnalysisSelection = (id: string) => {
    setSelectedAnalysisIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  const confirmAnalysis = async () => {
    const selectedItems = matchedItems.filter(i => selectedAnalysisIds.has(i.id));
    setShowAnalysisSelection(false);
    setShowAnalysisResult(true);
    setAiAnalysisResult(null); // null=报告弹窗进入 AI 骨架屏加载态

    // 汇总口径统一走共享工具（与选择/报告两个弹窗同源，2026-10-21 重设计收口）
    const summary = buildLedgerAnalysisSummary(selectedItems);

    // Call AI API
    try {
      const result = await analyzeProcurementLedger({
        keyword: filters.searchKeyword || "",
        items: selectedItems.map(i => ({
          projectName: i.projectName,
          procurementDate: i.procurementDate,
          procurementMethod: i.procurementMethod,
          departmentName: i.departmentName,
          budgetAmount: Number(i.controlAmount ?? i.budgetAmount ?? 0),
          awardAmount:
            i.awardAmount === null || i.awardAmount === undefined
              ? null
              : Number(i.awardAmount),
          resultStatus: i.resultStatus,
          supplierNames: i.supplierNames,
        })),
        summary,
      });
      setAiAnalysisResult(result);
    } catch (err) {
      console.error("AI analysis failed:", err);
      setAiAnalysisResult({
        overview: "AI分析暂时不可用，请稍后再试。",
        highlights: [],
        concerns: [],
        suggestions: [],
      });
    }
  };

  const getAnalysisItems = () => matchedItems.filter(i => selectedAnalysisIds.has(i.id));

  // 权限验证中：不渲染内容（staff 会被重定向）
  if (!authChecked) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[rgba(96,139,239,0.3)] border-t-[rgba(96,139,239,1)]" />
          <span className="text-sm text-[color:var(--muted-foreground)]">验证访问权限...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full">
        {/* Page Hero: title + KPI + search toolbar */}
        <div className="mb-4">
          <PageHero
            filters={filters}
            searchInput={searchInput}
            onFilterChange={handleFilterChange}
            methods={methods}
            onRefresh={loadData}
            onAnalyze={handleAnalyze}
            loading={loading}
            pagination={pagination}
            data={data}
            sortBy={sortBy}
            onSortChange={(v) => setSortBy(v as typeof sortBy)}
            companyId={companyId}
          onOpenExtract={() => setExtractOpen(true)}
          isAdmin={isAdmin}
          abnormalTotal={abnormalTotal}
          departments={departments}
            onCompanyChange={(v) => { setCompanyId(v); setPagination(prev => ({ ...prev, page: 1 })); }} /* 切公司重置页码（审计 P1-A：第 3 页切小公司显示误导性空态） */
          />
        </div>

        {/* 加载错误提示 */}
        {loadError && (
          <div className="mb-4 flex items-center justify-between rounded-xl bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-4 py-3 text-sm text-[color:var(--danger)]">
            <span>{loadError}</span>
            <button onClick={() => void loadData()} className="neu-btn-xs is-danger shrink-0 ml-3">重试</button>
          </div>
        )}

        {/* 单公司视图（admin）：该公司主标题（全量条数） */}
        {isAdmin && companyId !== "all" && selectedCompanyName && (
          <div className="mb-4">
            <CompanySectionHeader name={selectedCompanyName} count={pagination.total} />
          </div>
        )}

        {/* Data Grid */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="wb-panel p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw size={24} className="animate-spin text-[rgba(96,139,239,0.6)]" />
            </div>
          ) : data.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="text-[0.9rem] font-semibold text-[rgba(96,139,239,0.4)]">暂无采购记录</div>
            </div>
          ) : (
            <>
              {isAdmin && isGroupedCompanyView(companyId) ? (
                <div className="space-y-5">
                  {ledgerGroups.map((g) => (
                    <section key={g.name}>
                      <CompanySectionHeader
                        name={g.name}
                        count={g.fullCount}
                        suffix={g.items.length < g.fullCount ? `本页 ${g.items.length}` : undefined}
                      />
                      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
                        {g.items.map((item) => (
                          <LedgerRow
                            key={item.id}
                            item={item}
                            onExpand={() => handleExpandToggle(item)}
                            isExpanded={expandedItemIds.has(item.id)}
                            projectSummary={itemSummaries[item.id] || null}
                            summaryLoading={loadingSummaries.has(item.id)}
                            onViewArchive={() => handleViewArchive(item)}
                            onViewVolume={() => handleOpenVolume(item)}
                            canManageVolume={canManageArchive(item)}
                            onMoveToRecycleBin={() => handleMoveToRecycleBin(item)}
                            onRestore={() => handleRestoreFromRecycleBin(item)}
                            onDeletePermanently={() => handleDeletePermanently(item)}
                            isAdmin={isAdmin}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
                {data.map((item) => (
                  <LedgerRow
                    key={item.id}
                    item={item}
                    onExpand={() => handleExpandToggle(item)}
                    isExpanded={expandedItemIds.has(item.id)}
                    projectSummary={itemSummaries[item.id] || null}
                    summaryLoading={loadingSummaries.has(item.id)}
                    onViewArchive={() => handleViewArchive(item)}
                    onViewVolume={() => handleOpenVolume(item)}
                    canManageVolume={canManageArchive(item)}
                    onMoveToRecycleBin={() => handleMoveToRecycleBin(item)}
                    onRestore={() => handleRestoreFromRecycleBin(item)}
                    onDeletePermanently={() => handleDeletePermanently(item)}
                    isAdmin={isAdmin}
                  />
                ))}
              </div>
              )}

              {/* Pagination */}
              <hr className="wb-section-rule !mt-0 !mb-4" />
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[color:var(--muted-foreground)]">
                  {pagination.total} 条 · 第 {pagination.page}/{pagination.totalPages} 页
                </span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))} disabled={pagination.page <= 1} className="neu-btn-soft !px-3 !py-1 !text-[11px] disabled:opacity-40">
                    上一页
                  </button>
                  <button onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))} disabled={pagination.page >= pagination.totalPages} className="neu-btn-soft !px-3 !py-1 !text-[11px] disabled:opacity-40">
                    下一页
                  </button>
                </div>
              </div>
            </>
          )}
        </motion.div>

        {/* Analysis Modals */}
        {showAnalysisSelection && (
          <AnalysisSelectionModal
            keyword={filters.searchKeyword || ""}
            items={matchedItems}
            selectedIds={selectedAnalysisIds}
            onToggle={toggleAnalysisSelection}
            onClose={() => setShowAnalysisSelection(false)}
            onConfirm={confirmAnalysis}
          />
        )}

        {showAnalysisResult && (
          <AnalysisResultModal
            keyword={filters.searchKeyword || ""}
            items={getAnalysisItems()}
            aiResult={aiAnalysisResult}
            onClose={() => setShowAnalysisResult(false)}
          />
        )}

        {/* Recycle Confirmation Modal */}
        {recycleTarget && (
          <RecycleConfirmModal
            item={recycleTarget}
            loading={movingToRecycleBinId === recycleTarget.id}
            error={recycleError}
            onCancel={closeRecycleModal}
            onConfirm={confirmMoveToRecycleBin}
          />
        )}

        {/* Archive Detail Modal */}
        {showArchiveModal && selectedArchiveRoundId && (
          <ArchiveDetailModal
            procurementRoundId={selectedArchiveRoundId}
            onClose={() => {
              setShowArchiveModal(false);
              setSelectedArchiveRoundId(null);
            }}
          />
        )}

        {/* 归档卷弹窗（DA/T 103：范围勾稽/四性检测/补传/划定期限/ASIP 导出）——卸载即复位全部内部 state */}
        {volumeItem && volumeItem.projectManagementId && (
          <ArchiveVolumeModal
            target={{
              pmiId: volumeItem.projectManagementId,
              title: volumeItem.projectName,
              projectCode: volumeItem.projectCode || null,
              retentionPeriod: volumeItem.retentionPeriod ?? null,
              archiveExportedAt: volumeItem.archiveExportedAt ?? null,
              archiveRegistrationKey: volumeItem.archiveRegistrationKey ?? null,
            }}
            canManage={canManageArchive(volumeItem)}
            onClose={() => setVolumeItem(null)}
            onExported={() => void loadData()} // 刷「ASIP 已导出」徽标
            onRetentionSaved={() => void loadData()} // 刷 retentionPeriod（下次导出保留原值）
          />
        )}

        {dialog}
        <SasacExtractModal open={extractOpen} onClose={() => setExtractOpen(false)} companyId={companyId} />
      </div>
  );
}
