'use client';

import { Medal } from 'lucide-react';

// ── 排名徽章 ──

export function RankBadge({ rank }: { rank: number }) {
  if (rank === 1)
    return (
      <span className="w-6 h-6 rounded-full bg-[oklch(0.92_0.09_85_/_0.55)] flex items-center justify-center text-[oklch(0.55_0.13_80)] text-xs font-semibold">
        <Medal size={12} />
      </span>
    );
  if (rank === 2)
    return (
      <span className="w-6 h-6 rounded-full bg-[oklch(0.92_0.015_264_/_0.7)] flex items-center justify-center text-[oklch(0.45_0.02_264)] text-xs font-semibold">
        <Medal size={12} />
      </span>
    );
  if (rank === 3)
    return (
      <span className="w-6 h-6 rounded-full bg-[oklch(0.9_0.07_60_/_0.45)] flex items-center justify-center text-[oklch(0.5_0.1_55)] text-xs font-semibold">
        <Medal size={12} />
      </span>
    );
  return (
    <span className="w-6 h-6 rounded-full bg-[oklch(0.92_0.008_264)] flex items-center justify-center text-[11px] font-semibold text-[var(--color-text-tertiary)]">
      {rank}
    </span>
  );
}
