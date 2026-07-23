'use client';

// ── 供应商横向选择条（cgzxui 新拟态）—— .exp-supplier-bar + .exp-supplier-tile ──
// 替代原左侧 224px 固定面板，释放内容区宽度；平板横滑，磁贴凸起 → 选中内凹。

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
    <div className="flex flex-shrink-0 items-start gap-2.5">
      {/* 固定标签 + 计数 */}
      <div className="flex h-11 flex-shrink-0 items-center gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
          投标单位
        </span>
        <span className="neu-tab-count">{suppliers.length}</span>
      </div>

      {/* 供应商磁贴横滑条 */}
      <div className="exp-supplier-bar min-w-0 flex-1" role="tablist">
        {suppliers.map((s) => {
          const isActive = s.id === activeSupplier;
          const isConflicted = conflictedSupplierIds.has(s.id);
          // --sup-color 驱动选中磁贴的色调（解密成功绿 / 失败红 / 其他橙）
          const supColor =
            s.decryptStatus === 'SUCCESS'
              ? 'var(--success)'
              : s.decryptStatus === 'DANGER'
                ? 'var(--danger)'
                : 'var(--warning)';

          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              role="tab"
              aria-selected={isActive}
              aria-current={isActive ? 'true' : undefined}
              className={`exp-supplier-tile !py-3 ${isActive ? 'is-active' : ''}`}
              style={{ '--sup-color': supColor } as React.CSSProperties}
            >
              {/* 解密状态点 */}
              <span className="exp-pill-dot" style={{ '--c': supColor } as React.CSSProperties} />

              {/* 供应商名称 */}
              <span
                className={`max-w-[150px] truncate text-sm font-semibold ${
                  isActive ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)]'
                }`}
              >
                {s.supplierName}
              </span>

              {/* 已回避徽章 */}
              {isConflicted && (
                <span className="exp-pill" style={{ '--c': 'var(--danger)' } as React.CSSProperties}>
                  已回避
                </span>
              )}

              {/* P2：废标 / 已撤回徽章 */}
              {invalidSupplierIds?.has(s.id) && (
                <span className="exp-pill" style={{ '--c': 'var(--danger)' } as React.CSSProperties}>
                  废标
                </span>
              )}
              {s.submitStatus === '已撤回' && (
                <span className="exp-pill" style={{ '--c': 'var(--muted-foreground)' } as React.CSSProperties}>
                  已撤回
                </span>
              )}

              {/* 解密状态文字（仅非 SUCCESS 时显示） */}
              {s.decryptStatus !== 'SUCCESS' && (
                <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">
                  {decryptLabel[s.decryptStatus] || s.decryptStatus}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
