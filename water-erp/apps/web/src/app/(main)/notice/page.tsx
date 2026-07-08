'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  listAnnouncements, deleteAnnouncement, updateAnnouncement,
  getParticipants,
} from '@/lib/api/announcement';
import type { AnnouncementListItem, AnnouncementType, AnnouncementStatus, Participant } from '@/lib/api/announcement';
import { toast } from 'sonner';
import { StatusBadge, TableSkeleton } from '@/components/workbench';
import {
  FileText, Megaphone as MegaphoneIcon, PlusCircle, Search,
  ChevronUp, ChevronDown, ChevronsUpDown,
  Paperclip, Lock, Archive, Trash2, Send, X, RefreshCw,
} from 'lucide-react';

/* ── 类型/状态映射 ── */
const typeMeta: Record<AnnouncementType, { label: string; tone: 'blue' | 'green' | 'orange' | 'gray' }> = {
  BID_NOTICE: { label: '招标公示', tone: 'blue' },
  WIN_NOTICE: { label: '中标公示', tone: 'green' },
  POLICY: { label: '政策法规', tone: 'orange' },
  PLATFORM: { label: '平台通知', tone: 'gray' },
};
const statusMeta: Record<AnnouncementStatus, { label: string; tone: 'green' | 'gray' }> = {
  DRAFT: { label: '草稿', tone: 'gray' },
  PUBLISHED: { label: '已发布', tone: 'green' },
  ARCHIVED: { label: '已归档', tone: 'gray' },
};

type SortKey = 'publishDate' | 'viewCount' | 'type' | 'status';
type SortDir = 'asc' | 'desc';

/* ── neo-chip 色调（仅影响顶部色条 + 数字色）── */
const chipTone = {
  blue:   { bar: 'oklch(0.55 0.16 251)', num: 'var(--foreground)' },
  green:  { bar: 'oklch(0.6 0.14 164)',  num: 'var(--foreground)' },
  orange: { bar: 'oklch(0.62 0.14 72)',   num: 'var(--foreground)' },
  gray:   { bar: 'oklch(0.52 0.02 258)', num: 'var(--muted-foreground)' },
};

export default function NoticePage() {
  const router = useRouter();
  const [data, setData] = useState<{ total: number; items: AnnouncementListItem[] }>({ total: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<AnnouncementType>('BID_NOTICE');
  const [filterStatus, setFilterStatus] = useState<AnnouncementStatus | ''>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [partAnn, setPartAnn] = useState<AnnouncementListItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey | null>('publishDate');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAnnouncements({ type: filterType, status: filterStatus || undefined, search: search || undefined, page, pageSize: 15 });
      setData({ total: res.total, items: res.items });
    } catch { /* empty */ }
    setLoading(false);
  }, [filterType, filterStatus, search, page]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSelectedIds(new Set()); }, [filterType, filterStatus, search, page]);

  const totalPages = Math.max(1, Math.ceil(data.total / 15));

  const sortedItems = useMemo(() => {
    if (!sortKey) return data.items;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...data.items].sort((a, b) => {
      let av: string | number = '', bv: string | number = '';
      if (sortKey === 'viewCount') { av = a.viewCount; bv = b.viewCount; }
      else if (sortKey === 'publishDate') { av = a.publishDate || a.createdAt; bv = b.publishDate || b.createdAt; }
      else if (sortKey === 'type') { av = a.type; bv = b.type; }
      else if (sortKey === 'status') { av = a.status; bv = b.status; }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [data.items, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey !== key) { setSortKey(key); setSortDir('desc'); }
    else if (sortDir === 'desc') setSortDir('asc');
    else { setSortKey(null); setSortDir('desc'); }
  };

  const selectableIds = sortedItems.map(i => i.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selectedIds.has(id));
  const someSelected = selectableIds.some(id => selectedIds.has(id));
  const selectedCount = selectedIds.size;
  const toggleRow = (id: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelectedIds(prev => { const n = new Set(prev); allSelected ? selectableIds.forEach(id => n.delete(id)) : selectableIds.forEach(id => n.add(id)); return n; });
  const clearSelection = () => setSelectedIds(new Set());

  const runBatch = async (action: 'publish' | 'archive' | 'delete') => {
    const target = Array.from(selectedIds);
    if (target.length === 0) return;
    const label = action === 'publish' ? '发布' : action === 'archive' ? '归档' : '删除';
    if (action === 'delete' && !confirm(`确认删除选中的 ${target.length} 条信息？此操作不可撤销。`)) return;
    clearSelection();
    const results = await Promise.allSettled(target.map(id =>
      action === 'delete' ? deleteAnnouncement(id) : updateAnnouncement(id, { status: action === 'publish' ? 'PUBLISHED' : 'ARCHIVED' })
    ));
    const ok = results.filter(r => r.status === 'fulfilled').length;
    const fail = results.length - ok;
    if (fail === 0) toast.success(`${label}成功 ${ok} 条`);
    else if (ok === 0) toast.error(`${label}失败 ${fail} 条`);
    else toast(`${label}完成：成功 ${ok} / 失败 ${fail}`);
    load();
  };

  const remove = async (a: AnnouncementListItem) => {
    if (!confirm(`确认删除「${a.title}」？`)) return;
    const prevItems = data.items;
    setData(d => ({ ...d, items: d.items.filter(x => x.id !== a.id) }));
    let cancelled = false;
    toast('已删除「' + a.title + '」', { description: '4 秒内可撤销', duration: 4000, action: { label: '撤销', onClick: () => { cancelled = true; setData(d => ({ ...d, items: prevItems })); } } });
    await new Promise(r => setTimeout(r, 4200));
    if (cancelled) return;
    try { await deleteAnnouncement(a.id); load(); } catch (e: any) { toast.error(e?.message || '删除失败'); load(); }
  };

  /* ── 统计 ── */
  const published = data.items.filter(i => i.status === 'PUBLISHED').length;
  const drafts = data.items.filter(i => i.status === 'DRAFT').length;
  const archived = data.items.filter(i => i.status === 'ARCHIVED').length;

  return (
    <div className="flex flex-col gap-5">
      {/* ══════ page-hero — 标题卡片 + 内嵌 KPI 统计 ══════ */}
      <div className="page-hero">
        {/* 标题行 */}
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon">
              <MegaphoneIcon size={17} />
            </div>
            <div>
              <div className="page-hero__title">信息发布中心</div>
              <div className="page-hero__sub">招标公示、中标公示、政策法规、平台通知的起草与发布管理</div>
            </div>
          </div>

          <div className="page-hero__right">
            <button onClick={load} disabled={loading} className="neu-btn-xs">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
            <button onClick={() => router.push('/notice/new')} className="neu-btn-soft">
              <PlusCircle size={15} /> 新建信息
            </button>
          </div>
        </div>

        {/* KPI 统计行 — 浮在 hero 表面的凸起芯片，形成 hero(地基) → chips(浮起) 两层深度 */}
        <div
          className="grid grid-cols-2 gap-2.5 sm:grid-cols-4"
          style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "0.875rem" }}
        >
          <NeoChip label="信息总数" value={data.total} tone="blue" />
          <NeoChip label="已发布"   value={published} tone="green" />
          <NeoChip label="草稿"     value={drafts}    tone="orange" />
          <NeoChip label="已归档"   value={archived}  tone="gray" />
        </div>
      </div>

      {/* ══════ 工具栏卡片（类型 tab + 搜索 + 状态下拉） ══════ */}
      <div className="flex flex-wrap items-center gap-3 rounded-[16px] border border-[color-mix(in_oklch,var(--border)_80%,transparent)] bg-[var(--surface)] px-4 py-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.65),2px_2px_6px_oklch(0.55_0.03_258/0.08),-1px_-1px_3px_oklch(1_0_0/0.85)]">
        <div className="neu-tab-bar">
          {(Object.keys(typeMeta) as AnnouncementType[]).map(t => (
            <button key={t} onClick={() => { setFilterType(t); setPage(1); }} className={`neu-tab ${filterType === t ? 'is-active' : ''}`}>
              {typeMeta[t].label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[140px] xl:min-w-[200px] flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] z-10" />
          <input
            type="text"
            placeholder="搜索标题…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="neu-input !pl-9"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-[rgba(96,139,239,0.1)] text-[var(--muted-foreground)] z-10">
              <X size={14} />
            </button>
          )}
        </div>
        <select
          value={filterStatus}
          onChange={e => { setFilterStatus(e.target.value as AnnouncementStatus | ''); setPage(1); }}
          className="workbench-input !w-auto min-w-[110px]"
        >
          <option value="">全部状态</option>
          <option value="PUBLISHED">已发布</option>
          <option value="DRAFT">草稿</option>
          <option value="ARCHIVED">已归档</option>
        </select>
      </div>

      {/* ══════ 数据表格 ══════ */}
      <div className="neu-table-card">
        {selectedCount > 0 && (
          <div className="neu-batch-bar">
            <span className="neu-batch-bar-count">已选 <strong>{selectedCount}</strong> 条</span>
            <div className="neu-batch-bar-spacer" />
            <button onClick={() => runBatch('publish')} className="neu-btn-xs is-success"><Send size={13} /> 发布</button>
            <button onClick={() => runBatch('archive')} className="neu-btn-xs is-warning"><Archive size={13} /> 归档</button>
            <button onClick={() => runBatch('delete')} className="neu-btn-xs is-danger"><Trash2 size={13} /> 删除</button>
            <button onClick={clearSelection} className="neu-btn-xs"><X size={13} /> 取消选择</button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[760px]">
            <thead>
              <tr>
                <th style={{ width: 44 }}>
                  <input type="checkbox" className="neu-checkbox" checked={allSelected} ref={el => { if (el) el.indeterminate = !allSelected && someSelected; }} onChange={toggleAll} aria-label="全选" />
                </th>
                <th>标题</th>
                <SortTh label="类型" sortKey="type" current={sortKey} dir={sortDir} onToggle={toggleSort} />
                <SortTh label="状态" sortKey="status" current={sortKey} dir={sortDir} onToggle={toggleSort} />
                <th>附件 / 招标文件</th>
                <SortTh label="浏览" sortKey="viewCount" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right" />
                <th style={{ textAlign: 'center' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton cols={7} rows={5} />
              ) : sortedItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl">
                        <FileText size={22} className="text-[var(--muted-foreground)]" />
                      </div>
                      <p className="text-sm text-[var(--muted-foreground)]">暂无信息</p>
                      <button onClick={() => router.push('/notice/new')} className="neu-btn-primary !h-9 text-xs"><PlusCircle size={15} /> 新建信息</button>
                    </div>
                  </td>
                </tr>
              ) : sortedItems.map(a => {
                const tm = typeMeta[a.type] || typeMeta.PLATFORM;
                const sm = statusMeta[a.status] || statusMeta.DRAFT;
                const noBidDoc = a.type === 'BID_NOTICE' && a.status === 'PUBLISHED' && !a.bidDocument;
                const isSel = selectedIds.has(a.id);
                const hasAttachments = a.attachments && a.attachments.length > 0;
                return (
                  <tr key={a.id} className="row-clickable" data-selected={isSel ? 'true' : 'false'} onClick={() => router.push(`/notice/${a.id}`)}>
                    <td onClick={e => e.stopPropagation()}>
                      <input type="checkbox" className="neu-checkbox" checked={isSel} onChange={() => toggleRow(a.id)} aria-label={`选择 ${a.title}`} />
                    </td>
                    <td>
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-[var(--foreground)]">{a.title}</span>
                          {a.isTop && <StatusBadge tone="red" className="!text-[10px] !px-1.5 !py-0">置顶</StatusBadge>}
                          {noBidDoc && (
                            <span className="rounded-md bg-[color-mix(in_oklch,var(--danger)_20%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--danger)]">未上传招标文件</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
                          {a.publishDate && <span>{new Date(a.publishDate).toLocaleDateString('zh-CN')}</span>}
                          {a.relatedProjectCode && (<><span aria-hidden>·</span><span>{a.relatedProjectCode}</span></>)}
                          {a.summary && (<><span aria-hidden>·</span><span className="max-w-[360px] truncate">{a.summary.slice(0, 40)}{a.summary.length > 40 ? '…' : ''}</span></>)}
                        </div>
                      </div>
                    </td>
                    <td><StatusBadge tone={tm.tone}>{tm.label}</StatusBadge></td>
                    <td><StatusBadge tone={sm.tone}>{sm.label}</StatusBadge></td>
                    <td>
                      <div className="flex flex-wrap items-center justify-center gap-1.5">
                        {!hasAttachments && !a.bidDocument ? (<span className="text-[var(--muted-foreground)]">—</span>) : (<>
                          {hasAttachments && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--muted)]/50 px-2 py-1 text-[11px] font-semibold text-[var(--muted-foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.6)]">
                              <Paperclip size={11} /> {a.attachments!.length}
                            </span>
                          )}
                          {a.bidDocument && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--accent-soft)]/60 px-2 py-1 text-[11px] font-semibold text-[var(--accent-strong)] shadow-[inset_0_1px_0_oklch(1_0_0/0.6)]">
                              <Lock size={11} /> 招标文件{a.bidDocument.requirePayment ? ' (¥)' : ''}
                            </span>
                          )}
                        </>)}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }} className="tabular-nums font-semibold text-[var(--foreground)]">{a.viewCount}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="flex flex-wrap justify-center gap-1.5">
                        <button onClick={() => router.push(`/notice/${a.id}`)} className="neu-btn-xs is-info">查看</button>
                        {a.type === 'BID_NOTICE' && <button onClick={() => setPartAnn(a)} className="neu-btn-xs is-success">投标</button>}
                        <button onClick={() => remove(a)} className="neu-btn-xs is-danger">删除</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="neu-table-card-footer flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-[var(--muted-foreground)]">共 {data.total} 条，第 {page}/{totalPages} 页</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="neu-btn-xs disabled:opacity-40">上一页</button>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="neu-btn-xs disabled:opacity-40">下一页</button>
          </div>
        </div>
      </div>

      {partAnn && <ParticipantsModal announcement={partAnn} onClose={() => setPartAnn(null)} />}
    </div>
  );
}

/* ════════════ NeoChip — 浮在 hero 表面上的凸起指标芯片 ════════════
   只用 CSS 变量驱动动态颜色（bar 和数字色），静态背景/阴影走 class。
   bg/阴影值均来自 cgzxui neumorphic 色板。 */
function NeoChip({ label, value, tone }: { label: string; value: number; tone: keyof typeof chipTone }) {
  const t = chipTone[tone];
  return (
    <div
      className="flex flex-col gap-0.5 rounded-[11px] px-3.5 pb-2.5 pt-2"
      style={{
        background: 'var(--neu-raised-bg)',
        borderTop: `2px solid ${t.bar}`,
        boxShadow:
          'inset 0 1px 0 oklch(1 0 0 / 0.65), 1px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 2px oklch(1 0 0 / 0.7)',
        color: t.num,
      } as React.CSSProperties}
    >
      <span className="text-[1.2rem] font-black tabular-nums leading-none tracking-[-0.03em]">
        {value}
      </span>
      <span className="text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
        {label}
      </span>
    </div>
  );
}

/* ════════════ 可排序表头 ════════════ */
function SortTh({ label, sortKey, current, dir, onToggle, align = 'left' }: {
  label: string; sortKey: SortKey; current: SortKey | null; dir: SortDir; onToggle: (k: SortKey) => void; align?: 'left' | 'right';
}) {
  const active = current === sortKey;
  const Indicator = active ? (dir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;
  return (
    <th data-sortable="true" data-sort={active ? dir : undefined} style={{ textAlign: align }}>
      <button type="button" className="neu-th-sort" onClick={() => onToggle(sortKey)}>
        <span>{label}</span>
        <span className="neu-sort-indicator"><Indicator size={12} /></span>
      </button>
    </th>
  );
}

/* ════════════ 投标情况弹窗 ════════════ */
function ParticipantsModal({ announcement, onClose }: { announcement: AnnouncementListItem; onClose: () => void }) {
  const [result, setResult] = useState<{ project: any; suppliers: Participant[]; stats: { total: number; submitted: number } } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { getParticipants(announcement.id).then(setResult).catch(() => setResult(null)).finally(() => setLoading(false)); }, [announcement.id]);
  const pct = result && result.stats.total > 0 ? Math.round((result.stats.submitted / result.stats.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-[min(672px,92vw)] max-h-[90vh] overflow-y-auto rounded-[20px] bg-[var(--background)] p-0 shadow-[0_20px_60px_oklch(0.24_0.038_258/0.12)]" role="dialog" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 px-6 py-4">
          <div><h2 className="text-lg font-bold tracking-[-0.02em] text-[var(--foreground)]">投标情况</h2><p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{announcement.title}</p></div>
          <button onClick={onClose} className="neu-btn-xs"><X size={16} /></button>
        </div>
        <hr className="wb-section-rule mx-6" />
        <div className="px-6 py-5">
          {loading ? <p className="py-10 text-center text-sm text-[var(--muted-foreground)]">加载中...</p> :
           !result || !result.project ? <p className="py-10 text-center text-sm text-[var(--muted-foreground)]">该招标公示未关联招标项目，暂无投标数据。</p> : (
            <div className="space-y-5">
              <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex items-center justify-between"><strong className="text-[var(--foreground)]">{result.project.name}</strong><span className="text-xs text-[var(--muted-foreground)]">截止 {new Date(result.project.deadline).toLocaleDateString('zh-CN')}</span></div>
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2"><span className="text-sm font-semibold text-[var(--foreground)]">提交进度</span><span className="text-sm tabular-nums text-[var(--muted-foreground)]">{result.stats.submitted}/{result.stats.total} 已提交</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--muted)]"><div className="h-full rounded-full bg-[var(--success)] transition-all duration-500" style={{ width: `${pct}%` }} /></div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="neu-table w-full min-w-[580px] text-sm">
                  <thead><tr><th>供应商</th><th>分类</th><th>下载</th><th>标书状态</th><th>提交时间</th><th>报价</th></tr></thead>
                  <tbody>
                    {result.suppliers.length === 0 ? <tr><td colSpan={6} className="px-3 py-8 text-center text-[var(--muted-foreground)]">暂无投标供应商</td></tr> :
                      result.suppliers.map((s, i) => (
                        <tr key={i}>
                          <td className="font-semibold text-[var(--foreground)]">{s.supplierName}</td>
                          <td className="text-[var(--muted-foreground)]">{s.classification || '—'}</td>
                          <td className="text-[var(--muted-foreground)]">{s.downloadStatus}</td>
                          <td><BidStatusBadge withdrawn={s.withdrawn} submitted={s.submitted} /></td>
                          <td className="text-[var(--muted-foreground)]">{s.submittedAt ? new Date(s.submittedAt).toLocaleString('zh-CN') : '—'}</td>
                          <td className="text-[var(--muted-foreground)]">{s.bidPrice || '—'}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BidStatusBadge({ withdrawn, submitted }: { withdrawn: boolean; submitted: boolean }) {
  if (withdrawn) return <span className="inline-flex items-center rounded-md bg-[color-mix(in_oklch,var(--danger)_18%,transparent)] px-2 py-1 text-[11px] font-semibold text-[var(--danger)]">已撤回</span>;
  if (submitted) return <span className="inline-flex items-center rounded-md bg-[color-mix(in_oklch,var(--success)_18%,transparent)] px-2 py-1 text-[11px] font-semibold text-[var(--success)]">已提交</span>;
  return <span className="inline-flex items-center rounded-md bg-[var(--muted)]/50 px-2 py-1 text-[11px] font-semibold text-[var(--muted-foreground)]">未提交</span>;
}
