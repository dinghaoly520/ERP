'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { statusTone, type WorkbenchTone } from '@water-erp/shared';
import { TrendChip } from './trend-chip';
import { MiniSparkline } from '@/lib/hooks/use-trend';
import type { TrendDirection, TrendHistory } from '@/lib/hooks/use-trend';

interface MetricCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: WorkbenchTone;
  icon?: ReactNode;
  onClick?: () => void;
  footer?: ReactNode;
  className?: string;
  shimmer?: boolean;
  trendDirection?: TrendDirection;
  trendDelta?: number | null;
  trendHistory?: TrendHistory | null;
}

/* ── Count-up for a single number ── */
function useCountUp(target: number, duration = 700) {
  const [display, setDisplay] = useState(0);
  const raf = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const prevTarget = useRef(target);

  useEffect(() => {
    if (typeof target !== 'number' || isNaN(target)) return;
    const from = prevTarget.current !== target ? display : 0;
    prevTarget.current = target;
    if (target === 0 && from === 0) { setDisplay(0); return; }

    const animate = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out-back — slight overshoot then settle
      const c1 = 1.70158;
      const c3 = c1 + 1;
      const eased = 1 + c3 * Math.pow(progress - 1, 3) + c1 * Math.pow(progress - 1, 2);
      setDisplay(Math.round(from + (target - from) * Math.max(0, eased)));
      if (progress < 1) raf.current = requestAnimationFrame(animate);
      else setDisplay(target);
    };
    raf.current = requestAnimationFrame(animate);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, duration]);

  return display;
}

/* ── Smart value renderer: parses composite strings like "5/12" and animates each number ── */
function AnimatedValue({ value }: { value: ReactNode }) {
  // Pure number → count-up
  if (typeof value === 'number') {
    return <CountUpSpan target={value} />;
  }

  // String → parse and animate each numeric segment
  if (typeof value === 'string') {
    const parts = value.split(/(\d+)/g);
    return (
      <>
        {parts.map((part, i) =>
          /^\d+$/.test(part) ? (
            <CountUpSpan key={i} target={parseInt(part, 10)} />
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </>
    );
  }

  // Fallback: render as-is
  return <>{value}</>;
}

function CountUpSpan({ target }: { target: number }) {
  const animated = useCountUp(target);
  const [landed, setLanded] = useState(false);
  const prevAnimated = useRef(animated);

  useEffect(() => {
    if (animated === target && prevAnimated.current !== target) {
      setLanded(true);
      const t = setTimeout(() => setLanded(false), 400);
      return () => clearTimeout(t);
    }
    prevAnimated.current = animated;
  }, [animated, target]);

  return (
    <span className={cn('inline-block tabular-nums', landed && 'kpi-number-animate')}>
      {animated}
    </span>
  );
}

export function MetricCard({ label, value, hint, tone = 'blue', icon, onClick, footer, className, shimmer = false, trendDirection, trendDelta, trendHistory }: MetricCardProps) {
  const toneConfig = statusTone[tone];
  const Component = onClick ? 'button' : 'div';

  return (
    <Component
      onClick={onClick}
      className={cn(
        'neu-card card-enter group p-4 text-left',
        shimmer && 'kpi-card-shine',
        onClick && 'btn-press cursor-pointer',
        className,
      )}
    >
      {/* Content sits above the shimmer pseudo-element */}
      <div className="relative z-[1]">
        <div className="mb-2 flex items-start justify-between gap-3">
          <span className="text-xs font-bold text-[var(--muted-foreground)]">{label}</span>
          {icon && <span className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ color: toneConfig.color, backgroundColor: toneConfig.bg }}>{icon}</span>}
        </div>
        <div className="flex items-end justify-between gap-2">
          <span className="text-2xl font-black tracking-tight text-[var(--foreground)]">
            <AnimatedValue value={value} />
          </span>
          {trendHistory?.values && trendHistory.values.length >= 2 && (
            <MiniSparkline values={trendHistory.values} tone={tone} />
          )}
        </div>
        {hint && <p className="mt-0.5 text-xs leading-5 text-[var(--muted-foreground)]">{hint}</p>}
        {trendDelta != null && trendDelta !== 0 && trendDirection && (
          <TrendChip delta={trendDelta} direction={trendDirection} />
        )}
        {footer && <div className="mt-4 text-xs text-[var(--muted-foreground)]">{footer}</div>}
        {onClick && <ArrowRight className="mt-3 text-[var(--muted-foreground)] opacity-0 transition group-hover:opacity-100 group-hover:translate-x-0.5" size={16} />}
      </div>
    </Component>
  );
}
