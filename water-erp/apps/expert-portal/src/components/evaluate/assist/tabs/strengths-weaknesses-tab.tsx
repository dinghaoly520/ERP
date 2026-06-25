'use client';

import { Lightbulb, TrendingUp, AlertTriangle, MessageSquare } from 'lucide-react';

// ── 维度映射 ──

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

// ── 正向依据 / 需关注事项 条目 ──

interface SwItem {
  dimension: string;
  title: string;
  detail: string;
  evidence?: string;
  impact?: string;
}

interface StrengthsWeaknessesTabProps {
  strengths?: SwItem[] | null;
  weaknesses?: SwItem[] | null;
  overallComment?: string;
  keyObservations?: string[];
}

function SwCard({
  item,
  type,
}: {
  item: SwItem;
  type: 'strength' | 'weakness';
}) {
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
          <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
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

      <p className="text-xs text-[var(--color-text-secondary)] ml-6 leading-relaxed">
        {item.detail}
      </p>

      {(item.evidence || item.impact) && (
        <div className="mt-2 ml-6 space-y-1">
          {item.evidence && (
            <div className="text-[11px] text-[var(--color-text-tertiary)]">
              <span className="font-medium">证据：</span>
              {item.evidence}
            </div>
          )}
          {item.impact && (
            <div
              className={`text-[11px] font-medium ${isStrength ? 'text-emerald-600' : 'text-amber-600'}`}
            >
              <span>{isStrength ? '影响：' : '风险：'}</span>
              {item.impact}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function StrengthsWeaknessesTab({
  strengths,
  weaknesses,
  overallComment,
  keyObservations,
}: StrengthsWeaknessesTabProps) {
  const hasStrengths = strengths && strengths.length > 0;
  const hasWeaknesses = weaknesses && weaknesses.length > 0;
  const hasData = hasStrengths || hasWeaknesses || overallComment;

  if (!hasData) {
    return (
      <div className="glass-card rounded-xl p-8 text-center">
        <Lightbulb size={32} strokeWidth={1} className="text-[oklch(0.75_0.008_264)] mx-auto mb-3" />
        <p className="text-sm text-[var(--color-text-secondary)]">暂无竞争分析数据</p>
        <p className="text-xs text-[var(--color-text-tertiary)] mt-1 max-w-md mx-auto">
          AI 竞争分析在所有供应商 per-item 评分完成后生成，提供正向依据（优势）与需关注事项（不足）的结构化分析，以及关键观察点与综合评语。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 关键观察点 */}
      {keyObservations && keyObservations.length > 0 && (
        <div className="glass-card glass-card-blue rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
            <h3 className="font-bold text-sm text-[var(--color-primary)]">关键观察</h3>
          </div>
          <ul className="space-y-1.5">
            {keyObservations.map((obs, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-[var(--color-text)]">
                <span className="text-[var(--color-primary)] font-bold mt-0.5 shrink-0">
                  {i + 1}.
                </span>
                {obs}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 双列：正向依据 + 需关注事项 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 正向依据 */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={14} strokeWidth={1.5} className="text-emerald-500" />
            <h3 className="font-bold text-sm text-[var(--color-text)]">
              正向依据
              {hasStrengths && (
                <span className="text-xs text-[var(--color-text-tertiary)] ml-1 font-normal">
                  （{strengths!.length} 项）
                </span>
              )}
            </h3>
          </div>
          {hasStrengths ? (
            <div className="space-y-2">
              {strengths!.map((s, i) => (
                <SwCard key={i} item={s} type="strength" />
              ))}
            </div>
          ) : (
            <div className="glass-card glass-card-lighter rounded-lg p-4 text-center text-xs text-[var(--color-text-tertiary)]">
              暂无正向依据
            </div>
          )}
        </div>

        {/* 需关注事项 */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={14} strokeWidth={1.5} className="text-amber-500" />
            <h3 className="font-bold text-sm text-[var(--color-text)]">
              需关注事项
              {hasWeaknesses && (
                <span className="text-xs text-[var(--color-text-tertiary)] ml-1 font-normal">
                  （{weaknesses!.length} 项）
                </span>
              )}
            </h3>
          </div>
          {hasWeaknesses ? (
            <div className="space-y-2">
              {weaknesses!.map((w, i) => (
                <SwCard key={i} item={w} type="weakness" />
              ))}
            </div>
          ) : (
            <div className="glass-card glass-card-lighter rounded-lg p-4 text-center text-xs text-[var(--color-text-tertiary)]">
              暂无关注事项
            </div>
          )}
        </div>
      </div>

      {/* 综合评语 */}
      {overallComment && (
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
            <h3 className="font-bold text-sm text-[var(--color-text)]">综合评语</h3>
          </div>
          <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
            {overallComment}
          </p>
        </div>
      )}
    </div>
  );
}
