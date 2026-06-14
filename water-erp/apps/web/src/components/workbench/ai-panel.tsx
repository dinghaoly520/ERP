'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, RefreshCw, ArrowRight, Lightbulb, TrendingUp, AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { statusTone, type WorkbenchTone } from '@/lib/workbench';

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

const statusIcon: Record<string, typeof CheckCircle2> = {
  '健康': CheckCircle2,
  '关注': AlertCircle,
  '待处理': AlertCircle,
};

const statusColor: Record<string, string> = {
  '健康': 'text-emerald-600 bg-emerald-50 border-emerald-200',
  '关注': 'text-amber-600 bg-amber-50 border-amber-200',
  '待处理': 'text-orange-600 bg-orange-50 border-orange-200',
};

const impactBadge: Record<string, string> = {
  '高': 'bg-red-50 text-red-700 border-red-200',
  '中': 'bg-amber-50 text-amber-700 border-amber-200',
  '低': 'bg-slate-100 text-slate-600 border-slate-200',
};

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
      setResult(null);
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
      if (data.overview) {
        setResult(data);
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

  const hasData = result && (result.moduleInsights?.length > 0 || result.highlights?.length > 0);

  return (
    <section className={cn('rounded-2xl border bg-white shadow-sm overflow-hidden', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#edf3fb] px-6 py-4 bg-gradient-to-r from-[#faf5ff] via-[#f5f3ff] to-[#ede9fe]">
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
          刷新分析
        </button>
      </div>

      <div className="p-6">
        {!ready || loading ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-2 w-2 animate-pulse rounded-full bg-[#7c3aed]" />
              <div className="h-2 w-56 animate-pulse rounded-full bg-[#ede9fe]" />
              <div className="h-2 w-32 animate-pulse rounded-full bg-[#edf3fb]" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-28 animate-pulse rounded-xl bg-[#faf5ff]" />
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-[#fed7aa] bg-[#fff7ed] p-4 text-sm text-[#9a3412]">
            AI 引擎暂时不可用，请检查网络连接或稍后刷新重试。
          </div>
        ) : !hasData && totalItems === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f5f3ff]">
              <TrendingUp size={24} className="text-[#a78bfa]" />
            </div>
            <p className="text-sm font-bold text-[#5a6d8a]">各中心暂无业务数据</p>
            <p className="text-xs text-[#8a96aa] max-w-sm">请先通过信息发布中心录入公告、供应商管理中心注册供应商、专家管理中心建立专家库、电子商城导入目录数据，水叮当将基于实时数据为您提供运营分析。</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Overview */}
            {result?.overview && (
              <div className="flex items-start gap-3 rounded-xl bg-gradient-to-r from-[#faf5ff] via-[#f8f4ff] to-[#f0ebff] border border-[#ede9fe] p-4">
                <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-[#7c3aed] text-white">
                  <Lightbulb size={13} strokeWidth={2} />
                </div>
                <p className="text-sm leading-7 text-[#4c1d95] font-semibold">{result.overview}</p>
              </div>
            )}

            {/* Module Analysis Cards */}
            {result?.moduleInsights && result.moduleInsights.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {result.moduleInsights.map((m, i) => {
                  const StatusIcon = statusIcon[m.status] || AlertCircle;
                  return (
                    <button
                      key={i}
                      onClick={() => router.push(m.path)}
                      className="group flex flex-col gap-3 rounded-xl border border-[#ede9fe] bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md hover:border-[#c4b5fd]"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-black text-[#18243a]">{m.module}</span>
                        <span className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold', statusColor[m.status])}>
                          <StatusIcon size={11} strokeWidth={2.5} />
                          {m.status}
                        </span>
                      </div>
                      <p className="text-xs leading-6 text-[#5a6d8a]">{m.analysis}</p>
                      <div className="flex items-center justify-between">
                        <div className="flex gap-2">
                          {m.metrics.map((metric, j) => (
                            <span key={j} className="rounded-lg bg-[#f8fafc] px-2 py-0.5 text-[11px] font-bold text-[#5a6d8a]">{metric}</span>
                          ))}
                        </div>
                        <ArrowRight size={13} className="text-[#a78bfa] opacity-0 transition group-hover:opacity-100" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Cross-Module Insight */}
            {result?.crossInsight && (
              <div className="flex items-start gap-3 rounded-xl bg-gradient-to-r from-[#eff6ff] to-[#f5f3ff] border border-[#bfdbfe] p-4">
                <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#064ea2] to-[#7c3aed] text-white">
                  <TrendingUp size={13} strokeWidth={2} />
                </div>
                <p className="text-sm leading-7 text-[#1e3a5f] font-semibold">{result.crossInsight}</p>
              </div>
            )}

            {/* Legacy highlights fallback */}
            {!result?.moduleInsights?.length && result?.highlights && result.highlights.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {result.highlights.map((h: any, i: number) => {
                  const tone = toneToWorkbenchTone(h.tone);
                  const tc = statusTone[tone];
                  return (
                    <button
                      key={i}
                      onClick={() => router.push(h.path)}
                      className="group flex flex-col gap-2 rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
                      style={{ borderColor: tc.border, backgroundColor: tc.bg }}
                    >
                      <span className="inline-flex items-center gap-1.5 self-start rounded-lg px-2 py-0.5 text-[11px] font-bold" style={{ color: tc.color, backgroundColor: 'rgba(255,255,255,0.7)' }}>{h.module}</span>
                      <div className="text-lg font-black" style={{ color: tc.color }}>{h.metric}</div>
                      <p className="text-xs text-[#5a6d8a]">{h.comment}</p>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Suggestions with priority & impact */}
            {result?.suggestions && result.suggestions.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-black text-[#5a6d8a]">
                  <TrendingUp size={13} /> 优先级行动建议
                </div>
                <div className="grid gap-2">
                  {result.suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => router.push(s.path)}
                      className="flex items-center justify-between rounded-xl border border-[#ede9fe] bg-[#faf5ff] px-4 py-3 text-left transition hover:bg-[#f5f3ff] hover:border-[#c4b5fd]"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-[#7c3aed] text-[11px] font-black text-white">{s.priority}</span>
                        <span className="text-sm font-bold text-[#4c1d95] truncate">{s.text}</span>
                      </div>
                      <span className={cn('ml-3 flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold', impactBadge[s.impact])}>
                        {s.impact}影响
                      </span>
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
