'use client';

import { Medal } from 'lucide-react';

// ── 排名徽章 ──

export function RankBadge({ rank }: { rank: number }) {
  if (rank === 1)
    return (
      <span className="w-6 h-6 rounded-full bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center text-white text-xs font-bold shadow-sm">
        <Medal size={12} />
      </span>
    );
  if (rank === 2)
    return (
      <span className="w-6 h-6 rounded-full bg-gradient-to-br from-slate-300 to-slate-400 flex items-center justify-center text-white text-xs font-bold shadow-sm">
        <Medal size={12} />
      </span>
    );
  if (rank === 3)
    return (
      <span className="w-6 h-6 rounded-full bg-gradient-to-br from-amber-600 to-amber-700 flex items-center justify-center text-white text-xs font-bold shadow-sm">
        <Medal size={12} />
      </span>
    );
  return (
    <span className="w-6 h-6 rounded-full bg-[oklch(0.92_0.008_264)] flex items-center justify-center text-[11px] font-bold text-[var(--color-text-tertiary)]">
      {rank}
    </span>
  );
}
