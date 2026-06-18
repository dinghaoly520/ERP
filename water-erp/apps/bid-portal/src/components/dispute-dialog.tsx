'use client';

import { useState } from 'react';
import { X, Shield } from 'lucide-react';

interface Props {
  open: boolean;
  recordId: string;
  supplierName: string;
  objectionReason?: string;
  onClose: () => void;
  onResolved: (result: string, confirm: boolean) => Promise<void>;
}

export default function DisputeDialog({ open, recordId, supplierName, objectionReason, onClose, onResolved }: Props) {
  const [result, setResult] = useState('经核实，开标信息无误。');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const handleAction = async (confirm: boolean) => {
    setError('');
    setSubmitting(true);
    try {
      await onResolved(result, confirm);
      onClose();
    } catch (e: any) {
      setError(e.message || '处理失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="glass-card glass-card-deeper glass-card-rose w-full max-w-[460px] shadow-sm rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[oklch(0.91_0.006_264)]">
          <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight"
            style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
            处理开标异议
          </h2>
          <button onClick={onClose} className="text-[oklch(0.62_0.008_264)] hover:text-[oklch(0.18_0.012_265)] transition-colors">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="flex items-center gap-2 text-[12px]">
            <Shield size={13} strokeWidth={1.5} className="text-[oklch(0.50_0.18_22)]" />
            <span className="text-[oklch(0.55_0.01_264)]">供应商：</span>
            <span className="font-semibold text-[oklch(0.18_0.012_265)]">{supplierName}</span>
          </div>
          {objectionReason && (
            <div className="bg-[oklch(0.96_0.04_85)] border border-[oklch(0.88_0.06_82)] p-3">
              <div className="text-[11px] font-semibold text-[oklch(0.50_0.18_22)] uppercase tracking-wider mb-1">异议内容</div>
              <div className="text-[13px] text-[oklch(0.18_0.012_265)]">{objectionReason}</div>
            </div>
          )}
          <div>
            <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
              处理结果说明
            </label>
            <textarea
              value={result}
              onChange={e => setResult(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white/65 focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors resize-none"
            />
          </div>
          {error && (
            <div className="bg-[oklch(0.96_0.03_22)] border border-[oklch(0.88_0.06_22)] p-3 text-[12px] text-[oklch(0.50_0.18_22)]">
              {error}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-[oklch(0.91_0.006_264)] flex items-center justify-between">
          <span className="text-[11px] text-[oklch(0.62_0.008_264)]">
            选择处理方式：
          </span>
          <div className="flex items-center gap-3">
            <button onClick={() => handleAction(false)} disabled={submitting}
              className="px-4 py-2 text-[12px] font-semibold text-[oklch(0.50_0.18_22)] tracking-tight border border-[oklch(0.88_0.06_22)] hover:bg-[oklch(0.96_0.03_22)] transition-colors disabled:opacity-50">
              异议成立，退回
            </button>
            <button onClick={() => handleAction(true)} disabled={submitting}
              className="px-4 py-2 bg-[oklch(0.42_0.14_260)] text-white text-[12px] font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] transition-colors disabled:opacity-50">
              确认无误，维持
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
