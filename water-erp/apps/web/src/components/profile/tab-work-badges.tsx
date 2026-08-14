'use client';

import { useEffect, useState } from 'react';
import * as Lucide from 'lucide-react';
import { Award, Loader2, AlertCircle, Lock } from 'lucide-react';
import {
  fetchMyBadges, LEVEL_COLOR, LEVEL_LABEL, getNextLevel,
  type BadgeItem, type BadgeLevel,
} from '@/lib/api/badge';

function BadgeIcon({ iconKey, size = 24 }: { iconKey: string; size?: number }) {
  const Comp = (Lucide as any)[iconKey] as React.ComponentType<{ size?: number; strokeWidth?: number }> | undefined;
  if (!Comp) return <Award size={size} strokeWidth={1.5} />;
  return <Comp size={size} strokeWidth={1.5} />;
}

/** 格式化达成日期 */
function formatAchievedDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch { return ''; }
}

/** 单个硬币单元 */
function BadgeCoin({ badge }: { badge: BadgeItem }) {
  const level = badge.currentLevel;
  const next = getNextLevel(badge.currentValue, badge.thresholds);
  const unlocked = level !== null;
  const [hovered, setHovered] = useState(false);

  const color = level ? LEVEL_COLOR[level as BadgeLevel] : 'oklch(0.6 0.01 258)';
  const opacity = unlocked ? 1 : 0.5;

  return (
    <div
      className="group flex flex-col items-center gap-2"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* ══ 硬币主体（72×72）══ */}
      <div className="relative" style={{ opacity, transition: 'transform 0.3s ease', transform: hovered ? 'translateY(-2px)' : 'none' }}>
        {/* 外圈装饰环（金属硬币齿纹感）— 仅已解锁显示 */}
        {unlocked && (
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 72 72" style={{ pointerEvents: 'none' }}>
            <circle cx="36" cy="36" r="35" fill="none"
              stroke={color} strokeWidth="0.8"
              strokeDasharray="1.5 2.5" opacity="0.5" />
          </svg>
        )}

        {/* 硬币本体 — 径向渐变 + 双层阴影浮雕 */}
        <div
          className="relative flex h-[72px] w-[72px] items-center justify-center rounded-full"
          style={{
            background: unlocked
              ? `radial-gradient(circle at 32% 28%, oklch(1 0 0 / 0.55) 0%, ${color} 55%, oklch(0.4 0.05 258) 100%)`
              : 'radial-gradient(circle at 32% 28%, oklch(0.95 0.005 258) 0%, oklch(0.7 0.01 258) 60%, oklch(0.55 0.01 258) 100%)',
            boxShadow: unlocked
              ? [
                  'inset 0 2px 0 oklch(1 0 0 / 0.55)',     // 顶部高光
                  `inset 0 -3px 6px oklch(0.3 0.05 258 / 0.5)`, // 底部内阴影
                  'inset 2px 0 0 oklch(1 0 0 / 0.15)',     // 左侧细高光
                  '3px 3px 8px oklch(0.45 0.05 258 / 0.18)',// 右下投影
                  '-1px -1px 3px oklch(1 0 0 / 0.9)',      // 左上反光
                ].join(', ')
              : [
                  'inset 0 2px 4px oklch(0.3 0.01 258 / 0.4)',
                  'inset 0 -1px 2px oklch(1 0 0 / 0.3)',
                ].join(', '),
          }}
        >
          {unlocked ? (
            <BadgeIcon iconKey={badge.iconKey} size={26} />
          ) : (
            <Lock size={20} strokeWidth={1.4} className="text-[color:var(--muted-foreground)]" />
          )}
        </div>

        {/* 悬停 tooltip */}
        {hovered && (
          <div className="absolute -top-2 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-[color:var(--foreground)] px-2.5 py-1.5 text-[10px] font-medium text-[color:var(--background)] shadow-lg">
            {badge.description}
            {unlocked && badge.awardedLevels[level as string] && (
              <div className="mt-0.5 text-[9px] opacity-70 tabular-nums">
                {formatAchievedDate(badge.awardedLevels[level as string])} 达成
              </div>
            )}
            <div className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-[color:var(--foreground)]" />
          </div>
        )}
      </div>

      {/* ══ 等级 pill（独立于硬币下方）══ */}
      {unlocked ? (
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold tracking-[0.05em] text-white"
          style={{
            backgroundColor: color,
            boxShadow: `inset 0 1px 0 oklch(1 0 0 / 0.3), 0 1px 2px ${color}40`,
          }}
        >
          {LEVEL_LABEL[level as BadgeLevel]}
        </span>
      ) : (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold tracking-[0.05em] text-[color:var(--muted-foreground)]"
          style={{ backgroundColor: 'oklch(0.55 0.01 258 / 0.08)' }}>
          锁定
        </span>
      )}

      {/* ══ 名称 ══ */}
      <span className={`text-[11px] font-bold tracking-tight ${unlocked ? 'text-[color:var(--foreground)]' : 'text-[color:var(--muted-foreground)]'}`}>
        {badge.name}
      </span>

      {/* ══ 数值/进度 ══ */}
      {unlocked ? (
        <span className="text-[10px] tabular-nums text-[color:var(--muted-foreground)]">
          {badge.currentValue}{badge.unit}
        </span>
      ) : next ? (
        <div className="flex flex-col items-center gap-1">
          <span className="text-[10px] tabular-nums text-[color:var(--muted-foreground)]">
            <span className="font-semibold text-[color:var(--foreground)]">{badge.currentValue}</span>
            <span className="text-[color:var(--muted-foreground)]/50"> / </span>
            <span>{badge.thresholds[next.level]}</span>
            {badge.unit}
          </span>
          {/* 进度条 — 渐变到下一等级色 */}
          <div className="h-1 w-[56px] overflow-hidden rounded-full bg-[oklch(0.55_0.03_258/0.08)]">
            <div className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${next.progressPct}%`,
                background: `linear-gradient(90deg, oklch(0.6 0.01 258), ${LEVEL_COLOR[next.level]})`,
              }} />
          </div>
        </div>
      ) : (
        <span className="text-[10px] tabular-nums text-[color:var(--muted-foreground)]">
          {badge.currentValue}{badge.unit}
        </span>
      )}
    </div>
  );
}

export function TabWorkBadges() {
  const [badges, setBadges] = useState<BadgeItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMyBadges().then(data => {
      if (cancelled) return;
      const order: Record<string, number> = { platinum: 4, gold: 3, silver: 2, bronze: 1 };
      data.sort((a, b) => {
        const al = a.currentLevel ? order[a.currentLevel] : 0;
        const bl = b.currentLevel ? order[b.currentLevel] : 0;
        return bl - al;
      });
      setBadges(data);
    }).catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="wb-panel flex items-center justify-center gap-2.5 py-8 text-[12px] text-[color:var(--muted-foreground)]">
        <Loader2 size={14} className="animate-spin" />加载印记...
      </div>
    );
  }

  if (error || !badges) {
    return (
      <div className="wb-panel flex items-center justify-center gap-2 py-8 text-[12px] text-[color:var(--muted-foreground)]">
        <AlertCircle size={13} />无法加载工作印记
      </div>
    );
  }

  const earned = badges.filter(b => b.currentLevel);
  const total = badges.length;
  const highestLevel = earned.length > 0
    ? earned.reduce((best, b) => {
        const order: Record<string, number> = { platinum: 4, gold: 3, silver: 2, bronze: 1 };
        return (order[b.currentLevel!] ?? 0) > (order[best] ?? 0) ? b.currentLevel! : best;
      }, 'bronze' as BadgeLevel)
    : null;

  return (
    <div className="wb-panel p-6">
      {/* ══ 头部：标题 + 统计摘要 ══ */}
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
          <Award size={12} strokeWidth={1.8} className="text-[color:var(--accent)]" />
          工作印记
        </h3>
        <div className="flex items-center gap-2.5 text-[10px] font-semibold tabular-nums text-[color:var(--muted-foreground)]">
          <span>已获得 <span className="text-[color:var(--foreground)]">{earned.length}</span> / {total}</span>
          {highestLevel && (
            <>
              <span className="text-[color:var(--muted-foreground)]/40">·</span>
              <span className="inline-flex items-center gap-1">
                最高
                <span className="inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: LEVEL_COLOR[highestLevel] }} />
                {LEVEL_LABEL[highestLevel]}
              </span>
            </>
          )}
        </div>
      </div>

      {/* ══ 5 个硬币 ══ */}
      <div className="mt-5 grid grid-cols-5 gap-2">
        {badges.map(b => <BadgeCoin key={b.code} badge={b} />)}
      </div>
    </div>
  );
}
