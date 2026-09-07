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
              <div key={r.roundNo} className={
                isLast
                  ? 'rounded-lg bg-[oklch(0.985_0.005_258)] p-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.8),2px_2px_5px_oklch(0.55_0.03_258/0.1),-1.5px_-1.5px_4px_oklch(1_0_0/0.85),inset_0_0_0_1.5px_color-mix(in_oklch,var(--accent)_45%,transparent)]'
                  : 'rounded-lg bg-[oklch(0.985_0.005_258)] p-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.8),2px_2px_5px_oklch(0.55_0.03_258/0.1),-1.5px_-1.5px_4px_oklch(1_0_0/0.85)]'
              }>
                <div className="mb-2 flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-bold text-white ${isLast ? 'bg-[var(--accent-strong)]' : 'bg-[oklch(0.55_0.03_258)]'}`}>
                    第 {r.roundNo} 轮
                  </span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {ROUND_TYPE_LABEL[r.roundType] || r.roundType}
                  </span>
                  {isLast && (
                    <span className="exp-pill !text-[10px]" style={{ '--c': 'var(--accent-strong)' } as React.CSSProperties}>
                      最终报价
                    </span>
                  )}
                </div>
                <div className="overflow-hidden rounded-lg">
                  <table className="neu-table is-dense w-full">
                    <thead>
                      <tr>
                        <th className="!px-3 !py-1.5">排名</th>
                        <th className="!px-3 !py-1.5">供应商</th>
                        <th className="!px-3 !py-1.5 !text-right">报价(元)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.quotes.map((q, idx) => (
                        <tr key={idx} className={idx === 0 ? 'bg-[var(--accent)]/5' : ''}>
                          <td className="!px-3 !py-1.5 font-mono font-bold text-[var(--accent)]">{idx + 1}</td>
                          <td className="!px-3 !py-1.5 text-[var(--foreground)]">{q.supplierName}</td>
                          <td className="!px-3 !py-1.5 !text-right font-mono font-semibold">¥{formatPrice(q.quotePrice)}</td>
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
