'use client';

/**
 * P2c: 多轮报价轮次管理面板 — 谈判/竞价项目的报价轮次生命周期。
 * create → open → seal → publish → close(proceedToEvaluation)
 */

import { useCallback, useEffect, useState } from 'react';
import { Gavel, Plus, Lock, Eye, CheckCircle2, Loader2, Clock } from 'lucide-react';
import {
  createRound, closeRound, getRoundQuotes, listRounds, publishRound, sealRound,
  type BidProjectDetail,
} from '@/lib/api/bid';

type Props = {
  bidProjectId: string;
  detail: BidProjectDetail | null;
  onChanged: () => void;
};

type Round = {
  id: string; roundNo: number; roundType: string; status: string;
  deadline: string | null;
  quotes?: Array<{ id: string; bidSupplierId: string; quotePrice: string; status: string }>;
};

const STATUS_LABEL: Record<string, string> = {
  pending: '待开放', open: '报价中', sealed: '已截止', published: '已公布', closed: '已结束',
};
const STATUS_COLOR: Record<string, string> = {
  pending: '#8a96aa', open: '#064ea2', sealed: '#b45309', published: '#11a874', closed: '#5a6d8a',
};

export function RoundBlock({ bidProjectId, detail, onChanged }: Props) {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const roundMode = (detail as any)?.roundMode as string | undefined;
  const suppliers = detail?.suppliers ?? [];

  const load = useCallback(async () => {
    if (!bidProjectId) return;
    try { setRounds(await listRounds(bidProjectId)); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  }, [bidProjectId]);

  useEffect(() => { load(); }, [load]);

  if (!roundMode) return null; // 非多轮模式不渲染

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); await load(); onChanged(); }
    catch { /* toast handled by parent */ }
    finally { setBusy(false); }
  };

  const handleCreate = () => withBusy(async () => {
    await createRound(bidProjectId, { roundType: roundMode === 'negotiation' ? 'negotiation' : 'sealed_auction' });
  });

  return (
    <div className="neu-card-static rounded-2xl p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gavel size={16} strokeWidth={1.8} className="text-[var(--accent)]" />
          <h3 className="text-sm font-bold text-[var(--foreground)]">
            报价轮次管理
            <span className="ml-2 text-xs font-normal text-[var(--muted-foreground)]">
              {roundMode === 'negotiation' ? '谈判采购' : '竞价采购'} · 多轮密封报价
            </span>
          </h3>
        </div>
        {rounds.length === 0 && (
          <button onClick={handleCreate} disabled={busy} className="neu-btn-primary !h-[32px] !text-xs">
            <Plus size={13} /> 创建首轮报价
          </button>
        )}
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">加载中…</div>
      ) : rounds.length === 0 ? (
        <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">
          尚无报价轮次。点击「创建首轮报价」开始多轮报价流程。
        </div>
      ) : (
        <div className="space-y-3">
          {rounds.map((r) => (
            <div key={r.id} className="rounded-xl border border-[color-mix(in_oklch,var(--foreground)_8%,transparent)] p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="rounded-md bg-[var(--accent)] px-2 py-0.5 text-xs font-bold text-white">
                    第 {r.roundNo} 轮
                  </span>
                  <span className="text-sm font-semibold" style={{ color: STATUS_COLOR[r.status] }}>
                    {STATUS_LABEL[r.status] || r.status}
                  </span>
                  {r.deadline && (
                    <span className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                      <Clock size={11} strokeWidth={1.5} />
                      截止 {new Date(r.deadline).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  {r.status === 'open' && (
                    <button onClick={() => withBusy(async () => { await sealRound(bidProjectId, r.id); })}
                      disabled={busy} className="neu-btn-soft !h-[30px] !text-xs">
                      <Lock size={12} /> 截止报价
                    </button>
                  )}
                  {r.status === 'sealed' && (
                    <button onClick={() => withBusy(async () => { await publishRound(bidProjectId, r.id); })}
                      disabled={busy} className="neu-btn-soft !h-[30px] !text-xs">
                      <Eye size={12} /> 公布报价
                    </button>
                  )}
                  {r.status === 'published' && (
                    <>
                      <button onClick={() => withBusy(async () => { await closeRound(bidProjectId, r.id, false); await createRound(bidProjectId, { roundType: r.roundType }); })}
                        disabled={busy} className="neu-btn-soft !h-[30px] !text-xs">
                        <Plus size={12} /> 下一轮
                      </button>
                      <button onClick={() => withBusy(async () => { await closeRound(bidProjectId, r.id, true); })}
                        disabled={busy} className="neu-btn-primary !h-[30px] !text-xs">
                        <CheckCircle2 size={12} /> 结束·进入评标
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* 报价一览(published/closed 时显示) */}
              {(r.status === 'published' || r.status === 'closed') && r.quotes && r.quotes.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-[color-mix(in_oklch,var(--foreground)_6%,transparent)]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[color-mix(in_oklch,var(--accent)_4%,transparent)] text-xs text-[var(--muted-foreground)]">
                        <th className="px-3 py-2 text-left font-semibold">排名</th>
                        <th className="px-3 py-2 text-left font-semibold">供应商</th>
                        <th className="px-3 py-2 text-right font-semibold">报价(元)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...r.quotes].sort((a, b) => Number(a.quotePrice) - Number(b.quotePrice)).map((q, idx) => {
                        const sup = suppliers.find(s => s.id === q.bidSupplierId);
                        return (
                          <tr key={q.id} className="border-t border-[color-mix(in_oklch,var(--foreground)_4%,transparent)]">
                            <td className="px-3 py-2 font-mono font-bold text-[var(--accent)]">{idx + 1}</td>
                            <td className="px-3 py-2 text-[var(--foreground)]">{sup?.supplierName ?? q.bidSupplierId}</td>
                            <td className="px-3 py-2 text-right font-mono font-semibold">
                              {Number(q.quotePrice).toLocaleString('zh-CN')}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {busy && <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]"><Loader2 size={12} className="animate-spin" /> 处理中…</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
