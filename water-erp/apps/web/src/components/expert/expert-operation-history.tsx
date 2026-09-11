'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Modal } from '@/components/workbench';
import { getExpertOperationHistory, type ExpertOperationHistoryItem } from '@/lib/api/expert';
import { History, RefreshCw, ChevronLeft, ChevronRight, Lock, CalendarDays } from 'lucide-react';
import { LEVEL_LABEL } from '@water-erp/shared';

// 专家操作类型 → 中文标签（对齐供应商操作历史的设计口径）。
const ACTION_LABELS: Record<string, string> = {
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

const ACTION_TONE: Record<string, string> = {
  EXPERT_CREATE: 'var(--success)',
  EXPERT_IMPORT: 'var(--accent)',
  EXPERT_APPROVE: 'var(--success)',
  EXPERT_UPDATE: 'var(--accent)',
  EXPERT_ENABLE: 'var(--success)',
  EXPERT_DISABLE: 'var(--warning)',
  EXPERT_BATCH_ENABLE: 'var(--success)',
  EXPERT_BATCH_DISABLE: 'var(--warning)',
  EXPERT_SUSPEND: 'var(--warning)',
  EXPERT_RESUME: 'var(--accent)',
  EXPERT_RETIRE: 'var(--danger)',
  EXPERT_RETIRE_IGNORE: 'var(--muted-foreground)',
  EXPERT_EVALUATE: 'var(--accent)',
  EXPERT_VIOLATION_RECORDED: 'var(--danger)',
};

/** 审计详情字段 → 中文标签（expertName 冗余——专家列已展示，故不在此列示）。 */
const FIELD_LABELS: Record<string, string> = {
  reason: '事由',
  from: '原状态',
  to: '新状态',
  overallGrade: '评价等级',
  projectId: '关联项目',
  specialty: '专业',
  type: '违规类型',
  detail: '违规详情',
  severity: '严重程度',
  count: '处理数',
  imported: '导入数',
  skipped: '跳过数',
  failed: '失败数',
  updated: '更新',
};

/** 专家库状态枚举 → 中文 */
const ENTRY_STATUS_LABEL: Record<string, string> = {
  PENDING: '待审核',
  ACTIVE: '在库',
  SUSPENDED: '暂停',
  RETIRED: '已退库',
};

/** 字段值中文化：状态/等级枚举转中文，数组逗号分隔，布尔转是/否。 */
function formatValue(k: string, v: unknown): string {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) return v.join('、') || '—';
  if (k === 'from' || k === 'to') return ENTRY_STATUS_LABEL[String(v)] ?? String(v);
  if (k === 'overallGrade') return LEVEL_LABEL[String(v)] ?? String(v);
  if (k === 'severity') return String(v) === 'danger' ? '严重' : String(v) === 'warning' ? '警告' : String(v);
  if (k === 'updated') return v ? '是' : '否';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** 详情展示：优先展示事由/评价等级等关键字段，其余以只读键值列示（键值均中文）。 */
function DetailLines({ item }: { item: ExpertOperationHistoryItem }) {
  const d = (item.details ?? {}) as Record<string, unknown>;
  // expertName 是资源名，与「专家」列重复，故剔除；仅展示有意义的补充字段。
  const keys = Object.keys(d).filter(k => k !== 'expertName');
  if (keys.length === 0) return <span className="text-xs text-[var(--muted-foreground)]">—</span>;

  const prefer = ['reason', 'overallGrade', 'from', 'to', 'type', 'detail'];
  const ordered = [...prefer.filter(k => keys.includes(k)), ...keys.filter(k => !prefer.includes(k))];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {ordered.map(k => (
        <span key={k} className="text-xs text-[var(--muted-foreground)]">
          <span className="text-[var(--foreground)]/60">{FIELD_LABELS[k] ?? k}</span>：
          <span className="text-[var(--foreground)]">{formatValue(k, d[k])}</span>
        </span>
      ))}
    </div>
  );
}

/** 从 ISO 时间提取本地日期 YYYY-MM-DD（以天为单位的记录维度）。 */
function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 从 ISO 时间提取本地时分 HH:mm（日期已在分组头，行内仅显示时分）。 */
function localTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** YYYY-MM-DD → 中文日期（如 2026-09-10 → 2026年9月10日）。 */
function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function ExpertOperationHistory({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<ExpertOperationHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const pageSize = 20;

  // 注意：doLoad 显式接收 filter 参数，依赖数组仅为 pageSize → 函数引用稳定，避免对象身份导致的 useEffect 死循环
  const doLoad = useCallback(async (p: number, action: string, df: string, dt: string) => {
    setLoading(true);
    try {
      const res = await getExpertOperationHistory({
        page: p, pageSize,
        action: action || undefined,
        startDate: df || undefined,
        endDate: dt || undefined,
      });
      setItems(res.items);
      setTotal(res.total);
      setPage(res.page);
    } catch {
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  useEffect(() => {
    if (open) {
      setPage(1);
      setActionFilter(''); setDateFrom(''); setDateTo('');
      doLoad(1, '', '', '');
    }
  }, [open, doLoad]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // 按天分组（后端已按 createdAt desc 排序，Map 保持日期从新到旧）。
  const groups = useMemo(() => {
    const map = new Map<string, ExpertOperationHistoryItem[]>();
    for (const it of items) {
      const day = localDay(it.createdAt);
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(it);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <History size={16} className="text-[var(--accent)]" />
          专家操作历史
        </span>
      }
      description="入库、评价、停用、暂停、退库等全部操作的不可变留痕，供审计追溯，不支持修改"
      size="2xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <span className="text-xs text-[var(--muted-foreground)] flex items-center gap-1">
            <Lock size={11} />只读记录 · 共 {total} 条
          </span>
          <button onClick={onClose} className="neu-btn-soft">关闭</button>
        </div>
      }
    >
      <div className="space-y-3">
        {/* 筛选：操作类型 + 日期范围 */}
        <div className="wb-toolbar !px-3 !py-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-[var(--muted-foreground)]">操作类型</span>
          <select
            value={actionFilter}
            onChange={e => { const v = e.target.value; setActionFilter(v); doLoad(1, v, dateFrom, dateTo); }}
            className="workbench-input !w-auto !h-7 !text-[11px] min-w-[130px]"
          >
            <option value="">全部</option>
            {Object.entries(ACTION_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>

          <span className="text-[11px] font-semibold text-[var(--muted-foreground)] flex items-center gap-1">
            <CalendarDays size={12} />日期
          </span>
          <input
            type="date"
            value={dateFrom}
            onChange={e => { const v = e.target.value; setDateFrom(v); doLoad(1, actionFilter, v, dateTo); }}
            className="workbench-input !w-auto !h-7 !text-[11px]"
          />
          <span className="text-[11px] text-[var(--muted-foreground)]">至</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => { const v = e.target.value; setDateTo(v); doLoad(1, actionFilter, dateFrom, v); }}
            className="workbench-input !w-auto !h-7 !text-[11px]"
          />

          <div className="flex-1" />
          <button onClick={() => doLoad(page, actionFilter, dateFrom, dateTo)} disabled={loading} className="neu-btn-xs gap-1" aria-label="刷新">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* 列表（按天分组） */}
        {loading ? (
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中...</div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无操作历史</div>
        ) : (
          <div className="neu-table-card overflow-hidden">
            <table className="workbench-table">
              <thead>
                <tr>
                  <th>操作</th><th>专家</th><th>操作人</th><th>时间</th><th>详情</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(([day, list]) => (
                  <GroupRows key={day} day={day} list={list} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 分页 */}
        {total > pageSize && (
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => doLoad(page - 1, actionFilter, dateFrom, dateTo)} disabled={page <= 1 || loading} className="neu-btn-xs gap-1">
              <ChevronLeft size={12} />上一页
            </button>
            <span className="text-xs tabular-nums text-[var(--muted-foreground)]">{page} / {totalPages}</span>
            <button onClick={() => doLoad(page + 1, actionFilter, dateFrom, dateTo)} disabled={page >= totalPages || loading} className="neu-btn-xs gap-1">
              下一页<ChevronRight size={12} />
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** 某一天的分组：日期头行（跨列）+ 该天记录行。 */
function GroupRows({ day, list }: { day: string; list: ExpertOperationHistoryItem[] }) {
  return (
    <>
      <tr>
        <td colSpan={5} className="!py-2 !px-3" style={{ background: 'color-mix(in oklch, var(--accent) 4%, transparent)' }}>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-[var(--foreground)]">{dayLabel(day)}</span>
            <span className="text-[10px] tabular-nums text-[var(--muted-foreground)]">{list.length} 条</span>
          </div>
        </td>
      </tr>
      {list.map(it => {
        const tone = ACTION_TONE[it.action] || 'var(--foreground)';
        const name = typeof (it.details as any)?.expertName === 'string' ? (it.details as any).expertName : '';
        return (
          <tr key={it.id}>
            <td>
              <span className="rounded px-2 py-0.5 text-[10px] font-bold whitespace-nowrap"
                style={{ color: tone, backgroundColor: `color-mix(in_oklch,${tone}_12%,transparent)` }}>
                {ACTION_LABELS[it.action] || it.action}
              </span>
            </td>
            <td className="text-sm">{name || (it.resourceId === 'batch' ? '批量' : '—')}</td>
            <td className="text-sm">{it.user?.displayName || it.user?.username || '系统'}</td>
            <td className="text-xs tabular-nums text-[var(--muted-foreground)] whitespace-nowrap">{localTime(it.createdAt)}</td>
            <td><DetailLines item={it} /></td>
          </tr>
        );
      })}
    </>
  );
}
