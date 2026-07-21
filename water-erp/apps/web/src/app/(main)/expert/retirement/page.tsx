'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { getRetireCandidates, confirmRetire } from '@/lib/api/expert';
import { StatusBadge } from '@/components/workbench';
import { AlertTriangle, Check, RefreshCw, UserX } from 'lucide-react';

export default function RetirementPage() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [reason, setReason] = useState('');
  // 退库二次确认
  const [pendingRetire, setPendingRetire] = useState<{ id: string; name: string } | null>(null);
  const [retiring, setRetiring] = useState(false);

  const load = async () => {
    setLoading(true); setErrored(false);
    try { setCandidates(await getRetireCandidates()); }
    catch (e: any) { setErrored(true); toast.error(e?.message || '加载退库候选失败'); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openRetire = (id: string, name: string) => {
    if (!reason.trim()) { toast.error('请输入退库原因'); return; }
    setPendingRetire({ id, name });
  };

  const doRetire = async () => {
    if (!pendingRetire || !reason.trim()) return;
    const { id, name } = pendingRetire;
    setRetiring(true);
    try {
      await confirmRetire(id, reason.trim());
      toast.success(`${name} 已退库`);
      setReason('');
      setPendingRetire(null);
      load();
    } catch (e: any) { toast.error(e?.message || '退库失败'); }
    setRetiring(false);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><UserX size={17} /></div>
            <div><div className="page-hero__title">退库管理</div><div className="page-hero__sub">扫描连续 D 级评价或 12 个月无分配的专家，人工复核确认退库</div></div>
          </div>
          <div className="page-hero__right">
            <button onClick={() => router.push('/expert/repository')} className="neu-btn-soft">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              返回专家库</button>
          </div>
        </div>
        <div className="page-hero__divider">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="kpi-card group flex h-full flex-col gap-1.5 p-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">预警候选</span>
              <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--warning)]">{candidates.length}</span>
              <span className="min-h-[14px] text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">待人工复核</span>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="neu-table-card py-14 text-center text-sm text-[var(--muted-foreground)]"><RefreshCw size={14} className="animate-spin inline mr-2" />扫描中...</div>
      ) : errored ? (
        <div className="neu-table-card py-16 text-center">
          <p className="text-sm font-semibold text-[var(--danger)] mb-3">退库候选加载失败</p>
          <button onClick={load} className="neu-btn-xs is-info">重试</button>
        </div>
      ) : candidates.length === 0 ? (
        <div className="neu-table-card py-16 text-center">
          <Check size={36} className="mx-auto text-[var(--success)] mb-3" />
          <p className="text-sm text-[var(--muted-foreground)]">当前无退库候选专家</p>
          <p className="text-[11px] text-[var(--muted-foreground)]/60 mt-1">所有专家履职正常且近期有分配记录</p>
        </div>
      ) : (
        <div className="space-y-3">
          {candidates.length > 0 && (
            <div className="neu-table-card p-4">
              <label className="block mb-2 text-xs font-semibold text-[var(--muted-foreground)]">统一退库原因</label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="填写退库原因（如：连续两次D级评价）..."
                className="neu-input text-sm w-full"
                rows={2}
              />
            </div>
          )}
          {candidates.map(c => (
            <div key={c.userId} className="neu-table-card p-4 flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-[var(--foreground)]">{c.displayName}</span>
                  {c.specialty && <StatusBadge tone="blue">{c.specialty}</StatusBadge>}
                  <AlertTriangle size={14} className="text-[var(--warning)]" />
                </div>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">预警原因：{c.reason}</p>
              </div>
              <button
                onClick={() => openRetire(c.userId, c.displayName)}
                disabled={!reason.trim() || retiring}
                className="neu-btn-soft is-danger shrink-0"
              >
                确认退库
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ══════ 退库二次确认 ══════ */}
      {pendingRetire && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm" onClick={() => !retiring && setPendingRetire(null)} />
          <div className="relative w-full max-w-[min(420px,92vw)] rounded-[20px] bg-[var(--background)] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.12)]" role="dialog" aria-modal="true">
            <div className="flex items-center gap-3">
              <div className="neu-icon-well flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"><UserX size={18} className="text-[var(--danger)]" /></div>
              <div className="min-w-0">
                <h3 className="text-base font-bold tracking-[-0.02em] text-[var(--foreground)]">确认退库</h3>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">退库后该专家将移出评审专家库，此操作不可撤销</p>
              </div>
            </div>
            <hr className="wb-section-rule my-4" />
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-[var(--muted-foreground)]">专家姓名</span>
                <span className="text-sm font-semibold text-[var(--foreground)]">{pendingRetire.name}</span>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-[var(--muted-foreground)]">退库原因</span>
                <p className="rounded-lg bg-[var(--muted)] px-3 py-2 text-xs leading-relaxed text-[var(--foreground)]">{reason}</p>
              </div>
            </div>
            <hr className="wb-section-rule my-4" />
            <div className="flex justify-end gap-3">
              <button onClick={() => setPendingRetire(null)} disabled={retiring} className="neu-btn-soft h-[38px]">取消</button>
              <button onClick={doRetire} disabled={retiring} className="neu-btn-primary !h-[38px] is-danger">{retiring ? '处理中...' : '确认退库'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
