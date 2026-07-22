'use client';

// ── 供应商横向选择条 — 替代原左侧 224px 固定面板，释放内容区宽度 ──

interface SupplierTabBarProps {
  suppliers: Array<{
    id: string;
    supplierName: string;
    decryptStatus: string;
    submitStatus?: string; // P2：用于「已撤回」提示
  }>;
  activeSupplier: string;
  onSelect: (supplierId: string) => void;
  conflictedSupplierIds: Set<string>;
  invalidSupplierIds?: Set<string>; // P2：废标供应商
  decryptLabel: Record<string, string>;
}

export function SupplierTabBar({
  suppliers,
  activeSupplier,
  onSelect,
  conflictedSupplierIds,
  invalidSupplierIds,
  decryptLabel,
}: SupplierTabBarProps) {
  if (suppliers.length === 0) return null;

  return (
    <div className="glass-card glass-card-purple rounded-xl flex-shrink-0 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5">
        {/* 标签 */}
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-tertiary)] shrink-0 mr-1">
          投标单位
        </span>
        <span className="text-[10px] font-semibold bg-[oklch(0.94_0.004_264)] text-[var(--color-text-tertiary)] px-1.5 py-0.5 rounded-full shrink-0">
          {suppliers.length}
        </span>

        {/* 分隔线 */}
        <span className="w-px h-4 bg-[oklch(0.91_0.006_264)] shrink-0" />

        {/* 供应商 pill 列表 */}
        <div className="flex items-center gap-1.5 overflow-x-auto flex-1" role="tablist">
          {suppliers.map((s) => {
            const isActive = s.id === activeSupplier;
            const isConflicted = conflictedSupplierIds.has(s.id);
            const statusColor =
              s.decryptStatus === 'SUCCESS'
                ? 'bg-[#11a874]'
                : s.decryptStatus === 'DANGER'
                  ? 'bg-[#e74c3c]'
                  : 'bg-[#f5a623]';

            return (
              <button
                key={s.id}
                onClick={() => onSelect(s.id)}
                role="tab"
                aria-selected={isActive}
                aria-current={isActive ? 'true' : undefined}
                className={`shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all ${
                  isActive
                    ? 'bg-blue-50 border border-[#bfdbfe] shadow-sm text-[var(--color-primary)] font-bold'
                    : 'text-[var(--color-text-secondary)] hover:bg-[oklch(0.992_0.003_264)] border border-transparent'
                }`}
              >
                {/* 解密状态点 */}
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor}`} />

                {/* 供应商名称 */}
                <span className="truncate max-w-[140px]">{s.supplierName}</span>

                {/* 已回避徽章 */}
                {isConflicted && (
                  <span className="text-[10px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded shrink-0">
                    已回避
                  </span>
                )}

                {/* P2：废标 / 已撤回徽章 */}
                {invalidSupplierIds?.has(s.id) && (
                  <span className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded shrink-0">
                    废标
                  </span>
                )}
                {s.submitStatus === '已撤回' && (
                  <span className="text-[10px] font-bold text-[oklch(0.55_0.01_264)] bg-[oklch(0.95_0.004_264)] px-1.5 py-0.5 rounded shrink-0">
                    已撤回
                  </span>
                )}

                {/* 解密状态文字（仅非 SUCCESS 时显示） */}
                {s.decryptStatus !== 'SUCCESS' && (
                  <span className="text-[10px] text-[var(--color-text-tertiary)] shrink-0">
                    {decryptLabel[s.decryptStatus] || s.decryptStatus}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
