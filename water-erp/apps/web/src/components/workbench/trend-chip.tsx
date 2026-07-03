import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TrendDirection } from '@/lib/hooks/use-trend';

export function TrendChip({ delta, direction }: { delta: number; direction: TrendDirection }) {
  if (delta === 0) return null;
  const up = delta > 0;
  const colorCls =
    direction === 'up-good' ? (up ? 'text-[var(--success)] bg-[var(--success)]/10 border-[var(--success)]/20' : 'text-[var(--muted-foreground)] bg-[var(--surface)] border-[var(--border)]')
    : direction === 'up-bad'  ? (up ? 'text-[var(--danger)] bg-[var(--danger)]/10 border-[var(--danger)]/20' : 'text-[var(--success)] bg-[var(--success)]/10 border-[var(--success)]/20')
    : 'text-[var(--muted-foreground)] bg-[var(--surface)] border-[var(--border)]';
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-extrabold tabular-nums', colorCls)}>
      <Icon size={10} strokeWidth={3} />
      比上次 {up ? '+' : ''}{delta}
    </span>
  );
}
