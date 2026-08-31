'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, Loader2, Tags, X } from 'lucide-react';
import { approveBusinessTag, listBusinessTags, rejectBusinessTag, type BusinessTagRow } from '@/lib/api/supplier';


/**
 * 业务标签审核（供应商注册选择制）：供应商注册时自创的标签进入待审，
 * 审核通过后入池，成为后续注册供应商的可选项。无待审时不占版面（单行状态条）。
 */
export function BusinessTagReview({ onChanged }: { onChanged?: () => void }) {
  const [pending, setPending] = useState<BusinessTagRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPending(await listBusinessTags('PENDING'));
    } catch {
      setPending([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function act(tag: BusinessTagRow, approve: boolean) {
    setBusyId(tag.id);
    try {
      if (approve) await approveBusinessTag(tag.id);
      else await rejectBusinessTag(tag.id);
      toast.success(approve ? `「${tag.name}」已审核通过，加入标签库` : `「${tag.name}」已拒绝`);
      await load();
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message || '操作失败');
    } finally {
      setBusyId(null);
    }
  }

  if (pending === null) {
    return <div className="py-2 text-xs text-[var(--muted-foreground)] flex items-center gap-2"><Loader2 size={13} className="animate-spin" />业务标签审核加载中…</div>;
  }
  if (pending.length === 0) {
    return (
      <div className="flex items-center gap-2 py-1 text-xs text-[var(--muted-foreground)]">
        <Tags size={13} strokeWidth={1.75} />
        业务标签库：暂无待审核的自创标签（供应商注册自创标签后将出现在此处）
      </div>
    );
  }

  return (
    <div className="neu-table-card !p-0 mb-4">
      <div className="neu-table-card-header flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Tags size={15} strokeWidth={1.75} className="text-[var(--accent)]" />
          <span className="text-sm font-bold">业务标签审核</span>
          <span className="text-xs text-[var(--muted-foreground)]">供应商注册自创标签，通过后进入标签库供后续注册选择</span>
        </div>
        <span className="neu-tab-count">{pending.length} 待审</span>
      </div>
      <div className="overflow-x-auto">
        <table className="neu-table w-full min-w-[600px]">
          <thead>
            <tr>
              <th>标签名称</th>
              <th>来源供应商</th>
              <th>提交时间</th>
              <th style={{ width: 180 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((t) => (
              <tr key={t.id}>
                <td className="font-semibold">{t.name}</td>
                <td>
                  {t.createdBySupplier?.name
                    ? <a className="text-[var(--accent)] hover:underline" href={`/supplier/${t.createdBySupplier.supplierNo}`}>{t.createdBySupplier.name}</a>
                    : '—'}
                </td>
                <td className="text-xs">{new Date(t.createdAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                <td>
                  <div className="flex gap-1.5">
                    <button
                      className="neu-btn-xs is-success"
                      disabled={busyId === t.id}
                      onClick={() => act(t, true)}
                    >
                      {busyId === t.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}通过入池
                    </button>
                    <button
                      className="neu-btn-xs is-danger"
                      disabled={busyId === t.id}
                      onClick={() => act(t, false)}
                    >
                      <X size={12} />拒绝
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
