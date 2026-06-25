'use client';

import { AlertCircle } from 'lucide-react';
import type { AssistData } from '@water-erp/shared';

interface ConcordanceTabProps {
  concordance: AssistData['concordance'];
  concordanceStatus?: string;
}

interface CheckItem {
  label?: string;
  field?: string;
  systemValue?: unknown;
  docValue?: unknown;
  status?: string;
  severity?: string;
  note?: string;
}

const statusConfig: Record<string, { label: string; bg: string; text: string; dot: string; border: string }> = {
  conflict: {
    label: '冲突',
    bg: 'bg-red-50',
    text: 'text-red-700',
    dot: 'bg-red-500',
    border: 'border-red-200',
  },
  minor_diff: {
    label: '轻微差异',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    dot: 'bg-amber-500',
    border: 'border-amber-200',
  },
  consistent: {
    label: '一致',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    dot: 'bg-emerald-500',
    border: 'border-emerald-200',
  },
};

export function ConcordanceTab({ concordance, concordanceStatus }: ConcordanceTabProps) {
  if (!concordance || !Array.isArray(concordance as any[])) {
    return (
      <div className="glass-card rounded-xl p-8 text-center">
        <AlertCircle size={32} strokeWidth={1} className="text-[oklch(0.75_0.008_264)] mx-auto mb-3" />
        <p className="text-sm text-[var(--color-text-secondary)]">暂无一致性校验数据</p>
        <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
          双源一致性校验在 AI 分析完成后生成，用于核对系统登记数据与投标文件 OCR 数据的一致性
        </p>
      </div>
    );
  }

  const checks = concordance as unknown as CheckItem[];
  const conflicts = checks.filter((c) => c.status === 'conflict');
  const warnings = checks.filter((c) => c.status === 'minor_diff');
  const consistent = checks.filter((c) => c.status === 'consistent');
  const sorted = [...checks]
    .filter((c) => c.status !== 'insufficient_data')
    .sort((a, b) => {
      const order = { conflict: 0, minor_diff: 1, consistent: 2 };
      return (order[a.status as keyof typeof order] ?? 3) - (order[b.status as keyof typeof order] ?? 3);
    });

  return (
    <div className="glass-card rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <AlertCircle size={16} strokeWidth={1.5} className="text-[var(--color-primary)]" />
        <h3 className="font-bold text-[var(--color-text)]">双源一致性校验</h3>
        <span className="text-xs text-[var(--color-text-tertiary)] ml-1">系统登记数据 vs 标书 OCR 提取</span>
      </div>

      {/* 统计栏 */}
      <div className="flex flex-wrap gap-4 mb-4 p-3 rounded-lg" style={{ background: 'oklch(0.982 0.003 264)' }}>
        <span className="text-sm font-semibold text-[var(--color-danger)]">
          <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-danger)] mr-1.5" />
          冲突 {conflicts.length}
        </span>
        <span className="text-sm font-semibold text-[var(--color-warning)]">
          <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-warning)] mr-1.5" />
          轻微差异 {warnings.length}
        </span>
        <span className="text-sm font-semibold text-[var(--color-success)]">
          <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-success)] mr-1.5" />
          一致 {consistent.length}
        </span>
        {concordanceStatus && (
          <span className="text-sm text-[var(--color-text-secondary)] ml-auto">
            综合状态：
            <span className={`font-semibold ${
              concordanceStatus === 'consistent' ? 'text-[var(--color-success)]' :
              concordanceStatus === 'conflict' ? 'text-[var(--color-danger)]' :
              'text-[var(--color-warning)]'
            }`}>
              {concordanceStatus === 'consistent' ? '一致' :
               concordanceStatus === 'conflict' ? '存在冲突' :
               concordanceStatus === 'minor_diff' ? '轻微差异' : '数据不足'}
            </span>
          </span>
        )}
      </div>

      {/* 字段明细（冲突优先排序） */}
      <div className="space-y-2">
        {sorted.map((check, i) => {
          const cfg = statusConfig[check.status ?? ''] ?? statusConfig.consistent;
          return (
            <div key={i} className={`${cfg.bg} ${cfg.border} border rounded-lg p-3`}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${cfg.dot}`} />
                <span className="font-bold text-sm text-[var(--color-text)]">
                  {check.label || check.field}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full ml-auto font-medium ${cfg.bg} ${cfg.text}`}>
                  {cfg.label}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs ml-4">
                <div>
                  <span className="text-[var(--color-text-tertiary)]">系统数据：</span>
                  <span className="text-[var(--color-text)] font-medium">
                    {check.systemValue != null ? String(check.systemValue) : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--color-text-tertiary)]">标书 OCR：</span>
                  <span className="text-[var(--color-text)] font-medium">
                    {check.docValue != null ? String(check.docValue) : '—'}
                  </span>
                </div>
              </div>
              {check.note && (
                <div className="text-xs text-[var(--color-text-tertiary)] mt-1 ml-4">{check.note}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
