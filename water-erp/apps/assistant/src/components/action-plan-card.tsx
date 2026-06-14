'use client';

import { ShieldAlert, Check, X } from 'lucide-react';

const RISK_COLORS: Record<
  string,
  { border: string; bg: string; text: string }
> = {
  low: {
    border: 'var(--color-success)',
    bg: 'oklch(0.54 0.16 158 / 0.1)',
    text: 'var(--color-success)',
  },
  medium: {
    border: 'var(--color-warning)',
    bg: 'oklch(0.64 0.16 82 / 0.1)',
    text: 'var(--color-warning)',
  },
  high: {
    border: 'var(--color-danger)',
    bg: 'oklch(0.50 0.18 22 / 0.1)',
    text: 'var(--color-danger)',
  },
};

const RISK_LABELS: Record<string, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
};

export function ActionPlanCard({
  plan,
  onConfirm,
  onCancel,
}: {
  plan: {
    actionId: string;
    title: string;
    riskLevel: string;
    changes: unknown[];
  };
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const colors = RISK_COLORS[plan.riskLevel] || RISK_COLORS.low;

  return (
    <div
      className="rounded-lg border p-4"
      style={{ borderColor: colors.border }}
    >
      <div className="flex items-center gap-2 mb-3">
        <ShieldAlert size={16} style={{ color: colors.text }} />
        <span className="font-semibold text-sm">{plan.title}</span>
        <span
          className="text-xs px-2 py-0.5 rounded"
          style={{ background: colors.bg, color: colors.text }}
        >
          {RISK_LABELS[plan.riskLevel] || plan.riskLevel}
        </span>
      </div>
      <div
        className="text-xs space-y-1 mb-3"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        {(plan.changes as Array<{ field: string; from: string; to: string }>).map(
          (c, i) => (
            <div key={i}>
              • {c.field}: <s>{c.from}</s> → <strong>{c.to}</strong>
            </div>
          ),
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onConfirm(plan.actionId)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-white cursor-pointer"
          style={{ background: 'var(--color-blue-700)' }}
        >
          <Check size={14} /> 确认执行
        </button>
        <button
          onClick={() => onCancel(plan.actionId)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs cursor-pointer"
          style={{
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-secondary)',
          }}
        >
          <X size={14} /> 取消
        </button>
      </div>
    </div>
  );
}
