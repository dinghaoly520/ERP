'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Building2, Check, Loader2, Tags, X } from 'lucide-react';
import { approveBusinessTag, listBusinessTags, rejectBusinessTag, type BusinessTagRow } from '@/lib/api/supplier';


/**
 * 业务标签审核（供应商注册选择制）：供应商注册时自创的标签进入待审，
 * 审核通过后入池，成为后续注册供应商的可选项。
 * 按来源供应商合并分组（2026-10-08 用户裁定）：同一供应商的多个标签归一组展示，
 * 组内每个标签保留独立的「通过入池 / 拒绝」操作（逐条裁定，不整组连带）。
 * 常驻于 /supplier/approval（与密码重置审批同页），空态在卡片内提示——入口稳定可寻。
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

  /* 来源供应商分组（key=供应商 id，name 兜底）：同组多标签合并展示；
     组按待审数降序，组内保持提交时间倒序（后端已排序）。 */
  const groups = useMemo(() => {
    if (!pending) return null;
    const map = new Map<string, { key: string; label: string; tags: BusinessTagRow[] }>();
    for (const t of pending) {
      const s = t.createdBySupplier;
      const key = s?.id ?? s?.name ?? '未归属';
      const label = s?.name?.trim() || '未归属供应商';
      const g = map.get(key) ?? { key, label, tags: [] };
      g.tags.push(t);
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) =>
      a.label === '未归属供应商' ? 1 : b.label === '未归属供应商' ? -1 : b.tags.length - a.tags.length || a.label.localeCompare(b.label, 'zh'),
    );
  }, [pending]);

  const emptyHint = pending === null
    ? '加载中…'
    : '暂无待审核的自创标签 · 供应商注册自创标签后将出现在此处';

  return (
    <div className="neu-table-card !p-0">
      <div className="neu-table-card-header flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-[9px] text-[var(--accent)]" style={{ background: 'color-mix(in oklch, var(--accent) 9%, transparent)' }}>
            <Tags size={14} strokeWidth={1.9} />
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-[0.95rem] font-bold tracking-tight text-[var(--foreground)]">业务标签审核</span>
            <span className="text-[11px] text-[var(--muted-foreground)]">供应商注册自创标签，通过后进入标签库供后续注册选择</span>
          </div>
        </div>
        {pending !== null && pending.length > 0 && (
          <span className="neu-tab-count">{pending.length} 待审 · {groups?.length ?? 0} 家供应商</span>
        )}
      </div>
      {(pending === null || pending.length === 0) && (
        <div className="px-4 py-5 text-center text-xs text-[var(--muted-foreground)]">{emptyHint}</div>
      )}
      {groups !== null && groups.length > 0 && (
        <div className="flex max-h-[52vh] flex-col gap-2.5 overflow-y-auto px-4 pb-4 pt-1">
          {groups.map(g => (
            <div key={g.key} className="overflow-hidden rounded-xl border border-[var(--border)]">
              {/* 组头：来源供应商（同一供应商的标签合并于此）+ 待审计数 + 供应商库跳转 */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--border)] bg-[color-mix(in_oklch,var(--foreground)_2%,transparent)] px-3.5 py-2">
                <Building2 size={13} className="shrink-0 text-[var(--muted-foreground)]" />
                <a
                  className="min-w-0 truncate text-[13px] font-bold text-[var(--foreground)] hover:text-[var(--accent)] hover:underline"
                  href={`/supplier/repository?search=${encodeURIComponent(g.label)}`}
                  title="在供应商库中搜索"
                >
                  {g.label}
                </a>
                <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-[var(--muted-foreground)]">{g.tags.length} 条待审</span>
              </div>
              {/* 列头 */}
              <div className="grid grid-cols-[1fr_150px_180px] text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                <div className="px-3.5 py-1.5">标签名称</div>
                <div className="px-3 py-1.5">提交时间</div>
                <div className="px-3 py-1.5 text-right">操作</div>
              </div>
              {g.tags.map(t => (
                <div key={t.id} className="grid grid-cols-[1fr_150px_180px] items-center border-t border-[color-mix(in_oklch,var(--border)_60%,transparent)]">
                  <div className="px-3.5 py-2 text-[13px] font-semibold text-[var(--foreground)]">{t.name}</div>
                  <div className="px-3 py-2 text-xs text-[var(--muted-foreground)]">
                    {new Date(t.createdAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className="px-3 py-2">
                    {/* 逐条独立裁定：同组标签互不连带 */}
                    <div className="flex justify-end gap-1.5">
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
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
