'use client';

import { useEffect, useState, useRef } from 'react';
import { Sparkles, Clock, TrendingUp, Activity, CalendarClock } from 'lucide-react';
import { fetchWorkPortrait, type WorkPortrait } from '@/lib/api/work-arrangements';

// 2026-11-03 用户裁定：画像只在每周一 12:00 由后端批量为全体账号生成，其余任何时间不更新——
// 本组件纯读取展示（无刷新入口、无本地缓存；后端 WorkPortraitCache 为唯一数据源）。
export function TabWorkPortrait() {
  const [portrait, setPortrait] = useState<WorkPortrait | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    fetchWorkPortrait()
      .then(data => { if (isMountedRef.current) { setPortrait(data); setError(false); } })
      .catch(() => { if (isMountedRef.current) setError(true); })
      .finally(() => { if (isMountedRef.current) setLoading(false); });
    return () => { isMountedRef.current = false; };
  }, []);

  if (loading) {
    return (
      <div className="wb-panel flex h-[430px] items-center justify-center gap-2.5 text-sm text-[color:var(--muted-foreground)]">
        <Sparkles size={18} className="animate-pulse text-[color:var(--accent)]" />
        正在读取工作画像...
      </div>
    );
  }

  if (error) {
    return (
      <div className="wb-panel flex h-[430px] flex-col items-center justify-center gap-3 text-sm text-[color:var(--muted-foreground)]">
        <div className="neu-icon-well flex h-12 w-12 items-center justify-center rounded-xl">
          <Activity size={20} className="text-[color:var(--muted-foreground)]" />
        </div>
        <p className="text-[13px]">工作画像加载失败，请稍后重新打开个人中心</p>
      </div>
    );
  }

  // 尚无画像（新账号 / 本周一 12:00 批量任务未跑）
  if (!portrait || portrait.available === false) {
    return (
      <div className="wb-panel flex h-[430px] flex-col items-center justify-center gap-3 text-sm text-[color:var(--muted-foreground)]">
        <div className="neu-icon-well flex h-12 w-12 items-center justify-center rounded-xl">
          <CalendarClock size={20} className="text-[color:var(--accent)]" />
        </div>
        <p className="text-[13px]">工作画像尚未生成</p>
        <p className="text-[11px]">画像由系统在每周一 12:00 统一更新，届时将自动呈现</p>
      </div>
    );
  }

  const { narrative, metrics, domainFocus } = portrait;

  // 领域分布最大值（用于条形归一化）
  const maxPct = Math.max(...(domainFocus?.map(d => d.pct) ?? [1]), 1);

  return (
    <div className="wb-panel p-5 h-[430px] flex flex-col">
      {/* ══ 头部（2026-11-03：刷新按钮按用户裁定移除——画像仅每周一 12:00 更新）══ */}
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
          <Activity size={12} strokeWidth={1.8} className="text-[color:var(--accent)]" />
          工作画像
        </h3>
        <span className="text-[10px] tabular-nums text-[color:var(--muted-foreground)]">每周一 12:00 更新</span>
      </div>

      {/* ══ 领域分布（如果有）══ */}
      {domainFocus && domainFocus.length > 0 && (
        <>
          <hr className="wb-section-rule mt-5 flex-shrink-0" />
          <div className="mt-4 flex-shrink-0">
            <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
              <TrendingUp size={11} strokeWidth={1.7} className="text-[color:var(--accent)]" />
              工作领域分布
            </div>
            <div className="flex flex-col gap-2">
              {domainFocus.map((d, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <span className="w-[100px] shrink-0 truncate text-[11px] font-semibold text-[color:var(--foreground)]">{d.label}</span>
                  <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-[oklch(0.55 0.03 258/0.05)]">
                    <div className="absolute inset-y-0 left-0 rounded-md transition-all duration-500"
                      style={{
                        width: `${(d.pct / maxPct) * 100}%`,
                        background: 'linear-gradient(90deg, oklch(0.62 0.12 258 / 0.85), oklch(0.52 0.16 258 / 0.7))',
                      }} />
                    <span className="absolute inset-y-0 right-2 flex items-center text-[10px] font-bold tabular-nums text-[color:var(--foreground)]">{d.pct}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ══ 叙事文案 ══ */}
      {narrative && (
        <>
          <hr className="wb-section-rule mt-5 flex-shrink-0" />
          <div className="mt-4 flex min-h-0 flex-1 items-start gap-2.5 overflow-y-auto pr-1">
            <Sparkles size={13} strokeWidth={1.7} className="mt-1 shrink-0 text-[color:var(--accent)]" />
            <p className="whitespace-pre-line text-[13px] leading-7 break-words text-[color:var(--foreground)]">{narrative}</p>
          </div>
        </>
      )}

      {/* ══ 脚注：生成时间 ══ */}
      <div className="mt-4 flex flex-shrink-0 items-center gap-1.5 text-[10px] text-[color:var(--muted-foreground)]">
        <Clock size={10} strokeWidth={1.6} />
        {portrait.generatedAt
          ? `画像生成于 ${new Date(portrait.generatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
          : metrics.peakDay ? `数据采样至 ${metrics.peakDay}` : null}
      </div>
    </div>
  );
}
