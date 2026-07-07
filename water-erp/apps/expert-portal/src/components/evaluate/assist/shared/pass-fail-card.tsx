'use client';

import { CheckCircle, XCircle } from 'lucide-react';
import type { AiScoreItem } from '@water-erp/shared';

// ── Pass/Fail 审查卡片 ──

export function PassFailReviewCard({ item }: { item: AiScoreItem }) {
  const isPass = item.pass === true;
  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border ${
        isPass ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'
      }`}
    >
      <span
        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
          isPass ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
        }`}
      >
        {isPass ? <CheckCircle size={14} /> : <XCircle size={14} />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-sm text-[var(--color-text)]">{item.name}</span>
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              isPass ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
            }`}
          >
            {isPass ? '通过' : '不通过'}
          </span>
        </div>
        {item.reason && (
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">{item.reason}</p>
        )}
        {item.evidence && (
          <div className="mt-1.5 text-[11px] text-[var(--color-text-tertiary)]">
            <span className="font-medium">证据：</span>
            {item.evidence}
          </div>
        )}
      </div>
    </div>
  );
}
