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
type TagView = 'PENDING' | 'APPROVED' | 'REJECTED';

export function BusinessTagReview({ onChanged }: { onChanged?: () => void }) {
  const [view, setView] = useState<TagView>('PENDING');
  const [rows, setRows] = useState<BusinessTagRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (v: TagView) => {
    try {
      setRows(await listBusinessTags(v));
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => { load(view); }, [load, view]);
  // 切视图时清 busy，防跨视图残留禁用态
  useEffect(() => { setBusyId(null); }, [view]);

  async function act(tag: BusinessTagRow, approve: boolean) {
    setBusyId(tag.id);
    try {
      if (approve) await approveBusinessTag(tag.id);
      else await rejectBusinessTag(tag.id);
      toast.success(approve ? `「${tag.name}」已审核通过，加入标签库` : `「${tag.name}」已拒绝`);
      await load(view);
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
    if (!rows) return null;
    const map = new Map<string, { key: string; label: string; supplierNo?: string; tags: BusinessTagRow[] }>();
    for (const t of rows) {
      const s = t.createdBySupplier;
      /* 来源区分（2026-10-15）：无来源供应商时按 source 细分——migration=存量标签回填入池
         （2026-10-14 脚本），非「未归属供应商」误导口径 */
      const key = s?.id ?? s?.name ?? (t.source === 'migration' ? 'migration' : '未归属');
      const label = s?.name?.trim() || (t.source === 'migration' ? '历史标签回填（存量公共词入池）' : '未归属供应商');
      const g = map.get(key) ?? { key, label, supplierNo: s?.supplierNo, tags: [] };
      g.tags.push(t);
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) =>
      (/^(未归属供应商|历史标签回填)/.test(a.label) ? 1 : /^(未归属供应商|历史标签回填)/.test(b.label) ? -1 : b.tags.length - a.tags.length) || a.label.localeCompare(b.label, 'zh'),
    );
  }, [rows]);

  const VIEW_META: Record<TagView, { label: string; empty: string }> = {
    PENDING: { label: '待审核', empty: '暂无待审核的自创标签 · 供应商注册自创标签后将出现在此处' },
    APPROVED: { label: '已通过', empty: '暂无已通过的标签 · 审核通过的标签进入标签库供注册选择' },
    REJECTED: { label: '已拒绝', empty: '暂无已拒绝的标签' },
  };
  const emptyHint = rows === null ? '加载中…' : VIEW_META[view].empty;

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
        <div className="flex items-center gap-2">
          {rows !== null && rows.length > 0 && (
            <span className="neu-tab-count">{rows.length} 条 · {groups?.length ?? 0} 家供应商</span>
          )}
          {/* 展示不全修复（2026-10-15）：待审之外可切换查看已通过/已拒绝历史（复核留痕） */}
          <div className="neu-segment rc-segment-inline" role="group" aria-label="标签状态视图" data-count="3"
            data-index={String((['PENDING', 'APPROVED', 'REJECTED'] as TagView[]).indexOf(view))}>
            <span className="neu-segment-thumb" aria-hidden="true" />
            {(['PENDING', 'APPROVED', 'REJECTED'] as TagView[]).map(v => (
              <button key={v} type="button" className="neu-segment-btn" aria-pressed={view === v}
                onClick={() => setView(v)}>{VIEW_META[v].label}</button>
            ))}
          </div>
        </div>
      </div>
      {(rows === null || rows.length === 0) && (
        <div className="px-4 py-5 text-center text-xs text-[var(--muted-foreground)]">{emptyHint}</div>
      )}
      {groups !== null && groups.length > 0 && (
        <div className="flex max-h-[min(62vh,600px)] flex-col gap-2.5 overflow-y-auto px-4 pb-4 pt-1">
          {groups.map(g => (
            <div key={g.key} className="shrink-0 overflow-hidden rounded-xl border border-[var(--border)]">
              {/* 组头：来源供应商（同一供应商的标签合并于此）+ 待审计数 + 供应商库跳转 */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--border)] bg-[color-mix(in_oklch,var(--foreground)_2%,transparent)] px-3.5 py-2">
                <Building2 size={13} className="shrink-0 text-[var(--muted-foreground)]" />
                <a
                  className="min-w-0 truncate text-[13px] font-bold text-[var(--foreground)] hover:text-[var(--accent)] hover:underline"
                  href={`/supplier/repository?search=${encodeURIComponent(g.label)}`}
                  title={`${g.label}${g.supplierNo ? `（${g.supplierNo}）` : ''} · 在供应商库中搜索`}
                >
                  {g.label}
                </a>
                {g.supplierNo && (
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--muted-foreground)]">{g.supplierNo}</span>
                )}
                <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-[var(--muted-foreground)]">{g.tags.length} 条{view === 'PENDING' ? '待审' : '记录'}</span>
              </div>
              {/* 列头 */}
              <div className="grid grid-cols-[1fr_150px_200px] text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                <div className="px-3.5 py-1.5">标签名称</div>
                <div className="px-3 py-1.5">提交时间</div>
                <div className="px-3 py-1.5 text-right">{view === 'PENDING' ? '操作' : '审核留痕'}</div>
              </div>
              {g.tags.map(t => (
                <div key={t.id} className="grid grid-cols-[1fr_150px_200px] items-center border-t border-[color-mix(in_oklch,var(--border)_60%,transparent)]">
                  {/* 展示不全修复：长标签 break-all 完整换行展示，不再溢出/截断 */}
                  <div className="min-w-0 break-all px-3.5 py-2 text-[13px] font-semibold text-[var(--foreground)]" title={t.name}>{t.name}</div>
                  <div className="whitespace-nowrap px-3 py-2 text-xs text-[var(--muted-foreground)]">
                    {new Date(t.createdAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className="px-3 py-2">
                    {view !== 'PENDING' ? (
                      /* 已审视图：只读留痕（审核人 · 审核时间） */
                      <div className="text-right text-[11px] leading-4 text-[var(--muted-foreground)]" title={`${t.reviewedBy?.displayName ?? '—'} 于 ${t.reviewedAt ?? '—'}`}>
                        <span className="font-semibold text-[var(--foreground)]">{t.reviewedBy?.displayName ?? '—'}</span>
                        <br />
                        {t.reviewedAt ? new Date(t.reviewedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </div>
                    ) : null}
                    {/* 逐条独立裁定（仅待审视图）：同组标签互不连带 */}
                    {view === 'PENDING' && (
                    <div className="flex flex-nowrap justify-end gap-1.5">
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
                    )}
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
