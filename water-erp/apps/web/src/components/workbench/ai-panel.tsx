'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, RefreshCw, ArrowRight, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';
import { statusTone, type WorkbenchTone } from '@/lib/workbench';

export interface DashboardContext {
  supplier?: { total: number; approved: number; pending: number; risk: number };
  announcement?: { total: number; published: number; draftLike: number };
  expert?: { total: number; active: number; unfinished: number };
  catalog?: { total: number; active: number; alerts: number };
  applications?: { pending: number };
}

interface InsightHighlight {
  module: string;
  metric: string;
  comment: string;
  path: string;
  tone: string;
}

interface InsightSuggestion {
  text: string;
  path: string;
}

interface AiInsightResult {
  overview: string;
  highlights: InsightHighlight[];
  suggestions: InsightSuggestion[];
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
  const fetchedRef = useRef(false);

  const totalItems =
    (context.supplier?.total ?? 0) +
    (context.announcement?.total ?? 0) +
    (context.expert?.total ?? 0) +
    (context.catalog?.total ?? 0);

  const fetchInsight = async () => {
    if (totalItems === 0) {
      setResult({
        overview: '当前各业务中心暂无数据，请按需初始化业务模块。',
        highlights: [],
        suggestions: [],
      });
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const res = await fetch('/api/ai/dashboard-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context),
        credentials: 'include',
      });
      const data = await res.json();
      if (data.overview && Array.isArray(data.highlights)) {
        setResult(data);
      } else if (data.summary) {
        setResult({ overview: data.summary, highlights: [], suggestions: [] });
      } else {
        throw new Error('invalid response');
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ready && !fetchedRef.current) {
      fetchedRef.current = true;
      fetchInsight();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, totalItems]);

  const toneToWorkbenchTone = (t: string): WorkbenchTone => {
    const map: Record<string, WorkbenchTone> = { blue: 'blue', green: 'green', orange: 'orange', purple: 'purple', cyan: 'cyan', red: 'red' };
    return map[t] || 'blue';
  };

  return (
    <section className={cn('rounded-2xl border bg-white shadow-sm overflow-hidden', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#edf3fb] px-6 py-4 bg-gradient-to-r from-[#faf5ff] to-[#f5f3ff]">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#7c3aed] to-[#a78bfa] text-white shadow-[0_8px_20px_rgba(124,58,237,0.24)]">
            <Sparkles size={16} strokeWidth={1.8} />
          </div>
          <div>
            <h2 className="text-base font-black text-[#18243a]">水叮当智能管理助手</h2>
          </div>
        </div>
        <button
          onClick={fetchInsight}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-xl border border-[#ddd6fe] bg-white px-3 py-1.5 text-xs font-bold text-[#7c3aed] hover:bg-[#f5f3ff] transition disabled:opacity-40"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      <div className="p-6">
        {loading ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 py-2">
              <div className="h-2 w-2 animate-pulse rounded-full bg-[#7c3aed]" />
              <div className="h-2 w-64 animate-pulse rounded-full bg-[#edf3fb]" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-24 animate-pulse rounded-xl bg-[#f8fafc]" />
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-[#fed7aa] bg-[#fff7ed] p-4 text-sm text-[#9a3412]">
            AI 引擎暂时不可用，请检查 API Key 配置或稍后刷新重试。
          </div>
        ) : (
          <div className="space-y-5">
            {/* Overview banner */}
            {result?.overview && (
              <div className="flex items-start gap-3 rounded-xl bg-gradient-to-r from-[#faf5ff] to-[#f5f3ff] border border-[#ede9fe] p-4">
                <Lightbulb size={16} className="mt-0.5 flex-shrink-0 text-[#7c3aed]" />
                <p className="text-sm leading-6 text-[#4c1d95] font-bold">{result.overview}</p>
              </div>
            )}

            {/* Highlights grid */}
            {result?.highlights && result.highlights.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {result.highlights.map((h, i) => {
                  const tone = toneToWorkbenchTone(h.tone);
                  const tc = statusTone[tone];
                  return (
                    <button
                      key={i}
                      onClick={() => router.push(h.path)}
                      className="group flex flex-col gap-2 rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
                      style={{ borderColor: tc.border, backgroundColor: tc.bg }}
                    >
                      <span className="inline-flex items-center gap-1.5 self-start rounded-lg px-2 py-0.5 text-[11px] font-bold" style={{ color: tc.color, backgroundColor: 'rgba(255,255,255,0.7)' }}>
                        {h.module}
                      </span>
                      <div className="text-lg font-black" style={{ color: tc.color }}>{h.metric}</div>
                      <p className="text-xs text-[#5a6d8a]">{h.comment}</p>
                      <div className="mt-auto flex items-center gap-1 text-xs font-bold opacity-0 transition group-hover:opacity-100" style={{ color: tc.color }}>
                        前往处理 <ArrowRight size={12} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Suggestions */}
            {result?.suggestions && result.suggestions.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-[#8a96aa]">
                  <Lightbulb size={12} /> 今日建议
                </div>
                <div className="grid gap-2">
                  {result.suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => router.push(s.path)}
                      className="flex items-center justify-between rounded-xl border border-[#ede9fe] bg-[#faf5ff] px-4 py-2.5 text-left text-sm font-bold text-[#7c3aed] transition hover:bg-[#f5f3ff] hover:border-[#c4b5fd]"
                    >
                      <span>{s.text}</span>
                      <ArrowRight size={14} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {!result?.highlights?.length && !result?.suggestions?.length && result?.overview && (
              <p className="text-sm text-[#5a6d8a] text-center py-8">{result.overview}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
