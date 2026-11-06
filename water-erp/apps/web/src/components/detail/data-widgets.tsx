'use client';

/**
 * 详情页数据微件（2026-11-06「数据鲜活」用户路线）：让关键数据自己成为视觉锚点——
 * 语义色环 + 中心 count-up 大数字 + 说明行。用于专家/供应商详情的等级、健康度、评分。
 * 约束：不加框线/不加大色块；环色走语义 CSS 变量；count-up 复用上传进度同源 hook
 * （reduced-motion 直跳终值）。
 */
import { useCountUp } from '@/lib/upload/use-count-up';

export type WidgetTone = 'green' | 'blue' | 'orange' | 'yellow' | 'red' | 'gray' | 'purple';

const TONE_CSS: Record<WidgetTone, string> = {
  green: 'var(--success)',
  blue: 'var(--accent)',
  orange: 'var(--warning)',
  yellow: 'var(--warning)',
  red: 'var(--danger)',
  gray: 'var(--muted-foreground)',
  purple: 'var(--accent-strong)',
};

/** 语义色圆环仪表：环长=pct，中心数字 count-up；caption 为环下说明行 */
export function RingGauge({
  pct,
  tone = 'blue',
  size = 56,
  label,
  display,
  suffix = '',
  caption,
}: {
  pct: number;
  tone?: WidgetTone;
  size?: number;
  /** 环上小标签（如「资质」），可省 */
  label?: string;
  /** 中心数字（数值则 count-up 播值） */
  display: number | string;
  suffix?: string;
  /** 环下说明（如「绿 9 · 临 1 · 过 0」） */
  caption?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const numeric = typeof display === 'number';
  const animated = useCountUp(numeric ? Math.round(display) : 0, 400);
  const color = TONE_CSS[tone] ?? TONE_CSS.blue;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex min-w-0 flex-col items-center gap-1" title={`${label ?? ''}${label ? ' ' : ''}${clamped}%`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="color-mix(in oklch, var(--muted-foreground) 15%, transparent)" strokeWidth={stroke} />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c - (c * clamped) / 100}
            style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.16,1,0.3,1)' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          <span className="font-mono text-[13px] font-black tabular-nums text-[var(--foreground)]">
            {numeric ? animated : display}{suffix}
          </span>
          {label && <span className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">{label}</span>}
        </div>
      </div>
      {caption && <span className="max-w-[120px] truncate text-[9px] font-semibold text-[var(--muted-foreground)]">{caption}</span>}
    </div>
  );
}

/** 等级（A-E）→ 分值（环 pct 用） */
export const GRADE_SCORE: Record<string, number> = { A: 95, B: 85, C: 75, D: 65, E: 50 };
