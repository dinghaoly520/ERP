'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  listAnnouncements, deleteAnnouncement, updateAnnouncement,
  getParticipants,
} from '@/lib/api/announcement';
import type { AnnouncementListItem, AnnouncementType, AnnouncementStatus, Participant, ParticipantsResult } from '@/lib/api/announcement';
import { toast } from 'sonner';
import { StatusBadge, TableSkeleton, Modal } from '@/components/workbench';
import {
  FileText, Megaphone as MegaphoneIcon, PlusCircle, Search,
  ChevronUp, ChevronDown, ChevronsUpDown,
  Paperclip, Lock, Archive, Trash2, Send, X, RefreshCw,
} from 'lucide-react';

/* ── 类型/状态映射 ── */
const typeMeta: Record<AnnouncementType, { label: string; tone: 'blue' | 'green' | 'orange' | 'gray' }> = {
  BID_NOTICE: { label: '采购公告', tone: 'blue' },
  WIN_NOTICE: { label: '中标公告', tone: 'green' },
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
  const now = new Date();
  const drafts = data.items.filter(i => i.status === 'DRAFT').length;
  const published = data.items.filter(i => i.status === 'PUBLISHED').length;
  const publishedThisMonth = data.items.filter(i => {
    if (i.status !== 'PUBLISHED' || !i.publishDate) return false;
    const d = new Date(i.publishDate);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const totalViews = data.items.reduce((sum, i) => sum + (i.viewCount || 0), 0);

  return (
    <div className="flex flex-col gap-5">
      {/* ══════ page-hero — 标题卡片 + 内嵌 KPI 瓷片行 ══════ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon">
              <MegaphoneIcon size={17} />
            </div>
            <div>
              <div className="page-hero__title">信息发布中心</div>
              <div className="page-hero__sub">采购公告、中标公告、政策法规、平台通知的起草与发布管理</div>
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

                {/* hairline 分割线 + KPI 行 — 合并为单一容器，间距与项目管理统一 */}
        <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 items-stretch">
          <HeroStat label="已发布" value={published} sub="已生效可见" />
          <HeroStat label="待处理草稿" value={drafts} signal={drafts > 0 ? "warning" : undefined} sub={drafts > 0 ? "尽快发布" : "全部已发布"} />
          <HeroStat label="本月发布" value={publishedThisMonth} sub="本月新增公告" valueStr={publishedThisMonth.toString()} />
          <HeroStat label="浏览总量" value={totalViews} sub="累计曝光量" valueStr={totalViews >= 10000 ? `${(totalViews / 10000).toFixed(1)} 万` : totalViews.toLocaleString()} />
        </div>
        </div>
      </div>

      {/* ══════ 工具栏卡片（类型 tab + 搜索 + 状态下拉） ══════ */}
      <div className="wb-toolbar">
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
                <th>附件 / 采购文件</th>
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
                      <button onClick={() => router.push('/notice/new')} className="neu-btn-soft"><PlusCircle size={15} /> 新建信息</button>
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
                            <span className="rounded-md bg-[color-mix(in_oklch,var(--danger)_20%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--danger)]">未上传采购文件</span>
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
                              <Lock size={11} /> 采购文件{a.bidDocument.requirePayment ? ' (¥)' : ''}
                            </span>
                          )}
                        </>)}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }} className="tabular-nums font-semibold text-[var(--foreground)]">{a.viewCount}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="flex flex-wrap justify-center gap-1.5">
                        {a.type === 'BID_NOTICE' && <button onClick={() => setPartAnn(a)} className="neu-btn-xs is-success">投标情况</button>}
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

/* ════════════ HeroStat — 对标采购进度 KpiCard 的紧凑指标瓷片 ════════════
   kpi-card 基类：浅底凸起 + hover 抬升 + label/value/sub 纵向排版
   所有卡片保留相同结构层（label区 / value / sub区），确保同排高度一致 */
function HeroStat({ label, value, sub, signal, valueStr }: {
  label: string; value: number;
  sub?: string;
  signal?: "success" | "warning" | "danger";
  valueStr?: string;
}) {
  const sc = signal === "success" ? "bg-[var(--success)]" : signal === "warning" ? "bg-[var(--warning)]" : signal === "danger" ? "bg-[var(--danger)]" : "";
  const st = signal === "success" ? "text-[var(--success)]" : signal === "warning" ? "text-[var(--warning)]" : signal === "danger" ? "text-[var(--danger)]" : "";
  return (
    <div className="kpi-card group flex h-full flex-col gap-1.5 p-3">
      {/* label 行 — 固定 min-h 使得有/无 signal 时 label 位置一致 */}
      <div className="flex items-center justify-between gap-2 min-h-[18px]">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">{label}</span>
        {signal && (
          <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold bg-[color-mix(in_oklch,var(--muted-foreground)_8%,transparent)] ${st}`}>
            <span className={`h-1 w-1 rounded-full shrink-0 ${sc}`} />{signal === "warning" ? "待处理" : signal === "danger" ? "风险" : "正常"}
          </span>
        )}
      </div>
      {/* value — 始终渲染 */}
      <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">
        {valueStr ?? (value >= 1000 ? value.toLocaleString() : value)}
      </span>
      {/* sub 行 — 固定 min-h 使得有/无 sub 时 value 位置一致 */}
      <span className="min-h-[14px] text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">{sub || " "}</span>
    </div>
  );
}

/* ════════════ 可排序表头 ════════════ */
function SortTh({ label, sortKey, current, dir, onToggle, align = 'center' }: {
  label: string; sortKey: SortKey; current: SortKey | null; dir: SortDir; onToggle: (k: SortKey) => void; align?: 'left' | 'center' | 'right';
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
  const [result, setResult] = useState<ParticipantsResult | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { getParticipants(announcement.id).then(setResult).catch(() => setResult(null)).finally(() => setLoading(false)); }, [announcement.id]);
  const pct = result && result.stats.total > 0 ? Math.round((result.stats.submitted / result.stats.total) * 100) : 0;
  const downloadCount = result?.suppliers.filter(s => s.downloadCount > 0).length ?? 0;

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="投标情况"
      description={announcement.title}
    >
      {loading ? (
        <div className="flex flex-col items-center gap-3 py-12">
          <div className="neu-icon-well flex h-12 w-12 items-center justify-center rounded-2xl">
            <RefreshCw size={20} className="animate-spin text-[var(--muted-foreground)]" />
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">加载中...</p>
        </div>
      ) : !result ? (
        <div className="flex flex-col items-center gap-3 py-12">
          <div className="neu-icon-well flex h-12 w-12 items-center justify-center rounded-2xl">
            <FileText size={20} className="text-[var(--muted-foreground)]" />
          </div>
          <p className="text-sm font-semibold text-[var(--foreground)]">加载失败</p>
          <p className="text-xs text-[var(--muted-foreground)]">请稍后重试</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* ═══ 项目概况卡片 ═══ */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex flex-col gap-3">
              {/* 项目可能为 null（公告未关联项目/项目已删）——仅项目概况头部加守卫，统计区不受影响 */}
              {result.project && (
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-col gap-1">
                    <h3 className="text-[15px] font-bold leading-snug text-[var(--foreground)]">{result.project.name}</h3>
                    <span className="text-[11px] font-medium text-[var(--muted-foreground)] tabular-nums">
                      项目编号 {result.project.projectCode || '—'}
                      {result.project.stage && <> · {result.project.stage}</>}
                    </span>
                  </div>
                  {result.project.deadline && (
                    <span className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold tabular-nums text-[var(--muted-foreground)]">
                      截止 {new Date(result.project.deadline).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })}
                    </span>
                  )}
                </div>
              )}

              {/* 提交进度条 */}
              {result.stats.total > 0 && (
                <div className="mt-1">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs font-semibold text-[var(--foreground)]">投标提交进度</span>
                    <span className="text-xs tabular-nums font-semibold text-[var(--accent)]">
                      {result.stats.submitted}/{result.stats.total} 已提交
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--muted)]">
                    <div className="h-full rounded-full bg-[var(--success)] transition-all duration-600" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )}

              {/* KPI 行 */}
              <div className="mt-1 grid grid-cols-3 gap-2">
                <KpiTile label="参与供应商" value={result.stats.total} />
                <KpiTile label="已提交标书" value={result.stats.submitted} accent="success" />
                <KpiTile label="已下载文件" value={downloadCount} accent="accent" />
              </div>
            </div>
          </div>

          {/* ═══ 供应商表格 ═══ */}
          <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            <table className="neu-table w-full min-w-[680px] text-sm">
              <thead>
                <tr>
                  <th className="text-left">供应商</th>
                  <th className="text-left">业务标签</th>
                  <th className="text-center">下载</th>
                  <th className="text-center">标书状态</th>
                  <th className="text-right">提交时间</th>
                </tr>
              </thead>
              <tbody>
                {result.suppliers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <FileText size={20} className="text-[var(--muted-foreground)]/50" />
                        <p className="text-sm font-semibold text-[var(--foreground)]">暂无供应商参与</p>
                        <p className="max-w-[280px] text-xs leading-relaxed text-[var(--muted-foreground)]">
                          发布采购文件后，下载并提交标书的供应商将在此展示
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : result.suppliers.map((s, i) => (
                  <tr key={i} className={s.submitted ? '' : 'opacity-70'}>
                    <td>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[0.85rem] font-bold text-[var(--foreground)]">{s.supplierName}</span>
                        {s.withdrawn && <span className="text-[10px] font-semibold text-[var(--danger)]">已撤回</span>}
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {s.tags?.length ? s.tags.slice(0, 3).map((t, j) => (
                          <span key={j} className="inline-flex rounded-[5px] bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent)]">{t}</span>
                        )) : <span className="text-[11px] text-[var(--muted-foreground)]/60">—</span>}
                      </div>
                    </td>
                    <td className="text-center">
                      {s.lastDownloadAt ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-[0.8rem] tabular-nums font-semibold text-[var(--foreground)]">
                            {new Date(s.lastDownloadAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
                          </span>
                          <span className="text-[10px] tabular-nums text-[var(--muted-foreground)]">
                            {new Date(s.lastDownloadAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                            {s.downloadCount > 1 && <> · {s.downloadCount}次</>}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[11px] font-semibold text-[var(--warning)]">未下载</span>
                      )}
                    </td>
                    <td className="text-center">
                      <BidStatusBadge withdrawn={s.withdrawn} submitted={s.submitted} />
                    </td>
                    <td className="text-right tabular-nums text-[0.8rem] text-[var(--muted-foreground)]">
                      {s.submittedAt
                        ? new Date(s.submittedAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' + new Date(s.submittedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
                        : <span className="text-[var(--muted-foreground)]/40">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

function KpiTile({ label, value, accent }: { label: string; value: number; accent?: 'success' | 'accent' }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">{label}</div>
      <div className={`mt-0.5 text-lg font-black tabular-nums tracking-[-0.03em] ${
        accent === 'success' ? 'text-[var(--success)]' : accent === 'accent' ? 'text-[var(--accent)]' : 'text-[var(--foreground)]'
      }`}>{value}</div>
    </div>
  );
}

function BidStatusBadge({ withdrawn, submitted }: { withdrawn: boolean; submitted: boolean }) {
  if (withdrawn) return <span className="inline-flex items-center rounded-md bg-[color-mix(in_oklch,var(--danger)_18%,transparent)] px-2 py-1 text-[11px] font-semibold text-[var(--danger)]">已撤回</span>;
  if (submitted) return <span className="inline-flex items-center rounded-md bg-[color-mix(in_oklch,var(--success)_18%,transparent)] px-2 py-1 text-[11px] font-semibold text-[var(--success)]">已提交</span>;
  return <span className="inline-flex items-center rounded-md bg-[var(--muted)]/50 px-2 py-1 text-[11px] font-semibold text-[var(--muted-foreground)]">未提交</span>;
}
