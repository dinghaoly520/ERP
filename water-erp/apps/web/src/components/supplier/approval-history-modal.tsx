'use client';

/**
 * 审核历史窗口（2026-09-30，admin only）
 * 全流程审批记录：跨供应商、含三级通过（初审/复审/终审）+ 驳回 + 退回补正，倒序展示。
 * 入口：审批窗口右上角「审核历史」按钮（Modal headerExtra）。
 */

import { useEffect, useMemo, useState } from 'react';
import { History, Loader2, Search } from 'lucide-react';
import { Modal } from '@/components/workbench';
import { listAllApprovalRecords, type AllApprovalRecord } from '@/lib/api/supplier';

const ACTION_META: Record<string, { label: string; tone: 'green' | 'orange' | 'red' }> = {
  APPROVED: { label: '通过', tone: 'green' },
  RETURNED: { label: '退回补正', tone: 'orange' },
  REJECTED: { label: '驳回', tone: 'red' },
};

const STAGE_LABEL: Record<string, string> = {
  STAFF: '初审',
  LEADER: '复审',
  ADMIN: '终审',
};

type Filter = 'ALL' | 'APPROVED' | 'RETURNED' | 'REJECTED';

export function ApprovalHistoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [records, setRecords] = useState<AllApprovalRecord[] | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    setRecords(null);
    setFilter('ALL');   // 关闭重开重置筛选
    setSearch('');      // 与搜索（避免残留上次状态）
    listAllApprovalRecords().then(setRecords).catch(() => setRecords([]));
  }, [open]);

  const filtered = useMemo(() => {
    if (!records) return null;
    let rows = records;
    if (filter !== 'ALL') rows = rows.filter(r => r.action === filter);
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter(r => r.supplier.name.toLowerCase().includes(q) || (r.supplier.creditCode ?? '').toLowerCase().includes(q));
    return rows;
  }, [records, filter, search]);

  const actionLabel = (r: AllApprovalRecord): string =>
    r.action === 'APPROVED'
      ? (r.stage && STAGE_LABEL[r.stage] ? `${STAGE_LABEL[r.stage]}通过` : '通过')
      : ACTION_META[r.action].label;

  const actionTone = (r: AllApprovalRecord): string =>
    r.action === 'APPROVED' ? 'green' : ACTION_META[r.action].tone;

  const toneCls: Record<string, string> = {
    green: 'text-[var(--success)] bg-[color-mix(in_oklch,var(--success)_12%,transparent)]',
    orange: 'text-[var(--warning)] bg-[color-mix(in_oklch,var(--warning)_12%,transparent)]',
    red: 'text-[var(--danger)] bg-[color-mix(in_oklch,var(--danger)_12%,transparent)]',
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="审核历史"
      description={`全流程审批记录 · ${filtered ? `${filtered.length} 条` : '…'}`}
      size="xl"
    >
      {/* 筛选 + 搜索 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="neu-segment rc-segment-inline" role="group" aria-label="按动作筛选"
          style={{ '--segs': 4 } as React.CSSProperties}
          data-index={String(['ALL', 'APPROVED', 'RETURNED', 'REJECTED'].indexOf(filter))}>
          <span className="neu-segment-thumb" aria-hidden="true" />
          {([
            { key: 'ALL', label: '全部' },
            { key: 'APPROVED', label: '通过' },
            { key: 'RETURNED', label: '退回补正' },
            { key: 'REJECTED', label: '驳回' },
          ] as const).map(f => (
            <button key={f.key} type="button" className="neu-segment-btn" aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-[220px] shrink-0">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="搜索供应商名称 / 信用代码" className="neu-input neu-input-sm !pl-8 !h-[32px] !text-xs" />
        </div>
      </div>

      {/* 记录表 */}
      {filtered === null ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--muted-foreground)]">
          <Loader2 size={16} className="animate-spin" />加载审核记录…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-sm text-[var(--muted-foreground)]">
          <History size={20} className="opacity-50" />
          暂无符合条件的审批记录
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[720px]">
            <thead>
              <tr>
                <th style={{ width: 220 }}>供应商</th>
                <th style={{ textAlign: 'center', width: 100 }}>动作</th>
                <th style={{ width: 120 }}>操作人</th>
                <th>缘由 / 原因</th>
                <th style={{ textAlign: 'center', width: 150 }}>时间</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id}>
                  <td>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-bold text-[var(--foreground)]" title={r.supplier.name}>{r.supplier.name}</div>
                      <div className="truncate font-mono text-[10px] tabular-nums text-[var(--muted-foreground)]">{r.supplier.creditCode || '—'}</div>
                    </div>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${toneCls[actionTone(r)]}`}>
                      {actionLabel(r)}
                    </span>
                  </td>
                  <td className="text-[12px] text-[var(--foreground)]">{r.reviewer?.displayName || '—'}</td>
                  <td className="max-w-[280px]">
                    <span className="block truncate text-[12px] text-[var(--muted-foreground)]" title={r.reason ?? ''}>{r.reason || '—'}</span>
                    {(r.attachmentIds ?? []).length > 0 && (
                      <span className="mt-0.5 block font-mono text-[10px] text-[var(--accent)]">📎 {r.attachmentIds!.length} 个附件（详情见审批窗口）</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }} className="font-mono text-[11px] tabular-nums text-[var(--muted-foreground)]">
                    {new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
