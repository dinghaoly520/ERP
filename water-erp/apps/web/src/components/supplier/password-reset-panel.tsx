'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, KeyRound, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '@/components/workbench';
import {
  approveSupplierPasswordReset,
  fetchSupplierPasswordResets,
  rejectSupplierPasswordReset,
  type SupplierPasswordResetRequest,
} from '@/lib/api/supplier';

/**
 * 供应商密码重置审批（2026-09-03）：供应商门户「忘记密码」提交的重置申请在此审批
 * （供应商管理中心 · 供应商审批页顶部），由 staff/leader 日常处理；
 * 批准后按申请人提交的新密码生效（申请时已做短信验证码核验 + 人工电话核验提示）。
 */
export function SupplierPasswordResetPanel() {
  const [items, setItems] = useState<SupplierPasswordResetRequest[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<SupplierPasswordResetRequest | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const load = useCallback(async () => {
    try {
      setItems(await fetchSupplierPasswordResets());
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function approve(row: SupplierPasswordResetRequest) {
    setBusyId(row.id);
    try {
      await approveSupplierPasswordReset(row.id);
      toast.success(`已通过 ${row.requestedUsername} 的密码重置`);
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
      await rejectSupplierPasswordReset(rejecting.id, rejectNote.trim() || undefined);
      toast.success('已拒绝该重置申请');
      setRejecting(null);
      setRejectNote('');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败，请稍后重试');
    } finally {
      setBusyId(null);
    }
  }

  const pending = items ?? [];
  const supplierName = (row: SupplierPasswordResetRequest) =>
    row.matchedUser?.company || row.matchedUser?.displayName || row.requestedUsername;

  return (
    <div className="neu-table-card">
      <div className="neu-table-card-header flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-[9px] text-[var(--accent)]" style={{ background: 'color-mix(in oklch, var(--accent) 9%, transparent)' }}>
            <KeyRound size={14} strokeWidth={1.9} />
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-[0.95rem] font-bold tracking-tight text-[var(--foreground)]">供应商密码重置</span>
            <span className="text-[11px] text-[var(--muted-foreground)]">
              供应商门户「忘记密码」申请 · 已短信核验，批准后按新密码生效
            </span>
          </div>
          {pending.length > 0 && (
            <span className="neu-tab-count !static">{pending.length}</span>
          )}
        </div>
        <button onClick={load} className="neu-btn-xs" aria-label="刷新密码重置申请">
          <RefreshCw size={12} />
        </button>
      </div>

      {items === null ? (
        <div className="px-4 py-6 text-center text-xs text-[var(--muted-foreground)]">加载中…</div>
      ) : pending.length === 0 ? (
        <div className="px-4 py-5 text-center text-xs text-[var(--muted-foreground)]">暂无待审批的密码重置申请</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[720px]">
            <thead>
              <tr>
                <th>供应商</th>
                <th style={{ textAlign: 'center' }}>登录账号（信用代码）</th>
                <th>申请人 / 联系电话</th>
                <th style={{ textAlign: 'center' }}>申请时间</th>
                <th style={{ textAlign: 'center' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((row) => (
                <tr key={row.id} className="row-clickable">
                  <td className="font-medium">{supplierName(row)}</td>
                  <td style={{ textAlign: 'center' }} className="font-mono text-xs">{row.requestedUsername}</td>
                  <td>{row.applicantName} · {row.applicantContact}</td>
                  <td style={{ textAlign: 'center' }} className="text-xs">{new Date(row.requestedAt).toLocaleString('zh-CN', { hour12: false })}</td>
                  <td style={{ textAlign: 'center' }}>
                    <div className="flex items-center justify-center gap-1.5">
                      <button onClick={() => approve(row)} disabled={busyId === row.id} className="neu-btn-xs is-success">
                        <Check size={12} />{busyId === row.id ? '处理中' : '通过'}
                      </button>
                      <button onClick={() => { setRejecting(row); setRejectNote(''); }} disabled={busyId === row.id} className="neu-btn-xs is-danger">
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
        title="拒绝密码重置"
        description={<>供应商：<strong className="text-[var(--foreground)]">{rejecting && supplierName(rejecting)}</strong></>}
        footer={
          <>
            <button onClick={() => setRejecting(null)} className="neu-btn-soft">取消</button>
            <button onClick={reject} disabled={busyId !== null} className="neu-btn-soft is-danger">确认拒绝</button>
          </>
        }
      >
        <label className="block text-sm">
          拒绝原因（供应商重新申请时可见）
          <textarea
            className="neu-input mt-1.5 text-sm"
            rows={3}
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="如：电话核验未通过，请致电采购中心核实身份"
          />
        </label>
      </Modal>
    </div>
  );
}
