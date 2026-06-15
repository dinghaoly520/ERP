'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  listAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement,
  listAttachments, addAttachment, removeAttachment, uploadFile,
  getBidDocument, uploadBidDocument, updateBidDocumentConfig, confirmBidDocPayment, removeBidDocument,
  getParticipants,
} from '@/lib/api/announcement';
import type { AnnouncementListItem, AnnouncementType, AnnouncementStatus, AnnouncementAttachment, BidDocumentManage, Participant } from '@/lib/api/announcement';
import { getSupplierList } from '@/lib/api/supplier';
import type { Supplier } from '@/lib/types';
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

interface MetaField { key: string; label: string; area?: boolean }
const TYPE_META: Record<AnnouncementType, MetaField[]> = {
  BID_NOTICE: [
    { key: 'projectCode', label: '项目编号（关联招标项目，用于投标情况）' }, { key: 'method', label: '招标方式' }, { key: 'budget', label: '预算金额' },
    { key: 'scope', label: '采购内容/范围', area: true }, { key: 'qualification', label: '投标人资格要求', area: true },
    { key: 'deadline', label: '报名/投标截止' }, { key: 'openTime', label: '开标时间' }, { key: 'contact', label: '联系方式' },
  ],
  WIN_NOTICE: [
    { key: 'projectCode', label: '项目编号' }, { key: 'winner', label: '中标供应商' }, { key: 'amount', label: '中标金额' },
    { key: 'period', label: '工期/交货期' }, { key: 'quality', label: '质量标准' }, { key: 'experts', label: '评审专家' },
    { key: 'publicityPeriod', label: '公示期' }, { key: 'objection', label: '异议渠道', area: true },
  ],
  POLICY: [
    { key: 'docNo', label: '文号' }, { key: 'issuer', label: '发布机关' }, { key: 'effectiveDate', label: '生效日期' },
    { key: 'scope', label: '适用范围', area: true },
  ],
  PLATFORM: [
    { key: 'impactScope', label: '影响范围' }, { key: 'changes', label: '功能变化', area: true }, { key: 'schedule', label: '时间安排' },
    { key: 'guide', label: '操作指引', area: true }, { key: 'support', label: '支持渠道' },
  ],
};

export default function NoticePage() {
  const [data, setData] = useState<{ total: number; items: AnnouncementListItem[] }>({ total: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<AnnouncementType | ''>('');
  const [filterStatus, setFilterStatus] = useState<AnnouncementStatus | ''>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [editor, setEditor] = useState<AnnouncementListItem | null | 'new'>(null);
  const [partAnn, setPartAnn] = useState<AnnouncementListItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAnnouncements({ type: filterType || undefined, status: filterStatus || undefined, search: search || undefined, page, pageSize: 15 });
      setData({ total: res.total, items: res.items });
    } catch { /* empty */ }
    setLoading(false);
  }, [filterType, filterStatus, search, page]);

  useEffect(() => { load(); }, [load]);
  const totalPages = Math.ceil(data.total / 15);
  const remove = async (a: AnnouncementListItem) => {
    if (!confirm('确认删除「' + a.title + '」？')) return;
    // Optimistic removal + undo
    const prevItems = data.items;
    setData(d => ({ ...d, items: d.items.filter(x => x.id !== a.id) }));
    let cancelled = false;
    const undoId = toast('已删除「' + a.title + '」', {
      description: '4 秒内可撤销',
      duration: 4000,
      action: { label: '撤销', onClick: () => { cancelled = true; setData(d => ({ ...d, items: prevItems })); } },
    });
    // Wait for toast to expire
    await new Promise(r => setTimeout(r, 4200));
    if (cancelled) return;
    try { await deleteAnnouncement(a.id); load(); } catch (e: any) { toast.error(e?.message || '删除失败'); load(); }
  };

  return (
    <div>
      <PageHero
        eyebrow="信息发布中心"
        title="信息发布中心"
        description="招标公示、中标公示、政策法规、平台通知；起草并配齐招标文件/附件后再发布。"
        tone="blue"
        icon={<MegaphoneIcon size={14} />}
        actions={<button onClick={() => setEditor('new')} className="inline-flex items-center gap-2 rounded-xl bg-[#064ea2] px-4 py-2 text-sm font-bold text-white hover:bg-[#054280]"><PlusCircle size={16} /> 新建信息</button>}
      />

      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <MetricCard label="信息总数" value={data.total} hint="当前筛选条件下总量" tone="blue" icon={<FileText size={18} />} />
        <MetricCard label="已发布" value={data.items.filter(item => item.status === 'PUBLISHED').length} hint="本页已发布记录" tone="green" />
        <MetricCard label="草稿" value={data.items.filter(item => item.status === 'DRAFT').length} hint="本页草稿记录" tone="orange" />
        <MetricCard label="已归档" value={data.items.filter(item => item.status === 'ARCHIVED').length} hint="本页归档记录" tone="gray" />
      </div>

      {/* ── 分段控件条 + 搜索 ── */}
      <div className="mt-6 rounded-2xl border border-[#e5ecf4] bg-white overflow-hidden">
        {/* 类型分段控件 */}
        <div className="flex items-center border-b border-[#edf2f7]">
          <div className="flex">
            {([{ k: '', label: '全部' }, ...(Object.keys(typeMap) as AnnouncementType[]).map(t => ({ k: t, label: typeMap[t].label }))] as { k: string; label: string }[]).map((item, i, arr) => (
              <button
                key={item.k}
                onClick={() => { setFilterType(item.k as AnnouncementType | ''); setPage(1); }}
                className={`relative px-5 py-3 text-sm font-bold transition-colors
                  ${filterType === item.k
                    ? 'text-[#064ea2] bg-[#f0f5ff]'
                    : 'text-[#5a6d8a] hover:text-[#18243a] hover:bg-[#f8fafc]'
                  }
                  ${i < arr.length - 1 ? 'border-r border-[#edf2f7]' : ''}
                `}
              >
                {item.label}
                {filterType === item.k && (
                  <span className="absolute bottom-0 left-[14px] right-[14px] h-[2px] rounded-full bg-[#064ea2]" />
                )}
              </button>
            ))}
          </div>

          {/* 搜索 + 状态下拉 — 右对齐 */}
          <div className="ml-auto flex items-center gap-3 pr-4">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                placeholder="搜索标题..."
                className="w-[180px] rounded-lg border border-[#e5ecf4] bg-[#f8fafc] py-1.5 pl-8 pr-3 text-sm text-[#18243a] placeholder-[#94a3b8] outline-none transition focus:border-[#0b63ce] focus:bg-white focus:shadow-[0_0_0_3px_rgba(11,99,206,0.10)]"
              />
            </div>
            <select
              value={filterStatus}
              onChange={e => { setFilterStatus(e.target.value as any); setPage(1); }}
              className="rounded-lg border border-[#e5ecf4] bg-[#f8fafc] py-1.5 pl-3 pr-7 text-sm text-[#5a6d8a] outline-none transition focus:border-[#0b63ce] focus:bg-white focus:shadow-[0_0_0_3px_rgba(11,99,206,0.10)] appearance-none bg-no-repeat"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundPosition: 'right 8px center' }}
            >
              <option value="">全部状态</option>
              <option value="PUBLISHED">已发布</option>
              <option value="DRAFT">草稿</option>
              <option value="ARCHIVED">已归档</option>
            </select>
          </div>
        </div>

        {/* 表格 */}
        <div className="overflow-hidden">
        <table className="workbench-table">
          <thead className="bg-[#f3f7fc] text-[#5a6d8a]">
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
                <tr key={a.id} className="row-clickable" onClick={() => setEditor(a)}>
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
                    <div className="flex justify-center gap-1.5 flex-wrap">
                      <button onClick={(e) => { e.stopPropagation(); setEditor(a); }} className="rounded-lg border border-[#dce6f3] px-2.5 py-1 text-xs font-bold text-[#5a6d8a] hover:bg-[#f8fafc] transition">编辑</button>
                      {a.type === 'BID_NOTICE' && <button onClick={(e) => { e.stopPropagation(); setPartAnn(a); }} className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition">投标情况</button>}
                      <button onClick={(e) => { e.stopPropagation(); remove(a); }} className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-100 transition">删除</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="flex justify-between items-center px-4 py-3 border-t border-[#e5ecf4]">
            <span className="text-xs text-[#5a6d8a]">共 {data.total} 条，第 {page}/{totalPages} 页</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 text-xs border border-[#e5ecf4] rounded hover:bg-[#f8fafc] disabled:opacity-40">上一页</button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 text-xs border border-[#e5ecf4] rounded hover:bg-[#f8fafc] disabled:opacity-40">下一页</button>
            </div>
          </div>
        )}
      </div>
      </div>

      {editor !== null && <EditorModal key={editor === 'new' ? 'new' : editor.id} announcement={editor === 'new' ? null : editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); load(); }} />}
      {partAnn && <ParticipantsModal announcement={partAnn} onClose={() => setPartAnn(null)} />}
    </div>
  );
}

/* ════════════ 编辑器（合并：基本信息 + 结构化字段 + 正文 + 附件 + 招标文件；草稿优先，发布最后） ════════════ */

function EditorModal({ announcement, onClose, onSaved }: { announcement: AnnouncementListItem | null; onClose: () => void; onSaved: () => void }) {
  const [annId, setAnnId] = useState<string | null>(announcement?.id ?? null);
  const [type, setType] = useState<AnnouncementType>(announcement?.type || 'BID_NOTICE');
  const [title, setTitle] = useState(announcement?.title || '');
  const [content, setContent] = useState(announcement?.content || '');
  const [summary, setSummary] = useState(announcement?.summary || '');
  const [status, setStatus] = useState<AnnouncementStatus>(announcement?.status || 'DRAFT');
  const [isTop, setIsTop] = useState(announcement?.isTop ?? false);
  const [publishDate, setPublishDate] = useState(announcement?.publishDate ? announcement.publishDate.slice(0, 10) : new Date().toISOString().slice(0, 10));
  const buildMeta = (t: AnnouncementType) => {
    const out: Record<string, string> = {};
    const m = (announcement?.metadata || {}) as Record<string, any>;
    for (const f of TYPE_META[t]) out[f.key] = m[f.key] != null ? String(m[f.key]) : '';
    return out;
  };
  const [metadata, setMetadata] = useState<Record<string, string>>(() => buildMeta(announcement?.type || 'BID_NOTICE'));
  const [busy, setBusy] = useState(false);

  // 附件 + 招标文件（仅 annId 存在时可用）
  const [attachments, setAttachments] = useState<AnnouncementAttachment[]>([]);
  const [bidDoc, setBidDoc] = useState<BidDocumentManage | null>(null);

  const loadExtras = useCallback(async () => {
    if (!annId) return;
    try { setAttachments(await listAttachments(annId)); } catch { /* */ }
    if (type === 'BID_NOTICE') { try { setBidDoc(await getBidDocument(annId)); } catch { setBidDoc(null); } }
  }, [annId, type]);

  useEffect(() => { loadExtras(); }, [loadExtras]);

  const onTypeChange = (t: AnnouncementType) => { setType(t); setMetadata(buildMeta(t)); };

  /** 保存（草稿或发布）。返回保存后的 id。 */
  const save = async (targetStatus: AnnouncementStatus): Promise<string | null> => {
    if (!title.trim() || !content.trim()) { toast.error('请填写标题和正文'); return null; }
    setBusy(true);
    const meta: Record<string, any> = {};
    for (const f of TYPE_META[type]) if (metadata[f.key]?.trim()) meta[f.key] = metadata[f.key].trim();
    // 招标公示：把项目编号写入 relatedProjectCode，供投标情况解析
    const payload: any = { title, content, type, summary, status: targetStatus, isTop, publishDate, metadata: meta };
    if (type === 'BID_NOTICE') payload.relatedProjectCode = meta.projectCode || null;
    try {
      let saved: any;
      if (annId) saved = await updateAnnouncement(annId, payload);
      else saved = await createAnnouncement(payload);
      setAnnId(saved.id);
      setStatus(saved.status || targetStatus);
      return saved.id;
    } catch (e: any) { toast.error(e?.message || '保存失败'); return null; }
    finally { setBusy(false); }
  };

  const saveDraft = async () => { const id = await save('DRAFT'); if (id) { toast.success('草稿已保存'); await loadExtras(); } };
  const publish = async () => {
    if (type === 'BID_NOTICE' && !bidDoc) { if (!confirm('该招标公示尚未上传招标文件，确认直接发布？')) return; }
    const id = await save('PUBLISHED'); if (id) { toast.success('已发布'); onSaved(); }
  };

  return (
    <Modal title={annId ? '编辑信息' : '新建信息'} onClose={onClose} wide>
      <div className="space-y-4">
        {/* 提示条 */}
        {!annId && <div className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-3 py-2 text-xs text-[#064ea2]">先填写基本信息并「保存草稿」后，才能上传附件与招标文件；全部配齐后再「发布」。</div>}

        <div className="grid grid-cols-3 gap-3">
          <Field label="类型">
            <select value={type} onChange={e => onTypeChange(e.target.value as AnnouncementType)} className={inputCls} disabled={!!annId}>
              {(Object.keys(typeMap) as AnnouncementType[]).map(t => <option key={t} value={t}>{typeMap[t].label}</option>)}
            </select>
          </Field>
          <Field label="当前状态">
            <select value={status} onChange={e => setStatus(e.target.value as AnnouncementStatus)} className={inputCls}>
              <option value="DRAFT">草稿</option>
              <option value="PUBLISHED">已发布</option>
              <option value="ARCHIVED">已归档</option>
            </select>
          </Field>
          <Field label="发布日期"><input type="date" value={publishDate} onChange={e => setPublishDate(e.target.value)} className={inputCls} /></Field>
        </div>

        <Field label="标题"><input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} /></Field>

        <div className="rounded-xl border border-[#dce6f3] bg-[#f8fafc] p-4">
          <div className="text-xs font-bold text-[#064ea2] mb-3">{typeMap[type].label} · 结构化信息</div>
          <div className="grid grid-cols-2 gap-3">
            {TYPE_META[type].map(f => (
              <div key={f.key} className={f.area ? 'col-span-2' : ''}>
                <label className="block text-xs font-semibold text-[#5a6d8a] mb-1">{f.label}</label>
                {f.area
                  ? <textarea value={metadata[f.key] || ''} onChange={e => setMetadata({ ...metadata, [f.key]: e.target.value })} className={inputCls + ' h-16 resize-none'} />
                  : <input value={metadata[f.key] || ''} onChange={e => setMetadata({ ...metadata, [f.key]: e.target.value })} className={inputCls} />}
              </div>
            ))}
          </div>
        </div>

        <Field label="正文（支持 HTML）"><textarea value={content} onChange={e => setContent(e.target.value)} className={inputCls + ' h-28 resize-none font-mono text-xs'} /></Field>
        <Field label="摘要（可选，留空则 AI 自动生成）"><input value={summary} onChange={e => setSummary(e.target.value)} className={inputCls} /></Field>
        <label className="flex items-center gap-2 text-sm text-[#5a6d8a]"><input type="checkbox" checked={isTop} onChange={e => setIsTop(e.target.checked)} className="accent-[#064ea2]" />置顶</label>

        {/* 附件 */}
        <AttachmentsSection annId={annId} attachments={attachments} onChanged={loadExtras} />

        {/* 招标文件（仅招标公示） */}
        {type === 'BID_NOTICE' && <BidDocSection annId={annId} bidDoc={bidDoc} onChanged={loadExtras} />}
      </div>

      <div className="flex justify-between items-center gap-3 mt-5">
        <div className="text-xs text-[#8a96aa]">{annId ? 'ID: ' + annId.slice(-8) : '未保存'}</div>
        <div className="flex gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[#5a6d8a] hover:bg-[#f8fafc] rounded-lg">取消</button>
          <button onClick={saveDraft} disabled={busy} className="px-4 py-2 text-sm font-semibold text-[#064ea2] border border-[#bcd0e8] hover:bg-[#f0f6ff] rounded-lg disabled:opacity-50">{busy ? '保存中...' : '保存草稿'}</button>
          <button onClick={publish} disabled={busy} className="px-5 py-2 text-sm font-semibold text-white bg-[#11a874] hover:bg-[#0e8c5f] rounded-lg disabled:opacity-50">{busy ? '处理中...' : '发布'}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ── 附件区（编辑器内联）── */
function AttachmentsSection({ annId, attachments, onChanged }: { annId: string | null; attachments: AnnouncementAttachment[]; onChanged: () => void }) {
  const [title, setTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!annId) { toast.error('请先保存草稿'); e.target.value = ''; return; }
    const f = e.target.files?.[0]; if (!f) return;
    setUploading(true);
    try { const asset = await uploadFile(f, 'announcement'); await addAttachment(annId, asset.id, title || f.name); setTitle(''); onChanged(); toast.success('附件已添加'); } catch (err: any) { toast.error(err?.message || '上传失败'); }
    setUploading(false); e.target.value = '';
  };
  return (
    <div className="rounded-xl border border-[#e5ecf4] p-4">
      <div className="text-xs font-bold text-[#064ea2] mb-3">附件（公开可下载）</div>
      {!annId ? <p className="text-xs text-[#8a96aa]">保存草稿后可上传附件</p> : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="附件标题（可选）" className={inputCls + ' flex-1'} />
            <label className={'inline-flex items-center px-3 py-2 text-sm text-white bg-[#064ea2] hover:bg-[#054280] rounded-lg cursor-pointer whitespace-nowrap ' + (uploading ? 'opacity-50' : '')}>{uploading ? '上传中...' : '+ 添加'}<input type="file" className="hidden" onChange={onUpload} /></label>
          </div>
          {attachments.length === 0 ? <p className="text-xs text-[#8a96aa]">暂无附件</p> : attachments.map(a => (
            <div key={a.id} className="flex items-center justify-between rounded-lg border border-[#e5ecf4] px-3 py-2">
              <div><div className="text-sm font-semibold text-[#18243a]">{a.title}</div><div className="text-xs text-[#5a6d8a]">{a.fileAsset.originalName} · {(a.fileAsset.size / 1024).toFixed(0)} KB</div></div>
              <div className="flex gap-3">
                <a href={'/api/announcements/attachments/' + a.id + '/download'} target="_blank" rel="noreferrer" className="text-xs text-[#064ea2] hover:underline">预览</a>
                <button onClick={async () => { if (confirm('删除该附件？')) { await removeAttachment(a.id); onChanged(); } }} className="text-xs text-[#e74c3c] hover:underline">删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 招标文件区（编辑器内联，加密 + 受控分发）── */
function BidDocSection({ annId, bidDoc, onChanged }: { annId: string | null; bidDoc: BidDocumentManage | null; onChanged: () => void }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [docTitle, setDocTitle] = useState('');
  const [scope, setScope] = useState<'OPEN' | 'DESIGNATED' | 'INVITED'>('OPEN');
  const [requirePayment, setRequirePayment] = useState(false);
  const [price, setPrice] = useState<number | ''>('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (annId && bidDoc) { setScope(bidDoc.accessScope); setRequirePayment(bidDoc.requirePayment); setPrice(bidDoc.price ?? ''); setSelected(bidDoc.allowedSupplierIds); }
  }, [annId, bidDoc]);
  useEffect(() => {
    if (scope === 'DESIGNATED') getSupplierList({ status: 'APPROVED', search: supplierSearch || undefined, pageSize: 50 }).then(r => setSuppliers(r.items)).catch(() => {});
  }, [scope, supplierSearch]);

  const doUpload = async () => {
    if (!annId) { toast.error('请先保存草稿'); return; }
    if (!file) { toast.error('请选择招标文件'); return; }
    setBusy(true);
    try { await uploadBidDocument(annId, file, { title: docTitle || file.name, accessScope: scope, requirePayment, price: requirePayment ? (price || 0) : undefined, allowedSupplierIds: scope === 'DESIGNATED' ? selected : undefined }); toast.success('招标文件已加密上传'); setFile(null); setDocTitle(''); onChanged(); } catch (e: any) { toast.error(e?.message || '上传失败'); }
    setBusy(false);
  };
  const saveConfig = async () => {
    if (!annId || !bidDoc) return;
    setBusy(true);
    try { await updateBidDocumentConfig(annId, { accessScope: scope, requirePayment, price: requirePayment ? (price || 0) : undefined, allowedSupplierIds: scope === 'DESIGNATED' ? selected : undefined }); toast.success('配置已保存'); onChanged(); } catch (e: any) { toast.error(e?.message || '保存失败'); }
    setBusy(false);
  };
  const confirmPay = async (supplierId: string) => { if (!annId) return; try { await confirmBidDocPayment(annId, supplierId); toast.success('已确认到账'); onChanged(); } catch (e: any) { toast.error(e?.message || '失败'); } };
  const removeDoc = async () => { if (!annId || !bidDoc || !confirm('删除招标文件？')) return; try { await removeBidDocument(annId); toast.success('已删除'); onChanged(); } catch (e: any) { toast.error(e?.message || '失败'); } };

  const picker = scope === 'DESIGNATED' && (
    <div>
      <div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold text-[#5a6d8a]">可下载供应商（已选 {selected.length}）</span><input value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)} placeholder="搜索供应商" className="px-2 py-1 border border-[#e5ecf4] rounded text-xs w-40" /></div>
      <div className="max-h-36 overflow-y-auto rounded border border-[#e5ecf4] divide-y divide-[#f1f5f9]">
        {suppliers.map(s => (
          <label key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[#f8fafc] cursor-pointer">
            <input type="checkbox" checked={selected.includes(s.id)} onChange={() => setSelected(prev => prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id])} className="accent-[#064ea2]" />
            <span className="text-[#18243a]">{s.name}</span>
          </label>
        ))}
      </div>
    </div>
  );

  const configRow = (
    <div className="grid grid-cols-3 gap-3 mb-3">
      <Field label="访问范围"><select value={scope} onChange={e => setScope(e.target.value as any)} className={inputCls}><option value="OPEN">公开下载</option><option value="DESIGNATED">指定供应商</option><option value="INVITED">邀请招标</option></select></Field>
      <Field label="付费下载"><select value={requirePayment ? '1' : '0'} onChange={e => setRequirePayment(e.target.value === '1')} className={inputCls}><option value="0">免费</option><option value="1">付费</option></select></Field>
      {requirePayment && <Field label="价格（元）"><input type="number" value={price} onChange={e => setPrice(e.target.value === '' ? '' : Number(e.target.value))} className={inputCls} /></Field>}
    </div>
  );

  return (
    <div className="rounded-xl border border-[#ddd6fe] bg-[#faf9ff] p-4">
      <div className="text-xs font-bold text-[#7c3aed] mb-3">招标文件（AES-256-GCM 加密 · 受控分发 · 首页不公开）</div>
      {!annId ? <p className="text-xs text-[#8a96aa]">保存草稿后可上传招标文件</p> : bidDoc ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-[#e5ecf4] bg-white p-3">
            <div className="flex items-center justify-between">
              <div><strong className="text-[#18243a]">🔒 {bidDoc.title}</strong><span className="ml-2 text-xs text-[#5a6d8a]">{bidDoc.fileName} · {(bidDoc.fileSize / 1024).toFixed(0)} KB · 下载 {bidDoc.downloadCount} 次</span></div>
              <button onClick={removeDoc} className="text-xs text-[#e74c3c] hover:underline">删除</button>
            </div>
          </div>
          {configRow}
          {picker}
          <button onClick={saveConfig} disabled={busy} className="px-4 py-1.5 text-sm text-white bg-[#7c3aed] hover:bg-[#6d28d9] rounded-lg disabled:opacity-50">{busy ? '保存中...' : '保存访问配置'}</button>
          {bidDoc.accesses.length > 0 && (
            <div className="rounded-lg border border-[#e5ecf4] bg-white p-3">
              <div className="text-xs font-bold text-[#7c3aed] mb-2">访问与到账</div>
              <table className="w-full text-sm"><tbody>
                {bidDoc.accesses.map(a => (
                  <tr key={a.supplierId} className="border-b border-[#f1f5f9] last:border-0">
                    <td className="py-1.5 text-[#18243a]">{a.supplierName}{a.paymentRef && <span className="ml-1 text-xs text-[#5a6d8a]">凭证:{a.paymentRef}</span>}</td>
                    <td className="py-1.5 text-right">{bidDoc.requirePayment ? (a.paid ? <span className="text-[#11a874] text-xs">已付款</span> : <button onClick={() => confirmPay(a.supplierId)} className="px-2 py-0.5 text-xs text-white bg-[#11a874] rounded">确认到账</button>) : <span className="text-[#5a6d8a] text-xs">{a.downloadCount} 次下载</span>}</td>
                  </tr>
                ))}
              </tbody></table>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="选择文件"><input type="file" onChange={e => setFile(e.target.files?.[0] || null)} className="text-sm w-full" /></Field>
            <Field label="文件标题"><input value={docTitle} onChange={e => setDocTitle(e.target.value)} className={inputCls} placeholder="留空用文件名" /></Field>
          </div>
          {configRow}
          {picker}
          <button onClick={doUpload} disabled={busy || !file} className="px-4 py-1.5 text-sm text-white bg-[#7c3aed] hover:bg-[#6d28d9] rounded-lg disabled:opacity-50">{busy ? '加密上传中...' : '加密上传'}</button>
        </div>
      )}
    </div>
  );
}

/* ════════════ 投标情况（只读） ════════════ */

function ParticipantsModal({ announcement, onClose }: { announcement: AnnouncementListItem; onClose: () => void }) {
  const [data, setData] = useState<{ project: any; suppliers: Participant[]; stats: { total: number; submitted: number } } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { getParticipants(announcement.id).then(setData).catch(() => setData(null)).finally(() => setLoading(false)); }, [announcement.id]);
  const pct = data && data.stats.total > 0 ? Math.round((data.stats.submitted / data.stats.total) * 100) : 0;
  const badge = (s: Participant) => s.withdrawn ? { label: '已撤回', color: '#e74c3c', bg: '#e74c3c18' } : s.submitted ? { label: '已提交', color: '#11a874', bg: '#11a87418' } : { label: '未提交', color: '#95a5a6', bg: '#95a5a618' };
  return (
    <Modal title="投标情况（参与供应商 + 标书提交）" onClose={onClose} wide>
      {loading ? <p className="text-center text-[#5a6d8a] py-8">加载中...</p> : !data || !data.project ? (
        <div className="text-center py-8"><p className="text-[#5a6d8a]">该招标公示未关联招标项目（无项目编号），暂无投标数据。</p></div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#e5ecf4] p-4">
            <div className="flex items-center justify-between"><strong className="text-[#18243a]">{data.project.name}</strong><span className="text-xs text-[#5a6d8a]">截止 {new Date(data.project.deadline).toLocaleDateString('zh-CN')}</span></div>
            <div className="flex items-center justify-between mt-3 mb-1.5"><span className="text-sm font-semibold text-[#18243a]">提交进度</span><span className="text-sm text-[#5a6d8a]">{data.stats.submitted}/{data.stats.total} 已提交</span></div>
            <div className="h-2 rounded-full bg-[#f1f5f9] overflow-hidden"><div className="h-full rounded-full bg-[#11a874]" style={{ width: pct + '%' }} /></div>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-[#e5ecf4] text-left text-[#5a6d8a]"><th className="px-3 py-2">供应商</th><th className="px-3 py-2">分类</th><th className="px-3 py-2">下载</th><th className="px-3 py-2">标书状态</th><th className="px-3 py-2">提交时间</th><th className="px-3 py-2">报价</th></tr></thead>
            <tbody>
              {data.suppliers.length === 0 ? <tr><td colSpan={6} className="px-3 py-8 text-center text-[#5a6d8a]">暂无投标供应商</td></tr> : data.suppliers.map((s, i) => {
                const b = badge(s);
                return (<tr key={i} className="border-b border-[#f1f5f9]"><td className="px-3 py-2 font-semibold text-[#18243a]">{s.supplierName}</td><td className="px-3 py-2 text-[#5a6d8a]">{s.classification || '—'}</td><td className="px-3 py-2 text-[#5a6d8a]">{s.downloadStatus}</td><td className="px-3 py-2"><span className="px-2 py-1 rounded text-xs font-semibold" style={{ color: b.color, backgroundColor: b.bg }}>{b.label}</span></td><td className="px-3 py-2 text-[#5a6d8a]">{s.submittedAt ? new Date(s.submittedAt).toLocaleString('zh-CN') : '—'}</td><td className="px-3 py-2 text-[#5a6d8a]">{s.bidPrice || '—'}</td></tr>);
              })}
            </tbody>
          </table>
          <p className="text-xs text-[#8a96aa]">提示：开标/评标/归档在「在线开评标系统」；专家抽取在「专家管理中心」。</p>
        </div>
      )}
    </Modal>
  );
}

/* ════════════ 通用 UI ════════════ */
const inputCls = 'w-full px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]';
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs font-semibold text-[#5a6d8a] mb-1.5">{label}</label>{children}</div>;
}
function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className={'modal-content bg-white rounded-xl shadow-xl max-h-[92vh] overflow-y-auto ' + (wide ? 'w-full max-w-3xl' : 'w-full max-w-lg')} onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white flex items-center justify-between px-6 py-4 border-b border-[#e5ecf4] z-10">
          <h3 className="text-lg font-bold text-[#18243a]">{title}</h3>
          <button onClick={onClose} className="text-[#5a6d8a] hover:text-[#18243a] text-xl leading-none">×</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
