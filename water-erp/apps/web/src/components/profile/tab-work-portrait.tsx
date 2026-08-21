'use client';

import { useEffect, useState, useRef } from 'react';
import { Sparkles, RefreshCw, Clock, TrendingUp, Activity } from 'lucide-react';
import { fetchWorkPortrait, type WorkPortrait } from '@/lib/api/work-arrangements';

// Portrait 生成一次约 500 字 AI 叙事，成本不低且个人工作风格半月级别才显著变化。
// 用 localStorage 持久化缓存，15 天内不重新生成。
const CACHE_KEY = 'profile:work-portrait-cache:v2';
const CACHE_TTL = 15 * 24 * 60 * 60 * 1000;

type CachedPortrait = { data: WorkPortrait; timestamp: number };

function readCache(): CachedPortrait | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPortrait;
    if (!parsed?.data || !parsed.timestamp) return null;
    if (Date.now() - parsed.timestamp >= CACHE_TTL) return null;
    return parsed;
  } catch { return null; }
}

function writeCache(data: WorkPortrait) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() })); }
  catch { /* localStorage 不可用时静默降级 */ }
}

export function clearWorkPortraitCache() {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
}

export function TabWorkPortrait() {
  const [portrait, setPortrait] = useState<WorkPortrait | null>(() => readCache()?.data ?? null);
  const [loading, setLoading] = useState(() => !readCache());
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const isMountedRef = useRef(true);

  const loadPortrait = async (force = false) => {
    if (!force) {
      const cached = readCache();
      if (cached) { setPortrait(cached.data); setLoading(false); setError(false); return; }
    }
    setRefreshing(true);
    try {
      const data = await fetchWorkPortrait();
      if (!isMountedRef.current) return;
      writeCache(data);
      setPortrait(data);
      setLoading(false);
      setError(false);
    } catch {
      if (!isMountedRef.current) return;
      setError(true);
    } finally {
      if (isMountedRef.current) setRefreshing(false);
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    if (!readCache()) loadPortrait();
    return () => { isMountedRef.current = false; };
  }, []);

  if (loading) {
    return (
      <div className="wb-panel flex min-h-[200px] items-center justify-center gap-2.5 text-sm text-[color:var(--muted-foreground)]">
        <Sparkles size={18} className="animate-pulse text-[color:var(--accent)]" />
        正在分析你的工作风格...
      </div>
    );
  }

  if (error || !portrait) {
    return (
      <div className="wb-panel flex min-h-[200px] flex-col items-center justify-center gap-3 text-sm text-[color:var(--muted-foreground)]">
        <div className="neu-icon-well flex h-12 w-12 items-center justify-center rounded-xl">
          <Activity size={20} className="text-[color:var(--muted-foreground)]" />
        </div>
        <p className="text-[13px]">未成功生成工作画像</p>
        <button type="button" onClick={() => loadPortrait(true)} disabled={refreshing} className="neu-btn-xs">
          <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />重新生成
        </button>
      </div>
    );
  }

  const { narrative, metrics, domainFocus } = portrait;

  // 领域分布最大值（用于条形归一化）
  const maxPct = Math.max(...(domainFocus?.map(d => d.pct) ?? [1]), 1);

  return (
    <div className="wb-panel p-5">
      {/* ══ 头部：标题 + 刷新按钮 ══ */}
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
          <Activity size={12} strokeWidth={1.8} className="text-[color:var(--accent)]" />
          工作画像
        </h3>
        <button type="button" onClick={() => loadPortrait(true)} disabled={refreshing}
          className="neu-btn-xs" title="重新生成画像">
          <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? '生成中' : '刷新'}
        </button>
      </div>

      {/* ══ 领域分布（如果有）══ */}
      {domainFocus && domainFocus.length > 0 && (
        <>
          <hr className="wb-section-rule mt-5" />
          <div className="mt-4">
            <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
              <TrendingUp size={11} strokeWidth={1.7} className="text-[color:var(--accent)]" />
              工作领域分布
            </div>
            <div className="flex flex-col gap-2">
              {domainFocus.map((d, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <span className="w-[100px] shrink-0 truncate text-[11px] font-semibold text-[color:var(--foreground)]">{d.label}</span>
                  <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-[oklch(0.55_0.03_258/0.05)]">
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
          <hr className="wb-section-rule mt-5" />
          <div className="mt-4 flex items-start gap-2.5">
            <Sparkles size={13} strokeWidth={1.7} className="mt-1 shrink-0 text-[color:var(--accent)]" />
            <p className="whitespace-pre-line text-[13px] leading-7 break-words text-[color:var(--foreground)]">{narrative}</p>
          </div>
        </>
      )}

      {/* ══ 高峰日脚注 ══ */}
      {metrics.peakDay && (
        <div className="mt-4 flex items-center gap-1.5 text-[10px] text-[color:var(--muted-foreground)]">
          <Clock size={10} strokeWidth={1.6} />
          数据采样至 {metrics.peakDay}
        </div>
      )}
    </div>
  );
}
