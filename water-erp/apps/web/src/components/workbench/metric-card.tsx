'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { statusTone, type WorkbenchTone } from '@/lib/workbench';

interface MetricCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: WorkbenchTone;
  icon?: ReactNode;
  onClick?: () => void;
  footer?: ReactNode;
  className?: string;
}

function useCountUp(target: number, duration = 500) {
  const [display, setDisplay] = useState(0);
  const raf = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof target !== 'number' || isNaN(target) || target === 0) {
      setDisplay(target);
      return;
    }
    const animate = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setDisplay(Math.round(target * eased));
      if (progress < 1) raf.current = requestAnimationFrame(animate);
      else setDisplay(target);
    };
    raf.current = requestAnimationFrame(animate);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, duration]);

  return display;
}

export function MetricCard({ label, value, hint, tone = 'blue', icon, onClick, footer, className }: MetricCardProps) {
  const toneConfig = statusTone[tone];
  const Component = onClick ? 'button' : 'div';
  const numericValue = typeof value === 'number' ? value : NaN;
  const animatedValue = useCountUp(numericValue);
  const displayValue = !isNaN(numericValue) ? animatedValue : value;

  return (
    <Component
      onClick={onClick}
      className={cn(
        'card-enter group rounded-2xl border bg-white p-4 text-left shadow-sm transition',
        'hover:-translate-y-0.5 hover:shadow-lg',
        onClick && 'btn-press',
        className
      )}
      style={{ borderColor: toneConfig.border }}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <span className="text-xs font-bold text-[#5a6d8a]">{label}</span>
        {icon && <span className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ color: toneConfig.color, backgroundColor: toneConfig.bg }}>{icon}</span>}
      </div>
      <div className="text-2xl font-black tracking-tight text-[#18243a] tabular-nums">{displayValue}</div>
      {hint && <p className="mt-0.5 text-xs leading-5 text-[#8a96aa]">{hint}</p>}
      {footer && <div className="mt-4 text-xs text-[#5a6d8a]">{footer}</div>}
      {onClick && <ArrowRight className="mt-3 text-[#8a96aa] opacity-0 transition group-hover:opacity-100 group-hover:translate-x-0.5" size={16} />}
    </Component>
  );
}
