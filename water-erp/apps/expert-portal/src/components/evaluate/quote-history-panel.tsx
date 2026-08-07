'use client';

import { useEffect, useState } from 'react';
import { Gavel, ChevronDown, ChevronRight } from 'lucide-react';
import { getQuoteHistory, type QuoteHistoryRound } from '@/lib/api';

interface Props {
  projectId: string;
  /** 折叠初始状态 */
  defaultCollapsed?: boolean;
}

const ROUND_TYPE_LABEL: Record<string, string> = {
  negotiation: '谈判轮',
  final_quote: '最终报价轮',
  sealed_auction: '竞价轮',
};

function formatPrice(p: string): string {
  return Number(p).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * 多轮报价历史面板（专家只读）。
 * 展示每轮各供应商的报价排名 + 价格演变趋势。
 * 仅 published/closed 轮次有数据；报价未开始时显示空态。
 */
export function QuoteHistoryPanel({ projectId, defaultCollapsed = false }: Props) {
  const [rounds, setRounds] = useState<QuoteHistoryRound[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  useEffect(() => {
    getQuoteHistory(projectId)
      .then(setRounds)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) return null;
  if (rounds.length === 0) return null; // 无报价数据时不渲染

  const lastRound = rounds[rounds.length - 1];

  return (
    <div className="neu-card-static p-4">
      <button
        onClick={() => setCollapsed(prev => !prev)}
        className="flex w-full items-center gap-2"
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <Gavel size={14} className="text-[var(--accent-strong)]" />
        <span className="text-sm font-bold text-[var(--foreground)]">多轮报价历史</span>
        <span className="ml-1 text-xs text-[var(--muted-foreground)]">
          {rounds.length} 轮 · 最终轮 {lastRound.quotes.length} 家报价
        </span>
      </button>

      {!collapsed && (
        <div className="mt-4 space-y-4">
          {rounds.map((r) => {
            const isLast = r.roundNo === lastRound.roundNo;
            return (
              <div key={r.roundNo} className={isLast ? 'rounded-lg border-2 border-[var(--accent)] p-3' : 'rounded-lg border border-[color-mix(in_oklch,var(--foreground)_8%,transparent)] p-3'}>
                <div className="mb-2 flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-bold text-white ${isLast ? 'bg-[var(--accent-strong)]' : 'bg-[oklch(0.55_0.03_258)]'}`}>
                    第 {r.roundNo} 轮
                  </span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {ROUND_TYPE_LABEL[r.roundType] || r.roundType}
                  </span>
                  {isLast && (
                    <span className="rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-bold text-[var(--accent-strong)]">
                      最终报价
                    </span>
                  )}
                </div>
                <div className="overflow-hidden rounded-lg border border-[color-mix(in_oklch,var(--foreground)_6%,transparent)]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[color-mix(in_oklch,var(--accent)_4%,transparent)] text-xs text-[var(--muted-foreground)]">
                        <th className="px-3 py-1.5 text-left font-semibold">排名</th>
                        <th className="px-3 py-1.5 text-left font-semibold">供应商</th>
                        <th className="px-3 py-1.5 text-right font-semibold">报价(元)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.quotes.map((q, idx) => (
                        <tr key={idx} className={`border-t border-[color-mix(in_oklch,var(--foreground)_4%,transparent)] ${idx === 0 ? 'bg-[var(--accent)]/5' : ''}`}>
                          <td className="px-3 py-1.5 font-mono font-bold text-[var(--accent)]">{idx + 1}</td>
                          <td className="px-3 py-1.5 text-[var(--foreground)]">{q.supplierName}</td>
                          <td className="px-3 py-1.5 text-right font-mono font-semibold">¥{formatPrice(q.quotePrice)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
