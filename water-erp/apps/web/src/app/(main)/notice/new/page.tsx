'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  createAnnouncement,
  listAttachments, addAttachment, removeAttachment, uploadFile,
} from '@/lib/api/announcement';
import type { AnnouncementType, AnnouncementStatus, AnnouncementAttachment } from '@/lib/api/announcement';
import { Upload, PlusCircle, Save, Send } from 'lucide-react';
import { RichTextEditor } from '@/components/rich-text-editor';

type NoticeType = 'POLICY' | 'PLATFORM';

const typeLabel: Record<NoticeType, string> = {
  POLICY: '政策法规', PLATFORM: '平台通知',
};

interface MetaField { key: string; label: string; area?: boolean; date?: boolean }
const TYPE_META: Record<NoticeType, MetaField[]> = {
  POLICY: [
    { key: 'docNo', label: '文号' }, { key: 'issuer', label: '发布机关' }, { key: 'effectiveDate', label: '生效日期' },
    { key: 'scope', label: '适用范围', area: true },
  ],
  PLATFORM: [
    { key: 'impactScope', label: '影响范围' }, { key: 'changes', label: '功能变化', area: true }, { key: 'schedule', label: '时间安排' },
    { key: 'guide', label: '操作指引', area: true }, { key: 'support', label: '支持渠道' },
  ],
};

const Step = ({ n }: { n: number }) => (
  <span className="flex h-[18px] w-[18px] items-center justify-center rounded-md text-[10px] font-extrabold bg-[var(--accent)] text-white">{n}</span>
);

export default function NewNoticePage() {
  const router = useRouter();
  const [annId, setAnnId] = useState<string | null>(null);
  const [type, setType] = useState<NoticeType>('POLICY');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [summary, setSummary] = useState('');
  const [isTop, setIsTop] = useState(false);
  const [publishDate, setPublishDate] = useState(new Date().toISOString().slice(0, 10));
  const [metadata, setMetadata] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const [attachments, setAttachments] = useState<AnnouncementAttachment[]>([]);

  const onTypeChange = (t: NoticeType) => { setType(t); setMetadata({}); };

  const loadExtras = useCallback(async () => {
    if (!annId) return;
    try { setAttachments(await listAttachments(annId)); } catch {}
  }, [annId]);
  useEffect(() => { loadExtras(); }, [loadExtras]);

  const saveNew = async (targetStatus: AnnouncementStatus): Promise<string | null> => {
    if (!title.trim()) { toast.error('请填写标题'); return null; }
    setBusy(true);
    const meta: Record<string, any> = {};
    for (const f of TYPE_META[type]) if (metadata[f.key]?.trim()) meta[f.key] = metadata[f.key].trim();
    const payload: any = { title, content, type, summary, status: targetStatus, isTop, publishDate, metadata: meta };
    try {
      const saved = await createAnnouncement(payload);
      setAnnId(saved.id);
      return saved.id;
    } catch (e: any) { toast.error(e?.message || '保存失败'); return null; }
    finally { setBusy(false); }
  };

  const saveDraft = async () => { const id = await saveNew('DRAFT'); if (id) { toast.success('草稿已保存，可上传附件'); loadExtras(); } };
  const publish = async () => {
    const id = await saveNew('PUBLISHED');
    if (id) { toast.success('已发布'); router.push(`/notice/${id}`); }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* ══════ page-hero — 标题卡片 ══════ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon">
              <PlusCircle size={17} />
            </div>
            <div>
              <div className="page-hero__title">新建信息</div>
              <div className="page-hero__sub">{typeLabel[type]} — 填写基本信息后保存草稿，配齐附件后发布</div>
            </div>
          </div>
          <div className="page-hero__right">
            <button onClick={() => router.push('/notice')} className="neu-btn-soft">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              返回信息列表
            </button>
          </div>
        </div>
      </div>

      {/* 提示条 */}
      {!annId && (
        <div className="rounded-lg px-4 py-2.5 text-xs font-medium text-[var(--accent-strong)]"
          style={{ background: 'color-mix(in oklch, var(--accent-soft), transparent 50%)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.4)' }}>
          先填写基本信息并「保存草稿」后，才能上传附件；全部配齐后再「发布」。
        </div>
      )}

      {/* ══════ 表单卡片 — neu-table-card ══════ */}
      <div className="neu-table-card p-5 space-y-6">
        {/* ① 信息类型 */}
        <fieldset>
          <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
            <Step n={1} />信息类型
          </legend>
          <div className="neu-tab-bar">
            {(Object.keys(typeLabel) as NoticeType[]).map(t => (
              <button
                key={t}
                onClick={() => onTypeChange(t)}
                className={`neu-tab ${type === t ? 'is-active' : ''}`}
                disabled={!!annId}
              >
                {typeLabel[t]}
              </button>
            ))}
          </div>
        </fieldset>

        <hr className="wb-section-rule" />

        {/* ② 基本信息 */}
        <fieldset>
          <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
            <Step n={2} />基本信息
          </legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="space-y-1">
              <span className="text-xs font-semibold text-[var(--muted-foreground)]">当前状态</span>
              <input value="草稿" disabled className="neu-input text-[var(--muted-foreground)]" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold text-[var(--muted-foreground)]">发布日期</span>
              <input type="date" value={publishDate} onChange={e => setPublishDate(e.target.value)} className="neu-input" />
            </label>
          </div>
          <label className="space-y-1 mt-4 block">
            <span className="text-xs font-semibold text-[var(--muted-foreground)]">标题</span>
            <input value={title} onChange={e => setTitle(e.target.value)} className="neu-input" placeholder="信息标题..." />
          </label>
          <label className="flex items-center gap-2 mt-3 text-sm text-[var(--muted-foreground)] cursor-pointer">
            <input type="checkbox" checked={isTop} onChange={e => setIsTop(e.target.checked)} className="neu-checkbox" />置顶
          </label>
        </fieldset>

        <hr className="wb-section-rule" />

        {/* ③ 结构化元数据 */}
        <fieldset>
          <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
            <Step n={3} />{typeLabel[type]} — 结构化信息（按字段填写，不混入正文）
          </legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {TYPE_META[type].map(f => {
              const val = metadata[f.key] || '';
              return (
                <div key={f.key} className={f.area ? 'sm:col-span-2' : ''}>
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-[var(--muted-foreground)]">{f.label}</span>
                    {f.area
                      ? <textarea value={val} onChange={e => setMetadata({ ...metadata, [f.key]: e.target.value })} className="neu-input h-20 resize-y" />
                      : f.date
                        ? <input type="datetime-local" value={val} onChange={e => setMetadata({ ...metadata, [f.key]: e.target.value })} className="neu-input" />
                        : <input value={val} onChange={e => setMetadata({ ...metadata, [f.key]: e.target.value })} className="neu-input" />
                    }
                  </label>
                </div>
              );
            })}
          </div>
        </fieldset>

        <hr className="wb-section-rule" />

        {/* ④ 正文 */}
        <fieldset>
          <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
            <Step n={4} />正文内容
          </legend>
          <RichTextEditor value={content} onChange={setContent} placeholder="开始输入正文内容..." />
          <label className="space-y-1 mt-4 block">
            <span className="text-xs font-semibold text-[var(--muted-foreground)]">摘要（可选）</span>
            <input value={summary} onChange={e => setSummary(e.target.value)} className="neu-input" placeholder="简要概述..." />
          </label>
        </fieldset>

        {/* ⑤ 附件 — 保存草稿后显示 */}
        {annId ? (
          <>
            <hr className="wb-section-rule" />
            <fieldset>
              <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
                <Step n={5} />附件（公开可下载）
              </legend>
              <AttachmentUploader annId={annId} attachments={attachments} onChanged={loadExtras} />
            </fieldset>
          </>
        ) : (
          <>
            <hr className="wb-section-rule" />
            <p className="text-xs text-[var(--muted-foreground)] py-2">保存草稿后可上传附件</p>
          </>
        )}

        {/* 操作栏 */}
        <div className="flex items-center justify-between gap-3 pt-4 border-t border-[color-mix(in_oklch,var(--muted-foreground)_16%,transparent)]">
          <span className="text-xs text-[var(--muted-foreground)]">{annId ? 'ID: ' + annId.slice(-8) : '未保存'}</span>
          <div className="flex gap-3">
            <button onClick={() => router.push('/notice')} className="neu-btn-soft">取消</button>
            <button onClick={saveDraft} disabled={busy} className="neu-btn-soft is-info disabled:opacity-50">
              <Save size={14} />{busy ? '保存中...' : '保存草稿'}
            </button>
            <button onClick={publish} disabled={busy} className="neu-btn-primary disabled:opacity-50">
              <Send size={14} />{busy ? '处理中...' : '发布'}
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
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="附件标题（可选）" className="neu-input flex-1" />
        <label className={'neu-btn-primary cursor-pointer whitespace-nowrap ' + (uploading ? 'opacity-50' : '')}>
          <Upload size={14} />{uploading ? '上传中...' : '添加附件'}
          <input type="file" className="hidden" onChange={onUpload} />
        </label>
      </div>
      {attachments.length === 0 ? <p className="text-xs text-[var(--muted-foreground)]">暂无附件</p> : attachments.map(a => (
        <div key={a.id} className="neu-attachment-item">
          <div><div className="text-sm font-semibold text-[var(--foreground)]">{a.title}</div><div className="text-xs text-[var(--muted-foreground)]">{a.fileAsset.originalName} · {(a.fileAsset.size / 1024).toFixed(0)} KB</div></div>
          <button onClick={async () => { if (confirm('删除该附件？')) { await removeAttachment(a.id); onChanged(); } }} className="neu-btn-xs is-danger">删除</button>
        </div>
      ))}
    </div>
  );
}
