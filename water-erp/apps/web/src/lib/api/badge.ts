import { api } from '../api';

export type BadgeLevel = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface BadgeItem {
  code: string;
  name: string;
  category: string;
  description: string;
  iconKey: string;
  unit: string;
  currentValue: number;
  currentLevel: BadgeLevel | null;
  awardedLevels: Record<string, string>;
  thresholds: Record<string, number>;
}

export async function fetchMyBadges(): Promise<BadgeItem[]> {
  return api.get<BadgeItem[]>('/badge/my');
}

export const LEVEL_COLOR: Record<BadgeLevel, string> = {
  bronze: 'oklch(0.65 0.1 50)',
  silver: 'oklch(0.78 0.02 270)',
  gold: 'oklch(0.85 0.12 85)',
  platinum: 'oklch(0.92 0.04 270)',
};

export const LEVEL_LABEL: Record<BadgeLevel, string> = {
  bronze: '铜',
  silver: '银',
  gold: '金',
  platinum: '铂金',
};

/** 给定值和阈值，返回下一等级 + 还差多少 + 进度 */
export function getNextLevel(
  value: number,
  thresholds: Record<string, number>,
): { level: BadgeLevel; remaining: number; progressPct: number } | null {
  const order: BadgeLevel[] = ['bronze', 'silver', 'gold', 'platinum'];
  for (const level of order) {
    const t = thresholds[level];
    if (t != null && value < t) {
      const idx = order.indexOf(level);
      const prevT = idx > 0 ? thresholds[order[idx - 1]] : 0;
      const span = t - (prevT ?? 0);
      const done = value - (prevT ?? 0);
      return {
        level,
        remaining: t - value,
        progressPct: span > 0 ? Math.min(100, Math.round((done / span) * 100)) : 0,
      };
    }
  }
  return null;
}
