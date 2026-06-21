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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="glass-card w-full max-w-[560px] mx-4 rounded-2xl shadow-[0_24px_80px_rgba(15,47,87,0.18)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#edf2f7]">
          <div className="flex items-center gap-2">
            <UserPlus size={16} strokeWidth={1.5} className="text-[#064ea2]" />
            <h2 className="text-sm font-black text-[#18243a]">邀请供应商</h2>
            <span className="text-[11px] text-[#8a96aa]">· {projectName}</span>
          </div>
          <button onClick={onClose} className="rounded-xl p-1.5 text-[#94a3b8] hover:bg-[#f8fafc] hover:text-[#18243a] transition">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-[#edf2f7]">
          <div className="relative">
            <Search size={14} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索供应商名称或统一社会信用代码…"
              className="workbench-input w-full pl-9"
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] text-[#8a96aa]">
            <span>仅显示已入库（APPROVED）供应商</span>
            <span>已选 {selected.size} 家 · 已邀请 {invitedIds.size} 家</span>
          </div>
        </div>

        {/* List */}
        <div className="px-6 py-3 max-h-[360px] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-4 h-4 border-2 border-[#bfdbfe] border-t-[#064ea2] rounded-full animate-spin" />
              <span className="ml-2 text-xs text-[#8a96aa]">加载供应商库…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#8a96aa]">{suppliers.length === 0 ? '暂无已入库供应商' : '无匹配结果'}</div>
          ) : (
            <div className="space-y-1">
              {filtered.map(s => {
                const invited = invitedIds.has(s.id);
                const checked = invited || selected.has(s.id);
                return (
                  <label
                    key={s.id}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 transition ${
                      invited ? 'opacity-50' : 'hover:bg-[#f8fafc] cursor-pointer'
                    }`}
                  >
                    <span
                      className={`flex items-center justify-center w-4 h-4 rounded border transition ${
                        checked ? 'bg-[#064ea2] border-[#064ea2]' : 'border-[#cbd5e1] bg-white'
                      }`}
                    >
                      {checked && <Check size={11} strokeWidth={3} className="text-white" />}
                    </span>
                    <input
                      type="checkbox"
                      className="sr-only"
                      disabled={invited}
                      checked={checked}
                      onChange={() => !invited && toggle(s.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-[#18243a] truncate">{s.name}</div>
                      <div className="text-[10px] text-[#8a96aa] font-mono">{s.creditCode || '—'}</div>
                    </div>
                    {invited && (
                      <span className="text-[9px] font-bold text-[#11a874] bg-[#11a87412] rounded-full px-1.5 py-0.5">已邀请</span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[#edf2f7]">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-[12px] font-bold text-[#5a6d8a] hover:bg-[#f8fafc] transition"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={submitting || selected.size === 0}
            className="flex items-center gap-1.5 rounded-xl bg-[#064ea2] px-5 py-2 text-[12px] font-bold text-white hover:bg-[#054480] transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Check size={13} strokeWidth={2} />
            {submitting ? '邀请中…' : `确认邀请（${selected.size}）`}
          </button>
        </div>
      </div>
    </div>
  );
}
