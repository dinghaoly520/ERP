'use client';

import { useEffect, useState, useRef } from 'react';
import {
  Loader2, Star, Zap, TrendingUp, Calendar, Target, Sparkles, RefreshCw,
} from 'lucide-react';
import { fetchWorkPortrait, type WorkPortrait } from '@/lib/api/work-arrangements';

// Module-level cache — persists across tab switches within the same session
let portraitCache: { data: WorkPortrait; timestamp: number } | null = null;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export function TabWorkPortrait() {
  const [portrait, setPortrait] = useState<WorkPortrait | null>(
    () => (portraitCache && Date.now() - portraitCache.timestamp < CACHE_TTL) ? portraitCache.data : null,
  );
  const [loading, setLoading] = useState(!portraitCache);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const fetchedRef = useRef(false);

  const loadPortrait = async (force: boolean = false) => {
    if (!force && portraitCache && Date.now() - portraitCache.timestamp < CACHE_TTL) {
      setPortrait(portraitCache.data);
      setLoading(false);
      return;
    }
    setRefreshing(true);
    try {
      const data = await fetchWorkPortrait();
      if (!fetchedRef.current) {
        portraitCache = { data, timestamp: Date.now() };
        setPortrait(data);
        setLoading(false);
        setError(false);
      }
    } catch {
      if (!fetchedRef.current) setError(true);
    } finally {
      if (!fetchedRef.current) setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchedRef.current = true;
    if (!portraitCache || Date.now() - portraitCache.timestamp >= CACHE_TTL) {
      loadPortrait();
    } else {
      setPortrait(portraitCache.data);
      setLoading(false);
    }
    return () => { fetchedRef.current = false; };
  }, []);

  if (loading) {
    return (
      <div className="wb-panel flex min-h-[400px] flex-1 items-center justify-center gap-2.5 text-sm text-[color:var(--muted-foreground)]">
        <Sparkles size={18} className="animate-pulse text-[color:var(--accent)]" />
        AI 正在分析你的工作风格...
      </div>
    );
  }

  if (error || !portrait) {
    return (
      <div className="wb-panel flex min-h-[400px] flex-1 flex-col items-center justify-center gap-3 text-sm text-[color:var(--muted-foreground)]">
        <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl">
          <Star size={24} className="text-[color:var(--accent)] opacity-40" />
        </div>
        <p>暂时无法生成工作画像</p>
        <p className="text-[11px]">稍后重试，或在工作台积累更多工作数据</p>
      </div>
    );
  }

  const { narrative, metrics: m, domainFocus } = portrait;

  return (
    <div className="flex flex-col gap-4">
      {/* ═══ AI 叙事卡片 ═══ */}
      <div
        className="neu-card relative overflow-hidden p-5"
        style={{ background: 'linear-gradient(135deg, rgba(96,139,239,0.06), rgba(96,139,239,0.02))' }}
      >
        <div className="absolute right-4 top-4 opacity-10">
          <Sparkles size={64} strokeWidth={1} className="text-[color:var(--accent)]" />
        </div>
        <div className="relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center rounded-[10px] px-2.5 py-0.5 text-[11px] font-bold"
                style={{ backgroundColor: 'rgba(96,139,239,0.12)', color: 'var(--accent)' }}
              >
                <Sparkles size={11} className="mr-1" />AI 工作画像
              </span>
              <span className="text-[11px] text-[color:var(--muted-foreground)]">
                基于你的操作数据生成
              </span>
            </div>
            <button
              type="button"
              onClick={() => loadPortrait(true)}
              disabled={refreshing}
              className="neu-btn-xs"
              title="重新生成画像"
            >
              <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
          <p className="mt-3 w-full text-[14px] leading-relaxed break-words text-[#18243a]">
            {narrative}
          </p>
        </div>
      </div>

      {/* ═══ 指标行 ═══ */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="neu-card flex flex-col gap-2 p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#eef2ff]">
              <Zap size={15} className="text-[#6366f1]" />
            </span>
            <span className="text-[11px] font-semibold text-[color:var(--muted-foreground)]">平均响应</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-black tabular-nums text-[#18243a]">
              {m.avgResponseHours > 0 ? m.avgResponseHours : '—'}
            </span>
            {m.avgResponseHours > 0 && <span className="text-[11px] text-[color:var(--muted-foreground)]">小时</span>}
          </div>
          <span className="text-[10px] text-[color:var(--muted-foreground)]">
            {m.avgResponseHours > 0 ? '审批之间的平均间隔' : '暂无审批数据'}
          </span>
        </div>

        <div className="neu-card flex flex-col gap-2 p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f0fdf4]">
              <TrendingUp size={15} className="text-[#11a874]" />
            </span>
            <span className="text-[11px] font-semibold text-[color:var(--muted-foreground)]">连续活跃</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-black tabular-nums text-[#18243a]">{m.completionStreak}</span>
            <span className="text-[11px] text-[color:var(--muted-foreground)]">天</span>
          </div>
          <span className="text-[10px] text-[color:var(--muted-foreground)]">每天至少有一次操作记录</span>
        </div>

        <div className="neu-card flex flex-col gap-2 p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#fffbeb]">
              <Calendar size={15} className="text-[#f59e0b]" />
            </span>
            <span className="text-[11px] font-semibold text-[color:var(--muted-foreground)]">活跃峰值</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-black tabular-nums text-[#18243a]">{m.peakDay}</span>
            <span className="mx-0.5 text-[11px] text-[color:var(--muted-foreground)]">·</span>
            <span className="text-[13px] font-bold text-[#18243a]">{m.peakPeriod}</span>
          </div>
          <span className="text-[10px] text-[color:var(--muted-foreground)]">你最频繁操作的时段</span>
        </div>

        <div className="neu-card flex flex-col gap-2 p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f5f3ff]">
              <Target size={15} className="text-[#7c3aed]" />
            </span>
            <span className="text-[11px] font-semibold text-[color:var(--muted-foreground)]">总审批</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-black tabular-nums text-[#18243a]">{m.totalApprovals}</span>
            <span className="text-[11px] text-[color:var(--muted-foreground)]">次</span>
          </div>
          <span className="text-[10px] text-[color:var(--muted-foreground)]">累计处理的审批操作</span>
        </div>
      </div>

      {/* ═══ 领域分布条 ═══ */}
      {domainFocus.length > 0 && (
        <div className="neu-card p-4">
          <p className="text-[11px] font-semibold text-[color:var(--accent)]">工作领域分布</p>
          <div className="mt-4 space-y-3">
            {domainFocus.map((d) => (
              <div key={d.label} className="flex items-center gap-3">
                <span className="w-[60px] flex-shrink-0 text-[12px] font-semibold text-[#18243a]">{d.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#eef3f8]">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${d.pct}%`,
                      background: 'linear-gradient(90deg, var(--accent-soft), var(--accent))',
                    }}
                  />
                </div>
                <span className="w-[36px] flex-shrink-0 text-right text-[11px] tabular-nums font-bold text-[color:var(--accent)]">{d.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
