'use client';

// ── 供应商侧边栏（cgzxui 新拟态）— .exp-supplier-tile 竖排 ──
// 磁贴凸起 → 选中内凹（--sup-color 驱动代表色）；解密状态点 / 回避·废标 pill / 打分进度条

import { Lock } from 'lucide-react';

interface SupplierSidebarProps {
  suppliers: Array<{
    id: string;
    supplierName: string;
    decryptStatus: string;
    submitStatus?: string;
  }>;
  activeSupplier: string;
  onSelect: (supplierId: string) => void;
  conflictedSupplierIds: Set<string>;
  /** Phase ④ Task 7: suppliers currently 废标 (invalid) — greyed out, scoring disabled but still selectable for viewing */
  invalidSupplierIds?: Set<string>;
  decryptLabel: Record<string, string>;
  /** Optional scoring progress per supplier: `${supplierId}` → { scored, total } */
  scoringProgress?: Record<string, { scored: number; total: number }>;
}

// 供应商代表色轮转（与雷达图/柱状图同族）
const SUP_COLORS = [
  'oklch(0.48 0.18 264)',
  'oklch(0.52 0.14 180)',
  'oklch(0.55 0.16 60)',
  'oklch(0.50 0.16 20)',
  'oklch(0.50 0.14 310)',
];

export function SupplierSidebar({
  suppliers,
  activeSupplier,
  onSelect,
  conflictedSupplierIds,
  invalidSupplierIds,
  decryptLabel,
  scoringProgress,
}: SupplierSidebarProps) {
  if (suppliers.length === 0) return null;

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-[oklch(0.55_0.03_258/0.1)]">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
          投标单位
        </span>
        <span className="neu-tab-count">{suppliers.length}</span>
      </div>

      {/* 供应商磁贴列表 */}
      <div className="flex-1 space-y-2 overflow-y-auto px-2.5 pb-2.5 pt-0.5" style={{ scrollbarWidth: 'thin' }}>
        {suppliers.map((s, idx) => {
          const isActive = s.id === activeSupplier;
          const isConflicted = conflictedSupplierIds.has(s.id);
          // Phase ④ Task 7: 废标供应商 —— 置灰 + 徽章，但仍可选（可查看历史评分）
          const isInvalid = invalidSupplierIds?.has(s.id) ?? false;
          const supColor = SUP_COLORS[idx % SUP_COLORS.length];
          const statusColor =
            s.decryptStatus === 'SUCCESS' ? 'var(--success)'
            : s.decryptStatus === 'DANGER' ? 'var(--danger)'
            : 'var(--warning)';
          const isRunning = s.decryptStatus === 'RUNNING';

          const progress = scoringProgress?.[s.id];
          const progressPct = progress && progress.total > 0 ? (progress.scored / progress.total) * 100 : 0;

          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              aria-current={isActive ? 'true' : undefined}
              className={`exp-supplier-tile ${isActive ? 'is-active' : ''} ${isInvalid ? 'opacity-50' : ''}`}
              style={{ '--sup-color': supColor } as React.CSSProperties}
            >
              {/* 解密状态点（解密中呼吸）*/}
              {isRunning ? (
                <span className="exp-live-dot" style={{ '--c': statusColor } as React.CSSProperties} />
              ) : (
                <span className="exp-pill-dot" style={{ '--c': statusColor } as React.CSSProperties} />
              )}

              <span className="min-w-0 flex-1">
                {/* 名称 */}
                <span
                  className={`block truncate text-[13px] leading-tight ${
                    isActive ? 'font-bold text-[var(--foreground)]' : 'font-medium text-[var(--foreground)]/80'
                  }`}
                >
                  {s.supplierName}
                </span>

                {/* 状态徽章行 */}
                <span className="mt-1 flex flex-wrap items-center gap-1">
                  <span className="exp-pill" style={{ '--c': statusColor } as React.CSSProperties}>
                    {decryptLabel[s.decryptStatus] || s.decryptStatus}
                  </span>
                  {isConflicted && (
                    <span className="exp-pill" style={{ '--c': 'var(--danger)' } as React.CSSProperties}>
                      <Lock size={8} strokeWidth={2.2} /> 已回避
                    </span>
                  )}
                  {!isConflicted && isInvalid && (
                    <span className="exp-pill" style={{ '--c': 'var(--muted-foreground)' } as React.CSSProperties}>
                      废标
                    </span>
                  )}
                  {progress && (
                    <span className="text-[10px] font-semibold tabular-nums text-[var(--muted-foreground)]">
                      {progress.scored}/{progress.total}
                    </span>
                  )}
                </span>

                {/* 打分进度条 */}
                {progress && (
                  <span className="exp-bar mt-1.5 block">
                    <i
                      style={{
                        width: `${progressPct}%`,
                        '--bar': progressPct >= 100 ? 'var(--success)' : supColor,
                      } as React.CSSProperties}
                    />
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
