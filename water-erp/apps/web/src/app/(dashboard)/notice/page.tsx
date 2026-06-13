'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  listAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement,
  listAttachments, addAttachment, removeAttachment, uploadFile,
  getBidDocument, uploadBidDocument, updateBidDocumentConfig, confirmBidDocPayment, removeBidDocument,
} from '@/lib/api/announcement';
import type { AnnouncementListItem, AnnouncementType, AnnouncementStatus, AnnouncementAttachment, BidDocumentManage } from '@/lib/api/announcement';
import { getSupplierList } from '@/lib/api/supplier';
import type { Supplier } from '@/lib/types';
import { toast } from 'sonner';

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
    { key: 'projectCode', label: '项目编号' }, { key: 'method', label: '招标方式' }, { key: 'budget', label: '预算金额' },
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
  const [bidDocAnn, setBidDocAnn] = useState<AnnouncementListItem | null>(null);
  const [attAnn, setAttAnn] = useState<AnnouncementListItem | null>(null);

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
    try { await deleteAnnouncement(a.id); toast.success('已删除'); load(); } catch (e: any) { toast.error(e?.message || '删除失败'); }
  };

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="mb-2 inline-flex rounded-full border border-[#bfdbfe] bg-[#eff6ff] px-3 py-1 text-xs font-semibold text-[#064ea2]">信息发布中心</div>
          <h1 className="text-2xl font-bold text-[#0f2f57]">信息发布中心</h1>
          <p className="text-sm text-[#5a6d8a] mt-1">招标公示 · 中标公示 · 政策法规 · 平台通知 的发布与管理</p>
        </div>
        <button onClick={() => setEditor('new')} className="rounded-xl bg-[#064ea2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#054280] transition">+ 新建信息</button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <button onClick={() => { setFilterType(''); setPage(1); }} className={'rounded-full px-4 py-2 text-sm font-semibold transition ' + (filterType === '' ? 'bg-[#064ea2] text-white shadow-[0_8px_20px_rgba(6,78,162,0.2)]' : 'bg-white text-[#5a6d8a] border border-[#e5ecf4] hover:text-[#064ea2]')}>全部</button>
        {(Object.keys(typeMap) as AnnouncementType[]).map(t => (
          <button key={t} onClick={() => { setFilterType(t); setPage(1); }} className={'rounded-full px-4 py-2 text-sm font-semibold transition ' + (filterType === t ? 'bg-[#064ea2] text-white shadow-[0_8px_20px_rgba(6,78,162,0.2)]' : 'bg-white text-[#5a6d8a] border border-[#e5ecf4] hover:text-[#064ea2]')}>{typeMap[t].label}</button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-[#e5ecf4] p-4 mb-4 flex gap-3 items-center flex-wrap">
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="搜索标题" className="flex-1 min-w-[200px] px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]" />
        <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value as any); setPage(1); }} className="px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm">
          <option value="">全部状态</option>
          <option value="PUBLISHED">已发布</option>
          <option value="DRAFT">草稿</option>
          <option value="ARCHIVED">已归档</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-[#e5ecf4]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#e5ecf4] text-left text-[#5a6d8a]">
              <th className="px-5 py-3">标题</th>
              <th className="px-5 py-3">类型</th>
              <th className="px-5 py-3">状态</th>
              <th className="px-5 py-3">附件/招标文件</th>
              <th className="px-5 py-3">浏览</th>
              <th className="px-5 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-[#5a6d8a]">加载中...</td></tr>
            ) : data.items.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-[#5a6d8a]">暂无信息</td></tr>
            ) : data.items.map(a => {
              const tm = typeMap[a.type] || typeMap.PLATFORM;
              const sm = statusMap[a.status] || statusMap.DRAFT;
              return (
                <tr key={a.id} className="border-b border-[#e5ecf4] hover:bg-[#f8fafc]">
                  <td className="px-5 py-3 font-semibold text-[#18243a]">{a.title}{a.isTop && <span className="ml-1 text-[10px] text-[#e74c3c]">置顶</span>}</td>
                  <td className="px-5 py-3"><span className="px-2 py-1 rounded text-xs font-semibold" style={{ color: tm.color, backgroundColor: tm.bg }}>{tm.label}</span></td>
                  <td className="px-5 py-3"><span className="px-2 py-1 rounded text-xs font-semibold" style={{ color: sm.color, backgroundColor: sm.bg }}>{sm.label}</span></td>
                  <td className="px-5 py-3 text-xs text-[#5a6d8a]">
                    {a.attachments && a.attachments.length > 0 && <span className="mr-2">📎 {a.attachments.length}</span>}
                    {a.bidDocument && <span className="text-[#064ea2] font-semibold">🔒 招标文件{a.bidDocument.requirePayment ? '(付费)' : ''}</span>}
                  </td>
                  <td className="px-5 py-3 text-[#5a6d8a]">{a.viewCount}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-1.5 flex-wrap">
                      <button onClick={() => setEditor(a)} className="px-2 py-1 text-xs text-[#064ea2] hover:bg-[#f0f6ff] rounded">编辑</button>
                      {a.type === 'BID_NOTICE' && <button onClick={() => setBidDocAnn(a)} className="px-2 py-1 text-xs text-[#7c3aed] hover:bg-[#f5f3ff] rounded">招标文件</button>}
                      <button onClick={() => setAttAnn(a)} className="px-2 py-1 text-xs text-[#5a6d8a] hover:bg-[#f8fafc] rounded">附件</button>
                      <button onClick={() => remove(a)} className="px-2 py-1 text-xs text-[#e74c3c] hover:bg-[#fef2f2] rounded">删除</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="flex justify-between items-center px-5 py-3 border-t border-[#e5ecf4]">
            <span className="text-xs text-[#5a6d8a]">共 {data.total} 条，第 {page}/{totalPages} 页</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 text-xs border border-[#e5ecf4] rounded hover:bg-[#f8fafc] disabled:opacity-40">上一页</button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 text-xs border border-[#e5ecf4] rounded hover:bg-[#f8fafc] disabled:opacity-40">下一页</button>
            </div>
          </div>
        )}
      </div>

      {editor !== null && <EditorModal key={editor === 'new' ? 'new' : editor.id} announcement={editor === 'new' ? null : editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); load(); }} />}
      {bidDocAnn && <BidDocModal announcement={bidDocAnn} onClose={() => setBidDocAnn(null)} onChanged={load} />}
      {attAnn && <AttachmentsModal announcement={attAnn} onClose={() => setAttAnn(null)} onChanged={load} />}
    </div>
  );
}

function EditorModal({ announcement, onClose, onSaved }: { announcement: AnnouncementListItem | null; onClose: () => void; onSaved: () => void }) {
  const isNew = !announcement;
  const [type, setType] = useState<AnnouncementType>(announcement?.type || 'BID_NOTICE');
  const [title, setTitle] = useState(announcement?.title || '');
  const [content, setContent] = useState(announcement?.content || '');
  const [summary, setSummary] = useState(announcement?.summary || '');
  const [status, setStatus] = useState<AnnouncementStatus>(announcement?.status || 'PUBLISHED');
  const [isTop, setIsTop] = useState(announcement?.isTop ?? false);
  const [publishDate, setPublishDate] = useState(announcement?.publishDate ? announcement.publishDate.slice(0, 10) : new Date().toISOString().slice(0, 10));
  const buildMeta = (t: AnnouncementType) => {
    const out: Record<string, string> = {};
    const m = (announcement?.metadata || {}) as Record<string, any>;
    for (const f of TYPE_META[t]) out[f.key] = m[f.key] != null ? String(m[f.key]) : '';
    return out;
  };
  const [metadata, setMetadata] = useState<Record<string, string>>(() => buildMeta(announcement?.type || 'BID_NOTICE'));
  const [saving, setSaving] = useState(false);

  const onTypeChange = (t: AnnouncementType) => { setType(t); setMetadata(buildMeta(t)); };

  const save = async () => {
    if (!title.trim() || !content.trim()) { toast.error('请填写标题和正文'); return; }
    setSaving(true);
    const meta: Record<string, any> = {};
    for (const f of TYPE_META[type]) if (metadata[f.key]?.trim()) meta[f.key] = metadata[f.key].trim();
    const payload = { title, content, type, summary, status, isTop, publishDate, metadata: meta };
    try {
      if (isNew) await createAnnouncement(payload);
      else await updateAnnouncement(announcement.id, payload);
      toast.success(isNew ? '创建成功' : '已保存');
      onSaved();
    } catch (e: any) { toast.error(e?.message || '保存失败'); }
    setSaving(false);
  };

  return (
    <Modal title={isNew ? '新建信息' : '编辑信息'} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Field label="类型">
            <select value={type} onChange={e => onTypeChange(e.target.value as AnnouncementType)} className={inputCls}>
              {(Object.keys(typeMap) as AnnouncementType[]).map(t => <option key={t} value={t}>{typeMap[t].label}</option>)}
            </select>
          </Field>
          <Field label="发布状态">
            <select value={status} onChange={e => setStatus(e.target.value as AnnouncementStatus)} className={inputCls}>
              <option value="PUBLISHED">已发布</option>
              <option value="DRAFT">草稿</option>
              <option value="ARCHIVED">已归档</option>
            </select>
          </Field>
          <Field label="发布日期">
            <input type="date" value={publishDate} onChange={e => setPublishDate(e.target.value)} className={inputCls} />
          </Field>
        </div>

        <Field label="标题"><input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="信息标题" /></Field>

        <div className="rounded-xl border border-[#e5ecf4] bg-[#f8fafc] p-4">
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

        <Field label="正文（支持 HTML）"><textarea value={content} onChange={e => setContent(e.target.value)} className={inputCls + ' h-32 resize-none font-mono text-xs'} placeholder="<p>正文内容...</p>" /></Field>
        <Field label="摘要（可选，留空则 AI 自动生成）"><input value={summary} onChange={e => setSummary(e.target.value)} className={inputCls} /></Field>
        <label className="flex items-center gap-2 text-sm text-[#5a6d8a]"><input type="checkbox" checked={isTop} onChange={e => setIsTop(e.target.checked)} className="accent-[#064ea2]" />置顶</label>
      </div>
      <div className="flex justify-end gap-3 mt-5">
        <button onClick={onClose} className="px-4 py-2 text-sm text-[#5a6d8a] hover:bg-[#f8fafc] rounded-lg">取消</button>
        <button onClick={save} disabled={saving} className="px-5 py-2 text-sm text-white bg-[#064ea2] hover:bg-[#054280] rounded-lg disabled:opacity-50">{saving ? '保存中...' : '保存'}</button>
      </div>
    </Modal>
  );
}

function BidDocModal({ announcement, onClose, onChanged }: { announcement: AnnouncementListItem; onClose: () => void; onChanged: () => void }) {
  const [doc, setDoc] = useState<BidDocumentManage | null>(null);
  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [docTitle, setDocTitle] = useState('');
  const [scope, setScope] = useState<'OPEN' | 'DESIGNATED' | 'INVITED'>('OPEN');
  const [requirePayment, setRequirePayment] = useState(false);
  const [price, setPrice] = useState<number | ''>('');
  const [selectedSuppliers, setSelectedSuppliers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await getBidDocument(announcement.id); setDoc(d); if (d) { setScope(d.accessScope); setRequirePayment(d.requirePayment); setPrice(d.price ?? ''); setSelectedSuppliers(d.allowedSupplierIds); } } catch { setDoc(null); }
    setLoading(false);
  }, [announcement.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (scope === 'DESIGNATED') getSupplierList({ status: 'APPROVED', search: supplierSearch || undefined, pageSize: 50 }).then(r => setSuppliers(r.items)).catch(() => {});
  }, [scope, supplierSearch]);

  const doUpload = async () => {
    if (!file) { toast.error('请选择招标文件'); return; }
    setBusy(true);
    try {
      await uploadBidDocument(announcement.id, file, { title: docTitle || file.name, accessScope: scope, requirePayment, price: requirePayment ? (price || 0) : undefined, allowedSupplierIds: scope === 'DESIGNATED' ? selectedSuppliers : undefined });
      toast.success('招标文件已加密上传');
      setFile(null); setDocTitle('');
      load(); onChanged();
    } catch (e: any) { toast.error(e?.message || '上传失败'); }
    setBusy(false);
  };
  const saveConfig = async () => {
    setBusy(true);
    try {
      await updateBidDocumentConfig(announcement.id, { accessScope: scope, requirePayment, price: requirePayment ? (price || 0) : undefined, allowedSupplierIds: scope === 'DESIGNATED' ? selectedSuppliers : undefined });
      toast.success('配置已保存'); load(); onChanged();
    } catch (e: any) { toast.error(e?.message || '保存失败'); }
    setBusy(false);
  };
  const confirmPay = async (supplierId: string) => {
    try { await confirmBidDocPayment(announcement.id, supplierId); toast.success('已确认到账'); load(); } catch (e: any) { toast.error(e?.message || '操作失败'); }
  };
  const removeDoc = async () => {
    if (!doc || !confirm('确认删除该招标文件？已付费记录将一并清除。')) return;
    try { await removeBidDocument(announcement.id); toast.success('已删除'); load(); onChanged(); } catch (e: any) { toast.error(e?.message || '删除失败'); }
  };

  const supplierPicker = (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-[#5a6d8a]">可下载供应商（已选 {selectedSuppliers.length}）</span>
        <input value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)} placeholder="搜索供应商" className="px-2 py-1 border border-[#e5ecf4] rounded text-xs w-40" />
      </div>
      <div className="max-h-40 overflow-y-auto rounded border border-[#e5ecf4] divide-y divide-[#f1f5f9]">
        {suppliers.map(s => (
          <label key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[#f8fafc] cursor-pointer">
            <input type="checkbox" checked={selectedSuppliers.includes(s.id)} onChange={() => setSelectedSuppliers(prev => prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id])} className="accent-[#064ea2]" />
            <span className="text-[#18243a]">{s.name}</span>
            {s.classification?.name && <span className="text-xs text-[#5a6d8a] ml-auto">{s.classification.name}</span>}
          </label>
        ))}
        {suppliers.length === 0 && <div className="px-3 py-3 text-xs text-[#5a6d8a]">无匹配供应商</div>}
      </div>
    </div>
  );

  return (
    <Modal title="招标文件管理（加密 · 受控分发）" onClose={onClose} wide>
      {loading ? <p className="text-center text-[#5a6d8a] py-8">加载中...</p> : doc ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#e5ecf4] p-4">
            <div className="flex items-center justify-between">
              <div>
                <strong className="text-[#18243a]">🔒 {doc.title}</strong>
                <span className="ml-2 text-xs text-[#5a6d8a]">{doc.fileName} · {(doc.fileSize / 1024).toFixed(0)} KB</span>
              </div>
              <span className="text-xs px-2 py-1 rounded-full bg-[#064ea218] text-[#064ea2] font-semibold">{scopeLabel(doc.accessScope)}{doc.requirePayment ? ' · 付费 ¥' + doc.price : ''}</span>
            </div>
            <p className="text-xs text-[#5a6d8a] mt-1">累计下载 {doc.downloadCount} 次 · AES-256-GCM 加密存储，首页不公开</p>
          </div>

          <div className="rounded-xl border border-[#e5ecf4] p-4">
            <div className="text-xs font-bold text-[#064ea2] mb-3">访问配置</div>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <Field label="访问范围">
                <select value={scope} onChange={e => setScope(e.target.value as any)} className={inputCls}>
                  <option value="OPEN">公开下载（全库供应商）</option>
                  <option value="DESIGNATED">指定供应商（白名单）</option>
                  <option value="INVITED">邀请招标（关联项目）</option>
                </select>
              </Field>
              <Field label="付费下载">
                <select value={requirePayment ? '1' : '0'} onChange={e => setRequirePayment(e.target.value === '1')} className={inputCls}>
                  <option value="0">免费</option>
                  <option value="1">付费</option>
                </select>
              </Field>
              {requirePayment && <Field label="价格（元）"><input type="number" value={price} onChange={e => setPrice(e.target.value === '' ? '' : Number(e.target.value))} className={inputCls} /></Field>}
            </div>
            {scope === 'DESIGNATED' && supplierPicker}
            <button onClick={saveConfig} disabled={busy} className="mt-3 px-4 py-1.5 text-sm text-white bg-[#064ea2] hover:bg-[#054280] rounded-lg disabled:opacity-50">{busy ? '保存中...' : '保存配置'}</button>
          </div>

          {doc.accesses.length > 0 && (
            <div className="rounded-xl border border-[#e5ecf4] p-4">
              <div className="text-xs font-bold text-[#064ea2] mb-3">访问与到账记录</div>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[#5a6d8a] border-b border-[#e5ecf4]"><th className="py-2">供应商</th><th className="py-2">付费</th><th className="py-2">下载</th><th className="py-2 text-right">操作</th></tr></thead>
                <tbody>
                  {doc.accesses.map(a => (
                    <tr key={a.supplierId} className="border-b border-[#f1f5f9]">
                      <td className="py-2 text-[#18243a]">{a.supplierName}{a.paymentRef && <span className="ml-2 text-xs text-[#5a6d8a]">凭证:{a.paymentRef}</span>}</td>
                      <td className="py-2">{doc.requirePayment ? (a.paid ? <span className="text-[#11a874] font-semibold">已付款</span> : <span className="text-[#f5a623]">待确认</span>) : <span className="text-[#5a6d8a]">—</span>}</td>
                      <td className="py-2 text-[#5a6d8a]">{a.downloadCount} 次</td>
                      <td className="py-2 text-right">{doc.requirePayment && !a.paid && <button onClick={() => confirmPay(a.supplierId)} className="px-2 py-1 text-xs text-white bg-[#11a874] hover:bg-[#0e8c5f] rounded">确认到账</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end"><button onClick={removeDoc} className="px-4 py-1.5 text-sm text-[#e74c3c] border border-[#fecaca] hover:bg-[#fef2f2] rounded-lg">删除招标文件</button></div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#fcd34d] bg-[#fffbeb] p-3 text-xs text-[#92400e]">该招标公示尚未上传招标文件。上传后 AES-256-GCM 加密存储，首页不公开，供应商按权限在门户下载。</div>
          <Field label="选择文件"><input type="file" onChange={e => setFile(e.target.files?.[0] || null)} className="text-sm" /></Field>
          <Field label="文件标题"><input value={docTitle} onChange={e => setDocTitle(e.target.value)} className={inputCls} placeholder="留空则用文件名" /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="访问范围">
              <select value={scope} onChange={e => setScope(e.target.value as any)} className={inputCls}>
                <option value="OPEN">公开下载</option>
                <option value="DESIGNATED">指定供应商</option>
                <option value="INVITED">邀请招标</option>
              </select>
            </Field>
            <Field label="付费下载">
              <select value={requirePayment ? '1' : '0'} onChange={e => setRequirePayment(e.target.value === '1')} className={inputCls}>
                <option value="0">免费</option>
                <option value="1">付费</option>
              </select>
            </Field>
            {requirePayment && <Field label="价格（元）"><input type="number" value={price} onChange={e => setPrice(e.target.value === '' ? '' : Number(e.target.value))} className={inputCls} /></Field>}
          </div>
          {scope === 'DESIGNATED' && supplierPicker}
          <button onClick={doUpload} disabled={busy || !file} className="px-5 py-2 text-sm text-white bg-[#064ea2] hover:bg-[#054280] rounded-lg disabled:opacity-50">{busy ? '加密上传中...' : '加密上传'}</button>
        </div>
      )}
    </Modal>
  );
}

function AttachmentsModal({ announcement, onClose, onChanged }: { announcement: AnnouncementListItem; onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<AnnouncementAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState('');
  const load = useCallback(async () => { setLoading(true); try { setItems(await listAttachments(announcement.id)); } catch { /* */ } setLoading(false); }, [announcement.id]);
  useEffect(() => { load(); }, [load]);
  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setUploading(true);
    try { const asset = await uploadFile(f, 'announcement'); await addAttachment(announcement.id, asset.id, title || f.name); setTitle(''); load(); onChanged(); toast.success('附件已添加'); } catch (err: any) { toast.error(err?.message || '上传失败'); }
    setUploading(false); e.target.value = '';
  };
  return (
    <Modal title="附件管理（公开可下载）" onClose={onClose}>
      <div className="mb-4 rounded-xl border border-[#e5ecf4] p-3">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="附件标题（可选）" className={inputCls + ' mb-2'} />
        <label className={'inline-flex items-center px-4 py-2 text-sm text-white bg-[#064ea2] hover:bg-[#054280] rounded-lg cursor-pointer ' + (uploading ? 'opacity-50' : '')}>
          {uploading ? '上传中...' : '+ 添加附件'}<input type="file" className="hidden" onChange={onUpload} />
        </label>
      </div>
      {loading ? <p className="text-center text-[#5a6d8a] py-4">加载中...</p> : items.length === 0 ? <p className="text-center text-[#5a6d8a] py-6 text-sm">暂无附件</p> : (
        <div className="space-y-2">
          {items.map(a => (
            <div key={a.id} className="flex items-center justify-between rounded-lg border border-[#e5ecf4] px-3 py-2">
              <div>
                <div className="text-sm font-semibold text-[#18243a]">{a.title}</div>
                <div className="text-xs text-[#5a6d8a]">{a.fileAsset.originalName} · {(a.fileAsset.size / 1024).toFixed(0)} KB</div>
              </div>
              <div className="flex gap-3">
                <a href={'/api/upload/files/' + a.fileAsset.id} target="_blank" rel="noreferrer" className="text-xs text-[#064ea2] hover:underline">预览</a>
                <button onClick={async () => { if (confirm('删除该附件？')) { await removeAttachment(a.id); load(); onChanged(); } }} className="text-xs text-[#e74c3c] hover:underline">删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

const inputCls = 'w-full px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]';
function scopeLabel(s: string) { return s === 'DESIGNATED' ? '指定供应商' : s === 'INVITED' ? '邀请招标' : '公开下载'; }
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs font-semibold text-[#5a6d8a] mb-1.5">{label}</label>{children}</div>;
}
function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className={'bg-white rounded-xl shadow-xl max-h-[90vh] overflow-y-auto ' + (wide ? 'w-full max-w-3xl' : 'w-full max-w-lg')} onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white flex items-center justify-between px-6 py-4 border-b border-[#e5ecf4] z-10">
          <h3 className="text-lg font-bold text-[#18243a]">{title}</h3>
          <button onClick={onClose} className="text-[#5a6d8a] hover:text-[#18243a] text-xl leading-none">×</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
