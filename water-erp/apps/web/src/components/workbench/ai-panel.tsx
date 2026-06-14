'use client';

import { useEffect, useState } from 'react';
import { Sparkles, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DashboardContext {
  supplier?: { total: number; approved: number; pending: number; risk: number };
  announcement?: { total: number; published: number; draftLike: number };
  expert?: { total: number; active: number; unfinished: number };
  catalog?: { total: number; active: number; alerts: number };
  applications?: { pending: number };
}

interface AiSummaryResult {
  summary: string;
  level: 'info' | 'warn';
}

export function DashboardAiPanel({ context, className }: { context: DashboardContext; className?: string }) {
  const [result, setResult] = useState<AiSummaryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchSummary = async () => {
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
      setResult(data);
      if (data.level === 'warn') setError(true);
    } catch {
      setError(true);
      setResult({ summary: '网络异常，请确认 API 服务已启动并刷新页面重试。', level: 'warn' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className={cn('rounded-2xl border bg-white shadow-sm overflow-hidden', className)}>
      <div className="flex items-center justify-between border-b border-[#edf3fb] px-6 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#7c3aed] to-[#a78bfa] text-white shadow-[0_8px_20px_rgba(124,58,237,0.24)]">
            <Sparkles size={16} strokeWidth={1.8} />
          </div>
          <div>
            <h2 className="text-base font-black text-[#18243a]">水叮当智能管理助手</h2>
          </div>
        </div>
        <button
          onClick={fetchSummary}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-xl border border-[#e5ecf4] px-3 py-1.5 text-xs font-bold text-[#5a6d8a] hover:text-[#7c3aed] hover:border-[#ddd6fe] transition disabled:opacity-40"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      <div className="p-6">
        {loading ? (
          <div className="flex items-center gap-3 py-4">
            <div className="h-2 w-2 animate-pulse rounded-full bg-[#7c3aed]" />
            <div className="h-2 w-48 animate-pulse rounded-full bg-[#edf3fb]" />
            <div className="h-2 w-32 animate-pulse rounded-full bg-[#edf3fb]" />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm leading-7 text-[#18243a]">{result?.summary}</p>
            {!error && (
              <div className="flex items-center gap-2 rounded-xl bg-[#f5f3ff] px-3 py-2 text-xs font-bold text-[#7c3aed]">
                <Sparkles size={12} />
                AI 生成内容仅供参考，不替代管理判断
              </div>
            )}
            {error && (
              <div className="rounded-xl bg-[#fff7ed] px-3 py-2 text-xs font-bold text-[#9a3412]">
                如持续异常，请检查 API Key 配置或网络连接。
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
