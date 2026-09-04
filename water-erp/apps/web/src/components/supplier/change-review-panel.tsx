'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Check, FilePenLine, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '@/components/workbench';
import {
  approveSupplierChange,
  fetchPendingSupplierChanges,
  rejectSupplierChange,
  type SupplierChangePendingRow,
} from '@/lib/api/supplier';

/**
 * 供应商资料变更审批：:3004 供应商门户「资料变更」提交（字段白名单内 oldValue→newValue + 理由），
 * 审批中心批准后由后端原子应用字段（公司名变更同步登录用户名）。
 */
export function ChangeReviewPanel() {
  const [items, setItems] = useState<SupplierChangePendingRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<SupplierChangePendingRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    try {
      setItems(await fetchPendingSupplierChanges());
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function approve(row: SupplierChangePendingRow) {
    setBusyId(row.id);
    try {
      await approveSupplierChange(row.id);
      toast.success(`已通过「${row.supplier?.name ?? ''}」的资料变更`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '审批失败，请稍后重试');
    } finally {
      setBusyId(null);
    }
  }

  async function reject() {
    if (!rejecting) return;
    setBusyId(rejecting.id);
    try {
      await rejectSupplierChange(rejecting.id, rejectReason.trim() || undefined);
      toast.success('已拒绝该资料变更');
      setRejecting(null);
      setRejectReason('');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败，请稍后重试');
    } finally {
      setBusyId(null);
    }
  }

  const pending = items ?? [];

  return (
    <div className="neu-table-card !p-0">
      <div className="neu-table-card-header flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-[9px] text-[var(--accent)]" style={{ background: 'color-mix(in oklch, var(--accent) 9%, transparent)' }}>
            <FilePenLine size={14} strokeWidth={1.9} />
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-[0.95rem] font-bold tracking-tight text-[var(--foreground)]">资料变更</span>
            <span className="text-[11px] text-[var(--muted-foreground)]">供应商门户提交的资料修改 · 批准后立即生效</span>
          </div>
          {pending.length > 0 && <span className="neu-tab-count !static">{pending.length}</span>}
        </div>
        <button onClick={load} className="neu-btn-xs" aria-label="刷新资料变更">
          <RefreshCw size={12} />
        </button>
      </div>

      {items === null ? (
        <div className="px-4 py-6 text-center text-xs text-[var(--muted-foreground)]">加载中…</div>
      ) : pending.length === 0 ? (
        <div className="px-4 py-5 text-center text-xs text-[var(--muted-foreground)]">暂无待审批的资料变更 · 供应商在门户提交资料修改后将出现在此处</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[780px]">
            <thead>
              <tr>
                <th>供应商</th>
                <th style={{ textAlign: 'center' }}>变更字段</th>
                <th>原值 → 新值</th>
                <th>变更原因</th>
                <th style={{ textAlign: 'center' }}>申请时间</th>
                <th style={{ textAlign: 'center' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((row) => (
                <tr key={row.id} className="row-clickable">
                  <td className="font-medium">
                    {row.supplier?.name || '—'}
                    {row.fieldName === 'convertToRegular' && (
                      <span className="ml-1.5 inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold" style={{ background: 'color-mix(in oklch, var(--warning) 12%, transparent)', color: 'var(--warning)' }}>临时转正</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>{row.fieldLabel || row.fieldName}</td>
                  <td>
                    <div className="flex items-center gap-1.5 min-w-0 max-w-[320px]">
                      <span className="truncate text-[var(--muted-foreground)]" title={row.oldValue ?? ''}>{row.oldValue || '（空）'}</span>
                      <ArrowRight size={12} className="shrink-0 text-[var(--accent)]" />
                      <span className="truncate font-semibold" title={row.newValue ?? ''}>{row.newValue || '（空）'}</span>
                    </div>
                  </td>
                  <td className="max-w-[180px] truncate" title={row.reason ?? ''}>{row.reason || '—'}</td>
                  <td style={{ textAlign: 'center' }} className="text-xs">{new Date(row.createdAt).toLocaleString('zh-CN', { hour12: false })}</td>
                  <td style={{ textAlign: 'center' }}>
                    <div className="flex items-center justify-center gap-1.5">
                      <button onClick={() => approve(row)} disabled={busyId === row.id} className="neu-btn-xs is-success">
                        <Check size={12} />{busyId === row.id ? '处理中' : '通过'}
                      </button>
                      <button onClick={() => { setRejecting(row); setRejectReason(''); }} disabled={busyId === row.id} className="neu-btn-xs is-danger">
                        <X size={12} />拒绝
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title="拒绝资料变更"
        description={<>供应商：<strong className="text-[var(--foreground)]">{rejecting?.supplier?.name}</strong>（{rejecting?.fieldLabel || rejecting?.fieldName}）</>}
        footer={
          <>
            <button onClick={() => setRejecting(null)} className="neu-btn-soft">取消</button>
            <button onClick={reject} disabled={busyId !== null} className="neu-btn-soft is-danger">确认拒绝</button>
          </>
        }
      >
        <label className="block text-sm">
          拒绝原因（供应商在门户可见）
          <textarea
            className="neu-input mt-1.5 text-sm"
            rows={3}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="如：证明材料不足，请补充后再提交"
          />
        </label>
      </Modal>
    </div>
  );
}
