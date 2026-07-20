'use client';

import { useEffect, useState, useRef } from 'react';
import { Star, Sparkles, RefreshCw } from 'lucide-react';
import { fetchWorkPortrait, type WorkPortrait } from '@/lib/api/work-arrangements';

// Portrait 生成一次约 500 字 AI 叙事，成本不低且个人工作风格半月级别才显著变化。
// 用 localStorage 持久化缓存，15 天内不重新生成；刷新页面、切换 tab 都直接读缓存。
const CACHE_KEY = 'profile:work-portrait-cache';
const CACHE_TTL = 15 * 24 * 60 * 60 * 1000; // 15 天

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
  } catch {
    return null;
  }
}

function writeCache(data: WorkPortrait) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
  } catch {
    // localStorage 不可用时静默降级（每次都重新生成）
  }
}

/** 登出时调用，避免下一个账号看到上一个账号的画像缓存。 */
export function clearWorkPortraitCache() {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
}

export function TabWorkPortrait() {
  const [portrait, setPortrait] = useState<WorkPortrait | null>(() => readCache()?.data ?? null);
  const [loading, setLoading] = useState(() => !readCache());
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // isMounted pattern — prevents setState after the component unmounts.
  // (The previous `fetchedRef` was inverted: useEffect set it to `true` synchronously,
  //  so `!fetchedRef.current` was always false and portrait/state was never updated.)
  const isMountedRef = useRef(true);

  const loadPortrait = async (force: boolean = false) => {
    if (!force) {
      const cached = readCache();
      if (cached) {
        setPortrait(cached.data);
        setLoading(false);
        setError(false);
        return;
      }
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
    // 首次挂载：若 useState initializer 已从 localStorage 读到未过期缓存，直接展示；
    // 否则触发一次后台生成。
    if (!readCache()) {
      loadPortrait();
    }
    return () => { isMountedRef.current = false; };
  }, []);

  if (loading) {
    return (
      <div className="wb-panel flex min-h-[180px] items-center justify-center gap-2.5 text-sm text-[color:var(--muted-foreground)]">
        <Sparkles size={18} className="animate-pulse text-[color:var(--accent)]" />
        AI 正在分析你的工作风格...
      </div>
    );
  }

  if (error || !portrait) {
    return (
      <div className="wb-panel flex min-h-[180px] flex-col items-center justify-center gap-3 text-sm text-[color:var(--muted-foreground)]">
        <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl">
          <Star size={24} className="text-[color:var(--accent)] opacity-40" />
        </div>
        <p>未成功生成工作画像</p>
        <button
          type="button"
          onClick={() => loadPortrait(true)}
          disabled={refreshing}
          className="neu-btn-soft"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          重新生成
        </button>
      </div>
    );
  }

  const { narrative } = portrait;

  return (
    <div
      className="neu-card relative overflow-hidden p-5"
      style={{ background: 'linear-gradient(135deg, rgba(96,139,239,0.06), rgba(96,139,239,0.02))' }}
    >
      <div className="pointer-events-none absolute -right-2 -top-2 opacity-10">
        <Sparkles size={88} strokeWidth={1} className="text-[color:var(--accent)]" />
      </div>
      <div className="relative">
        <div className="flex items-center justify-between">
          <span
            className="inline-flex items-center rounded-[10px] px-2.5 py-0.5 text-[11px] font-bold"
            style={{ backgroundColor: 'rgba(96,139,239,0.12)', color: 'var(--accent)' }}
          >
            <Sparkles size={11} className="mr-1" />AI 工作画像
          </span>
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
        {/* whitespace-pre-line preserves the \n\n between paragraphs returned by the LLM */}
        <div className="mt-3 whitespace-pre-line text-[14px] leading-7 break-words text-[#18243a]">
          {narrative}
        </div>
      </div>
    </div>
  );
}
