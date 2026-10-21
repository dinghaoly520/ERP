'use client';

// 采购台账 AI 分析·第一步「选择分析对象」（2026-10-21 重设计）。
// 原版：双列卡片平铺 + 页脚挤「全选/计数/开始分析」三个控件——匹配上限 100 条时
// 检索困难、勾选过程没有任何汇总反馈，用户不知道自己圈了多大的盘子。
// 重设计要点：
//   ① 顶部选区实时汇总条：已选数 / 预算合计 / 成交合计 / 节约资金随勾选联动；
//   ② 状态分段过滤 chips（已成交/待处理/异常/其他）——只想分析异常记录时一键收窄；
//   ③ 单列高密度行：hairline 分隔 + 右对齐 monospace 金额（终端式密度，百条可扫）；
//   ④ 行级键盘可达（role=checkbox + Enter/Space），「全选可见」作用于当前过滤集。

import { useMemo, useState } from 'react';
import { BarChart3, CheckSquare, ListFilter, SearchX, Square } from 'lucide-react';
import { Modal } from '@/components/workbench';
import type { LedgerStatusGroup } from '@/components/procurements/ledger-analysis';
import {
  buildLedgerAnalysisSummary,
  LEDGER_GROUP_BG,
  LEDGER_GROUP_COLOR,
  LEDGER_GROUP_LABEL,
  statusGroupOf,
} from '@/components/procurements/ledger-analysis';
import type { ProcurementRoundItem } from '@/lib/types/procurement';
import { RESULT_STATUS_CONFIG } from '@/lib/types/procurement';
import { formatWan } from '@/lib/format';

const BLUE = 'rgba(96,139,239,1)';
const BLUE_BG = 'rgba(96,139,239,0.10)';
const HAIRLINE = 'oklch(0.6 0.04 258 / 0.14)';

// 状态徽章（页面内 StatusBadge 同口径精简版：终止项目红「已终止」，其余按 RESULT_STATUS_CONFIG）
function StatusPill({ item }: { item: ProcurementRoundItem }) {
  if (item.resultStatus === 'CANCELLED' && item.terminationReason) {
    return (
      <span
        className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold"
        style={{ color: 'rgba(220,90,80,1)', borderColor: 'rgba(220,90,80,0.25)', backgroundColor: 'rgba(220,90,80,0.12)' }}
      >
        已终止
      </span>
    );
  }
  const cfg = RESULT_STATUS_CONFIG[item.resultStatus];
  const label =
    item.resultStatus === 'AWARDED' || item.resultStatus === 'PENDING' || !item.resultText
      ? cfg.label
      : item.resultText;
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold"
      style={{ color: cfg.color, borderColor: cfg.borderColor, backgroundColor: cfg.bgColor }}
    >
      {label}
    </span>
  );
}

function SummaryCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
        {label}
      </div>
      <div
        className="mt-1 truncate font-mono text-[1.05rem] font-bold tabular-nums"
        style={{ color: color ?? 'var(--foreground)' }}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

export function AnalysisSelectionModal({
  keyword,
  items,
  selectedIds,
  onToggle,
  onClose,
  onConfirm,
}: {
  keyword: string;
  items: ProcurementRoundItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [groupFilter, setGroupFilter] = useState<LedgerStatusGroup | null>(null);

  const groupCounts = useMemo(() => {
    const c: Record<LedgerStatusGroup, number> = { awarded: 0, pending: 0, abnormal: 0, other: 0 };
    items.forEach((i) => {
      c[statusGroupOf(i.resultStatus)]++;
    });
    return c;
  }, [items]);

  const visibleItems = useMemo(
    () => (groupFilter ? items.filter((i) => statusGroupOf(i.resultStatus) === groupFilter) : items),
    [items, groupFilter],
  );

  // 勾选联动汇总：只算选中集，用户在点「开始分析」前就能看到盘子大小
  const selectionSummary = useMemo(
    () => buildLedgerAnalysisSummary(items.filter((i) => selectedIds.has(i.id))),
    [items, selectedIds],
  );

  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every((i) => selectedIds.has(i.id));

  // 「全选可见」作用于当前过滤集：过滤态下增量并入，再次点击移除可见集
  const toggleVisible = () => {
    if (allVisibleSelected) visibleItems.forEach((i) => onToggle(i.id));
    else visibleItems.forEach((i) => {
      if (!selectedIds.has(i.id)) onToggle(i.id);
    });
  };
  const clearSelection = () => items.filter((i) => selectedIds.has(i.id)).forEach((i) => onToggle(i.id));

  const hasSelection = selectedIds.size > 0;

  return (
    <Modal
      open
      onClose={onClose}
      size="2xl"
      title={
        <span className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-[rgba(96,139,239,0.25)] bg-[rgba(96,139,239,0.1)] text-[rgba(96,139,239,1)]">
            <BarChart3 size={20} strokeWidth={1.9} />
          </span>
          AI 综合分析 · 选择数据范围
        </span>
      }
      description={
        <>
          关键词「{keyword || '（空）'}」匹配 {items.length} 条记录 · 勾选需要纳入分析的台账记录
        </>
      }
      footer={
        <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] leading-5 text-[color:var(--muted-foreground)]">
            已选{' '}
            <span className="font-mono font-bold tabular-nums text-[color:var(--foreground)]">{selectedIds.size}</span>
            {' / '}
            {items.length} 项
            {hasSelection && (
              <>
                {' · 预算合计 '}
                <span className="font-mono tabular-nums">{formatWan(selectionSummary.totalBudget, { digits: 2 })}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="neu-btn-soft">
              取消
            </button>
            <button onClick={onConfirm} disabled={!hasSelection} className="neu-btn-primary disabled:opacity-50">
              <BarChart3 size={15} />
              开始分析{hasSelection ? `（${selectedIds.size} 项）` : ''}
            </button>
          </div>
        </div>
      }
    >
      {/* 选区实时汇总条——勾选即联动，先看盘子再确认 */}
      <div
        className="grid grid-cols-2 divide-x rounded-[14px] border bg-[linear-gradient(145deg,rgba(247,250,255,0.86),rgba(255,255,255,0.72))] lg:grid-cols-4"
        style={{ borderColor: HAIRLINE }}
      >
        <SummaryCell label="已选记录" value={`${selectedIds.size} / ${items.length}`} color={BLUE} />
        <SummaryCell label="预算合计" value={formatWan(selectionSummary.totalBudget, { digits: 2 })} color={BLUE} />
        <SummaryCell
          label="成交合计"
          value={hasSelection ? formatWan(selectionSummary.totalAward, { digits: 2 }) : '—'}
          color="rgba(92,181,150,1)"
        />
        <SummaryCell
          label="节约资金"
          value={hasSelection ? formatWan(selectionSummary.savings, { digits: 2 }) : '—'}
          color={selectionSummary.savings < 0 ? 'rgba(230,129,102,1)' : 'rgba(234,188,110,1)'}
        />
      </div>

      {/* 过滤 + 批量操作 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
          <ListFilter size={12} />
          状态
        </span>
        <button
          onClick={() => setGroupFilter(null)}
          className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors"
          style={
            groupFilter === null
              ? { color: BLUE, borderColor: BLUE, backgroundColor: BLUE_BG }
              : { color: 'var(--muted-foreground)', borderColor: HAIRLINE, backgroundColor: 'transparent' }
          }
        >
          全部 <span className="font-mono font-bold tabular-nums">{items.length}</span>
        </button>
        {(Object.keys(LEDGER_GROUP_LABEL) as LedgerStatusGroup[])
          .filter((g) => groupCounts[g] > 0)
          .map((g) => (
            <button
              key={g}
              onClick={() => setGroupFilter(groupFilter === g ? null : g)}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors"
              style={
                groupFilter === g
                  ? { color: LEDGER_GROUP_COLOR[g], borderColor: LEDGER_GROUP_COLOR[g], backgroundColor: LEDGER_GROUP_BG[g] }
                  : { color: 'var(--muted-foreground)', borderColor: HAIRLINE, backgroundColor: 'transparent' }
              }
            >
              {LEDGER_GROUP_LABEL[g]} <span className="font-mono font-bold tabular-nums">{groupCounts[g]}</span>
            </button>
          ))}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={toggleVisible} className="neu-btn-xs !text-[11px]">
            {allVisibleSelected ? '取消可见' : '全选可见'}
          </button>
          <button onClick={clearSelection} disabled={!hasSelection} className="neu-btn-xs !text-[11px] disabled:opacity-40">
            清空
          </button>
        </div>
      </div>

      {/* 记录列表：单列高密度行，hairline 分隔，右对齐 monospace 金额 */}
      <div
        className="max-h-[46vh] overflow-y-auto rounded-[14px] border bg-[oklch(1_0_0/0.35)]"
        style={{ borderColor: HAIRLINE }}
      >
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-[color:var(--muted-foreground)]">
            <SearchX size={22} className="opacity-40" />
            <span className="text-xs">未匹配到记录，可调整关键词或筛选后重试</span>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-[color:var(--muted-foreground)]">
            <SearchX size={22} className="opacity-40" />
            <span className="text-xs">该状态下暂无记录</span>
          </div>
        ) : (
          visibleItems.map((item, idx) => {
            const isSelected = selectedIds.has(item.id);
            const supplier =
              item.awardedSupplierName ??
              (item.supplierNames?.length ? `${item.supplierNames.length} 家供应商` : null);
            const metaParts = [
              item.procurementDate ? item.procurementDate.slice(0, 10) : '日期未填',
              item.procurementMethod,
              item.departmentName || '未填部门',
              supplier,
            ].filter(Boolean);
            return (
              <div
                key={item.id}
                role="checkbox"
                aria-checked={isSelected}
                aria-label={item.projectName}
                tabIndex={0}
                onClick={() => onToggle(item.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggle(item.id);
                  }
                }}
                className={`flex cursor-pointer select-none items-center gap-3 px-3 py-2.5 outline-none transition-colors focus-visible:bg-[rgba(96,139,239,0.10)] ${
                  isSelected
                    ? 'bg-[rgba(96,139,239,0.07)] shadow-[inset_3px_0_0_rgba(96,139,239,0.65)]'
                    : 'hover:bg-[oklch(1_0_0/0.55)]'
                } ${idx > 0 ? 'border-t' : ''}`}
                style={idx > 0 ? { borderColor: HAIRLINE } : undefined}
              >
                {isSelected ? (
                  <CheckSquare size={16} className="shrink-0 text-[rgba(96,139,239,1)]" />
                ) : (
                  <Square size={16} className="shrink-0 text-[color:var(--muted-foreground)] opacity-50" />
                )}
                <span className="w-5 shrink-0 font-mono text-[10px] tabular-nums text-[color:var(--muted-foreground)] opacity-70">
                  {String(idx + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className="truncate text-[0.84rem] font-medium leading-tight text-[color:var(--foreground)]"
                    title={item.projectName}
                  >
                    {item.projectName}
                  </div>
                  <div className="mt-0.5 truncate text-[10.5px] leading-4 text-[color:var(--muted-foreground)]">
                    {metaParts.join(' · ')}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusPill item={item} />
                  <div className="flex items-baseline gap-2 font-mono text-[11px] tabular-nums">
                    <span className="text-[color:var(--muted-foreground)]">
                      预算{' '}
                      <span className="text-[color:var(--foreground)]">
                        {formatWan(item.controlAmount ?? item.budgetAmount, { digits: 2 })}
                      </span>
                    </span>
                    {item.awardAmount !== null && item.awardAmount !== undefined && item.awardAmount !== '' && (
                      <span className="text-[rgba(92,181,150,0.75)]">
                        成交 <span className="text-[rgba(92,181,150,1)]">{formatWan(item.awardAmount, { digits: 2 })}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}
