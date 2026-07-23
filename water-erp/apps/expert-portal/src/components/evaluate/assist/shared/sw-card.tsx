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
  qualification: 'var(--accent-strong)',
  technical: 'var(--success)',
  commercial: 'var(--warning)',
  price: 'var(--danger)',
  risk: 'oklch(0.55 0.16 300)',
};

// ── SW 卡片（正向依据/需关注事项）— cgzxui 新拟态 + 左侧语义色标 ──

export function SwCard({ item, type }: { item: SwItem; type: 'strength' | 'weakness' }) {
  const isStrength = type === 'strength';
  const color = DIMENSION_COLOR[item.dimension] ?? 'var(--accent)';

  return (
    <div className="neu-card relative !rounded-[14px] p-3.5">
      {/* 左侧语义色标（正向绿 / 关注橙）*/}
      <span
        className={`absolute bottom-3 left-0 top-3 w-0.5 rounded-full ${
          isStrength ? 'bg-[var(--success)]' : 'bg-[var(--warning)]'
        }`}
      />
      <div className="mb-1.5 flex items-start gap-2">
        {isStrength ? (
          <TrendingUp size={14} className="mt-0.5 shrink-0 text-[var(--success)]" />
        ) : (
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-[var(--warning)]" />
        )}
        <div className="min-w-0 flex-1">
          <span className="exp-pill mb-1" style={{ '--c': color } as React.CSSProperties}>
            {DIMENSION_LABEL[item.dimension] ?? item.dimension}
          </span>
          <div className="text-sm font-semibold text-[var(--foreground)]">{item.title}</div>
        </div>
      </div>
      <p className="ml-6 text-xs leading-relaxed text-[var(--muted-foreground)]">{item.detail}</p>
      {(item.evidence || item.impact) && (
        <div className="ml-6 mt-2 space-y-1">
          {item.evidence && (
            <div className="text-[11px] text-[var(--muted-foreground)]">
              <span className="font-medium">证据：</span>
              {item.evidence}
            </div>
          )}
          {item.impact && (
            <div className={`text-[11px] font-medium ${isStrength ? 'text-[var(--success)]' : 'text-[var(--warning)]'}`}>
              <span>{isStrength ? '影响：' : '风险：'}</span>
              {item.impact}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
