import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TrendDirection } from '@/lib/hooks/use-trend';

export function TrendChip({ delta, direction }: { delta: number; direction: TrendDirection }) {
  if (delta === 0) return null;
  const up = delta > 0;
  const colorCls =
    direction === 'up-good' ? (up ? 'text-[#11a874] bg-[#11a87418] border-[#11a87430]' : 'text-[#5a6d8a] bg-[#f8fafc] border-[#e5ecf4]')
    : direction === 'up-bad'  ? (up ? 'text-[#e74c3c] bg-[#e74c3c18] border-[#e74c3c30]' : 'text-[#11a874] bg-[#11a87418] border-[#11a87430]')
    : 'text-[#5a6d8a] bg-[#f8fafc] border-[#e5ecf4]';
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-extrabold tabular-nums', colorCls)}>
      <Icon size={10} strokeWidth={3} />
      比上次 {up ? '+' : ''}{delta}
    </span>
  );
}
