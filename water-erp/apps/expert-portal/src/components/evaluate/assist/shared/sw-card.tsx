'use client';

import { TrendingUp, AlertCircle } from 'lucide-react';

export interface SwItem {
  dimension: string;
  title: string;
  detail: string;
  evidence?: string;
  impact?: string;
}

// ── 维度徽章颜色 ──

const DIMENSION_LABEL: Record<string, string> = {
  qualification: '资质',
  technical: '技术',
  commercial: '商务',
  price: '价格',
  risk: '风险',
};

const DIMENSION_COLOR: Record<string, string> = {
  qualification: '#064ea2',
  technical: '#11a874',
  commercial: '#f5a623',
  price: '#e74c3c',
  risk: '#8b5cf6',
};

// ── SW 卡片（正向依据/需关注事项）──

export function SwCard({ item, type }: { item: SwItem; type: 'strength' | 'weakness' }) {
  const isStrength = type === 'strength';
  const color = DIMENSION_COLOR[item.dimension] ?? '#0b63ce';

  return (
    <div
      className={`glass-card glass-card-lighter rounded-lg p-3.5 border-l-2 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
        isStrength ? 'border-l-emerald-400' : 'border-l-amber-400'
      }`}
    >
      <div className="flex items-start gap-2 mb-1.5">
        {isStrength ? (
          <TrendingUp size={14} className="text-emerald-500 shrink-0 mt-0.5" />
        ) : (
          <AlertCircle size={14} className="text-amber-500 shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <span
            className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded mb-1"
            style={{ color, background: `${color}15` }}
          >
            {DIMENSION_LABEL[item.dimension] ?? item.dimension}
          </span>
          <div className="font-semibold text-sm text-[var(--color-text)]">{item.title}</div>
        </div>
      </div>
      <p className="text-xs text-[var(--color-text-secondary)] ml-6 leading-relaxed">{item.detail}</p>
      {(item.evidence || item.impact) && (
        <div className="mt-2 ml-6 space-y-1">
          {item.evidence && (
            <div className="text-[11px] text-[var(--color-text-tertiary)]">
              <span className="font-medium">证据：</span>
              {item.evidence}
            </div>
          )}
          {item.impact && (
            <div className={`text-[11px] font-medium ${isStrength ? 'text-emerald-600' : 'text-amber-600'}`}>
              <span>{isStrength ? '影响：' : '风险：'}</span>
              {item.impact}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
