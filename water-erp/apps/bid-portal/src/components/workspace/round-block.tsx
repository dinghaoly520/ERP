'use client';

/**
 * 多轮报价轮次管理面板 — 谈判/竞价项目的报价轮次生命周期。
 * create → open → seal → publish → close(proceedToEvaluation)
 */

import { useCallback, useEffect, useState } from 'react';
import { Gavel, Plus, Lock, Eye, CheckCircle2, Loader2, Clock, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  createRound, closeRound, listRounds, publishRound, sealRound,
} from '@/lib/api/bid';
import type { BidProjectDetail } from '@/lib/types';

type Props = {
  bidProjectId: string;
  detail: BidProjectDetail | null;
  onChanged: () => void;
};

type Round = {
  id: string; roundNo: number; roundType: string; status: string;
  deadline: string | null;
  eligibleSupplierIds?: string[];
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
  const [showSupplierDialog, setShowSupplierDialog] = useState(false);
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>([]);

  const roundMode = detail?.roundMode as string | undefined;
  const suppliers = detail?.suppliers ?? [];

  const load = useCallback(async () => {
    if (!bidProjectId) return;
    try { setRounds(await listRounds(bidProjectId)); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  }, [bidProjectId]);

  useEffect(() => { load(); }, [load]);

  if (!roundMode) return null;

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); await load(); onChanged(); }
    catch (e: any) { toast.error(e?.message || '操作失败，请重试'); }
    finally { setBusy(false); }
  };

  // 合格供应商（bidValidity !== 'invalid'）
  const qualifiedSuppliers = suppliers.filter(s => s.bidValidity !== 'invalid');
  const invalidSuppliers = suppliers.filter(s => s.bidValidity === 'invalid');

  const openCreateDialog = () => {
    // 默认勾选所有合格供应商
    setSelectedSupplierIds(qualifiedSuppliers.map(s => s.id));
    setShowSupplierDialog(true);
  };

  const handleCreateFromDialog = () => withBusy(async () => {
    setShowSupplierDialog(false);
    await createRound(bidProjectId, {
      roundType: roundMode === 'negotiation' ? 'negotiation' : 'sealed_auction',
      supplierIds: selectedSupplierIds,
    });
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
          <button onClick={openCreateDialog} disabled={busy} className="neu-btn-primary !h-[32px] !text-xs">
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
          {rounds.map((r, idx) => {
          const isLast = idx === rounds.length - 1; // 仅最后一轮显示操作按钮
          return (
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
                  {isLast && r.status === 'open' && (
                    <button onClick={() => withBusy(async () => { await sealRound(bidProjectId, r.id); })}
                      disabled={busy} className="neu-btn-soft !h-[30px] !text-xs">
                      <Lock size={12} /> 截止报价
                    </button>
                  )}
                  {isLast && r.status === 'sealed' && (
                    <button onClick={() => withBusy(async () => { await publishRound(bidProjectId, r.id); })}
                      disabled={busy} className="neu-btn-soft !h-[30px] !text-xs">
                      <Eye size={12} /> 公布报价
                    </button>
                  )}
                  {isLast && r.status === 'published' && (
                    <>
                      <button onClick={() => withBusy(async () => {
                        // M3: closeRound + createRound 非原子——分步执行+错误恢复
                        await closeRound(bidProjectId, r.id, false);
                        try {
                          await createRound(bidProjectId, { roundType: r.roundType, supplierIds: r.eligibleSupplierIds });
                        } catch {
                          toast.error('轮次已关闭，但创建下一轮失败。请点击「创建首轮报价」重试。');
                        }
                      })}
                        disabled={busy} className="neu-btn-soft !h-[30px] !text-xs">
                        <Plus size={12} /> 下一轮
                      </button>
                      <button onClick={() => withBusy(async () => {
                        await closeRound(bidProjectId, r.id, false);
                        toast.info(
                          roundMode === 'negotiation'
                            ? '最终轮报价已锁定。请切换到「评标管理」页签生成评标结果。'
                            : '最终轮报价已锁定。请在「评标管理」页签启动评标。'
                        );
                      })}
                        disabled={busy} className="neu-btn-primary !h-[30px] !text-xs">
                        <CheckCircle2 size={12} /> 结束报价
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
          );
          })}
        </div>
      )}
      {/* 供应商选择弹窗 */}
      {showSupplierDialog && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center" style={{ background: 'oklch(0.975 0.012 258 / 0.72)', backdropFilter: 'blur(5px)' }}>
          <div className="neu-card-static w-[480px] max-w-[90vw] rounded-2xl p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-bold text-[var(--foreground)]">选择参与报价的供应商</h3>
              <button onClick={() => setShowSupplierDialog(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                <X size={16} />
              </button>
            </div>
            <p className="mb-3 text-xs text-[var(--muted-foreground)]">
              合格供应商默认全选，可按需取消。废标供应商不可参与。
            </p>
            <div className="mb-4 max-h-[300px] space-y-2 overflow-y-auto">
              {qualifiedSuppliers.map(s => (
                <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[color-mix(in_oklch,var(--foreground)_8%,transparent)] px-3 py-2 hover:bg-[color-mix(in_oklch,var(--accent)_4%,transparent)]">
                  <input
                    type="checkbox"
                    checked={selectedSupplierIds.includes(s.id)}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedSupplierIds(prev => [...prev, s.id]);
                      else setSelectedSupplierIds(prev => prev.filter(id => id !== s.id));
                    }}
                    className="accent-[var(--accent)]"
                  />
                  <span className="text-sm text-[var(--foreground)]">{s.supplierName}</span>
                  <span className="ml-auto text-xs text-[var(--success)]">✅ 合格</span>
                </label>
              ))}
              {invalidSuppliers.map(s => (
                <div key={s.id} className="flex items-center gap-2 rounded-lg border border-[color-mix(in_oklch,var(--foreground)_4%,transparent)] px-3 py-2 opacity-50">
                  <input type="checkbox" disabled className="accent-[var(--accent)]" />
                  <span className="text-sm text-[var(--muted-foreground)]">{s.supplierName}</span>
                  <span className="ml-auto text-xs text-[var(--danger)]">🔒 已废标</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowSupplierDialog(false)} className="neu-btn-soft !h-[34px] !text-xs">取消</button>
              <button
                onClick={handleCreateFromDialog}
                disabled={busy || selectedSupplierIds.length === 0}
                className="neu-btn-primary !h-[34px] !text-xs"
              >
                创建轮次（{selectedSupplierIds.length} 家）
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
