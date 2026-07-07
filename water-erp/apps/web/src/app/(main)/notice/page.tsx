'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  listAnnouncements, deleteAnnouncement, updateAnnouncement,
  getParticipants,
} from '@/lib/api/announcement';
import type { AnnouncementListItem, AnnouncementType, AnnouncementStatus, Participant } from '@/lib/api/announcement';
import { toast } from 'sonner';
import { MetricCard, PageHero, StatusBadge, TableSkeleton } from '@/components/workbench';
import {
  FileText, Megaphone as MegaphoneIcon, PlusCircle, Search,
  ChevronUp, ChevronDown, ChevronsUpDown,
  Paperclip, Lock, Archive, Trash2, Send, X,
} from 'lucide-react';

/* ── 类型 / 状态映射（tone 化，由 StatusBadge 渲染，不写硬编码色）── */

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

/* ── 排序键 ── */
type SortKey = 'publishDate' | 'viewCount' | 'type' | 'status';
type SortDir = 'asc' | 'desc';

export default function NoticePage() {
  const router = useRouter();
  const [data, setData] = useState<{ total: number; items: AnnouncementListItem[] }>({ total: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<AnnouncementType>('BID_NOTICE');
  const [filterStatus, setFilterStatus] = useState<AnnouncementStatus | ''>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [partAnn, setPartAnn] = useState<AnnouncementListItem | null>(null);

  /* 选择（跨页不保留）*/
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /* 排序（前端页内；默认发布日期降序）*/
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

  // 切换筛选 / 翻页时清空选择
  useEffect(() => { setSelectedIds(new Set()); }, [filterType, filterStatus, search, page]);

  const totalPages = Math.max(1, Math.ceil(data.total / 15));

  /* 排序后的当前页条目 */
  const sortedItems = useMemo(() => {
    if (!sortKey) return data.items;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...data.items].sort((a, b) => {
      let av: string | number = '';
      let bv: string | number = '';
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
    else { setSortKey(null); setSortDir('desc'); } // 第三次点击取消排序
  };

  /* 选择辅助 */
  const selectableIds = sortedItems.map(i => i.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selectedIds.has(id));
  const someSelected = selectableIds.some(id => selectedIds.has(id));
  const selectedCount = selectedIds.size;

  const toggleRow = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const toggleAll = () => setSelectedIds(prev => {
    const next = new Set(prev);
    if (allSelected) selectableIds.forEach(id => next.delete(id));
    else selectableIds.forEach(id => next.add(id));
    return next;
  });
  const clearSelection = () => setSelectedIds(new Set());

  /* 批量操作 —— 客户端 Promise.all 扇出 */
  const runBatch = async (action: 'publish' | 'archive' | 'delete') => {
    const target = Array.from(selectedIds);
    if (target.length === 0) return;
    const label = action === 'publish' ? '发布' : action === 'archive' ? '归档' : '删除';
    if (action === 'delete' && !confirm(`确认删除选中的 ${target.length} 条信息？此操作不可撤销。`)) return;

    clearSelection();
    const results = await Promise.allSettled(target.map(id =>
      action === 'delete'
        ? deleteAnnouncement(id)
        : updateAnnouncement(id, { status: action === 'publish' ? 'PUBLISHED' : 'ARCHIVED' })
    ));
    const ok = results.filter(r => r.status === 'fulfilled').length;
    const fail = results.length - ok;
    if (fail === 0) toast.success(`${label}成功 ${ok} 条`);
    else if (ok === 0) toast.error(`${label}失败 ${fail} 条`);
    else toast(`${label}完成：成功 ${ok} / 失败 ${fail}`);
    load();
  };

  /* 单条删除（保留撤销 toast）*/
  const remove = async (a: AnnouncementListItem) => {
    if (!confirm(`确认删除「${a.title}」？`)) return;
    const prevItems = data.items;
    setData(d => ({ ...d, items: d.items.filter(x => x.id !== a.id) }));
    let cancelled = false;
    toast('已删除「' + a.title + '」', {
      description: '4 秒内可撤销',
      duration: 4000,
      action: { label: '撤销', onClick: () => { cancelled = true; setData(d => ({ ...d, items: prevItems })); } },
    });
    await new Promise(r => setTimeout(r, 4200));
    if (cancelled) return;
    try { await deleteAnnouncement(a.id); load(); } catch (e: any) { toast.error(e?.message || '删除失败'); load(); }
  };

  return (
    <div className="h-full">
      <PageHero
        title="信息发布中心"
        description="招标公示、中标公示、政策法规、平台通知；起草并配齐招标文件/附件后再发布。"
        tone="blue"
        icon={<MegaphoneIcon size={14} />}
        actions={
          <button onClick={() => router.push('/notice/new')} className="neu-btn-primary">
            <PlusCircle size={16} /> 新建信息
          </button>
        }
      />

      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <MetricCard label="信息总数" value={data.total} hint="当前筛选条件下总量" tone="blue" icon={<FileText size={18} />} />
        <MetricCard label="已发布" value={data.items.filter(item => item.status === 'PUBLISHED').length} hint="本页已发布记录" tone="green" />
        <MetricCard label="草稿" value={data.items.filter(item => item.status === 'DRAFT').length} hint="本页草稿记录" tone="orange" />
        <MetricCard label="已归档" value={data.items.filter(item => item.status === 'ARCHIVED').length} hint="本页归档记录" tone="gray" />
      </div>

      <div className="neu-table-card mt-6">
        {/* 批量操作条 */}
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

        {/* 工具栏：类型 tab + 搜索 + 状态筛选 */}
        <div className="neu-table-card-header flex flex-wrap items-center justify-between gap-3">
          <div className="neu-tab-bar">
            {(Object.keys(typeMeta) as AnnouncementType[]).map(t => (
              <button
                key={t}
                onClick={() => { setFilterType(t); setPage(1); }}
                className={`neu-tab ${filterType === t ? 'is-active' : ''}`}
              >
                {typeMeta[t].label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--muted-foreground)]" />
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                placeholder="搜索标题..."
                className="neu-input !h-9 min-w-[160px] max-w-[220px] !pl-9 text-sm"
              />
            </div>
            <select
              value={filterStatus}
              onChange={e => { setFilterStatus(e.target.value as any); setPage(1); }}
              className="neu-select !h-9 min-w-[110px] text-sm"
            >
              <option value="">全部状态</option>
              <option value="PUBLISHED">已发布</option>
              <option value="DRAFT">草稿</option>
              <option value="ARCHIVED">已归档</option>
            </select>
          </div>
        </div>

        {/* 表格主体 */}
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[760px]">
            <thead>
              <tr>
                <th style={{ width: 44 }}>
                  <input
                    type="checkbox"
                    className="neu-checkbox"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = !allSelected && someSelected; }}
                    onChange={toggleAll}
                    aria-label="全选当前页"
                  />
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
                        <FileText size={22} className="text-[color:var(--muted-foreground)]" />
                      </div>
                      <p className="text-sm text-[color:var(--muted-foreground)]">暂无信息</p>
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
                          <span className="text-sm font-bold text-[color:var(--foreground)]">{a.title}</span>
                          {a.isTop && <StatusBadge tone="red" className="!text-[10px] !px-1.5 !py-0">置顶</StatusBadge>}
                          {noBidDoc && <span className="rounded-md bg-[oklch(0.95_0.04_27/0.55)] px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--danger)]">未上传招标文件</span>}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-[color:var(--muted-foreground)]">
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
                        {!hasAttachments && !a.bidDocument ? (
                          <span className="text-[color:var(--muted-foreground)]">—</span>
                        ) : (
                          <>
                            {hasAttachments && (
                              <span className="inline-flex items-center gap-1 rounded-md bg-[oklch(0.96_0.005_258)] px-2 py-1 text-[11px] font-semibold text-[color:var(--muted-foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.7)]">
                                <Paperclip size={11} /> {a.attachments!.length}
                              </span>
                            )}
                            {a.bidDocument && (
                              <span className="inline-flex items-center gap-1 rounded-md bg-[oklch(0.95_0.04_251/0.5)] px-2 py-1 text-[11px] font-semibold text-[color:var(--accent-strong)] shadow-[inset_0_1px_0_oklch(1_0_0/0.7)]">
                                <Lock size={11} /> 招标文件{a.bidDocument.requirePayment ? ' (¥)' : ''}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }} className="tabular-nums font-semibold text-[color:var(--foreground)]">{a.viewCount}</td>
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

        {/* 分页 */}
        <div className="neu-table-card-footer flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-[color:var(--muted-foreground)]">共 {data.total} 条，第 {page}/{totalPages} 页</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="neu-btn-xs disabled:opacity-40 disabled:pointer-events-none">上一页</button>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="neu-btn-xs disabled:opacity-40 disabled:pointer-events-none">下一页</button>
          </div>
        </div>
      </div>

      {partAnn && <ParticipantsModal announcement={partAnn} onClose={() => setPartAnn(null)} />}
    </div>
  );
}

/* ════════════ 可排序表头 ════════════ */

function SortTh({ label, sortKey, current, dir, onToggle, align = 'left' }: {
  label: string;
  sortKey: SortKey;
  current: SortKey | null;
  dir: SortDir;
  onToggle: (k: SortKey) => void;
  align?: 'left' | 'right';
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

/* ════════════ 投标情况弹窗（只读） ════════════ */

function ParticipantsModal({ announcement, onClose }: { announcement: AnnouncementListItem; onClose: () => void }) {
  const [data, setData] = useState<{ project: any; suppliers: Participant[]; stats: { total: number; submitted: number } } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { getParticipants(announcement.id).then(setData).catch(() => setData(null)).finally(() => setLoading(false)); }, [announcement.id]);
  const pct = data && data.stats.total > 0 ? Math.round((data.stats.submitted / data.stats.total) * 100) : 0;
  const badge = (s: Participant) => s.withdrawn ? { label: '已撤回', color: '#e74c3c', bg: '#e74c3c18' } : s.submitted ? { label: '已提交', color: '#11a874', bg: '#11a87418' } : { label: '未提交', color: '#95a5a6', bg: '#95a5a618' };
  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="modal-content glass-card w-full max-w-3xl rounded-xl shadow-xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-white px-6 py-4">
          <h3 className="text-lg font-bold text-[#18243a]">投标情况</h3>
          <button onClick={onClose} className="text-xl leading-none text-[#5a6d8a] hover:text-[#18243a]">×</button>
        </div>
        <div className="p-6">
          {loading ? <p className="py-8 text-center text-[#5a6d8a]">加载中...</p> : !data || !data.project ? (
            <p className="py-8 text-center text-[#5a6d8a]">该招标公示未关联招标项目（无项目编号），暂无投标数据。</p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--border)] p-4">
                <div className="flex items-center justify-between"><strong className="text-[#18243a]">{data.project.name}</strong><span className="text-xs text-[#5a6d8a]">截止 {new Date(data.project.deadline).toLocaleDateString('zh-CN')}</span></div>
                <div className="mt-3 mb-1.5 flex items-center justify-between"><span className="text-sm font-semibold text-[#18243a]">提交进度</span><span className="text-sm text-[#5a6d8a]">{data.stats.submitted}/{data.stats.total} 已提交</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-[#f1f5f9]"><div className="h-full rounded-full bg-[#11a874]" style={{ width: pct + '%' }} /></div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[580px] text-sm">
                <thead><tr className="border-b border-[var(--border)] text-left text-[#5a6d8a]"><th className="px-3 py-2">供应商</th><th className="px-3 py-2">分类</th><th className="px-3 py-2">下载</th><th className="px-3 py-2">标书状态</th><th className="px-3 py-2">提交时间</th><th className="px-3 py-2">报价</th></tr></thead>
                <tbody>
                  {data.suppliers.length === 0 ? <tr><td colSpan={6} className="px-3 py-8 text-center text-[#5a6d8a]">暂无投标供应商</td></tr> : data.suppliers.map((s, i) => {
                    const b = badge(s);
                    return (<tr key={i} className="border-b border-[#f1f5f9]"><td className="px-3 py-2 font-semibold text-[#18243a]">{s.supplierName}</td><td className="px-3 py-2 text-[#5a6d8a]">{s.classification || '—'}</td><td className="px-3 py-2 text-[#5a6d8a]">{s.downloadStatus}</td><td className="px-3 py-2"><span className="rounded px-2 py-1 text-xs font-semibold" style={{ color: b.color, backgroundColor: b.bg }}>{b.label}</span></td><td className="px-3 py-2 text-[#5a6d8a]">{s.submittedAt ? new Date(s.submittedAt).toLocaleString('zh-CN') : '—'}</td><td className="px-3 py-2 text-[#5a6d8a]">{s.bidPrice || '—'}</td></tr>);
                  })}
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
