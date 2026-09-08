'use client';

/**
 * workspace 内部共享小组件（F19-B 合并清理）：
 * - Ring：迷你环形进度（合并 evaluation-view.Ring 与 ai-analysis-card.ProgressRing 两份同构实现）
 * - FeedbackBanner + FEEDBACK_AUTOHIDE_MS：feedback 横幅（合并三份 12 行同构 JSX，色调走 .bid-alert）
 */

import { AlertTriangle, CheckCircle2 } from 'lucide-react';

/* ── 迷你环形进度 ── */
export function Ring({
  pct, size = 34, stroke = 4, color, textColorSize = 9, trackColor = 'oklch(0.92 0.008 258)',
}: {
  pct: number; size?: number; stroke?: number; color: string; textColorSize?: number; trackColor?: string;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * Math.min(1, pct / 100);
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" className="transition-all duration-700"
        />
      </svg>
      <span className="absolute font-extrabold tabular-nums" style={{ color, fontSize: textColorSize }}>{Math.round(pct)}</span>
    </div>
  );
}

/* ── feedback 横幅 ── */
export interface Feedback { text: string; tone: 'ok' | 'err' }

/** 横幅自动消失时长（原三处三个值 3000/2800/2800，统一 2800） */
export const FEEDBACK_AUTOHIDE_MS = 2800;

export function FeedbackBanner({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) return null;
  return (
    <div className={`bid-alert mb-3 flex items-center gap-2 ${feedback.tone === 'ok' ? 'bid-alert--success' : 'bid-alert--danger'}`}>
      {feedback.tone === 'ok' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
      {feedback.text}
    </div>
  );
}
