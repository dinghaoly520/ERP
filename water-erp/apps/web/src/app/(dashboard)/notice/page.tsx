'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { TableSkeleton, CardSkeleton } from '@/components/skeleton';

interface Announcement {
  id: string;
  title: string;
  content: string;
  type: string;
  status: string;
  summary?: string;
  publishDate?: string;
  isTop: boolean;
  viewCount: number;
  relatedProjectCode?: string;
  createdAt: string;
  updatedAt: string;
}

const typeMap: Record<string, { label: string; color: string; bg: string }> = {
  BID_NOTICE: { label: '招标公告', color: '#064ea2', bg: '#064ea218' },
  WIN_NOTICE: { label: '中标公示', color: '#11a874', bg: '#11a87418' },
  POLICY: { label: '政策法规', color: '#f5a623', bg: '#f5a62318' },
  PLATFORM: { label: '平台通知', color: '#5a6d8a', bg: '#5a6d8a18' },
};

const statusMap: Record<string, { label: string; color: string; bg: string }> = {
  DRAFT: { label: '草稿', color: '#8a9aaa', bg: '#8a9aaa18' },
  PUBLISHED: { label: '已发布', color: '#11a874', bg: '#11a87418' },
  ARCHIVED: { label: '已归档', color: '#5a6d8a', bg: '#5a6d8a18' },
};

export default function NoticePage() {
  const [data, setData] = useState<{ total: number; page: number; pageSize: number; items: Announcement[] }>({ total: 0, page: 1, pageSize: 20, items: [] });
  const [stats, setStats] = useState<{ total: number; published: number; bidNotice: number; winNotice: number; policy: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Create modal
  const [createModal, setCreateModal] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', type: 'BID_NOTICE', summary: '' });
  const [createLoading, setCreateLoading] = useState(false);

  // Detail modal
  const [detail, setDetail] = useState<Announcement | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (filterType) query.set('type', filterType);
      if (filterStatus) query.set('status', filterStatus);
      if (search) query.set('search', search);
      query.set('page', String(page));
      query.set('pageSize', '20');
      const res = await api.get<{ total: number; page: number; pageSize: number; items: Announcement[] }>(`/announcements?${query.toString()}`);
      setData(res);
    } catch { /* empty */ }
    setLoading(false);
  }, [filterType, filterStatus, search, page]);

  const loadStats = async () => {
    try { const s = await api.get<typeof stats>('/announcements/stats'); setStats(s); } catch { /* empty */ }
  };

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadStats(); }, []);

  const handleCreate = async () => {
    if (!form.title || !form.content) { toast.error('请填写信息标题和正文'); return; }
    setCreateLoading(true);
    try {
      await api.post('/announcements', form);
      toast.success('信息创建成功');
      setCreateModal(false);
      setForm({ title: '', content: '', type: 'BID_NOTICE', summary: '' });
      loadData();
      loadStats();
    } catch { toast.error('创建失败'); }
    setCreateLoading(false);
  };

  const totalPages = Math.ceil(data.total / 20);

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="mb-2 inline-flex rounded-full border border-[#bfdbfe] bg-[#eff6ff] px-3 py-1 text-xs font-semibold text-[#064ea2]">信息发布中心</div>
          <h1 className="text-2xl font-bold text-[#0f2f57]">信息发布中心</h1>
          <p className="text-sm text-[#5a6d8a] mt-1">统一管理招标/采购公告、中标/成交公示、政策制度与通知公告</p>
        </div>
        <button onClick={() => setCreateModal(true)} className="px-5 py-2.5 bg-[#064ea2] text-white rounded-xl font-semibold hover:bg-[#053f85] transition shadow-[0_10px_24px_rgba(6,78,162,0.22)]">新建信息</button>
      </div>

      {/* 统计卡片 */}
      {loading ? <CardSkeleton /> : stats && (
        <div className="grid grid-cols-5 gap-4 mb-6">
          {[
            { label: '全部信息', value: stats.total, color: '#18243a' },
            { label: '已发布', value: stats.published, color: '#11a874' },
            { label: '招标/采购公告', value: stats.bidNotice, color: '#064ea2' },
            { label: '中标/成交公示', value: stats.winNotice, color: '#f5a623' },
            { label: '政策制度', value: stats.policy, color: '#5a6d8a' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5">
              <p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">{s.label}</p>
              <p className="text-3xl font-bold" style={{ color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-4 gap-4 mb-6">
        {Object.entries(typeMap).map(([key, value]) => (
          <button
            key={key}
            onClick={() => { setFilterType(key); setPage(1); }}
            className="rounded-2xl border border-[#e5ecf4] bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-[#bfdbfe] hover:shadow-md"
          >
            <div className="mb-3 inline-flex rounded-full px-2.5 py-1 text-xs font-bold" style={{ color: value.color, backgroundColor: value.bg }}>{value.label}</div>
            <div className="text-sm font-semibold text-[#18243a]">查看{value.label}</div>
            <div className="mt-1 text-xs text-[#8a96aa]">筛选并管理该类信息</div>
          </button>
        ))}
      </div>

      {/* 筛选栏 */}
      <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-4 mb-4 flex gap-3 items-center flex-wrap">
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="搜索标题或内容" className="flex-1 min-w-[200px] px-3 py-2 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]" />
        <select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]">
          <option value="">全部类型</option>
          {Object.entries(typeMap).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]">
          <option value="">全部状态</option>
          {Object.entries(statusMap).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button onClick={() => { setSearch(''); setFilterType(''); setFilterStatus(''); setPage(1); }}
          className="px-4 py-2 text-sm text-[oklch(0.55_0.01_264)] hover:text-[#064ea2]">重置</button>
      </div>

      {/* 公告列表 */}
      <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)]">
        {loading ? <div className="p-5"><TableSkeleton rows={5} cols={5} /></div> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-[oklch(0.91_0.006_264)] text-left text-[oklch(0.55_0.01_264)]">
              <th className="px-5 py-3">标题</th>
              <th className="px-5 py-3">分类</th>
              <th className="px-5 py-3">状态</th>
              <th className="px-5 py-3">发布范围</th>
              <th className="px-5 py-3">更新时间</th>
              <th className="px-5 py-3 text-right">操作</th>
            </tr></thead>
            <tbody>
              {data.items.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-[oklch(0.55_0.01_264)]">暂无公告数据</td></tr>
              ) : data.items.map(a => {
                const t = typeMap[a.type] || { label: a.type, color: '#999', bg: '#99918' };
                const s = statusMap[a.status] || { label: a.status, color: '#999', bg: '#99918' };
                return (
                  <tr key={a.id} className="border-b border-[oklch(0.91_0.006_264)] hover:bg-[oklch(0.992_0.003_264)]">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        {a.isTop && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold">置顶</span>}
                        <span className="font-semibold text-[oklch(0.18_0.012_265)] cursor-pointer hover:text-[#064ea2]" onClick={() => setDetail(a)}>{a.title}</span>
                      </div>
                      {a.summary && <p className="text-xs text-[oklch(0.55_0.01_264)] mt-1 truncate max-w-[300px]">{a.summary}</p>}
                    </td>
                    <td className="px-5 py-3"><span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ color: t.color, backgroundColor: t.bg }}>{t.label}</span></td>
                    <td className="px-5 py-3"><span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ color: s.color, backgroundColor: s.bg }}>{s.label}</span></td>
                    <td className="px-5 py-3 text-[oklch(0.55_0.01_264)]">采购管理端 / 公共门户</td>
                    <td className="px-5 py-3 text-[oklch(0.55_0.01_264)]">{new Date(a.updatedAt).toLocaleDateString('zh-CN')}</td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => setDetail(a)} className="px-2 py-1 text-xs text-[#064ea2] hover:underline">查看</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {totalPages > 1 && (
          <div className="flex justify-between items-center px-5 py-3 border-t border-[oklch(0.91_0.006_264)]">
            <span className="text-xs text-[oklch(0.55_0.01_264)]">共 {data.total} 条，第 {page}/{totalPages} 页</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 text-xs border border-[oklch(0.91_0.006_264)] rounded hover:bg-[oklch(0.992_0.003_264)] disabled:opacity-40">上一页</button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 text-xs border border-[oklch(0.91_0.006_264)] rounded hover:bg-[oklch(0.992_0.003_264)] disabled:opacity-40">下一页</button>
            </div>
          </div>
        )}
      </div>

      {/* 新建信息弹窗 */}
      {createModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setCreateModal(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-lg shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-[oklch(0.18_0.012_265)] mb-4">新建信息</h3>
            <div className="space-y-3">
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="公告标题" className="w-full px-3 py-2 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]" />
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full px-3 py-2 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]">
                {Object.entries(typeMap).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <textarea value={form.summary} onChange={e => setForm(f => ({ ...f, summary: e.target.value }))}
                placeholder="摘要（选填）" className="w-full px-3 py-2 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm h-16 resize-none focus:outline-none focus:border-[#064ea2]" />
              <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                placeholder="公告内容" className="w-full px-3 py-2 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm h-32 resize-none focus:outline-none focus:border-[#064ea2]" />
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setCreateModal(false)} className="px-4 py-2 text-sm text-[oklch(0.55_0.01_264)] hover:bg-[oklch(0.992_0.003_264)] rounded-lg">取消</button>
              <button onClick={handleCreate} disabled={createLoading} className="px-4 py-2 text-sm text-white bg-[#064ea2] rounded-lg hover:bg-[#0e62d0] disabled:opacity-50">
                {createLoading ? '发布中...' : '保存并发布'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 详情弹窗 */}
      {detail && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-lg shadow-xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ color: typeMap[detail.type]?.color, backgroundColor: typeMap[detail.type]?.bg }}>{typeMap[detail.type]?.label || detail.type}</span>
              {detail.isTop && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold">置顶</span>}
            </div>
            <h3 className="text-lg font-bold text-[oklch(0.18_0.012_265)] mb-2">{detail.title}</h3>
            {detail.summary && <p className="text-sm text-[oklch(0.55_0.01_264)] mb-4">{detail.summary}</p>}
            <div className="text-sm text-[oklch(0.18_0.012_265)] whitespace-pre-wrap leading-relaxed mb-4">{detail.content}</div>
            <div className="flex justify-between text-xs text-[oklch(0.72_0.008_264)] pt-3 border-t border-[oklch(0.91_0.006_264)]">
              <span>浏览：{detail.viewCount} 次</span>
              <span>{detail.publishDate ? new Date(detail.publishDate).toLocaleString('zh-CN') : ''}</span>
            </div>
            <div className="mt-4 flex justify-end">
              <button onClick={() => setDetail(null)} className="px-4 py-2 text-sm text-[oklch(0.55_0.01_264)] hover:bg-[oklch(0.992_0.003_264)] rounded-lg">关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
