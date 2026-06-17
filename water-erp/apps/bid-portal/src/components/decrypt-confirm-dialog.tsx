'use client';

import { useState } from 'react';
import { AlertTriangle, Unlock, Loader, ShieldAlert } from 'lucide-react';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(15,18,28,0.45)' }}>
      <div className="bg-white border border-[oklch(0.91_0.006_264)] w-full max-w-md mx-4">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[oklch(0.91_0.006_264)] flex items-center justify-between">
          <h3
            className="text-[15px] font-semibold tracking-tight text-[oklch(0.18_0.012_265)] flex items-center gap-2"
            style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}
          >
            <ShieldAlert size={16} className="text-[#e74c3c]" />
            确认解密
          </h3>
          <button onClick={onClose} className="text-[12px] text-[oklch(0.55_0.01_264)] hover:text-[oklch(0.18_0.012_265)] tracking-tight">
            取消
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Warning */}
          <div className="rounded-lg border border-[#fcd34d] bg-[#fffbeb] p-3 flex items-start gap-2.5">
            <AlertTriangle size={16} className="text-[#92400e] mt-0.5 shrink-0" />
            <div className="space-y-1 text-[12px] text-[#92400e] tracking-tight leading-relaxed">
              <p className="font-bold">解密操作不可逆</p>
              <p>解密后投标文件内容将对评标专家可见，该操作将被记录在监督日志中，无法撤回。</p>
            </div>
          </div>

          {/* Supplier list */}
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-[oklch(0.55_0.01_264)] mb-2">
              {isBulk ? `待解密供应商（共 ${suppliers.length} 家）` : '待解密供应商'}
            </label>
            <div className="border border-[oklch(0.88_0.008_264)] divide-y divide-[oklch(0.94_0.004_264)] max-h-[180px] overflow-y-auto">
              {suppliers.slice(0, 5).map(s => (
                <div key={s.id} className="flex items-center gap-2 px-3 py-2 text-[13px] text-[oklch(0.18_0.012_265)] tracking-tight">
                  <Unlock size={12} className="text-[oklch(0.55_0.01_264)] shrink-0" />
                  <span>{s.name}</span>
                </div>
              ))}
              {suppliers.length > 5 && (
                <div className="px-3 py-2 text-[12px] text-[oklch(0.55_0.01_264)] tracking-tight">
                  ...共 {suppliers.length} 家
                </div>
              )}
            </div>
          </div>

          {/* Acknowledgment checkbox */}
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={e => setAcknowledged(e.target.checked)}
              className="mt-0.5 accent-[oklch(0.42_0.14_260)]"
            />
            <span className="text-[12px] text-[oklch(0.55_0.01_264)] tracking-tight leading-relaxed">
              我已知晓解密操作不可逆，确认对以上供应商执行解密
            </span>
          </label>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[oklch(0.91_0.006_264)] flex items-center justify-between">
          <span className="text-[11px] text-[#e74c3c] tracking-tight font-semibold">解密后不可撤回</span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-[12px] text-[oklch(0.55_0.01_264)] hover:text-[oklch(0.18_0.012_265)] tracking-tight"
            >
              取消
            </button>
            <button
              onClick={onConfirm}
              disabled={!acknowledged || loading}
              className="px-4 py-2 bg-[#e74c3c] text-white text-[12px] font-semibold tracking-tight hover:bg-[#c0392b] transition-colors disabled:opacity-50 flex items-center gap-1.5"
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
