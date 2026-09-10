'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { getExpertOperationHistory, type ExpertOperationHistoryItem } from '@/lib/api/expert';
import { Modal, StatusBadge, TableSkeleton } from '@/components/workbench';
import { History, RefreshCw, AlertTriangle, ChevronLeft, ChevronRight, ShieldCheck, Search, X, CalendarDays } from 'lucide-react';

/** 审计动作 → 中文标签 */
const ACTION_LABEL: Record<string, string> = {
  EXPERT_CREATE: '录入专家',
  EXPERT_IMPORT: '批量导入',
  EXPERT_APPROVE: '审核入库',
  EXPERT_UPDATE: '更新资料',
  EXPERT_ENABLE: '启用',
  EXPERT_DISABLE: '停用',
  EXPERT_BATCH_ENABLE: '批量启用',
  EXPERT_BATCH_DISABLE: '批量停用',
  EXPERT_SUSPEND: '暂停',
  EXPERT_RESUME: '恢复',
  EXPERT_RETIRE: '退库',
  EXPERT_RETIRE_IGNORE: '忽略退库预警',
  EXPERT_EVALUATE: '履职评价',
  EXPERT_VIOLATION_RECORDED: '违规记录',
};

/** 操作类型下拉选项（按生命周期顺序） */
const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: 'EXPERT_CREATE', label: '录入专家' },
  { value: 'EXPERT_IMPORT', label: '批量导入' },
  { value: 'EXPERT_APPROVE', label: '审核入库' },
  { value: 'EXPERT_UPDATE', label: '更新资料' },
  { value: 'EXPERT_ENABLE', label: '启用' },
  { value: 'EXPERT_DISABLE', label: '停用' },
  { value: 'EXPERT_BATCH_ENABLE', label: '批量启用' },
  { value: 'EXPERT_BATCH_DISABLE', label: '批量停用' },
  { value: 'EXPERT_SUSPEND', label: '暂停' },
  { value: 'EXPERT_RESUME', label: '恢复' },
  { value: 'EXPERT_RETIRE', label: '退库' },
  { value: 'EXPERT_RETIRE_IGNORE', label: '忽略退库预警' },
  { value: 'EXPERT_EVALUATE', label: '履职评价' },
  { value: 'EXPERT_VIOLATION_RECORDED', label: '违规记录' },
];

/** 动作 → 徽章色 */
const ACTION_TONE: Record<string, 'green' | 'blue' | 'orange' | 'red' | 'gray' | 'purple'> = {
  EXPERT_CREATE: 'green',
  EXPERT_IMPORT: 'blue',
  EXPERT_APPROVE: 'green',
  EXPERT_UPDATE: 'blue',
  EXPERT_ENABLE: 'green',
  EXPERT_DISABLE: 'gray',
  EXPERT_BATCH_ENABLE: 'green',
  EXPERT_BATCH_DISABLE: 'gray',
  EXPERT_SUSPEND: 'orange',
  EXPERT_RESUME: 'blue',
  EXPERT_RETIRE: 'red',
  EXPERT_RETIRE_IGNORE: 'gray',
  EXPERT_EVALUATE: 'purple',
  EXPERT_VIOLATION_RECORDED: 'red',
};

/** 从 details 提取事由文本（按动作定制，避免冗长 JSON） */
function detailText(action: string, d: Record<string, unknown> | null): string {
  if (!d) return '';
  const name = typeof d.expertName === 'string' ? d.expertName : '';
  const reason = typeof d.reason === 'string' ? d.reason : '';
  switch (action) {
    case 'EXPERT_CREATE':
      return [name, typeof d.specialty === 'string' ? d.specialty : ''].filter(Boolean).join(' · ');
    case 'EXPERT_IMPORT':
    case 'EXPERT_BATCH_ENABLE':
    case 'EXPERT_BATCH_DISABLE':
      return `共 ${d.count ?? d.imported ?? '?'} 位专家${reason ? ` · 事由：${reason}` : ''}`;
    case 'EXPERT_EVALUATE':
      return `${name ? name + ' ' : ''}综合 ${d.overallGrade ?? '—'}${d.updated ? ' · 更新' : ''}`;
    case 'EXPERT_APPROVE':
    case 'EXPERT_RESUME':
    case 'EXPERT_SUSPEND':
    case 'EXPERT_RETIRE': {
      const segs = [name];
      if (d.from && d.to) segs.push(`${d.from} → ${d.to}`);
      if (reason) segs.push(`事由：${reason}`);
      return segs.filter(Boolean).join(' · ');
    }
    case 'EXPERT_RETIRE_IGNORE':
      return name ? `${name} · 90 天内不再扫描` : '90 天内不再扫描';
    case 'EXPERT_VIOLATION_RECORDED':
      return [typeof d.type === 'string' ? d.type : '', typeof d.detail === 'string' ? d.detail : ''].filter(Boolean).join('：');
    default:
      return [name, reason].filter(Boolean).join(' · ');
  }
}

/** 本地时区取 YYYY-MM-DD（用于按天分组与展示） */
function dayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 专家管理操作历史抽屉（审计只读，无任何修改/删除入口） */
export function ExpertOperationHistory({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<ExpertOperationHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);
  // 检索条件
  const [action, setAction] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  // 已提交的检索条件（点击「查询」才生效，避免每次输入都触发请求）
  const [applied, setApplied] = useState<{ action: string; startDate: string; endDate: string }>({ action: '', startDate: '', endDate: '' });

  const PAGE_SIZE = 20;

  const load = useCallback(async (p: number) => {
    setLoading(true); setErrored(false);
    try {
      const res = await getExpertOperationHistory({
        page: p,
        pageSize: PAGE_SIZE,
        action: applied.action || undefined,
        startDate: applied.startDate || undefined,
        endDate: applied.endDate || undefined,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (e: any) {
      setErrored(true); toast.error(e?.message || '加载操作历史失败');
    }
    setLoading(false);
  }, [applied]);

  useEffect(() => {
    if (open) {
      setPage(1); setAction(''); setStartDate(''); setEndDate('');
      setApplied({ action: '', startDate: '', endDate: '' });
      load(1);
    }
  }, [open, load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilter = applied.action !== '' || applied.startDate !== '' || applied.endDate !== '';

  /** 按天分组（同一天记录归组，展示日期标题） */
  const grouped = useMemo(() => {
    const map = new Map<string, ExpertOperationHistoryItem[]>();
    for (const it of items) {
      const k = dayKey(it.createdAt);
      const arr = map.get(k);
      if (arr) arr.push(it);
      else map.set(k, [it]);
    }
    return Array.from(map.entries()).map(([date, rows]) => ({ date, rows }));
  }, [items]);

  const doSearch = () => {
    setPage(1);
    setApplied({ action, startDate, endDate });
    load(1);
  };

  const doReset = () => {
    setAction(''); setStartDate(''); setEndDate('');
    setPage(1);
    setApplied({ action: '', startDate: '', endDate: '' });
    load(1);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="操作历史"
      description="专家入库、评价、停用、暂停、退库等操作的审计记录 · 仅追加、不可修改，为系统审计留痕"
    >
      <div className="space-y-3">
        {/* 只读提示条 */}
        <div className="flex items-center gap-2 rounded-xl bg-[color-mix(in_oklch,var(--accent)_6%,transparent)] px-3 py-2 shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">
          <ShieldCheck size={14} className="text-[var(--accent)] shrink-0" />
          <span className="text-xs text-[var(--muted-foreground)]">记录不可编辑、不可删除，仅用于合规审计与追溯。</span>
        </div>

        {/* 检索区：操作类型 + 日期范围 */}
        <div className="flex flex-wrap items-end gap-2 rounded-xl bg-[color-mix(in_oklch,var(--muted-foreground)_3%,transparent)] p-3">
          <label className="space-y-1">
            <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">操作类型</span>
            <select value={action} onChange={e => setAction(e.target.value)} className="workbench-input !h-[32px] !w-[130px] text-xs">
              <option value="">全部类型</option>
              {ACTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">起始日期</span>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="workbench-input !h-[32px] !w-[150px] text-xs" />
          </label>
          <span className="pb-[6px] text-[var(--muted-foreground)]/60 text-xs">至</span>
          <label className="space-y-1">
            <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">结束日期</span>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="workbench-input !h-[32px] !w-[150px] text-xs" />
          </label>
          <button onClick={doSearch} className="neu-btn-xs is-info !h-[32px]"><Search size={12} />查询</button>
          {hasFilter && <button onClick={doReset} className="neu-btn-xs !h-[32px]"><X size={12} />重置</button>}
          <button onClick={() => load(page)} disabled={loading} className="neu-btn-xs !h-[32px] ml-auto" aria-label="刷新">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {loading ? (
          <div className="neu-table-card"><table className="neu-table w-full min-w-[640px]"><tbody><TableSkeleton cols={4} rows={6} /></tbody></table></div>
        ) : errored ? (
          <div className="neu-table-card py-14 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl"><AlertTriangle size={22} className="text-[var(--danger)]" /></div>
              <p className="text-sm font-semibold text-[var(--danger)]">操作历史加载失败</p>
              <button onClick={() => load(page)} className="neu-btn-soft"><RefreshCw size={15} />重试</button>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="neu-table-card py-16 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl"><History size={22} className="text-[var(--muted-foreground)]" /></div>
              <p className="text-sm text-[var(--muted-foreground)]">{hasFilter ? '无符合条件的操作记录' : '暂无操作记录'}</p>
              {hasFilter && <button onClick={doReset} className="neu-btn-xs">清除筛选</button>}
            </div>
          </div>
        ) : (
          <>
            {/* 按天分组展示 */}
            <div className="space-y-3">
              {grouped.map(({ date, rows }) => (
                <div key={date} className="neu-table-card overflow-hidden">
                  <div className="flex items-center gap-2 border-b border-[color-mix(in_oklch,var(--muted-foreground)_12%,transparent)] bg-[color-mix(in_oklch,var(--muted-foreground)_3%,transparent)] px-4 py-2">
                    <CalendarDays size={13} className="text-[var(--accent)]" />
                    <span className="text-xs font-bold text-[var(--foreground)]">{date}</span>
                    <span className="text-[10px] text-[var(--muted-foreground)] tabular-nums">{rows.length} 条</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="neu-table w-full min-w-[680px]">
                      <thead>
                        <tr>
                          <th style={{ width: 110 }}>操作</th>
                          <th>对象</th>
                          <th style={{ width: 120 }}>操作人</th>
                          <th className="text-center" style={{ width: 80 }}>时间</th>
                          <th>事由 / 详情</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(it => {
                          const d = (it.details ?? {}) as Record<string, unknown>;
                          const name = typeof d.expertName === 'string' ? d.expertName : '';
                          return (
                            <tr key={it.id}>
                              <td><StatusBadge tone={ACTION_TONE[it.action] ?? 'gray'}>{ACTION_LABEL[it.action] ?? it.action}</StatusBadge></td>
                              <td className="text-sm font-semibold text-[var(--foreground)]">{name || (it.resourceId === 'batch' ? '批量' : '—')}</td>
                              <td className="text-xs text-[var(--muted-foreground)]">
                                {it.user?.displayName || it.user?.username || '系统'}
                              </td>
                              <td className="text-center text-xs tabular-nums text-[var(--muted-foreground)]">
                                {new Date(it.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                              </td>
                              <td className="text-xs text-[var(--muted-foreground)] max-w-[280px] truncate" title={detailText(it.action, d) || undefined}>
                                {detailText(it.action, d) || '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between px-1">
              <span className="text-[0.8rem] text-[var(--muted-foreground)] tabular-nums">共 <strong className="font-semibold text-[var(--foreground)]">{total}</strong> 条 · 第 {page}/{totalPages} 页</span>
              <div className="flex gap-1.5">
                <button disabled={page <= 1} onClick={() => { const p = page - 1; setPage(p); load(p); }} className="neu-btn-xs disabled:opacity-30"><ChevronLeft size={14} /></button>
                <button disabled={page >= totalPages} onClick={() => { const p = page + 1; setPage(p); load(p); }} className="neu-btn-xs disabled:opacity-30"><ChevronRight size={14} /></button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
