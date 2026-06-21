'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  createAnnouncement,
  listAttachments, addAttachment, removeAttachment, uploadFile,
  getBidDocument, uploadBidDocument, updateBidDocumentConfig, confirmBidDocPayment, removeBidDocument,
} from '@/lib/api/announcement';
import type { AnnouncementType, AnnouncementStatus, AnnouncementAttachment, BidDocumentManage } from '@/lib/api/announcement';
import { getSupplierList } from '@/lib/api/supplier';
import type { Supplier } from '@/lib/types';
import { ArrowLeft, Upload, PlusCircle } from 'lucide-react';
import { RichTextEditor } from '@/components/rich-text-editor';

const typeMap: Record<AnnouncementType, { label: string }> = {
  BID_NOTICE: { label: '招标公示' },
  WIN_NOTICE: { label: '中标公示' },
  POLICY: { label: '政策法规' },
  PLATFORM: { label: '平台通知' },
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

export default function NewNoticePage() {
  const router = useRouter();
  const [annId, setAnnId] = useState<string | null>(null);
  const [type, setType] = useState<AnnouncementType>('BID_NOTICE');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [summary, setSummary] = useState('');
  const [isTop, setIsTop] = useState(false);
  const [publishDate, setPublishDate] = useState(new Date().toISOString().slice(0, 10));
  const [metadata, setMetadata] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const [attachments, setAttachments] = useState<AnnouncementAttachment[]>([]);
  const [bidDoc, setBidDoc] = useState<BidDocumentManage | null>(null);

  const onTypeChange = (t: AnnouncementType) => { setType(t); setMetadata({}); };

  const loadExtras = useCallback(async () => {
    if (!annId) return;
    try { setAttachments(await listAttachments(annId)); } catch {}
    if (type === 'BID_NOTICE') { try { setBidDoc(await getBidDocument(annId)); } catch { setBidDoc(null); } }
  }, [annId, type]);

  useEffect(() => { loadExtras(); }, [loadExtras]);

  const saveNew = async (targetStatus: AnnouncementStatus): Promise<string | null> => {
    if (!title.trim()) { toast.error('请填写标题'); return null; }
    setBusy(true);
    const meta: Record<string, any> = {};
    for (const f of TYPE_META[type]) if (metadata[f.key]?.trim()) meta[f.key] = metadata[f.key].trim();
    const payload: any = { title, content, type, summary, status: targetStatus, isTop, publishDate, metadata: meta };
    if (type === 'BID_NOTICE') payload.relatedProjectCode = meta.projectCode || null;
    try {
      const saved = await createAnnouncement(payload);
      setAnnId(saved.id);
      return saved.id;
    } catch (e: any) { toast.error(e?.message || '保存失败'); return null; }
    finally { setBusy(false); }
  };

  const saveDraft = async () => { const id = await saveNew('DRAFT'); if (id) { toast.success('草稿已保存，可上传附件'); loadExtras(); } };
  const publish = async () => {
    if (type === 'BID_NOTICE' && !bidDoc) { if (!confirm('该招标公示尚未上传招标文件，确认直接发布？')) return; }
    const id = await saveNew('PUBLISHED');
    if (id) {
      toast.success(type === 'BID_NOTICE' ? '已发布，开评标项目已同步创建' : '已发布');
      router.push(`/notice/${id}`);
    }
  };

  return (
    <div>
      <button onClick={() => router.push('/notice')} className="inline-flex items-center gap-1.5 text-[13px] text-[#64748b] hover:text-[#0756a5] mb-4 transition">
        <ArrowLeft size={14} />返回信息列表
      </button>

      <div className="glass-card glass-card-lighter rounded-2xl p-6 space-y-5">
        <h1 className="text-lg font-extrabold text-[#18243a] flex items-center gap-2">
          <PlusCircle size={18} className="text-[#064ea2]" />新建信息
        </h1>

        {/* 提示条 */}
        {!annId && <div className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-4 py-2 text-xs text-[#064ea2]">先填写基本信息并「保存草稿」后，才能上传附件与招标文件；全部配齐后再「发布」。</div>}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-[#5a6d8a] mb-1.5">类型</label>
            <select value={type} onChange={e => onTypeChange(e.target.value as AnnouncementType)} className={inputCls} disabled={!!annId}>
              {(Object.keys(typeMap) as AnnouncementType[]).map(t => <option key={t} value={t}>{typeMap[t].label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#5a6d8a] mb-1.5">当前状态</label>
            <input value="草稿" disabled className={inputCls + ' text-[#8a9aaa]'} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#5a6d8a] mb-1.5">发布日期</label>
            <input type="date" value={publishDate} onChange={e => setPublishDate(e.target.value)} className={inputCls} />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#5a6d8a] mb-1.5">标题</label>
          <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="信息标题..." />
        </div>

        <label className="flex items-center gap-2 text-sm text-[#5a6d8a]">
          <input type="checkbox" checked={isTop} onChange={e => setIsTop(e.target.checked)} className="accent-[#064ea2]" />置顶
        </label>

        {/* 结构化元数据 */}
        <div className="rounded-xl border border-[#ddd6fe] bg-[#faf9ff] p-5">
          <div className="text-xs font-bold text-[#7c3aed] mb-4">{typeMap[type].label} — 结构化信息（按字段填写，不混入正文）</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {TYPE_META[type].map(f => {
              const val = metadata[f.key] || '';
              return (
                <div key={f.key} className={f.area ? 'sm:col-span-2' : ''}>
                  <label className="block text-xs font-semibold text-[#5a6d8a] mb-1.5">{f.label}</label>
                  {f.area
                    ? <textarea value={val} onChange={e => setMetadata({ ...metadata, [f.key]: e.target.value })} className={inputCls + ' h-20 resize-none'} />
                    : f.date
                      ? <input type="datetime-local" value={val} onChange={e => setMetadata({ ...metadata, [f.key]: e.target.value })} className={inputCls} />
                      : <input value={val} onChange={e => setMetadata({ ...metadata, [f.key]: e.target.value })} className={inputCls} />
                  }
                </div>
              );
            })}
          </div>
        </div>

        {/* 正文 */}
        <div>
          <label className="block text-xs font-semibold text-[#5a6d8a] mb-1.5">正文内容</label>
          <RichTextEditor value={content} onChange={setContent} placeholder="开始输入正文内容..." />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#5a6d8a] mb-1.5">摘要（可选）</label>
          <input value={summary} onChange={e => setSummary(e.target.value)} className={inputCls} placeholder="简要概述..." />
        </div>

        {/* 附件 */}
        {annId ? (
          <div className="rounded-xl border border-[#e5ecf4] p-4">
            <div className="text-xs font-bold text-[#064ea2] mb-3">附件（公开可下载）</div>
            <AttachmentUploader annId={annId} attachments={attachments} onChanged={loadExtras} />
          </div>
        ) : (
          <p className="text-xs text-[#8a96aa]">保存草稿后可上传附件与招标文件</p>
        )}

        {/* 招标文件 */}
        {annId && type === 'BID_NOTICE' && (
          <div className="rounded-xl border border-[#ddd6fe] bg-[#faf9ff] p-5">
            <div className="text-xs font-bold text-[#7c3aed] mb-4">招标文件（AES-256-GCM 加密 · 受控分发）</div>
            <BidDocUploader annId={annId} bidDoc={bidDoc} onChanged={loadExtras} />
          </div>
        )}

        {/* 操作栏 */}
        <div className="flex items-center justify-between pt-4 border-t border-[#eef3f8]">
          <span className="text-xs text-[#8a96aa]">{annId ? 'ID: ' + annId.slice(-8) : '未保存'}</span>
          <div className="flex gap-3">
            <button onClick={() => router.push('/notice')} className="rounded-xl border border-[#dce3eb] px-4 py-2 text-sm font-bold text-[#5a6d8a] hover:bg-[#f8fafc] transition">取消</button>
            <button onClick={saveDraft} disabled={busy} className="rounded-xl border border-[#bcd0e8] px-4 py-2 text-sm font-bold text-[#064ea2] hover:bg-[#f0f6ff] disabled:opacity-50 transition">
              {busy ? '保存中...' : '保存草稿'}
            </button>
            <button onClick={publish} disabled={busy} className="rounded-xl bg-[#11a874] px-5 py-2 text-sm font-bold text-white hover:bg-[#0e8c5f] disabled:opacity-50 transition">
              {busy ? '处理中...' : '发布'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 附件上传器 ── */
function AttachmentUploader({ annId, attachments, onChanged }: { annId: string; attachments: AnnouncementAttachment[]; onChanged: () => void }) {
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
    <div className="space-y-3">
      <div className="flex gap-2">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="附件标题（可选）" className={inputCls + ' flex-1'} />
        <label className={'inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-[#064ea2] hover:bg-[#054280] rounded-xl cursor-pointer whitespace-nowrap ' + (uploading ? 'opacity-50' : '')}>
          <Upload size={14} />{uploading ? '上传中...' : '添加附件'}
          <input type="file" className="hidden" onChange={onUpload} />
        </label>
      </div>
      {attachments.length === 0 ? <p className="text-xs text-[#8a96aa]">暂无附件</p> : attachments.map(a => (
        <div key={a.id} className="flex items-center justify-between rounded-lg border border-[#e5ecf4] px-3 py-2">
          <div><div className="text-sm font-semibold text-[#18243a]">{a.title}</div><div className="text-xs text-[#5a6d8a]">{a.fileAsset.originalName} · {(a.fileAsset.size / 1024).toFixed(0)} KB</div></div>
          <button onClick={async () => { if (confirm('删除该附件？')) { await removeAttachment(a.id); onChanged(); } }} className="text-xs text-[#e74c3c] hover:underline">删除</button>
        </div>
      ))}
    </div>
  );
}

/* ── 招标文件上传器 ── */
function BidDocUploader({ annId, bidDoc, onChanged }: { annId: string; bidDoc: BidDocumentManage | null; onChanged: () => void }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [docTitle, setDocTitle] = useState('');
  const [scope, setScope] = useState<'OPEN' | 'DESIGNATED' | 'INVITED'>(bidDoc?.accessScope || 'OPEN');
  const [requirePayment, setRequirePayment] = useState(bidDoc?.requirePayment ?? false);
  const [price, setPrice] = useState<number | ''>(bidDoc?.price ?? '');
  const [selected, setSelected] = useState<string[]>(bidDoc?.allowedSupplierIds || []);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (scope === 'DESIGNATED') getSupplierList({ status: 'APPROVED', search: supplierSearch || undefined, pageSize: 50 }).then(r => setSuppliers(r.items)).catch(() => {});
  }, [scope, supplierSearch]);

  const doUpload = async () => {
    if (!file) { toast.error('请选择招标文件'); return; }
    setBusy(true);
    try { await uploadBidDocument(annId, file, { title: docTitle || file.name, accessScope: scope, requirePayment, price: requirePayment ? (price || 0) : undefined, allowedSupplierIds: scope === 'DESIGNATED' ? selected : undefined }); toast.success('招标文件已加密上传'); setFile(null); setDocTitle(''); onChanged(); }
    catch (e: any) { toast.error(e?.message || '上传失败'); }
    setBusy(false);
  };
  const saveConfig = async () => {
    if (!bidDoc) return;
    setBusy(true);
    try { await updateBidDocumentConfig(annId, { accessScope: scope, requirePayment, price: requirePayment ? (price || 0) : undefined, allowedSupplierIds: scope === 'DESIGNATED' ? selected : undefined }); toast.success('配置已保存'); onChanged(); }
    catch (e: any) { toast.error(e?.message || '保存失败'); }
    setBusy(false);
  };
  const confirmPay = async (supplierId: string) => { try { await confirmBidDocPayment(annId, supplierId); toast.success('已确认到账'); onChanged(); } catch (e: any) { toast.error(e?.message || '失败'); } };
  const removeDoc = async () => { if (!bidDoc || !confirm('删除招标文件？')) return; try { await removeBidDocument(annId); toast.success('已删除'); onChanged(); } catch (e: any) { toast.error(e?.message || '失败'); } };

  const configRow = (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
      <div><label className="block text-xs font-semibold text-[#5a6d8a] mb-1">访问范围</label><select value={scope} onChange={e => setScope(e.target.value as any)} className={inputCls}><option value="OPEN">公开下载</option><option value="DESIGNATED">指定供应商</option><option value="INVITED">邀请招标</option></select></div>
      <div><label className="block text-xs font-semibold text-[#5a6d8a] mb-1">付费下载</label><select value={requirePayment ? '1' : '0'} onChange={e => setRequirePayment(e.target.value === '1')} className={inputCls}><option value="0">免费</option><option value="1">付费</option></select></div>
      {requirePayment && <div><label className="block text-xs font-semibold text-[#5a6d8a] mb-1">价格（元）</label><input type="number" value={price} onChange={e => setPrice(e.target.value === '' ? '' : Number(e.target.value))} className={inputCls} /></div>}
    </div>
  );

  const picker = scope === 'DESIGNATED' && (
    <div className="mb-3">
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

  if (bidDoc) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-lg bg-white border border-[#e5ecf4] px-4 py-3">
          <div><p className="text-sm font-bold text-[#18243a]">🔒 {bidDoc.title}</p><p className="text-xs text-[#5a6d8a]">{bidDoc.fileName} · {(bidDoc.fileSize / 1024).toFixed(0)} KB · 下载 {bidDoc.downloadCount} 次</p></div>
          <button onClick={removeDoc} className="text-xs font-bold text-[#e74c3c] hover:underline">删除文件</button>
        </div>
        {configRow}
        {picker}
        <button onClick={saveConfig} disabled={busy} className="rounded-xl bg-[#7c3aed] px-4 py-2 text-sm font-bold text-white hover:bg-[#6d28d9] disabled:opacity-50 transition">{busy ? '保存中...' : '保存访问配置'}</button>
        {bidDoc.accesses.length > 0 && (
          <div className="rounded-lg bg-white border border-[#e5ecf4] p-3">
            <div className="text-xs font-bold text-[#7c3aed] mb-2">访问与到账</div>
            {bidDoc.accesses.map(a => (
              <div key={a.supplierId} className="flex items-center justify-between py-1.5 border-b border-[#f1f5f9] last:border-0 text-sm">
                <span className="text-[#18243a]">{a.supplierName}{a.paymentRef && <span className="ml-1 text-xs text-[#5a6d8a]">凭证:{a.paymentRef}</span>}</span>
                {bidDoc.requirePayment
                  ? (a.paid ? <span className="text-[#11a874] text-xs font-bold">已付款</span> : <button onClick={() => confirmPay(a.supplierId)} className="rounded-lg bg-[#11a874] px-2 py-0.5 text-xs font-bold text-white hover:bg-[#0e8c5f]">确认到账</button>)
                  : <span className="text-[#5a6d8a] text-xs">{a.downloadCount} 次下载</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className="block text-xs font-semibold text-[#5a6d8a] mb-1">选择文件</label><input type="file" onChange={e => setFile(e.target.files?.[0] || null)} className="text-sm w-full" /></div>
        <div><label className="block text-xs font-semibold text-[#5a6d8a] mb-1">文件标题</label><input value={docTitle} onChange={e => setDocTitle(e.target.value)} className={inputCls} placeholder="留空用文件名" /></div>
      </div>
      {configRow}
      {picker}
      <button onClick={doUpload} disabled={busy || !file} className="rounded-xl bg-[#7c3aed] px-4 py-2 text-sm font-bold text-white hover:bg-[#6d28d9] disabled:opacity-50 transition">{busy ? '加密上传中...' : '加密上传'}</button>
    </div>
  );
}

const inputCls = 'w-full px-3 py-2 border border-[#e5ecf4] bg-white rounded-lg text-sm placeholder-[#94a3b8] focus:outline-none focus:border-[#064ea2] focus:ring-2 focus:ring-[#064ea2]/10';
