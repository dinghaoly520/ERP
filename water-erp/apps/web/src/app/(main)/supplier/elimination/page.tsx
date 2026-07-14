'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { AlertTriangle, Trash2, Loader2, ArrowLeft } from 'lucide-react';
import { getEliminationCandidates, confirmEliminate } from '@/lib/api/supplier';
import type { EliminationCandidate } from '@/lib/api/supplier';

export default function EliminationPage() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<EliminationCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  useEffect(() => { getEliminationCandidates().then(setCandidates).catch(() => {}).finally(() => setLoading(false)); }, []);

  const handleConfirm = async (supplierId: string) => {
    setConfirmingId(supplierId);
    try {
      await confirmEliminate(supplierId, '连续3次绩效评分≤60，系统自动淘汰预警');
      toast.success('已确认淘汰');
      setCandidates(prev => prev.filter(c => c.supplierId !== supplierId));
    } catch (e: any) { toast.error(e?.message || '操作失败'); }
    setConfirmingId(null);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><Trash2 size={17} /></div>
            <div>
              <div className="page-hero__title">淘汰候选</div>
              <div className="page-hero__sub">系统自动扫描连续 3 次绩效评分 ≤ 60 的供应商，需人工确认淘汰</div>
            </div>
          </div>
          <div className="page-hero__right">
            <button onClick={() => router.push('/supplier/repository')} className="neu-btn-soft"><ArrowLeft size={15} />返回供应商库</button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="neu-table-card py-14 text-center text-sm text-[var(--muted-foreground)]">加载中...</div>
      ) : candidates.length === 0 ? (
        <div className="neu-table-card py-12 text-center">
          <AlertTriangle size={32} className="mx-auto mb-3 text-[var(--muted-foreground)]/30" />
          <p className="text-sm text-[var(--muted-foreground)]">暂无淘汰候选</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]/60">系统每周一凌晨 1 点自动扫描</p>
        </div>
      ) : (
        <div className="neu-table-card overflow-hidden">
          <table className="workbench-table">
            <thead>
              <tr><th>供应商名称</th><th>触发原因</th><th className="w-24">操作</th></tr>
            </thead>
            <tbody>
              {candidates.map(c => (
                <tr key={c.supplierId}>
                  <td>
                    <Link href={`/supplier/${c.supplierId}`} className="text-sm font-semibold text-[var(--foreground)] hover:text-[var(--accent)]">
                      {c.name}
                    </Link>
                  </td>
                  <td className="text-sm text-[var(--muted-foreground)]">{c.reason}</td>
                  <td>
                    <button onClick={() => handleConfirm(c.supplierId)} disabled={confirmingId === c.supplierId}
                      className="neu-btn-xs is-danger">
                      {confirmingId === c.supplierId ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      {confirmingId === c.supplierId ? '处理中...' : '确认淘汰'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
