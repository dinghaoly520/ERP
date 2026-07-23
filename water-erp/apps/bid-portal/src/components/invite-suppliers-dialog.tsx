'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Search, Check, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { getSupplierList } from '@/lib/api/supplier';
import { listProjectSuppliers, inviteSuppliers } from '@/lib/api/bid';
import type { Supplier } from '@/lib/types';

interface Props {
  open: boolean;
  projectId: string;
  projectName: string;
  onClose: () => void;
  onInvited: () => void;
}

/**
 * 邀请供应商弹窗：从已入库(APPROVED)供应商库多选，加入项目 BidSupplier 名册。
 * 已在名册的标灰锁定（不可重复邀请）。确认后批量建名册 + 发邀请通知。
 */
export default function InviteSuppliersDialog({ open, projectId, projectName, onClose, onInvited }: Props) {
  const [loading, setLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSelected(new Set());
    setSearch('');
    Promise.all([
      getSupplierList({ status: 'APPROVED', pageSize: 200 }),
      listProjectSuppliers(projectId),
    ])
      .then(([res, roster]) => {
        setSuppliers(res.items ?? []);
        setInvitedIds(new Set((roster ?? []).map(r => r.supplierId).filter((s): s is string => !!s)));
      })
      .catch((e: any) => toast.error(e?.message || '加载供应商列表失败'))
      .finally(() => setLoading(false));
  }, [open, projectId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(s =>
      s.name.toLowerCase().includes(q) || (s.creditCode ?? '').toLowerCase().includes(q),
    );
  }, [suppliers, search]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleConfirm = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setSubmitting(true);
    try {
      const { added, skipped } = await inviteSuppliers(projectId, ids);
      toast.success(`已邀请 ${added} 家供应商${skipped > 0 ? `（跳过 ${skipped} 家已在名册）` : ''}`);
      onInvited();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || '邀请失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm" onClick={onClose} />

      <div className="bid-dialog relative mx-4 w-full max-w-[560px]" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-6 pb-4 pt-5">
          <div className="flex items-center gap-2">
            <UserPlus size={16} strokeWidth={1.7} className="text-[var(--accent)]" />
            <h2 className="text-[15px] font-bold tracking-tight text-[var(--foreground)]">邀请供应商</h2>
            <span className="text-[11px] text-[var(--muted-foreground)]">· {projectName}</span>
          </div>
          <button onClick={onClose} className="neu-btn-xs" title="关闭"><X size={15} strokeWidth={1.7} /></button>
        </div>
        <div className="wb-section-rule" />

        {/* Search */}
        <div className="px-6 py-3">
          <div className="relative">
            <Search size={14} strokeWidth={1.5} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索供应商名称或统一社会信用代码…"
              className="neu-input has-icon"
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--muted-foreground)]">
            <span>仅显示已入库（APPROVED）供应商</span>
            <span>已选 {selected.size} 家 · 已邀请 {invitedIds.size} 家</span>
          </div>
        </div>
        <div className="wb-section-rule" />

        {/* List */}
        <div className="max-h-[360px] overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
              <span className="ml-2 text-xs text-[var(--muted-foreground)]">加载供应商库…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-xs text-[var(--muted-foreground)]">{suppliers.length === 0 ? '暂无已入库供应商' : '无匹配结果'}</div>
          ) : (
            <div className="space-y-1">
              {filtered.map(s => {
                const invited = invitedIds.has(s.id);
                const checked = invited || selected.has(s.id);
                return (
                  <label
                    key={s.id}
                    className={`bid-pick-row flex items-center gap-3 px-3 py-2 ${invited ? 'cursor-default opacity-50' : 'cursor-pointer'}`}
                  >
                    <input
                      type="checkbox"
                      className="neu-checkbox"
                      disabled={invited}
                      checked={checked}
                      onChange={() => !invited && toggle(s.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-[var(--foreground)]">{s.name}</div>
                      <div className="font-mono text-[10px] text-[var(--muted-foreground)]">{s.creditCode || '—'}</div>
                    </div>
                    {invited && (
                      <span className="bid-pill" style={{ '--c': 'var(--success)' } as React.CSSProperties}>已邀请</span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="wb-section-rule" />

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4">
          <button onClick={onClose} className="neu-btn-soft h-[38px]">取消</button>
          <button
            onClick={handleConfirm}
            disabled={submitting || selected.size === 0}
            className="neu-btn-primary !h-[38px]"
          >
            <Check size={14} strokeWidth={2} />
            {submitting ? '邀请中…' : `确认邀请（${selected.size}）`}
          </button>
        </div>
      </div>
    </div>
  );
}
