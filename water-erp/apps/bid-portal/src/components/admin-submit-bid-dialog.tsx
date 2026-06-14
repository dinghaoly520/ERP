'use client';

import { useState } from 'react';
import { X, SendHorizonal } from 'lucide-react';
import { STAGE_LABEL } from '@water-erp/shared';

interface Props {
  open: boolean;
  projectId: string;
  projectStage: string;
  onClose: () => void;
  onSubmit: (supplierName: string) => void;
}

/** 允许代投标的阶段：下载期或投标期 */
const ALLOWED_STAGES = ['DOWNLOAD', 'SUBMIT'];

export default function AdminSubmitBidDialog({
  open,
  projectId,
  projectStage,
  onClose,
  onSubmit,
}: Props) {
  const [supplierName, setSupplierName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const allowed = ALLOWED_STAGES.includes(projectStage);
  const stageLabel = STAGE_LABEL[projectStage] ?? projectStage;

  const handleSubmit = () => {
    setError('');
    if (!supplierName.trim()) {
      setError('请填写供应商名称');
      return;
    }
    setSubmitting(true);
    try {
      onSubmit(supplierName.trim());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '提交失败');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white w-full max-w-[480px] border border-[oklch(0.91_0.006_264)] shadow-sm">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[oklch(0.91_0.006_264)]">
          <h2
            className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight"
            style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}
          >
            代供应商投标
          </h2>
          <button
            onClick={onClose}
            className="text-[oklch(0.62_0.008_264)] hover:text-[oklch(0.18_0.012_265)] transition-colors"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {!allowed ? (
            <div className="bg-[oklch(0.96_0.04_85)] border border-[oklch(0.88_0.06_82)] p-4">
              <div className="text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1">
                当前阶段不可投标
              </div>
              <p className="text-[13px] text-[oklch(0.18_0.012_265)] leading-relaxed">
                项目当前处于「{stageLabel}」阶段，仅可在
                <span className="font-semibold text-[oklch(0.30_0.08_250)]">下载期</span>
                或
                <span className="font-semibold text-[oklch(0.30_0.08_250)]">投标期</span>
                代为提交标书。
              </p>
            </div>
          ) : (
            <div>
              <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
                供应商名称 <span className="text-[oklch(0.50_0.18_22)]">*</span>
              </label>
              <input
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="例：四川省水利工程有限公司"
                autoFocus
                className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white
                  focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors
                  placeholder:text-[oklch(0.72_0.008_264)]"
              />
            </div>
          )}

          {error && (
            <div className="bg-[oklch(0.96_0.03_22)] border border-[oklch(0.88_0.06_22)] p-3 text-[12px] text-[oklch(0.50_0.18_22)]">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[oklch(0.91_0.006_264)] flex items-center justify-between">
          <p className="text-[11px] text-[oklch(0.62_0.008_264)]">
            回执编号将自动生成（格式：TB-YYYYMMDD-NNN）
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-[12px] font-semibold text-[oklch(0.55_0.01_264)] tracking-tight
                hover:text-[oklch(0.18_0.012_265)] transition-colors"
            >
              取消
            </button>
            {allowed && (
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex items-center gap-1.5 px-5 py-2 bg-[oklch(0.42_0.14_260)] text-white text-[12px]
                  font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] transition-colors disabled:opacity-50"
              >
                <SendHorizonal size={13} strokeWidth={2} />
                {submitting ? '提交中…' : '确认提交'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
