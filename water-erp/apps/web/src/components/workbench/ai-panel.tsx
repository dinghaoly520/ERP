'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, RefreshCw, ArrowRight, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

export interface DashboardContext {
  supplier?: { total: number; approved: number; pending: number; risk: number };
  announcement?: { total: number; published: number; draftLike: number };
  expert?: { total: number; active: number; unfinished: number };
  catalog?: { total: number; active: number; alerts: number };
  applications?: { pending: number };
}

interface ModuleInsight {
  module: string;
  status: '健康' | '关注' | '待处理';
  analysis: string;
  path: string;
  tone: string;
  metrics: string[];
}

interface InsightSuggestion {
  priority: number;
  text: string;
  path: string;
  impact: '高' | '中' | '低';
}

interface AiInsightResult {
  overview: string;
  moduleInsights: ModuleInsight[];
  crossInsight: string;
  highlights: any[];
  suggestions: InsightSuggestion[];
}

const dotColor: Record<string, string> = {
  '健康': 'bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.4)]',
  '关注': 'bg-amber-400 shadow-[0_0_6px_rgba(245,158,11,0.4)]',
  '待处理': 'bg-orange-400 shadow-[0_0_6px_rgba(249,115,22,0.4)]',
};

const CACHE_KEY = 'dashboard_ai_insight_v1';

interface CachedInsight {
  result: AiInsightResult;
  contextSnapshot: string;
}

function readCache(): CachedInsight | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.result?.overview && parsed?.contextSnapshot) return parsed;
  } catch { /* corrupted */ }
  return null;
}

function writeCache(result: AiInsightResult, context: DashboardContext) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      result,
      contextSnapshot: JSON.stringify(context),
    }));
  } catch { /* quota exceeded, silently skip */ }
}

export function DashboardAiPanel({
  context,
  ready = false,
  className,
}: {
  context: DashboardContext;
  ready?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [result, setResult] = useState<AiInsightResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const initializedRef = useRef(false);

  const totalItems =
    (context.supplier?.total ?? 0) +
    (context.announcement?.total ?? 0) +
    (context.expert?.total ?? 0) +
    (context.catalog?.total ?? 0);

  const contextKey = JSON.stringify(context);

  const fetchInsight = async (force = false) => {
    if (totalItems === 0) { setResult(null); setLoading(false); return; }
    setLoading(true);
    setError(false);
    try {
      const data = await api.post<AiInsightResult>('/ai/dashboard-summary', context);
      if (data.overview) {
        setResult(data);
        writeCache(data, context);
      } else throw new Error('invalid');
    } catch { setError(true); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!ready || initializedRef.current) return;
    initializedRef.current = true;

    // Check cache: if context snapshot matches, reuse cached result
    const cached = readCache();
    if (cached && cached.contextSnapshot === contextKey) {
      setResult(cached.result);
      return;
    }
    // Data has changed (or no cache) — fetch fresh insight
    fetchInsight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, contextKey]);

  if (!ready) return null;

  return (
    <section className={cn('relative overflow-hidden', className)}>
      {/* ── Header ── */}
      <div className="flex items-center justify-between border-b border-[#f0edf6]/60 px-6 py-4 relative z-10">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#18181b] text-white">
            <Sparkles size={14} strokeWidth={1.6} />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-[#18181b]">水叮当</span>
          <span className="hidden sm:inline text-[13px] text-[#a1a1aa]">智能运营分析</span>
        </div>
        <button onClick={() => fetchInsight(true)} disabled={loading}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[#71717a] hover:bg-[#f4f4f5] transition disabled:opacity-40">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      <div className="px-6 py-5 relative z-10">
        {/* ── Loading ── */}
        {loading && (
          <div className="space-y-4 py-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-[#f4f4f5]" />
            <div className="grid grid-cols-4 gap-3">
              {[1, 2, 3, 4].map(i => <div key={i} className="h-20 animate-pulse rounded-xl bg-[#fafafa]" />)}
            </div>
            <div className="space-y-2">
              <div className="h-4 w-1/3 animate-pulse rounded bg-[#f4f4f5]" />
              <div className="h-4 w-2/3 animate-pulse rounded bg-[#f4f4f5]" />
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {!loading && error && (
          <div className="py-6 text-center text-sm text-[#a1a1aa]">
            AI 引擎暂不可用，请检查网络后刷新重试
          </div>
        )}

        {/* ── Empty ── */}
        {!loading && !error && totalItems === 0 && (
          <div className="py-8 text-center">
            <p className="text-sm font-medium text-[#52525b]">暂无业务数据</p>
            <p className="mt-1.5 text-xs text-[#a1a1aa] max-w-xs mx-auto leading-relaxed">
              录入公告、供应商、专家和目录数据后，水叮当将自动生成运营洞察
            </p>
          </div>
        )}

        {/* ── Content ── */}
        {!loading && !error && totalItems > 0 && (
          <div className="space-y-5">
            {/* Overview */}
            {result?.overview && (
              <p className="text-sm leading-7 text-[#3f3f46]">{result.overview}</p>
            )}

            {/* Module Insights — horizontal row */}
            {result?.moduleInsights && result.moduleInsights.length > 0 && (
              <div className="grid grid-cols-4 gap-3">
                {result.moduleInsights.map((m, i) => (
                  <button key={i} onClick={() => router.push(m.path)}
                    className="group flex flex-col gap-3 rounded-xl bg-[#fafafa] px-4 py-3.5 text-left transition hover:bg-[#f4f4f5]">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-[#18181b]">{m.module}</span>
                      <span className={cn('h-2 w-2 rounded-full flex-shrink-0', dotColor[m.status])} />
                    </div>
                    <p className="text-xs leading-5 text-[#71717a] line-clamp-3">{m.analysis}</p>
                    <div className="mt-auto flex items-center gap-2 text-[11px] font-medium text-[#a1a1aa]">
                      {m.metrics.slice(0, 2).map((metric, j) => (
                        <span key={j} className="rounded-md bg-white px-2 py-0.5">{metric}</span>
                      ))}
                      <ArrowRight size={11} className="ml-auto opacity-0 group-hover:opacity-100 transition" />
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Cross insight */}
            {result?.crossInsight && (
              <div className="flex items-start gap-3 rounded-xl border border-[#f4f4f5] bg-[#fafafa] px-4 py-3">
                <TrendingUp size={14} className="mt-0.5 flex-shrink-0 text-[#a1a1aa]" />
                <p className="text-[13px] leading-6 text-[#52525b]">{result.crossInsight}</p>
              </div>
            )}

            {/* Suggestions */}
            {result?.suggestions && result.suggestions.length > 0 && (
              <div className="space-y-2">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-[#a1a1aa]">行动建议</span>
                <div className="space-y-1.5">
                  {result.suggestions.map((s, i) => (
                    <button key={i} onClick={() => router.push(s.path)}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] transition hover:bg-[#fafafa]">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-[#f4f4f5] text-[11px] font-semibold text-[#71717a]">{s.priority}</span>
                        <span className="truncate text-[#3f3f46]">{s.text}</span>
                      </div>
                      <ArrowRight size={13} className="ml-3 flex-shrink-0 text-[#d4d4d8]" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
