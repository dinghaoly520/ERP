'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  getAnnouncement, updateAnnouncement, deleteAnnouncement,
  listAttachments, addAttachment, removeAttachment, uploadFile,
  getBidDocument, uploadBidDocument, updateBidDocumentConfig, confirmBidDocPayment, removeBidDocument,
} from '@/lib/api/announcement';
import type { AnnouncementListItem, AnnouncementType, AnnouncementStatus, AnnouncementAttachment, BidDocumentManage } from '@/lib/api/announcement';
import { getSupplierList } from '@/lib/api/supplier';
import type { Supplier } from '@/lib/types';
import { StatusBadge } from '@/components/workbench';
import { ArrowLeft, Pencil, X, Trash2, Megaphone, Upload, Save } from 'lucide-react';
import { RichTextEditor } from '@/components/rich-text-editor';

/* ── 类型/状态标签色调 ── */
const typeTone: Record<AnnouncementType, 'blue' | 'green' | 'orange' | 'gray'> = {
  BID_NOTICE: 'blue', WIN_NOTICE: 'green', POLICY: 'orange', PLATFORM: 'gray',
};
const typeLabel: Record<AnnouncementType, string> = {
  BID_NOTICE: '招标公示', WIN_NOTICE: '中标公示', POLICY: '政策法规', PLATFORM: '平台通知',
};
const statusTone: Record<AnnouncementStatus, 'green' | 'gray'> = {
  DRAFT: 'gray', PUBLISHED: 'green', ARCHIVED: 'gray',
};
const statusLabel: Record<AnnouncementStatus, string> = {
  DRAFT: '草稿', PUBLISHED: '已发布', ARCHIVED: '已归档',
};

interface MetaField { key: string; label: string; area?: boolean; date?: boolean }
const TYPE_META: Record<AnnouncementType, MetaField[]> = {
  BID_NOTICE: [
    { key: 'projectCode', label: '项目编号' }, { key: 'method', label: '招标方式' }, { key: 'budget', label: '预算金额' },
    { key: 'scope', label: '采购内容/范围', area: true }, { key: 'qualification', label: '投标人资格要求', area: true },
    { key: 'deadline', label: '报名/投标截止', date: true }, { key: 'openTime', label: '开标时间', date: true }, { key: 'contact', label: '联系方式' },
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
const inputCls = 'w-full px-3 py-2 border border-[var(--border)] bg-[var(--background)] rounded-lg text-sm placeholder-[var(--muted-foreground)]/60 focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10';

export default function NoticeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [ann, setAnn] = useState<AnnouncementListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    getAnnouncement(id).then(setAnn).catch(() => setAnn(null)).finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div className="space-y-4 animate-pulse">
      <div className="h-5 w-32 rounded bg-[var(--muted)]" />
      <div className="h-10 w-72 rounded-xl bg-[var(--muted)]" />
      <div className="space-y-4"><div className="h-4 w-48 rounded bg-[var(--muted)]" /><div className="h-24 w-full rounded bg-[var(--muted)]" /></div>
    </div>
  );
  if (!ann) return <div className="py-24 text-center text-sm text-[var(--muted-foreground)]">信息不存在</div>;

  const handleDelete = async () => {
    if (!confirm(`确认删除「${ann.title}」？`)) return;
    try { await deleteAnnouncement(ann.id); toast.success('已删除'); router.push('/notice'); }
    catch (e: any) { toast.error(e?.message || '删除失败'); }
  };

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.push('/notice')} className="flow-back shrink-0">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flow-back-arrow">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          返回信息列表
        </button>
        <span className="text-[var(--muted-foreground)]/30">/</span>
        <span className="text-[13px] text-[var(--muted-foreground)] truncate">{ann.title}</span>
      </div>

      {/* 状态横幅 — 统一样式 */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <StatusBadge tone={typeTone[ann.type]}>
          <Megaphone size={13} className="mr-1 inline" />
          {typeLabel[ann.type]}
        </StatusBadge>
        <StatusBadge tone={statusTone[ann.status]}>{statusLabel[ann.status]}</StatusBadge>
        {ann.isTop && <StatusBadge tone="red">置顶</StatusBadge>}
        {ann.publishDate && (
          <span className="text-xs text-[var(--muted-foreground)] ml-2">
            发布日期：{new Date(ann.publishDate).toLocaleDateString('zh-CN')}
          </span>
        )}
        <span className="text-xs text-[var(--muted-foreground)]">浏览 {ann.viewCount}</span>
        <div className="ml-auto flex items-center gap-2">
          {!editing ? (
            <>
              <button onClick={() => setEditing(true)} className="neu-btn-primary">
                <Pencil size={14} />编辑
              </button>
              <button onClick={handleDelete} className="neu-btn-soft is-danger">
                <Trash2 size={14} />删除
              </button>
            </>
          ) : (
            <button onClick={() => setEditing(false)} className="neu-btn-soft">
              <X size={14} />取消编辑
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <EditView ann={ann} onCancel={() => setEditing(false)} onSaved={(updated) => { setAnn(updated); setEditing(false); }} />
      ) : (
        <ReadOnlyView ann={ann} />
      )}
    </div>
  );
}

/* ════════════ 只读展示 ════════════ */
function ReadOnlyView({ ann }: { ann: AnnouncementListItem }) {
  const meta = (ann.metadata || {}) as Record<string, any>;
  const fields = TYPE_META[ann.type];
  const hasMeta = fields.some(f => meta[f.key]);

  return (
    <div>
      <h1 className="text-xl font-extrabold text-[var(--foreground)] leading-snug mb-5">{ann.title}</h1>

      {hasMeta && (
        <dl className="flex flex-wrap gap-x-6 gap-y-1.5 mb-5 pb-5 border-b border-[rgba(184,199,227,0.4)] text-sm">
          {fields.filter(f => meta[f.key]).map(f => (
            <div key={f.key} className="flex items-baseline gap-1.5">
              <dt className="text-[var(--muted-foreground)] text-xs">{f.label}</dt>
              <dd className="text-[var(--foreground)] font-medium">{meta[f.key]}</dd>
            </div>
          ))}
        </dl>
      )}

      <div
        className="prose prose-sm mx-auto max-w-[75ch] text-[var(--foreground)] leading-relaxed [&_table]:border-collapse [&_table_td]:border [&_table_td]:border-[var(--border)] [&_table_td]:px-3 [&_table_td]:py-2 [&_table_th]:border [&_table_th]:border-[var(--border)] [&_table_th]:px-3 [&_table_th]:py-2 [&_table_th]:bg-[var(--muted)] [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-6 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-4 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
        dangerouslySetInnerHTML={{ __html: ann.content }}
      />
    </div>
  );
}

/* ════════════ 编辑视图 ════════════ */
function EditView({ ann, onCancel, onSaved }: { ann: AnnouncementListItem; onCancel: () => void; onSaved: (updated: AnnouncementListItem) => void }) {
  const [type, setType] = useState<AnnouncementType>(ann.type);
  const [title, setTitle] = useState(ann.title);
  const [content, setContent] = useState(ann.content);
  const [summary, setSummary] = useState(ann.summary || '');
  const [status, setStatus] = useState<AnnouncementStatus>(ann.status);
  const [isTop, setIsTop] = useState(ann.isTop);
  const [publishDate, setPublishDate] = useState(ann.publishDate ? ann.publishDate.slice(0, 10) : new Date().toISOString().slice(0, 10));

  const buildMeta = (t: AnnouncementType) => {
    const out: Record<string, string> = {};
    const m = (ann.metadata || {}) as Record<string, any>;
    for (const f of TYPE_META[t]) out[f.key] = m[f.key] != null ? String(m[f.key]) : '';
    return out;
  };
  const [metadata, setMetadata] = useState<Record<string, string>>(() => buildMeta(ann.type));
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<AnnouncementAttachment[]>([]);
  const [bidDoc, setBidDoc] = useState<BidDocumentManage | null>(null);

  const loadExtras = useCallback(async () => {
    try { setAttachments(await listAttachments(ann.id)); } catch {}
    if (type === 'BID_NOTICE') { try { setBidDoc(await getBidDocument(ann.id)); } catch { setBidDoc(null); } }
  }, [ann.id, type]);
  useEffect(() => { loadExtras(); }, [loadExtras]);

  const onTypeChange = (t: AnnouncementType) => { setType(t); setMetadata(buildMeta(t)); };

  const save = async (targetStatus: AnnouncementStatus): Promise<AnnouncementListItem | null> => {
    if (!title.trim()) { toast.error('请填写标题'); return null; }
    setBusy(true);
    const meta: Record<string, any> = {};
    for (const f of TYPE_META[type]) if (metadata[f.key]?.trim()) meta[f.key] = metadata[f.key].trim();
    const payload: any = { title, content, type, summary, status: targetStatus, isTop, publishDate, metadata: meta };
    if (type === 'BID_NOTICE') payload.relatedProjectCode = meta.projectCode || null;
    try {
      return await updateAnnouncement(ann.id, payload);
    } catch (e: any) { toast.error(e?.message || '保存失败'); return null; }
    finally { setBusy(false); }
  };

  const saveDraft = async () => {
    const saved = await save('DRAFT');
    if (saved) { toast.success('草稿已保存'); onSaved(saved); }
  };
  const publish = async () => {
    if (type === 'BID_NOTICE' && !bidDoc) {
      if (!confirm('该招标公示尚未上传招标文件，确认直接发布？')) return;
    }
    const saved = await save('PUBLISHED');
    if (saved) {
      toast.success(type === 'BID_NOTICE' ? '已发布，开评标项目已同步创建' : '已发布');
      onSaved(saved);
    }
  };

  return (
    <div className="space-y-5">
      {/* 基本信息 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">类型</label>
          <select value={type} onChange={e => onTypeChange(e.target.value as AnnouncementType)} className={inputCls} disabled>
            {(Object.keys(typeLabel) as AnnouncementType[]).map(t => <option key={t} value={t}>{typeLabel[t]}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">当前状态</label>
          <select value={status} onChange={e => setStatus(e.target.value as AnnouncementStatus)} className={inputCls}>
            <option value="DRAFT">草稿</option>
            <option value="PUBLISHED">已发布</option>
            <option value="ARCHIVED">已归档</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">发布日期</label>
          <input type="date" value={publishDate} onChange={e => setPublishDate(e.target.value)} className={inputCls} />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">标题</label>
        <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="信息标题..." />
      </div>

      <label className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
        <input type="checkbox" checked={isTop} onChange={e => setIsTop(e.target.checked)} className="accent-[var(--accent)]" />置顶
      </label>

      {/* 结构化元数据 */}
      <div className="rounded-xl border border-[var(--accent)]/15 bg-[var(--accent-soft)]/30 p-5">
        <div className="text-xs font-bold text-[var(--accent-strong)] mb-4">{typeLabel[type]} — 结构化信息（按字段填写）</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {TYPE_META[type].map(f => (
            <div key={f.key} className={f.area ? 'sm:col-span-2' : ''}>
              <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">{f.label}</label>
              {f.area
                ? <textarea value={metadata[f.key] || ''} onChange={e => setMetadata({ ...metadata, [f.key]: e.target.value })} className={inputCls + ' h-20 resize-none'} />
                : f.date
                  ? <input type="datetime-local" value={metadata[f.key] || ''} onChange={e => setMetadata({ ...metadata, [f.key]: e.target.value })} className={inputCls} />
                  : <input value={metadata[f.key] || ''} onChange={e => setMetadata({ ...metadata, [f.key]: e.target.value })} className={inputCls} />
              }
            </div>
          ))}
        </div>
      </div>

      {/* 正文 */}
      <div>
        <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">正文内容</label>
        <RichTextEditor value={content} onChange={setContent} placeholder="开始输入正文内容..." />
      </div>

      <div>
        <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">摘要</label>
        <input value={summary} onChange={e => setSummary(e.target.value)} className={inputCls} placeholder="简要概述..." />
      </div>

      {/* 附件 */}
      <AttachmentEditSection annId={ann.id} attachments={attachments} onChanged={loadExtras} />

      {/* 招标文件 */}
      {type === 'BID_NOTICE' && <BidDocEditSection annId={ann.id} bidDoc={bidDoc} onChanged={loadExtras} />}

      {/* 操作栏 */}
      <hr className="wb-section-rule" />
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--muted-foreground)]">ID: {ann.id.slice(-8)}</span>
        <div className="flex gap-3">
          <button onClick={onCancel} className="neu-btn-soft">取消</button>
          <button onClick={saveDraft} disabled={busy} className="neu-btn-soft is-info disabled:opacity-50">
            <Save size={14} />{busy ? '保存中...' : '保存草稿'}
          </button>
          <button onClick={publish} disabled={busy} className="neu-btn-primary disabled:opacity-50">
            {busy ? '处理中...' : '发布'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── 附件编辑 ── */
function AttachmentEditSection({ annId, attachments, onChanged }: { annId: string; attachments: AnnouncementAttachment[]; onChanged: () => void }) {
  const [title, setTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setUploading(true);
    try { const asset = await uploadFile(f, 'announcement'); await addAttachment(annId, asset.id, title || f.name); setTitle(''); onChanged(); toast.success('附件已添加'); }
    catch (err: any) { toast.error(err?.message || '上传失败'); }
    setUploading(false); e.target.value = '';
  };
  return (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <div className="text-xs font-bold text-[var(--accent-strong)] mb-3">附件（公开可下载）</div>
      <div className="flex gap-2 mb-3">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="附件标题（可选）" className={inputCls + ' flex-1'} />
        <label className={'neu-btn-primary cursor-pointer whitespace-nowrap ' + (uploading ? 'opacity-50' : '')}>
          <Upload size={14} />{uploading ? '上传中...' : '添加附件'}
          <input type="file" className="hidden" onChange={onUpload} />
        </label>
      </div>
      {attachments.length === 0 ? <p className="text-xs text-[var(--muted-foreground)]">暂无附件</p> : attachments.map(a => (
        <div key={a.id} className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2">
          <div><div className="text-sm font-semibold text-[var(--foreground)]">{a.title}</div><div className="text-xs text-[var(--muted-foreground)]">{a.fileAsset.originalName} · {(a.fileAsset.size / 1024).toFixed(0)} KB</div></div>
          <button onClick={async () => { if (confirm('删除该附件？')) { await removeAttachment(a.id); onChanged(); } }} className="neu-btn-xs is-danger">删除</button>
        </div>
      ))}
    </div>
  );
}

/* ── 招标文件编辑 ── */
function BidDocEditSection({ annId, bidDoc, onChanged }: { annId: string; bidDoc: BidDocumentManage | null; onChanged: () => void }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [docTitle, setDocTitle] = useState('');
  const [scope, setScope] = useState<'OPEN' | 'INVITED'>(bidDoc?.accessScope || 'OPEN');
  const [requirePayment, setRequirePayment] = useState(bidDoc?.requirePayment ?? false);
  const [price, setPrice] = useState<number | ''>(bidDoc?.price ?? '');
  const [selected, setSelected] = useState<string[]>(bidDoc?.allowedSupplierIds || []);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (scope === 'INVITED') getSupplierList({ status: 'APPROVED', search: supplierSearch || undefined, pageSize: 50 }).then(r => setSuppliers(r.items)).catch(() => {});
  }, [scope, supplierSearch]);

  const doUpload = async () => {
    if (!file) { toast.error('请选择招标文件'); return; }
    setBusy(true);
    try { await uploadBidDocument(annId, file, { title: docTitle || file.name, accessScope: scope, requirePayment, price: requirePayment ? (price || 0) : undefined, allowedSupplierIds: scope === 'INVITED' ? selected : undefined }); toast.success('招标文件已加密上传'); setFile(null); setDocTitle(''); onChanged(); }
    catch (e: any) { toast.error(e?.message || '上传失败'); }
    setBusy(false);
  };
  const saveConfig = async () => {
    if (!bidDoc) return;
    setBusy(true);
    try { await updateBidDocumentConfig(annId, { accessScope: scope, requirePayment, price: requirePayment ? (price || 0) : undefined, allowedSupplierIds: scope === 'INVITED' ? selected : undefined }); toast.success('配置已保存'); onChanged(); }
    catch (e: any) { toast.error(e?.message || '保存失败'); }
    setBusy(false);
  };
  const confirmPay = async (supplierId: string) => { try { await confirmBidDocPayment(annId, supplierId); toast.success('已确认到账'); onChanged(); } catch (e: any) { toast.error(e?.message || '失败'); } };
  const removeDoc = async () => { if (!bidDoc || !confirm('删除招标文件？')) return; try { await removeBidDocument(annId); toast.success('已删除'); onChanged(); } catch (e: any) { toast.error(e?.message || '失败'); } };

  const configRow = (
    <div className={`grid gap-3 mb-3 ${requirePayment ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
      <div><label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1">访问范围</label><select value={scope} onChange={e => setScope(e.target.value as any)} className={inputCls}><option value="OPEN">公开下载</option><option value="INVITED">邀请招标</option></select></div>
      <div><label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1">付费下载</label><select value={requirePayment ? '1' : '0'} onChange={e => setRequirePayment(e.target.value === '1')} className={inputCls}><option value="0">免费</option><option value="1">付费</option></select></div>
      {requirePayment && <div><label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1">价格（元）</label><input type="number" value={price} onChange={e => setPrice(e.target.value === '' ? '' : Number(e.target.value))} className={inputCls} /></div>}
    </div>
  );

  const picker = scope === 'INVITED' && (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold text-[var(--muted-foreground)]">可下载供应商（已选 {selected.length}）</span><input value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)} placeholder="搜索供应商" className="px-2 py-1 border border-[var(--border)] rounded text-xs w-40 bg-[var(--background)]" /></div>
      <div className="max-h-36 overflow-y-auto rounded border border-[var(--border)] divide-y divide-[var(--border)]">
        {suppliers.map(s => (
          <label key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--muted)] cursor-pointer">
            <input type="checkbox" checked={selected.includes(s.id)} onChange={() => setSelected(prev => prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id])} className="accent-[var(--accent)]" />
            <span className="text-[var(--foreground)]">{s.name}</span>
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <div className="rounded-xl border border-[var(--accent)]/15 bg-[var(--accent-soft)]/30 p-5">
      <div className="text-xs font-bold text-[var(--accent-strong)] mb-4">招标文件（AES-256-GCM 加密 · 受控分发）</div>
      {bidDoc ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-3">
            <div>
              <p className="text-sm font-bold text-[var(--foreground)]">🔒 {bidDoc.title}</p>
              <p className="text-xs text-[var(--muted-foreground)]">{bidDoc.fileName} · {(bidDoc.fileSize / 1024).toFixed(0)} KB · 下载 {bidDoc.downloadCount} 次</p>
            </div>
            <button onClick={removeDoc} className="neu-btn-xs is-danger">删除文件</button>
          </div>
          {configRow}
          {picker}
          <button onClick={saveConfig} disabled={busy} className="neu-btn-primary disabled:opacity-50">{busy ? '保存中...' : '保存访问配置'}</button>
          {bidDoc.accesses.length > 0 && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
              <div className="text-xs font-bold text-[var(--accent-strong)] mb-2">访问与到账</div>
              {bidDoc.accesses.map(a => (
                <div key={a.supplierId} className="flex items-center justify-between py-1.5 border-b border-[var(--border)] last:border-0 text-sm">
                  <span className="text-[var(--foreground)]">{a.supplierName}{a.paymentRef && <span className="ml-1 text-xs text-[var(--muted-foreground)]">凭证:{a.paymentRef}</span>}</span>
                  {bidDoc.requirePayment
                    ? (a.paid ? <StatusBadge tone="green">已付款</StatusBadge> : <button onClick={() => confirmPay(a.supplierId)} className="neu-btn-xs is-success">确认到账</button>)
                    : <span className="text-xs text-[var(--muted-foreground)]">{a.downloadCount} 次下载</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1">选择文件</label><input type="file" onChange={e => setFile(e.target.files?.[0] || null)} className={`${inputCls} file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--accent)] file:px-3 file:py-1 file:text-xs file:font-bold file:text-white hover:file:bg-[var(--accent-strong)]`} /></div>
            <div><label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1">文件标题</label><input value={docTitle} onChange={e => setDocTitle(e.target.value)} className={inputCls} placeholder="留空用文件名" /></div>
          </div>
          {configRow}
          {picker}
          <button onClick={doUpload} disabled={busy || !file} className="neu-btn-primary disabled:opacity-50">{busy ? '加密上传中...' : '加密上传'}</button>
        </div>
      )}
    </div>
  );
}
