'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Megaphone, X, Save, Send, Upload, Loader2 } from 'lucide-react';
import {
  createAnnouncement,
  updateAnnouncement,
  listAttachments,
  addAttachment,
  removeAttachment,
  uploadFile,
  attachFromObject,
} from '@/lib/api/announcement';
import type {
  AnnouncementAttachment,
  AnnouncementStatus,
} from '@/lib/api/announcement';
import { RichTextEditor } from '@/components/rich-text-editor';
import type {
  ProjectManagementItem,
  ProjectManagementAttachment,
} from '@/lib/types/project-management';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectManagementItem | null;
  onPublished: () => void;
};

const META_FIELDS = [
  { key: 'projectCode', label: '项目编号' },
  { key: 'method', label: '招标方式' },
  { key: 'budget', label: '预算金额' },
  { key: 'scope', label: '采购内容/范围', area: true },
  { key: 'qualification', label: '投标人资格要求', area: true },
  { key: 'deadline', label: '报名/投标截止', date: true },
  { key: 'openTime', label: '开标时间', date: true },
  { key: 'contact', label: '联系方式' },
] as const;

const inputCls =
  'w-full px-3 py-2 border border-[var(--border)] bg-[var(--background)] rounded-lg text-sm placeholder-[var(--muted-foreground)]/60 focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10';

function buildPrefill(project: ProjectManagementItem) {
  const code = project.departmentNumber || project.contractNumber || '';
  const budgetNum = Number(project.budgetAmount || 0);
  const budget = budgetNum > 0 ? `${budgetNum.toLocaleString('zh-CN')} 元` : '';
  const scope = [project.procurementCategory, project.projectOverview]
    .filter(Boolean)
    .join('；');
  const contactParts = [project.requesterName, project.requesterDepartment].filter(Boolean);
  const contact = contactParts.length === 2 ? `${contactParts[0]}（${contactParts[1]}）` : contactParts.join('');
  const metadata: Record<string, string> = {
    projectCode: code,
    method: project.procurementMethod || '',
    budget,
    scope,
    qualification: project.supplierRequirements || '',
    deadline: '',
    openTime: project.bidOpeningTime || '',
    contact,
  };
  const esc = (s: string) => (s || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
  const title = `关于${project.title}的采购公告`;
  const content = [
    `<p><strong>项目名称：</strong>${esc(project.title)}</p>`,
    `<p><strong>采购方式：</strong>${esc(project.procurementMethod)}</p>`,
    `<p><strong>预算金额：</strong>${esc(budget)}</p>`,
    `<p><strong>采购内容/范围：</strong>${esc(scope)}</p>`,
    `<p><strong>投标人资格要求：</strong>${esc(project.supplierRequirements)}</p>`,
    `<p><strong>报名/投标截止：</strong></p>`,
    `<p><strong>开标时间：</strong>${esc(project.bidOpeningTime)}</p>`,
    `<p><strong>联系方式：</strong>${esc(contact)}</p>`,
  ].join('');
  return { metadata, title, content };
}

export function AnnouncementPublishModal({ isOpen, onClose, project, onPublished }: Props) {
  const [annId, setAnnId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [summary, setSummary] = useState('');
  const [publishDate, setPublishDate] = useState(new Date().toISOString().slice(0, 10));
  const [metadata, setMetadata] = useState<Record<string, string>>({});
  const [attachOn, setAttachOn] = useState(false);
  const [tenderOn, setTenderOn] = useState(false);
  const [attachments, setAttachments] = useState<AnnouncementAttachment[]>([]);
  const [busy, setBusy] = useState(false);

  const tenderFiles = useMemo<ProjectManagementAttachment[]>(
    () => project?.stages.find((s) => s.stageKey === 'TENDER_DOCUMENT')?.attachments ?? [],
    [project],
  );

  // 打开/切换项目时预填
  useEffect(() => {
    if (!isOpen || !project) return;
    const pre = buildPrefill(project);
    setTitle(pre.title);
    setContent(pre.content);
    setMetadata(pre.metadata);
    setSummary('');
    setAnnId(null);
    setAttachOn(false);
    setTenderOn(false);
    setAttachments([]);
    setPublishDate(new Date().toISOString().slice(0, 10));
  }, [isOpen, project]);

  // ESC 关闭
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const loadAttachments = async (id: string) => {
    try {
      setAttachments(await listAttachments(id));
    } catch {
      /* 加载失败忽略，附件区保持当前状态 */
    }
  };

  const collectMeta = () => {
    const meta: Record<string, string> = {};
    for (const f of META_FIELDS) {
      const v = metadata[f.key]?.trim();
      if (v) meta[f.key] = v;
    }
    return meta;
  };

  // 引用项目采购文件（去重：已挂过的跳过、失败 continues）
  const ensureTenderAttached = async (id: string) => {
    if (!tenderOn || tenderFiles.length === 0) return;
    const existing = await listAttachments(id);
    const have = new Set(existing.map((a) => a.fileAsset.originalName));
    for (const f of tenderFiles) {
      if (have.has(f.fileName)) continue;
      try {
        await attachFromObject(id, {
          objectKey: f.objectKey,
          fileName: f.fileName,
          mimeType: f.mimeType,
          size: f.fileSize,
          title: f.fileName,
        });
      } catch (e) {
        toast.error(`采购文件引用失败：${f.fileName} ${(e as Error).message}`);
      }
    }
    await loadAttachments(id);
  };

  const saveDraft = async () => {
    if (!title.trim()) {
      toast.error('请填写标题');
      return;
    }
    setBusy(true);
    const meta = collectMeta();
    const payload = {
      title,
      content,
      type: 'BID_NOTICE' as const,
      summary,
      status: 'DRAFT' as AnnouncementStatus,
      publishDate,
      metadata: meta,
      relatedProjectCode: meta.projectCode || null,
    };
    try {
      let id = annId;
      if (id) {
        await updateAnnouncement(id, payload);
      } else {
        const saved = await createAnnouncement(payload);
        id = saved.id;
        setAnnId(id);
      }
      await ensureTenderAttached(id);
      toast.success('草稿已保存');
    } catch (e) {
      toast.error((e as Error).message || '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!title.trim()) {
      toast.error('请填写标题');
      return;
    }
    setBusy(true);
    const meta = collectMeta();
    const payload = {
      title,
      content,
      type: 'BID_NOTICE' as const,
      summary,
      status: 'PUBLISHED' as AnnouncementStatus,
      publishDate,
      metadata: meta,
      relatedProjectCode: meta.projectCode || null,
    };
    try {
      let id = annId;
      if (id) {
        await updateAnnouncement(id, payload);
      } else {
        const saved = await createAnnouncement(payload);
        id = saved.id;
        setAnnId(id);
      }
      await ensureTenderAttached(id);
      toast.success('已发布，开评标项目已同步创建');
      onPublished();
      onClose();
    } catch (e) {
      toast.error((e as Error).message || '发布失败');
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen || !project) return null;

  const tenderAvailable = tenderFiles.length > 0;

  return (
    <div className="fixed inset-0 z-[500] flex flex-col">
      <div
        className="absolute inset-0"
        style={{ background: 'oklch(0.975 0.012 258 / 0.72)', backdropFilter: 'blur(5px)' }}
        onClick={onClose}
      />
      <div
        className="relative z-10 mx-5 my-5 flex flex-1 flex-col overflow-hidden rounded-[28px]"
        style={{
          background: 'linear-gradient(170deg, oklch(1 0 0 / 0.94), oklch(0.988 0.005 258 / 0.62))',
          boxShadow:
            'inset 0 1px 0 oklch(1 0 0 / 0.88), 3px 4px 16px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)',
        }}
      >
        {/* 标题栏 */}
        <div
          className="flex shrink-0 items-center justify-between gap-3 px-6 py-4"
          style={{
            background: 'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.975 0.006 258 / 0.58) 60%)',
            borderBottom: '1px solid oklch(0.6 0.04 258 / 0.14)',
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px]"
              style={{
                background: 'color-mix(in oklch, var(--accent-soft) 45%, transparent)',
                boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.1)',
              }}
            >
              <Megaphone size={17} className="text-[var(--accent)]" />
            </div>
            <div className="min-w-0">
              <div className="text-[0.92rem] font-semibold tracking-[-0.02em] text-[var(--foreground)] truncate">
                公告制作与发布
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                采购公告（招标公示）· 项目数据已自动预填，可直接编辑后发布
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="neu-btn-soft !p-2">
            <X size={16} />
          </button>
        </div>

        {/* 滚动正文 */}
        <div
          className="flex-1 min-h-0 overflow-y-auto px-6 py-5"
          style={{
            background: 'oklch(0.975 0.012 258 / 0.32)',
            boxShadow: 'inset 2px 3px 8px oklch(0.5 0.04 258 / 0.1), inset -1px -1px 3px oklch(1 0 0 / 0.55)',
          }}
        >
          <div className="mx-auto max-w-[860px] space-y-5">
            {!annId && (
              <div className="rounded-lg border border-[var(--accent)]/20 bg-[var(--accent-soft)]/50 px-4 py-2.5 text-xs text-[var(--accent-strong)]">
                先填写基本信息并「保存草稿」后，才能上传附件与引用采购文件；全部配齐后再「发布」。
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">发布日期</label>
                <input type="date" value={publishDate} onChange={(e) => setPublishDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">类型</label>
                <input value="采购公告（招标公示）" disabled className={inputCls + ' text-[var(--muted-foreground)]'} />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">标题</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="公告标题..." />
            </div>

            {/* 结构化元数据 */}
            <div className="rounded-xl border border-[var(--accent)]/15 bg-[var(--accent-soft)]/30 p-5">
              <div className="text-xs font-bold text-[var(--accent-strong)] mb-4">采购公告 — 结构化信息</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {META_FIELDS.map((f) => {
                  const val = metadata[f.key] || '';
                  return (
                    <div key={f.key} className={'area' in f && f.area ? 'sm:col-span-2' : ''}>
                      <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">{f.label}</label>
                      {'area' in f && f.area ? (
                        <textarea value={val} onChange={(e) => setMetadata({ ...metadata, [f.key]: e.target.value })} className={inputCls + ' h-20 resize-none'} />
                      ) : 'date' in f && f.date ? (
                        <input type="datetime-local" value={val} onChange={(e) => setMetadata({ ...metadata, [f.key]: e.target.value })} className={inputCls} />
                      ) : (
                        <input value={val} onChange={(e) => setMetadata({ ...metadata, [f.key]: e.target.value })} className={inputCls} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">正文内容</label>
              <RichTextEditor value={content} onChange={setContent} placeholder="开始输入正文内容..." />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">摘要（可选）</label>
              <input value={summary} onChange={(e) => setSummary(e.target.value)} className={inputCls} placeholder="简要概述..." />
            </div>

            {/* 开关 */}
            <div className="flex flex-wrap items-center gap-6 rounded-xl border border-[var(--border)] px-4 py-3">
              <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
                <input type="checkbox" checked={attachOn} onChange={(e) => setAttachOn(e.target.checked)} className="accent-[var(--accent)]" />
                添加附件
              </label>
              <label
                className={[
                  'flex items-center gap-2 text-sm',
                  tenderAvailable ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)] opacity-60 cursor-not-allowed',
                ].join(' ')}
              >
                <input
                  type="checkbox"
                  checked={tenderOn && tenderAvailable}
                  disabled={!tenderAvailable}
                  onChange={(e) => setTenderOn(e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                添加采购文件（引用本项目已有文件{tenderAvailable ? ` · ${tenderFiles.length} 份` : ''}）
              </label>
              {!tenderAvailable && (
                <span className="text-xs text-[var(--muted-foreground)]">本项目暂无采购文件可引用</span>
              )}
            </div>

            {/* 附件区 */}
            {attachOn && annId && (
              <AttachmentSection annId={annId} attachments={attachments} onChanged={() => loadAttachments(annId)} />
            )}
            {attachOn && !annId && (
              <p className="text-xs text-[var(--muted-foreground)]">保存草稿后可上传附件。</p>
            )}
          </div>
        </div>

        {/* 操作栏 */}
        <div
          className="flex shrink-0 items-center justify-between gap-3 px-6 py-3.5"
          style={{
            background: 'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.975 0.006 258 / 0.58) 60%)',
            borderTop: '1px solid oklch(0.6 0.04 258 / 0.14)',
          }}
        >
          <span className="text-xs text-[var(--muted-foreground)]">
            {annId ? 'ID: ' + annId.slice(-8) : '未保存'}
          </span>
          <div className="flex gap-3">
            <button onClick={onClose} className="neu-btn-soft">取消</button>
            <button onClick={saveDraft} disabled={busy} className="neu-btn-soft is-info disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {busy ? '保存中...' : '保存草稿'}
            </button>
            <button onClick={publish} disabled={busy} className="neu-btn-primary disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {busy ? '处理中...' : '发布'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AttachmentSection({
  annId,
  attachments,
  onChanged,
}: {
  annId: string;
  attachments: AnnouncementAttachment[];
  onChanged: () => void;
}) {
  const [attTitle, setAttTitle] = useState('');
  const [uploading, setUploading] = useState(false);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const asset = await uploadFile(f, 'announcement');
      await addAttachment(annId, asset.id, attTitle || f.name);
      setAttTitle('');
      onChanged();
      toast.success('附件已添加');
    } catch (err) {
      toast.error((err as Error).message || '上传失败');
    }
    setUploading(false);
    e.target.value = '';
  };

  return (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <div className="text-xs font-bold text-[var(--accent-strong)] mb-3">附件（公开可下载）</div>
      <div className="space-y-3">
        <div className="flex gap-2">
          <input
            value={attTitle}
            onChange={(e) => setAttTitle(e.target.value)}
            placeholder="附件标题（可选）"
            className={inputCls + ' flex-1'}
          />
          <label
            className={['neu-btn-primary cursor-pointer whitespace-nowrap', uploading ? 'opacity-50' : ''].join(' ')}
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {uploading ? '上传中...' : '添加附件'}
            <input type="file" className="hidden" onChange={onUpload} />
          </label>
        </div>
        {attachments.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)]">暂无附件</p>
        ) : (
          attachments.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2"
            >
              <div>
                <div className="text-sm font-semibold text-[var(--foreground)]">{a.title}</div>
                <div className="text-xs text-[var(--muted-foreground)]">
                  {a.fileAsset.originalName} · {(a.fileAsset.size / 1024).toFixed(0)} KB
                </div>
              </div>
              <button
                onClick={async () => {
                  if (confirm('删除该附件？')) {
                    await removeAttachment(a.id);
                    onChanged();
                  }
                }}
                className="neu-btn-xs is-danger"
              >
                删除
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
