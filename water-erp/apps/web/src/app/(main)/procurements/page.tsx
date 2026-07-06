"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion, AnimatePresence } from "framer-motion";
import {
  Search,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  XCircle,
  FileEdit,
  Ban,
  DollarSign,
  CircleDollarSign,
  Building2,
  Users,
  Sparkles,
  X,
  Calendar,
  BarChart3,
  PieChart,
  Activity,
  Target,
  Lightbulb,
  AlertCircle,
  CheckSquare,
  Square,
  Loader2,
  Trophy,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  Trash2,
  RotateCcw,
} from "lucide-react";
import type { ProcurementRoundItem, ResultStatusKey, LedgerFilterState } from "@/lib/types/procurement";
import { RESULT_STATUS_CONFIG } from "@/lib/types/procurement";
import {
  fetchProcurements,
  fetchProcurementMethods,
  analyzeProcurementLedger,
  moveProcurementToRecycleBin,
  restoreProcurementFromRecycleBin,
  deleteProcurementPermanently,
} from "@/lib/api/procurements";
import { fetchCurrentUser } from "@/lib/api/auth";
import { ArchiveDetailModal } from "@/components/procurements/archive-detail-modal";
import { useAssistant } from "@/components/assistant/assistant-provider";

// ─── Animation Utilities ───────────────────────────────────────────────────────
const easeOutQuint: [number, number, number, number] = [0.22, 1, 0.36, 1];

function fadeIn(index: number, reducedMotion: boolean, baseDelay = 0.04) {
  if (reducedMotion) return { initial: {}, animate: {}, transition: { duration: 0 } };
  return {
    initial: { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, delay: index * baseDelay, ease: easeOutQuint },
  };
}

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

// ─── Status Badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status, resultText }: { status: ResultStatusKey; resultText?: string | null }) {
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

// ─── Filter Toolbar ────────────────────────────────────────────────────────────
function FilterToolbar({
  filters,
  onFilterChange,
  methods,
  onRefresh,
  onAnalyze,
  loading,
}: {
  filters: LedgerFilterState;
  onFilterChange: (key: keyof LedgerFilterState, value: string | null) => void;
  methods: string[];
  onRefresh: () => void;
  onAnalyze: () => void;
  loading: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-[16px] border border-white/50 bg-white/70 p-3"
    >
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative min-w-[140px] xl:min-w-[200px] flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--muted-foreground)]" />
          <input
            type="text"
            placeholder="搜索项目名称、供应商..."
            value={filters.searchKeyword}
            onChange={(e) => onFilterChange("searchKeyword", e.target.value)}
            className="w-full rounded-[10px] border border-white/55 bg-white/70 py-2 pl-9 pr-3 text-[0.85rem] outline-none focus:border-[rgba(96,139,239,0.35)]"
          />
          {filters.searchKeyword && (
            <button onClick={() => onFilterChange("searchKeyword", null)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-[rgba(96,139,239,0.1)]">
              <X size={12} />
            </button>
          )}
        </div>

        {/* Analyze Button - shows when keyword exists */}
        {filters.searchKeyword && filters.searchKeyword.length >= 2 && (
          <button
            onClick={onAnalyze}
            className="neu-btn-primary"
          >
            <Sparkles size={15} />
            分析
          </button>
        )}

        {/* Method Filter */}
        <select
          value={filters.procurementMethod || ""}
          onChange={(e) => onFilterChange("procurementMethod", e.target.value || null)}
          className="rounded-[8px] border border-white/55 bg-white/70 px-3 py-2 text-[0.8rem] outline-none"
        >
          <option value="">全部方式</option>
          {methods.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>

        {/* Status Filter */}
        <select
          value={filters.resultStatus || ""}
          onChange={(e) => onFilterChange("resultStatus", e.target.value as ResultStatusKey || null)}
          className="rounded-[8px] border border-white/55 bg-white/70 px-3 py-2 text-[0.8rem] outline-none"
        >
          <option value="">全部状态</option>
          {Object.entries(RESULT_STATUS_CONFIG).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}
        </select>

        {/* Recycle Status Filter */}
        <select
          value={filters.recycleStatus || "ACTIVE"}
          onChange={(e) => onFilterChange("recycleStatus", e.target.value || "ACTIVE")}
          className="rounded-[8px] border border-white/55 bg-white/70 px-3 py-2 text-[0.8rem] outline-none"
        >
          <option value="ACTIVE">正常台账</option>
          <option value="RECYCLED">回收站</option>
        </select>

        {/* Refresh */}
        <button onClick={onRefresh} disabled={loading} className="inline-flex items-center gap-2 rounded-[10px] border border-white/55 bg-white/70 px-3 py-2 text-[0.85rem] disabled:opacity-50">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          刷新
        </button>
      </div>
    </motion.div>
  );
}

// ─── Ledger Row (Full version for main list) ────────────────────────────────────
function LedgerRow({
  item,
  onExpand,
  isExpanded,
  projectSummary,
  summaryLoading,
  onViewArchive,
  onMoveToRecycleBin,
  onRestore,
  onDeletePermanently,
  isAdmin,
}: {
  item: ProcurementRoundItem;
  onExpand: () => void;
  isExpanded: boolean;
  projectSummary: string | null;
  summaryLoading: boolean;
  onViewArchive?: () => void;
  onMoveToRecycleBin?: () => void;
  onRestore?: () => void;
  onDeletePermanently?: () => void;
  isAdmin: boolean;
}) {
  const formatDate = (date: string | null) => {
    if (!date) return "-";
    const d = new Date(date);
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
  };

  const formatAmount = (amount: number | null | string) => {
    if (!amount) return "-";
    const num = typeof amount === "string" ? parseFloat(amount) : amount;
    return num >= 10000 ? `${(num / 10000).toFixed(2)}万` : `${num.toFixed(0)}元`;
  };

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
      className="group rounded-[14px] border border-white/50 bg-white/70 transition-all hover:border-[rgba(96,139,239,0.25)] hover:bg-white/85"
    >
      {/* Main Row */}
      <div className="p-3.5">
        {/* Header Row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Calendar size={11} style={{ color: accentMap.blue }} />
            <span className="text-[11px] font-semibold text-[rgba(96,139,239,1)]">{formatDate(item.procurementDate)}</span>
            <StatusBadge status={item.resultStatus} resultText={item.resultText} />
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
              <span className="text-[10px] text-[color:var(--muted-foreground)] bg-white/60 rounded-full px-2 py-0.5">
                {item.createdByName}
              </span>
            )}
          </div>
        </div>

        {/* Name */}
        <div className="mt-2 text-[0.9rem] font-semibold text-[color:var(--foreground)] line-clamp-1">{item.projectName}</div>

        {/* Info: 部门 + 中标单位 */}
        <div className="mt-1.5 flex items-center gap-4 text-xs text-[color:var(--muted-foreground)]">
          <span className="flex items-center gap-1.5"><Building2 size={14} />{item.departmentName || "-"}</span>
          {awardedSupplier && (
            <span className="flex items-center gap-1.5 text-[rgba(92,181,150,1)]"><Trophy size={14} />{awardedSupplier}</span>
          )}
        </div>

        {/* Amount */}
        <div className="mt-2 flex items-center gap-4 border-t border-white/30 pt-2">
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
          {/* 右下角：展开详情按钮 */}
          {item.sourceType === "PROJECT_MANAGEMENT" && item.projectManagementId ? (
            <button
              onClick={onViewArchive}
              className="ml-auto flex items-center gap-1.5 rounded-[8px] bg-[rgba(92,181,150,0.1)] px-3 py-1.5 text-[11px] text-[rgba(92,181,150,1)] hover:bg-[rgba(92,181,150,0.18)] transition-colors"
            >
              <FolderOpen size={14} />
              归档详情
            </button>
          ) : (
            <button
              onClick={onExpand}
              className="ml-auto flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[11px] text-[color:var(--muted-foreground)] hover:bg-[rgba(96,139,239,0.08)] transition-colors"
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
            className="border-t border-white/30 px-4 py-3"
          >
            {/* 所属项目 */}
            <div className="text-[11px] text-[color:var(--muted-foreground)]">
              <span className="font-medium">所属项目：</span>
              <span className="ml-1 text-[color:var(--foreground)]">{item.projectName}</span>
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

// ─── Simplified Row for Selection Modal ─────────────────────────────────────────
function SimplifiedRow({
  item,
  isSelected,
  onToggle,
}: {
  item: ProcurementRoundItem;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const formatAmount = (amount: number | null | string) => {
    if (!amount) return "-";
    const num = typeof amount === "string" ? parseFloat(amount) : amount;
    return num >= 10000 ? `${(num / 10000).toFixed(1)}万` : `${num.toFixed(0)}元`;
  };

  return (
    <div
      onClick={onToggle}
      className={`cursor-pointer rounded-[10px] border p-2.5 transition-all ${
        isSelected
          ? "border-[rgba(96,139,239,0.5)] bg-[rgba(96,139,239,0.08)]"
          : "border-white/40 bg-white/60 hover:border-[rgba(96,139,239,0.2)] hover:bg-white/80"
      }`}
    >
      <div className="flex items-start gap-2">
        {isSelected ? (
          <CheckSquare size={16} className="text-[rgba(96,139,239,1)] shrink-0 mt-0.5" />
        ) : (
          <Square size={16} className="text-[color:var(--muted-foreground)] shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[0.85rem] font-medium text-[color:var(--foreground)] leading-tight">{item.projectName}</div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-[color:var(--muted-foreground)]">
            <span>预算{formatAmount(item.controlAmount ?? item.budgetAmount)}</span>
            {item.awardAmount && <span className="text-[rgba(92,181,150,0.8)]">成交{formatAmount(item.awardAmount)}</span>}
          </div>
        </div>
        <StatusBadge status={item.resultStatus} resultText={item.resultText} />
      </div>
    </div>
  );
}

// ─── Analysis Selection Modal ───────────────────────────────────────────────────
function AnalysisSelectionModal({
  keyword,
  items,
  selectedIds,
  onToggle,
  onSelectAll,
  onClose,
  onConfirm,
}: {
  keyword: string;
  items: ProcurementRoundItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const allSelected = selectedIds.size === items.length;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(244,248,252,0.55)] backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="relative max-w-[680px] w-[92vw] max-h-[70vh] overflow-hidden rounded-[20px] border border-white/55 bg-white/90 shadow-lg"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/40">
            <div className="flex items-center gap-3">
              <Sparkles size={20} style={{ color: accentMap.blue }} />
              <div>
                <h2 className="text-base font-bold text-[color:var(--foreground)]">选择分析对象</h2>
                <p className="text-[11px] text-[color:var(--muted-foreground)]">关键词「{keyword}」匹配到 {items.length} 条记录</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-[8px] hover:bg-white/80">
              <X size={16} />
            </button>
          </div>

          {/* Items */}
          <div className="p-4 overflow-y-auto max-h-[calc(70vh-150px)]">
            <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
              {items.map((item) => (
                <SimplifiedRow
                  key={item.id}
                  item={item}
                  isSelected={selectedIds.has(item.id)}
                  onToggle={() => onToggle(item.id)}
                />
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-5 py-4 border-t border-white/40">
            <div className="flex items-center gap-3">
              <button
                onClick={onSelectAll}
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-white/50 bg-white/60 px-3 py-1.5 text-[11px] font-medium hover:bg-white/80"
              >
                {allSelected ? <CheckSquare size={14} className="text-[rgba(96,139,239,1)]" /> : <Square size={14} />}
                {allSelected ? "取消全选" : "全选"}
              </button>
              <span className="text-[11px] text-[color:var(--muted-foreground)]">已选择 {selectedIds.size} / {items.length} 条</span>
            </div>
            <button
              onClick={onConfirm}
              disabled={selectedIds.size === 0}
              className="neu-btn-primary disabled:opacity-50"
            >
              <BarChart3 size={15} />
              开始分析
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── AI Analysis Result Type ────────────────────────────────────────────────────
type AiAnalysisResult = {
  overview: string;
  highlights: string[];
  concerns: string[];
  suggestions: string[];
};

// ─── Analysis Result Modal ─────────────────────────────────────────────────────
function AnalysisResultModal({
  keyword,
  items,
  aiResult,
  onClose,
}: {
  keyword: string;
  items: ProcurementRoundItem[];
  aiResult: AiAnalysisResult | null;
  onClose: () => void;
}) {
  const reducedMotion = useReducedMotion() ?? false;

  // Calculate analytics
  const totalBudget = items.reduce((s, i) => {
    const v = i.controlAmount ?? i.budgetAmount ?? 0;
    return s + (typeof v === "string" ? parseFloat(v) : v);
  }, 0);
  const totalAward = items.reduce((s, i) => s + (typeof i.awardAmount === "string" ? parseFloat(i.awardAmount) : i.awardAmount || 0), 0);
  const savings = totalBudget - totalAward;
  const savingsRate = totalBudget > 0 ? ((savings / totalBudget) * 100).toFixed(1) : "0";

  const awardedCount = items.filter(i => i.resultStatus === "AWARDED").length;
  const pendingCount = items.filter(i => i.resultStatus === "PENDING").length;
  const abnormalCount = items.filter(i => ["FAILED_REVIEW", "FILE_REVISION_REQUIRED", "INVALID_RESPONSE"].includes(i.resultStatus)).length;

  const methodCounts: Record<string, number> = {};
  items.forEach(i => { methodCounts[i.procurementMethod] = (methodCounts[i.procurementMethod] || 0) + 1; });

  const deptCounts: Record<string, number> = {};
  items.forEach(i => { deptCounts[i.departmentName] = (deptCounts[i.departmentName] || 0) + 1; });

  const pieRadius = 50;
  const pieCx = 60;

  const formatAmount = (n: number) => n >= 10000 ? `${(n/10000).toFixed(1)}万` : `${n.toFixed(0)}元`;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="relative max-w-[900px] w-[94vw] rounded-[22px] border border-white/55 bg-white/92 shadow-xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/35">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-[rgba(96,139,239,0.1)]">
                <BarChart3 size={22} style={{ color: accentMap.blue }} />
              </div>
              <div>
                <h2 className="text-[1.1rem] font-bold text-[color:var(--foreground)]">综合分析报告</h2>
                <p className="text-xs text-[color:var(--muted-foreground)]">关键词「{keyword}」 · {items.length} 条记录</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2.5 rounded-[10px] hover:bg-white hover:rotate-90 transition-all">
              <X size={18} />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* Key Metrics */}
            <motion.div {...fadeIn(0, reducedMotion)} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <div className="rounded-[14px] bg-[rgba(96,139,239,0.06)] p-4 text-center">
                <div className="text-[10px] uppercase tracking-wide text-[rgba(96,139,239,0.7)]">预算总额</div>
                <div className="mt-2 text-[1.3rem] font-bold text-[rgba(96,139,239,1)]">{formatAmount(totalBudget)}</div>
              </div>
              <div className="rounded-[14px] bg-[rgba(92,181,150,0.06)] p-4 text-center">
                <div className="text-[10px] uppercase tracking-wide text-[rgba(92,181,150,0.7)]">成交总额</div>
                <div className="mt-2 text-[1.3rem] font-bold text-[rgba(92,181,150,1)]">{formatAmount(totalAward)}</div>
              </div>
              <div className="rounded-[14px] bg-[rgba(234,188,110,0.06)] p-4 text-center">
                <div className="text-[10px] uppercase tracking-wide text-[rgba(234,188,110,0.7)]">节约资金</div>
                <div className="mt-2 text-[1.3rem] font-bold text-[rgba(234,188,110,1)]">{formatAmount(savings)}</div>
              </div>
              <div className="rounded-[14px] bg-[rgba(119,129,219,0.06)] p-4 text-center">
                <div className="text-[10px] uppercase tracking-wide text-[rgba(119,129,219,0.7)]">节资率</div>
                <div className="mt-2 text-[1.3rem] font-bold text-[rgba(119,129,219,1)]">{savingsRate}%</div>
              </div>
            </motion.div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {/* Status Distribution */}
              <motion.div {...fadeIn(1, reducedMotion)} className="rounded-[16px] border border-white/40 bg-white/65 p-4">
                <div className="flex items-center gap-2 mb-4">
                  <PieChart size={16} style={{ color: accentMap.blue }} />
                  <h3 className="text-[0.9rem] font-semibold text-[color:var(--foreground)]">状态分布</h3>
                </div>
                <div className="flex items-center gap-6">
                  <div className="relative">
                    <svg width="120" height="120" viewBox="0 0 120 120">
                      {awardedCount > 0 && (
                        <circle cx={pieCx} cy={pieCx} r={pieRadius} fill="transparent" stroke={accentMap.teal} strokeWidth="20" strokeDasharray={`${(awardedCount/items.length)*314} 314`} transform="rotate(-90 60 60)" />
                      )}
                      {pendingCount > 0 && (
                        <circle cx={pieCx} cy={pieCx} r={pieRadius} fill="transparent" stroke={accentMap.gold} strokeWidth="20" strokeDasharray={`${(pendingCount/items.length)*314} 314`} strokeDashoffset={`${-(awardedCount/items.length)*314}`} transform="rotate(-90 60 60)" />
                      )}
                      {abnormalCount > 0 && (
                        <circle cx={pieCx} cy={pieCx} r={pieRadius} fill="transparent" stroke={accentMap.coral} strokeWidth="20" strokeDasharray={`${(abnormalCount/items.length)*314} 314`} strokeDashoffset={`${-(awardedCount+pendingCount)/items.length*314}`} transform="rotate(-90 60 60)" />
                      )}
                    </svg>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full bg-[rgba(92,181,150,1)]" />
                      <span className="text-[11px]">已成交 {awardedCount}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full bg-[rgba(234,188,110,1)]" />
                      <span className="text-[11px]">待处理 {pendingCount}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full bg-[rgba(230,129,102,1)]" />
                      <span className="text-[11px]">异常 {abnormalCount}</span>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Method Distribution */}
              <motion.div {...fadeIn(2, reducedMotion)} className="rounded-[16px] border border-white/40 bg-white/65 p-4">
                <div className="flex items-center gap-2 mb-4">
                  <Activity size={16} style={{ color: accentMap.teal }} />
                  <h3 className="text-[0.9rem] font-semibold text-[color:var(--foreground)]">采购方式</h3>
                </div>
                <div className="space-y-2">
                  {Object.entries(methodCounts).map(([method, count], i) => {
                    const pct = Math.round((count / items.length) * 100);
                    const colors = [accentMap.blue, accentMap.teal, accentMap.gold, accentMap.indigo];
                    return (
                      <div key={method} className="flex items-center gap-3">
                        <span className="w-[100px] text-[11px] truncate">{method}</span>
                        <div className="flex-1 h-5 rounded-[4px] bg-[rgba(200,215,235,0.2)] overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.5, delay: i * 0.08 }}
                            className="h-full rounded-[4px]"
                            style={{ background: colors[i % colors.length] }}
                          />
                        </div>
                        <span className="text-[11px] font-bold" style={{ color: colors[i % colors.length] }}>{count}</span>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            </div>

            {/* Department Distribution */}
            <motion.div {...fadeIn(3, reducedMotion)} className="rounded-[16px] border border-white/40 bg-white/65 p-4">
              <div className="flex items-center gap-2 mb-4">
                <Building2 size={16} style={{ color: accentMap.indigo }} />
                <h3 className="text-[0.9rem] font-semibold text-[color:var(--foreground)]">部门分布</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(deptCounts).sort((a, b) => b[1] - a[1]).map(([dept, count]) => (
                  <span
                    key={dept}
                    className="rounded-[10px] px-3 py-1.5 text-[11px] font-medium bg-[rgba(119,129,219,0.08)] text-[rgba(119,129,219,0.9)]"
                  >
                    {dept} <span className="font-bold">{count}</span>
                  </span>
                ))}
              </div>
            </motion.div>

            {/* AI Analysis Section */}
            <motion.div {...fadeIn(4, reducedMotion)} className="rounded-[16px] border border-[rgba(96,139,239,0.25)] bg-[linear-gradient(135deg,rgba(96,139,239,0.05),rgba(92,181,150,0.03))] p-5">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles size={18} style={{ color: accentMap.blue }} />
                <h3 className="text-base font-bold text-[rgba(96,139,239,1)]">AI智能分析</h3>
              </div>

              {aiResult ? (
                <div className="space-y-3">
                  {/* Overview */}
                  <div className="p-3 rounded-[12px] bg-white/60">
                    <p className="text-[0.85rem] leading-relaxed text-[color:var(--foreground)]">{aiResult.overview}</p>
                  </div>

                  {/* Highlights */}
                  {aiResult.highlights.length > 0 && (
                    <div className="flex items-start gap-3 p-3 rounded-[12px] bg-white/60">
                      <Target size={16} className="shrink-0 mt-0.5" style={{ color: accentMap.teal }} />
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-wide text-[rgba(92,181,150,0.8)]">核心亮点</div>
                        <ul className="mt-1.5 space-y-1">
                          {aiResult.highlights.map((h, i) => (
                            <li key={i} className="text-[0.85rem] leading-relaxed text-[color:var(--foreground)]">• {h}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {/* Concerns */}
                  {aiResult.concerns.length > 0 && (
                    <div className="flex items-start gap-3 p-3 rounded-[12px] bg-[rgba(230,129,102,0.08)]">
                      <AlertCircle size={16} className="shrink-0 mt-0.5" style={{ color: accentMap.coral }} />
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-wide text-[rgba(230,129,102,0.8)]">待关注项</div>
                        <ul className="mt-1.5 space-y-1">
                          {aiResult.concerns.map((c, i) => (
                            <li key={i} className="text-[0.85rem] leading-relaxed text-[color:var(--foreground)]">• {c}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {/* Suggestions */}
                  {aiResult.suggestions.length > 0 && (
                    <div className="flex items-start gap-3 p-3 rounded-[12px] bg-[rgba(234,188,110,0.08)]">
                      <Lightbulb size={16} className="shrink-0 mt-0.5" style={{ color: accentMap.gold }} />
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-wide text-[rgba(234,188,110,0.8)]">建议方向</div>
                        <ul className="mt-1.5 space-y-1">
                          {aiResult.suggestions.map((s, i) => (
                            <li key={i} className="text-[0.85rem] leading-relaxed text-[color:var(--foreground)]">• {s}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={24} className="animate-spin text-[rgba(96,139,239,0.6)]" />
                  <span className="ml-3 text-[0.85rem] text-[color:var(--muted-foreground)]">AI正在分析...</span>
                </div>
              )}
            </motion.div>

            {/* Export Actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/30">
              <button onClick={onClose} className="rounded-[10px] border border-white/55 bg-white/70 px-4 py-2.5 text-[0.85rem] font-medium">
                关闭
              </button>
              <button className="inline-flex items-center gap-2 rounded-[10px] bg-[rgba(92,181,150,0.9)] px-4 py-2.5 text-[0.85rem] font-semibold text-white">
                <CircleDollarSign size={14} />
                导出报告
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Recycle Confirmation Modal ────────────────────────────────────────────────
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
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(244,248,252,0.55)] backdrop-blur-sm"
        onClick={loading ? undefined : onCancel}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 18 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 18 }}
          transition={{ duration: 0.22, ease: easeOutQuint }}
          onClick={(e) => e.stopPropagation()}
          className="w-[min(92vw,460px)] overflow-hidden rounded-[22px] border border-white/65 bg-white/92 shadow-[0_28px_70px_rgba(69,99,158,0.16)]"
        >
          <div className="relative px-6 py-5">
            <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,rgba(230,129,102,0.88),rgba(234,188,110,0.65),rgba(96,139,239,0.2))]" />
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] border border-[rgba(230,129,102,0.25)] bg-[rgba(230,129,102,0.1)] text-[rgba(230,129,102,1)]">
                <Trash2 size={22} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold tracking-[-0.02em] text-[color:var(--foreground)]">
                  移至回收站
                </h2>
                <p className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
                  请确认是否处理以下采购台账记录。
                </p>
              </div>
              <button
                onClick={onCancel}
                disabled={loading}
                className="rounded-[10px] p-2 text-[color:var(--muted-foreground)] transition-all hover:bg-[rgba(96,139,239,0.08)] hover:text-[color:var(--foreground)] disabled:opacity-40"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-5 rounded-[16px] border border-white/55 bg-[linear-gradient(145deg,rgba(247,250,255,0.86),rgba(255,255,255,0.72))] p-4">
              <div className="text-[0.92rem] font-semibold leading-6 text-[color:var(--foreground)]">
                {item.projectName}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--muted-foreground)]">
                <span className="rounded-full bg-[rgba(96,139,239,0.08)] px-2 py-1">{item.departmentName || "未填部门"}</span>
                <span className="rounded-full bg-[rgba(92,181,150,0.1)] px-2 py-1">{item.resultStatusLabel}</span>
                <span className="rounded-full bg-[rgba(234,188,110,0.12)] px-2 py-1">{item.procurementMethod}</span>
              </div>
            </div>

            <div className="mt-4 rounded-[14px] bg-[rgba(230,129,102,0.07)] px-4 py-3 text-xs leading-5 text-[rgba(145,82,62,1)]">
              该记录将移入采购台账回收站，不会再出现在正常台账列表中。你可以在本页面切换到“回收站”后恢复或彻底删除。
            </div>

            {error && (
              <div className="mt-3 flex items-start gap-2 rounded-[12px] border border-[rgba(230,129,102,0.22)] bg-[rgba(230,129,102,0.08)] px-3 py-2 text-xs leading-5 text-[rgba(190,88,68,1)]">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-white/45 bg-[rgba(247,250,255,0.58)] px-6 py-4">
            <button
              onClick={onCancel}
              disabled={loading}
              className="rounded-[11px] border border-white/60 bg-white/72 px-4 py-2 text-[0.85rem] font-medium text-[color:var(--foreground)] transition-colors hover:bg-white disabled:opacity-40"
            >
              取消
            </button>
            <button
              onClick={onConfirm}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-[11px] bg-[rgba(230,129,102,0.92)] px-4 py-2 text-[0.85rem] font-semibold text-white shadow-[0_10px_22px_rgba(230,129,102,0.18)] transition-colors hover:bg-[rgba(220,112,88,1)] disabled:opacity-60"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              确认移至回收站
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function ProcurementsPage() {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [data, setData] = useState<ProcurementRoundItem[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 12, total: 0, totalPages: 0 });
  const [methods, setMethods] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const [filters, setFilters] = useState<LedgerFilterState>({
    startDate: null,
    endDate: null,
    procurementMethod: null,
    departmentId: null,
    resultStatus: null,
    searchKeyword: "",
    recycleStatus: "ACTIVE",
  });

  // Analysis states
  const [showAnalysisSelection, setShowAnalysisSelection] = useState(false);
  const [matchedItems, setMatchedItems] = useState<ProcurementRoundItem[]>([]);
  const [selectedAnalysisIds, setSelectedAnalysisIds] = useState<Set<string>>(new Set());
  const [showAnalysisResult, setShowAnalysisResult] = useState(false);
  const [aiAnalysisResult, setAiAnalysisResult] = useState<AiAnalysisResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Expanded card states for inline details
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(new Set());
  const [itemSummaries, setItemSummaries] = useState<Record<string, string>>({});
  const [loadingSummaries, setLoadingSummaries] = useState<Set<string>>(new Set());
  const { setPageContext } = useAssistant();

  // Archive detail modal state
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [selectedArchiveRoundId, setSelectedArchiveRoundId] = useState<string | null>(null);

  // Admin check
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    const loadCurrentUser = async () => {
      try {
        const user = await fetchCurrentUser();
        setIsAdmin(user.role === 'admin');
      } catch {
        setIsAdmin(false);
      }
    };

    void loadCurrentUser();
  }, []);

  // Move to recycle bin state
  const [movingToRecycleBinId, setMovingToRecycleBinId] = useState<string | null>(null);
  const [recycleTarget, setRecycleTarget] = useState<ProcurementRoundItem | null>(null);
  const [recycleError, setRecycleError] = useState<string | null>(null);

  const handleViewArchive = (item: ProcurementRoundItem) => {
    setSelectedArchiveRoundId(item.id);
    setShowArchiveModal(true);
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
    if (!confirm(`确定要彻底删除「${item.projectName}」吗？此操作不可恢复。`)) return;

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
          const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api'}/project-management/${item.projectManagementId}/summary`, {
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
    setLoading(true);
    try {
      const [listRes, methodsRes] = await Promise.all([
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
        }),
        fetchProcurementMethods(),
      ]);
      setData(listRes.data);
      setPagination(listRes.pagination);
      setMethods(methodsRes);
    } catch (err) {
      console.error("Failed to load:", err);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, filters]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleFilterChange = (key: keyof LedgerFilterState, value: string | null) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  // Analysis handlers
  const handleAnalyze = async () => {
    if (!filters.searchKeyword) return;
    try {
      const res = await fetchProcurements({
        page: 1,
        pageSize: 100,
        searchKeyword: filters.searchKeyword,
      });
      setMatchedItems(res.data);
      setSelectedAnalysisIds(new Set());
      setShowAnalysisSelection(true);
    } catch (err) {
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

  const handleSelectAll = () => {
    if (selectedAnalysisIds.size === matchedItems.length) {
      setSelectedAnalysisIds(new Set());
    } else {
      setSelectedAnalysisIds(new Set(matchedItems.map(i => i.id)));
    }
  };

  const confirmAnalysis = async () => {
    const selectedItems = matchedItems.filter(i => selectedAnalysisIds.has(i.id));
    setShowAnalysisSelection(false);
    setShowAnalysisResult(true);
    setAiAnalysisResult(null);
    setAiLoading(true);

    // Calculate summary
    const totalBudget = selectedItems.reduce((s, i) => {
      const v = i.controlAmount ?? i.budgetAmount ?? 0;
      return s + (typeof v === "string" ? parseFloat(v) : v);
    }, 0);
    const totalAward = selectedItems.reduce((s, i) => s + (typeof i.awardAmount === "string" ? parseFloat(i.awardAmount) : i.awardAmount || 0), 0);
    const savings = totalBudget - totalAward;
    const savingsRate = totalBudget > 0 ? ((savings / totalBudget) * 100).toFixed(1) : "0";
    const awardedCount = selectedItems.filter(i => i.resultStatus === "AWARDED").length;
    const pendingCount = selectedItems.filter(i => i.resultStatus === "PENDING").length;
    const abnormalCount = selectedItems.filter(i => ["FAILED_REVIEW", "FILE_REVISION_REQUIRED", "INVALID_RESPONSE"].includes(i.resultStatus)).length;
    const methodCounts: Record<string, number> = {};
    selectedItems.forEach(i => { methodCounts[i.procurementMethod] = (methodCounts[i.procurementMethod] || 0) + 1; });
    const deptCounts: Record<string, number> = {};
    selectedItems.forEach(i => { deptCounts[i.departmentName] = (deptCounts[i.departmentName] || 0) + 1; });

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
        summary: {
          totalCount: selectedItems.length,
          totalBudget,
          totalAward,
          savings,
          savingsRate,
          awardedCount,
          pendingCount,
          abnormalCount,
          methodCounts,
          deptCounts,
        },
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
    } finally {
      setAiLoading(false);
    }
  };

  const getAnalysisItems = () => matchedItems.filter(i => selectedAnalysisIds.has(i.id));

  return (
    <div className="min-h-full px-4 py-4 lg:px-6">
        {/* Toolbar */}
        <div className="mb-4">
          <FilterToolbar
            filters={filters}
            onFilterChange={handleFilterChange}
            methods={methods}
            onRefresh={loadData}
            onAnalyze={handleAnalyze}
            loading={loading}
          />
        </div>

        {/* Data Grid */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="rounded-[20px] border border-white/55 bg-white/80 p-4">
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
                    onMoveToRecycleBin={() => handleMoveToRecycleBin(item)}
                    onRestore={() => handleRestoreFromRecycleBin(item)}
                    onDeletePermanently={() => handleDeletePermanently(item)}
                    isAdmin={isAdmin}
                  />
                ))}
              </div>

              {/* Pagination */}
              <div className="mt-5 flex items-center justify-between border-t border-white/30 pt-4">
                <span className="text-[11px] text-[color:var(--muted-foreground)]">
                  {pagination.total} 条 · 第 {pagination.page}/{pagination.totalPages} 页
                </span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))} disabled={pagination.page <= 1} className="rounded-[8px] border border-white/50 bg-white/60 px-3 py-1.5 text-[11px] disabled:opacity-40">
                    上一页
                  </button>
                  <button onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))} disabled={pagination.page >= pagination.totalPages} className="rounded-[8px] border border-white/50 bg-white/60 px-3 py-1.5 text-[11px] disabled:opacity-40">
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
            onSelectAll={handleSelectAll}
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
      </div>
  );
}
