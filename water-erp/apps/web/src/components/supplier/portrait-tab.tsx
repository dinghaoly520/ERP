'use client';

import { useEffect, useState } from 'react';
import { getSupplierPortrait } from '@/lib/api/supplier';
import type { SupplierPortrait } from '@/lib/api/supplier';
import { Loader2, TrendingUp, TrendingDown, Minus } from 'lucide-react';

function ScoreBarChart({ evaluations }: { evaluations: { score: number; level: string; createdAt: string }[] }) {
  const levelColors: Record<string, string> = { A: 'var(--success)', B: 'var(--accent)', C: 'var(--warning)', D: 'var(--danger)' };
  const recent = evaluations.slice(-10);
  if (recent.length === 0) return null;
  const maxH = 80;
  return (
    <div className="mt-4">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-3">最近评价趋势</h4>
      <div className="flex items-end gap-2 h-[90px]">
        {recent.map((e, i) => {
          const h = (Number(e.score) / 100) * maxH;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <span className="text-[10px] tabular-nums font-semibold" style={{ color: levelColors[e.level] || 'var(--muted-foreground)' }}>{String(e.score)}</span>
              <div className="w-full rounded-t-sm transition-all duration-500" style={{ height: `${h}px`, backgroundColor: levelColors[e.level] || 'var(--muted)', opacity: 0.7 }} />
              <span className="text-[9px] text-[var(--muted-foreground)]/50 tabular-nums">{new Date(e.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PortraitTab({ supplierId }: { supplierId: string }) {
  const [portrait, setPortrait] = useState<SupplierPortrait | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSupplierPortrait(supplierId).then(setPortrait).catch(() => {}).finally(() => setLoading(false));
  }, [supplierId]);

  if (loading) return <div className="py-8 text-center text-sm text-[var(--muted-foreground)]"><Loader2 size={14} className="animate-spin mx-auto mb-2" />加载供应商画像...</div>;
  if (!portrait) return <p className="text-sm text-[var(--muted-foreground)] py-8 text-center">无法加载供应商画像</p>;

  const trendIcon = portrait.performanceTrend === 'improving' ? <TrendingUp size={14} className="text-[var(--success)]" />
    : portrait.performanceTrend === 'declining' ? <TrendingDown size={14} className="text-[var(--danger)]" />
    : <Minus size={14} className="text-[var(--muted-foreground)]" />;
  const trendLabel = portrait.performanceTrend === 'improving' ? '进步中' : portrait.performanceTrend === 'declining' ? '下滑中' : '平稳';
  const levelColors: Record<string, string> = { A: 'var(--success)', B: 'var(--accent)', C: 'var(--warning)', D: 'var(--danger)' };

  return (
    <div className="space-y-5">
      {/* Key metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: '参与项目', value: portrait.participationCount, sub: `中标 ${portrait.winCount} 次` },
          { label: '中标率', value: `${(portrait.winRate * 100).toFixed(0)}%`, sub: `${portrait.winCount}/${portrait.participationCount}` },
          { label: '评价均分', value: portrait.avgEvalScore?.toFixed(1) ?? '—', sub: `${portrait.evalCount} 次评价` },
          { label: '绩效趋势', value: trendLabel, sub: null, icon: trendIcon },
        ].map(m => (
          <div key={m.label} className="neu-card-static !rounded-2xl p-4 text-center">
            <div className="text-[11px] text-[var(--muted-foreground)] mb-1">{m.label}</div>
            <div className="flex items-center justify-center gap-1.5">
              <span className="text-lg font-extrabold tabular-nums text-[var(--foreground)]">{m.value}</span>
              {m.icon}
            </div>
            {m.sub && <div className="text-[10px] text-[var(--muted-foreground)]/60 mt-0.5">{m.sub}</div>}
          </div>
        ))}
      </div>

      {/* Win rate bar */}
      <div className="neu-card-static !rounded-2xl p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-2">中标率</h4>
        <div className="h-3 rounded-full bg-[var(--muted)]/30 overflow-hidden">
          <div className="h-full rounded-full bg-[var(--success)] transition-all duration-700" style={{ width: `${portrait.winRate * 100}%` }} />
        </div>
      </div>

      {/* Level distribution */}
      <div className="neu-card-static !rounded-2xl p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-3">评价等级分布</h4>
        <div className="space-y-2">
          {(['A', 'B', 'C', 'D'] as const).map(level => {
            const count = portrait.levelCounts[level];
            const total = Object.values(portrait.levelCounts).reduce((a, b) => a + b, 0);
            const pct = total > 0 ? (count / total) * 100 : 0;
            return (
              <div key={level} className="flex items-center gap-2">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[10px] font-extrabold text-white" style={{ backgroundColor: levelColors[level] }}>{level}</span>
                <div className="flex-1 h-4 rounded-md bg-[var(--muted)]/20 overflow-hidden">
                  <div className="h-full rounded-md transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: levelColors[level], opacity: 0.5 }} />
                </div>
                <span className="text-[10px] tabular-nums text-[var(--muted-foreground)] w-8 text-right">{count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
