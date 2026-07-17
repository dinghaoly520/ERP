'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { AlertTriangle, Trash2, RefreshCw, X } from 'lucide-react';
import { getEliminationCandidates, confirmEliminate } from '@/lib/api/supplier';
import type { EliminationCandidate } from '@/lib/api/supplier';
import { Modal } from '@/components/workbench';

export default function EliminationPage() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<EliminationCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmModal, setConfirmModal] = useState<EliminationCandidate | null>(null);
  const [reason, setReason] = useState('');

  const loadData = async () => {
    setLoading(true);
    try { setCandidates(await getEliminationCandidates()); } catch {}
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const handleManualScan = async () => {
    setRefreshing(true);
    toast.info('正在扫描供应商绩效数据…');
    try {
      const fresh = await getEliminationCandidates();
      setCandidates(fresh);
      toast.success(fresh.length > 0 ? `扫描完成，发现 ${fresh.length} 个淘汰候选` : '扫描完成，当前无淘汰候选');
    } catch (e: any) {
      toast.error('扫描失败，请稍后重试');
    }
    setRefreshing(false);
  };

  const openConfirm = (c: EliminationCandidate) => {
    setConfirmModal(c);
    setReason(c.reason);
  };

  const executeEliminate = async () => {
    if (!confirmModal) return;
    if (!reason.trim()) { toast.error('请填写淘汰原因'); return; }
    const target = confirmModal;
    const prevCandidates = candidates;
    setCandidates(prev => prev.filter(c => c.supplierId !== target.supplierId));
    setConfirmModal(null);
    let cancelled = false;
    toast(`已淘汰「${target.name}」`, {
      description: '4 秒内可撤销',
      duration: 4000,
      action: { label: '撤销', onClick: () => { cancelled = true; setCandidates(prevCandidates); } },
    });
    await new Promise(r => setTimeout(r, 4200));
    if (cancelled) return;
    try {
      await confirmEliminate(target.supplierId, reason.trim());
      toast.success('已确认淘汰');
    } catch (e: any) {
      toast.error(e?.message || '操作失败');
      setCandidates(prevCandidates);
    }
  };

  return (
    <div className="flex flex-col gap-4">
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
            <button onClick={handleManualScan} disabled={refreshing || loading} className="neu-btn-xs gap-1" title="手动触发绩效扫描">
              <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? '扫描中...' : '手动扫描'}
            </button>
            <button onClick={() => router.push('/supplier/repository')} className="neu-btn-soft">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              返回供应商库
            </button>
          </div>
        </div>
        <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }}>
          <div className="text-[10px] text-[var(--muted-foreground)]">
            自动扫描周期：每周一凌晨 1 点。{refreshing ? '正在手动扫描...' : `当前 ${candidates.length} 个候选 ${loading ? '' : '，点击「手动扫描」立即执行'}`}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="neu-table-card py-14 text-center text-sm text-[var(--muted-foreground)]">加载中...</div>
      ) : candidates.length === 0 ? (
        <div className="neu-table-card py-12 text-center">
          <AlertTriangle size={32} className="mx-auto mb-3 text-[var(--muted-foreground)]/30" />
          <p className="text-sm text-[var(--muted-foreground)]">暂无淘汰候选</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]/60">点击「手动扫描」可立即执行一次扫描</p>
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
                    <button onClick={() => openConfirm(c)} className="neu-btn-xs is-danger">
                      <Trash2 size={12} />确认淘汰
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmModal && (
        <Modal
          open
          onClose={() => setConfirmModal(null)}
          title="确认淘汰供应商"
          description={<>供应商：<strong className="text-[var(--foreground)]">{confirmModal.name}</strong></>}
          footer={
            <>
              <button onClick={() => setConfirmModal(null)} className="neu-btn-soft">取消</button>
              <button onClick={executeEliminate} disabled={!reason.trim()} className="neu-btn-soft is-danger">确认淘汰</button>
            </>
          }
        >
          <p className="text-xs text-[var(--muted-foreground)]">淘汰后供应商将移出资源池。操作在 4 秒撤销期内可撤回，过期后不可逆。</p>
          <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="请填写淘汰原因（将记录在案）..." className="neu-input w-full h-24 resize-none text-sm" />
        </Modal>
      )}
    </div>
  );
}
