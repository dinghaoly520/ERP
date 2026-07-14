'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { getRetireCandidates, confirmRetire } from '@/lib/api/expert';
import { StatusBadge } from '@/components/workbench';
import { AlertTriangle, RefreshCw, Check, UserX, ArrowLeft } from 'lucide-react';

export default function RetirementPage() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = async () => { setLoading(true); try { setCandidates(await getRetireCandidates()); } catch {} setLoading(false); };
  useEffect(() => { load(); }, []);

  const doRetire = async (id: string, name: string) => {
    if (!reason.trim()) { toast.error('请输入退库原因'); return; }
    setConfirming(id);
    try {
      await confirmRetire(id, reason.trim());
      toast.success(`${name} 已退库`);
      setReason('');
      load();
    } catch (e: any) { toast.error(e?.message || '退库失败'); }
    setConfirming(null);
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
            <button onClick={() => router.push('/expert/repository')} className="neu-btn-soft gap-1"><ArrowLeft size={14} />返回专家库</button>
            <button onClick={load} disabled={loading} className="neu-btn-xs"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
          </div>
        </div>
        <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }}>
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
                onClick={() => doRetire(c.userId, c.displayName)}
                disabled={confirming === c.userId || !reason.trim()}
                className="neu-btn-soft is-danger shrink-0"
              >
                {confirming === c.userId ? '处理中...' : '确认退库'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
