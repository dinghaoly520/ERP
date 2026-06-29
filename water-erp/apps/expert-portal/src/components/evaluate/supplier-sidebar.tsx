'use client';

// ── 供应商侧边栏 — 工业精度垂直导航，替代原水平 pill 条 ──
// 设计理念：类似调音台 channel strip 的选择感，左侧色条指示当前选中

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
  decryptLabel: Record<string, string>;
  /** Optional scoring progress per supplier: `${supplierId}` → { scored, total } */
  scoringProgress?: Record<string, { scored: number; total: number }>;
}

export function SupplierSidebar({
  suppliers,
  activeSupplier,
  onSelect,
  conflictedSupplierIds,
  decryptLabel,
  scoringProgress,
}: SupplierSidebarProps) {
  if (suppliers.length === 0) return null;

  return (
    <aside className="w-56 shrink-0 flex flex-col border-r border-[oklch(0.91_0.006_264)] bg-white/30">
      {/* 头部 */}
      <div className="px-3 py-2.5 border-b border-[oklch(0.91_0.006_264)] flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[oklch(0.48_0.01_264)]">
          投标单位
        </span>
        <span className="text-[10px] font-semibold bg-[oklch(0.94_0.004_264)] text-[oklch(0.48_0.01_264)] px-1.5 py-0.5 rounded-full tabular-nums">
          {suppliers.length}
        </span>
      </div>

      {/* 供应商列表 */}
      <div className="flex-1 overflow-y-auto py-1.5 px-2 space-y-0.5">
        {suppliers.map((s) => {
          const isActive = s.id === activeSupplier;
          const isConflicted = conflictedSupplierIds.has(s.id);
          const statusColor =
            s.decryptStatus === 'SUCCESS'
              ? 'bg-[#11a874]'
              : s.decryptStatus === 'DANGER'
                ? 'bg-[#e74c3c]'
                : 'bg-[#f5a623]';

          const progress = scoringProgress?.[s.id];

          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={`w-full text-left group relative transition-all ${
                isActive
                  ? 'bg-blue-50/80 border border-[#bfdbfe]'
                  : 'border border-transparent hover:bg-[oklch(0.992_0.003_264)] hover:border-[oklch(0.94_0.004_264)]'
              } rounded-lg`}
            >
              {/* 左侧激活指示条 */}
              {isActive && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-[#064ea2]" />
              )}

              <div className="px-3 py-2.5 pl-3.5">
                {/* 第一行：状态点 + 名称 */}
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${statusColor} ${
                      s.decryptStatus === 'RUNNING' ? 'animate-pulse' : ''
                    }`}
                  />
                  <span
                    className={`text-[13px] truncate flex-1 leading-tight ${
                      isActive
                        ? 'font-bold text-[#064ea2]'
                        : 'font-medium text-[oklch(0.22_0.012_265)]'
                    }`}
                  >
                    {s.supplierName}
                  </span>
                </div>

                {/* 第二行：状态标签 + 冲突/进度 */}
                <div className="flex items-center gap-2 mt-1 ml-4">
                  <span
                    className={`text-[10px] font-medium ${
                      s.decryptStatus === 'SUCCESS'
                        ? 'text-[#11a874]'
                        : s.decryptStatus === 'DANGER'
                          ? 'text-[#e74c3c]'
                          : 'text-[#f5a623]'
                    }`}
                  >
                    {decryptLabel[s.decryptStatus] || s.decryptStatus}
                  </span>

                  {isConflicted ? (
                    <span className="text-[10px] font-bold text-red-500 bg-red-50 px-1 rounded">
                      <Lock size={8} strokeWidth={2} className="inline mr-0.5 -mt-px" />
                      已回避
                    </span>
                  ) : progress ? (
                    <span className="text-[10px] text-[oklch(0.48_0.01_264)] tabular-nums">
                      {progress.scored}/{progress.total}
                    </span>
                  ) : null}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
