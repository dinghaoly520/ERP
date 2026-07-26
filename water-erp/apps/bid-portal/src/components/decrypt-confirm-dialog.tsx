'use client';

import { useState } from 'react';
import { AlertTriangle, Unlock, Loader, ShieldAlert, X } from 'lucide-react';

interface Props {
  open: boolean;
  suppliers: { id: string; name: string }[];
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export default function DecryptConfirmDialog({ open, suppliers, loading, onConfirm, onClose }: Props) {
  const [acknowledged, setAcknowledged] = useState(false);

  if (!open || suppliers.length === 0) return null;

  const isBulk = suppliers.length > 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm" onClick={onClose} />
      <div className="bid-dialog relative mx-4 w-full max-w-[min(480px,92vw)]" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-5">
          <h3 className="flex items-center gap-2 font-[family-name:var(--font-display)] text-[15px] font-semibold tracking-tight text-[color:var(--foreground)]">
            <ShieldAlert size={16} className="text-[var(--danger)]" />
            确认解密
          </h3>
          <button type="button" onClick={onClose} className="neu-btn-xs" aria-label="关闭"><X size={15} /></button>
        </div>

        <hr className="wb-section-rule mx-6" />

        {/* Body */}
        <div className="space-y-4 px-6 py-5">
          {/* Warning — 无边框，warning 色调底 */}
          <div className="flex items-start gap-2.5 rounded-xl bg-[oklch(0.78_0.12_83_/_0.16)] p-3">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[oklch(0.46_0.11_65)]" />
            <div className="space-y-1 text-[12px] leading-relaxed tracking-tight text-[oklch(0.46_0.11_65)]">
              <p className="font-bold">解密操作不可逆</p>
              <p>解密后投标文件内容将对评标专家可见，该操作将被记录在监督日志中，无法撤回。</p>
            </div>
          </div>

          {/* Supplier list — 内凹面，无外侧框线，内部 hairline 分隔 */}
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
              {isBulk ? `待解密供应商（共 ${suppliers.length} 家）` : '待解密供应商'}
            </label>
            <div className="max-h-[180px] divide-y divide-[oklch(0.6_0.04_258_/_0.12)] overflow-y-auto rounded-xl bg-[oklch(0.99_0.004_258)] shadow-[inset_2px_2px_5px_oklch(0.55_0.03_258_/_0.1),inset_-2px_-2px_5px_oklch(1_0_0_/_0.6)]">
              {suppliers.slice(0, 5).map(s => (
                <div key={s.id} className="flex items-center gap-2 px-3 py-2 text-[13px] tracking-tight text-[color:var(--foreground)]">
                  <Unlock size={12} className="shrink-0 text-[color:var(--muted-foreground)]" />
                  <span>{s.name}</span>
                </div>
              ))}
              {suppliers.length > 5 && (
                <div className="px-3 py-2 text-[12px] tracking-tight text-[color:var(--muted-foreground)]">
                  ...共 {suppliers.length} 家
                </div>
              )}
            </div>
          </div>

          {/* Acknowledgment checkbox */}
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={e => setAcknowledged(e.target.checked)}
              className="neu-checkbox mt-0.5"
            />
            <span className="text-[12px] leading-relaxed tracking-tight text-[color:var(--muted-foreground)]">
              我已知晓解密操作不可逆，确认对以上供应商执行解密
            </span>
          </label>
        </div>

        <hr className="wb-section-rule mx-6" />

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
          <span className="text-[11px] font-semibold tracking-tight text-[var(--danger)]">解密后不可撤回</span>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="neu-btn-soft h-[38px]">取消</button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={!acknowledged || loading}
              className="neu-btn-primary is-danger !h-[38px] disabled:opacity-50"
            >
              {loading && <Loader size={12} className="animate-spin" />}
              {loading ? '解密中…' : isBulk ? `全部解密 (${suppliers.length})` : '确认解密'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
