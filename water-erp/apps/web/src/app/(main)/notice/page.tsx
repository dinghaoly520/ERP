'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  listAnnouncements, deleteAnnouncement,
  getParticipants,
} from '@/lib/api/announcement';
import type { AnnouncementListItem, AnnouncementType, AnnouncementStatus, Participant } from '@/lib/api/announcement';
import { toast } from 'sonner';
import { MetricCard, PageHero, StatusBadge, TableSkeleton } from '@/components/workbench';
import { FileText, Megaphone as MegaphoneIcon, PlusCircle, Search } from 'lucide-react';

const typeMap: Record<AnnouncementType, { label: string; color: string; bg: string }> = {
  BID_NOTICE: { label: '招标公示', color: '#064ea2', bg: '#064ea218' },
  WIN_NOTICE: { label: '中标公示', color: '#11a874', bg: '#11a87418' },
  POLICY: { label: '政策法规', color: '#f5a623', bg: '#f5a62318' },
  PLATFORM: { label: '平台通知', color: '#5a6d8a', bg: '#5a6d8a18' },
};
const statusMap: Record<AnnouncementStatus, { label: string; color: string; bg: string }> = {
  DRAFT: { label: '草稿', color: '#8a9aaa', bg: '#8a9aaa18' },
  PUBLISHED: { label: '已发布', color: '#11a874', bg: '#11a87418' },
  ARCHIVED: { label: '已归档', color: '#5a6d8a', bg: '#5a6d8a18' },
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAnnouncements({ type: filterType, status: filterStatus || undefined, search: search || undefined, page, pageSize: 15 });
      setData({ total: res.total, items: res.items });
    } catch { /* empty */ }
    setLoading(false);
  }, [filterType, filterStatus, search, page]);

  useEffect(() => { load(); }, [load]);
  const totalPages = Math.ceil(data.total / 15);

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
    <div className="mx-auto max-w-[1440px]">
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

      <div className="mt-6">
        <div className="flex flex-wrap items-center border-b border-[var(--border)]">
          <div className="flex">
            {(Object.keys(typeMap) as AnnouncementType[]).map((t, i, arr) => (
              <button
                key={t}
                onClick={() => { setFilterType(t); setPage(1); }}
                className={`relative px-5 py-3 text-sm font-bold transition-colors
                  ${filterType === t ? 'text-[#064ea2] bg-[#f0f5ff]' : 'text-[#5a6d8a] hover:text-[#18243a] hover:bg-[#f8fafc]'}
                  ${i < arr.length - 1 ? 'border-r border-[var(--border)]' : ''}`}
              >
                {typeMap[t].label}
                {filterType === t && <span className="absolute bottom-0 left-[14px] right-[14px] h-[2px] rounded-full bg-[#064ea2]" />}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-3 pr-4">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
              <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
                placeholder="搜索标题..." className="w-full min-w-[120px] max-w-[200px] rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1.5 pl-8 pr-3 text-sm text-[#18243a] placeholder-[#94a3b8] outline-none transition focus:border-[#0b63ce] focus:bg-white focus:shadow-[0_0_0_3px_rgba(11,99,206,0.10)]" />
            </div>
            <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value as any); setPage(1); }}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1.5 pl-3 pr-7 text-sm text-[#5a6d8a] outline-none transition focus:border-[#0b63ce] focus:bg-white focus:shadow-[0_0_0_3px_rgba(11,99,206,0.10)] appearance-none bg-no-repeat"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundPosition: 'right 8px center' }}
            >
              <option value="">全部状态</option>
              <option value="PUBLISHED">已发布</option>
              <option value="DRAFT">草稿</option>
              <option value="ARCHIVED">已归档</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
        <table className="workbench-table w-full min-w-[640px]">
          <thead className="neu-thead [neu-thead text-[#5a6d8a] [&_th]:whitespace-nowrap_th]:whitespace-nowrap">
            <tr>
              <th className="px-4 py-3 text-center">标题</th>
              <th className="px-4 py-3 text-center">类型</th>
              <th className="px-4 py-3 text-center">状态</th>
              <th className="px-4 py-3 text-center">附件/招标文件</th>
              <th className="px-4 py-3 text-center">浏览</th>
              <th className="px-4 py-3 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableSkeleton cols={6} rows={5} />
            ) : data.items.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-16 text-center text-[#8a99ad]">暂无信息</td></tr>
            ) : data.items.map(a => {
              const tm = typeMap[a.type] || typeMap.PLATFORM;
              const sm = statusMap[a.status] || statusMap.DRAFT;
              const noBidDoc = a.type === 'BID_NOTICE' && a.status === 'PUBLISHED' && !a.bidDocument;
              return (
                <tr key={a.id} className="row-clickable" onClick={() => router.push(`/notice/${a.id}`)}>
                  <td className="px-4 py-3">
                    <span className="text-sm font-bold text-[#18243a]">{a.title}</span>
                    {a.isTop && <StatusBadge tone="red" className="ml-1 !text-[10px] !px-1.5 !py-0">置顶</StatusBadge>}
                    {noBidDoc && <span className="ml-2 rounded-md bg-[#fef2f2] px-1.5 py-0.5 text-[10px] text-[#e74c3c]">未上传招标文件</span>}
                  </td>
                  <td className="px-4 py-3 text-center"><StatusBadge tone={a.type === 'BID_NOTICE' ? 'blue' : a.type === 'WIN_NOTICE' ? 'green' : a.type === 'POLICY' ? 'orange' : 'gray'}>{tm.label}</StatusBadge></td>
                  <td className="px-4 py-3 text-center"><StatusBadge tone={a.status === 'PUBLISHED' ? 'green' : a.status === 'DRAFT' ? 'gray' : 'gray'}>{sm.label}</StatusBadge></td>
                  <td className="px-4 py-3 text-center text-xs text-[#5a6d8a]">
                    {a.attachments && a.attachments.length > 0 && <span className="mr-2">📎 {a.attachments.length}</span>}
                    {a.bidDocument && <span className="text-[#064ea2] font-semibold">🔒 招标文件{a.bidDocument.requirePayment ? '(付费)' : ''}</span>}
                  </td>
                  <td className="px-4 py-3 text-center text-[#5a6d8a]">{a.viewCount}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center gap-1.5 flex-wrap" onClick={e => e.stopPropagation()}>
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
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 px-4 py-3 border-t border-[var(--border)]">
            <span className="text-xs text-[#5a6d8a]">共 {data.total} 条，第 {page}/{totalPages} 页</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 text-xs border border-[var(--border)] rounded hover:bg-[var(--surface)] disabled:opacity-40">上一页</button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 text-xs border border-[var(--border)] rounded hover:bg-[var(--surface)] disabled:opacity-40">下一页</button>
            </div>
          </div>
        )}
      </div>
      </div>

      {partAnn && <ParticipantsModal announcement={partAnn} onClose={() => setPartAnn(null)} />}
    </div>
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
    <div className="modal-backdrop fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="modal-content glass-card rounded-xl shadow-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white flex items-center justify-between px-6 py-4 border-b border-[var(--border)] z-10">
          <h3 className="text-lg font-bold text-[#18243a]">投标情况</h3>
          <button onClick={onClose} className="text-[#5a6d8a] hover:text-[#18243a] text-xl leading-none">×</button>
        </div>
        <div className="p-6">
          {loading ? <p className="text-center text-[#5a6d8a] py-8">加载中...</p> : !data || !data.project ? (
            <p className="text-center text-[#5a6d8a] py-8">该招标公示未关联招标项目（无项目编号），暂无投标数据。</p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--border)] p-4">
                <div className="flex items-center justify-between"><strong className="text-[#18243a]">{data.project.name}</strong><span className="text-xs text-[#5a6d8a]">截止 {new Date(data.project.deadline).toLocaleDateString('zh-CN')}</span></div>
                <div className="flex items-center justify-between mt-3 mb-1.5"><span className="text-sm font-semibold text-[#18243a]">提交进度</span><span className="text-sm text-[#5a6d8a]">{data.stats.submitted}/{data.stats.total} 已提交</span></div>
                <div className="h-2 rounded-full bg-[#f1f5f9] overflow-hidden"><div className="h-full rounded-full bg-[#11a874]" style={{ width: pct + '%' }} /></div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[580px] text-sm">
                <thead><tr className="border-b border-[var(--border)] text-left text-[#5a6d8a]"><th className="px-3 py-2">供应商</th><th className="px-3 py-2">分类</th><th className="px-3 py-2">下载</th><th className="px-3 py-2">标书状态</th><th className="px-3 py-2">提交时间</th><th className="px-3 py-2">报价</th></tr></thead>
                <tbody>
                  {data.suppliers.length === 0 ? <tr><td colSpan={6} className="px-3 py-8 text-center text-[#5a6d8a]">暂无投标供应商</td></tr> : data.suppliers.map((s, i) => {
                    const b = badge(s);
                    return (<tr key={i} className="border-b border-[#f1f5f9]"><td className="px-3 py-2 font-semibold text-[#18243a]">{s.supplierName}</td><td className="px-3 py-2 text-[#5a6d8a]">{s.classification || '—'}</td><td className="px-3 py-2 text-[#5a6d8a]">{s.downloadStatus}</td><td className="px-3 py-2"><span className="px-2 py-1 rounded text-xs font-semibold" style={{ color: b.color, backgroundColor: b.bg }}>{b.label}</span></td><td className="px-3 py-2 text-[#5a6d8a]">{s.submittedAt ? new Date(s.submittedAt).toLocaleString('zh-CN') : '—'}</td><td className="px-3 py-2 text-[#5a6d8a]">{s.bidPrice || '—'}</td></tr>);
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
