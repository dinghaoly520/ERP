'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Megaphone, X, Send, Upload, Loader2, ArrowLeft, ArrowRight,
} from 'lucide-react';
import {
  createAnnouncement,
  listAttachments,
  addAttachment,
  removeAttachment,
  uploadFile,
  attachFromObject,
  parseAnnouncementFields,
} from '@/lib/api/announcement';
import type {
  AnnouncementAttachment,
  AnnouncementStatus,
} from '@/lib/api/announcement';
import { getSupplierList } from '@/lib/api/supplier';
import type { Supplier } from '@/lib/types';
import { AnnouncementDialog } from '@/components/tender-write/announcement-dialog';
import { mapProcurementMethodToTenderType } from '@/lib/tender-write/procurement-method-map';
import { buildPrefillFromProject } from '@/lib/tender-write/prefill-from-project';
import {
  getAnnouncementFields,
  createEmptyAnnouncementDraft,
  applyAutoFill,
  getAvailableAnnouncementCategories,
  getAnnouncementLabel,
} from '@/lib/tender-write/announcement-templates';
import { TENDER_DOCUMENT_TYPES } from '@/lib/tender-write/templates';
import type {
  AnnouncementCategory,
  AnnouncementDraft,
} from '@/lib/types/announcement';
import type {
  ReadyTenderDocumentType,
  ReadyTenderDraft,
  TenderDocumentTypeMeta,
} from '@/lib/types/tender-write';
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

const inputCls =
  'w-full px-3 py-2 border border-[var(--border)] bg-[var(--background)] rounded-lg text-sm placeholder-[var(--muted-foreground)]/60 focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10';

export function AnnouncementPublishWizard({ isOpen, onClose, project, onPublished }: Props) {
  // Wizard state
  const [step, setStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(true);

  // Step 1 → Step 2 handoff
  const [category, setCategory] = useState<AnnouncementCategory | null>(null);
  const [draft, setDraft] = useState<AnnouncementDraft | null>(null);
  const [tenderType, setTenderType] = useState<ReadyTenderDocumentType | null>(null);
  const [tenderDraftForDialog, setTenderDraftForDialog] = useState<ReadyTenderDraft>(
    {} as ReadyTenderDraft,
  );
  const [selectedMeta, setSelectedMeta] = useState<TenderDocumentTypeMeta | null>(null);

  // Step 2 config
  const [visibility, setVisibility] = useState<'PUBLIC' | 'RESTRICTED'>('PUBLIC');
  const [restrictedSupplierIds, setRestrictedSupplierIds] = useState<string[]>([]);
  const [publishTiming, setPublishTiming] = useState<'now' | 'scheduled'>('now');
  const [scheduledDate, setScheduledDate] = useState('');
  const [attachOn, setAttachOn] = useState(false);
  const [tenderOn, setTenderOn] = useState(false);
  const [notifyOnPublish, setNotifyOnPublish] = useState(false);
  const [annId, setAnnId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<AnnouncementAttachment[]>([]);
  const [busy, setBusy] = useState(false);

  // Supplier picker
  const [allSuppliers, setAllSuppliers] = useState<Supplier[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');

  const tenderFiles = useMemo<ProjectManagementAttachment[]>(
    () => project?.stages.find((s) => s.stageKey === 'TENDER_DOCUMENT')?.attachments ?? [],
    [project],
  );

  // 打开时：确定 tenderType + 构造预填 draft + 解析 .docx
  /* eslint-disable react-hooks/set-state-in-effect -- 弹窗打开时重置表单值，符合模态惯例 */
  useEffect(() => {
    if (!isOpen || !project) return;
    setLoading(true);
    setStep(1);
    setAnnId(null);
    setAttachOn(false);
    setTenderOn(false);
    setNotifyOnPublish(false);
    setVisibility('PUBLIC');
    setRestrictedSupplierIds([]);
    setPublishTiming('now');
    setScheduledDate('');
    setCategory(null);
    setDraft(null);

    const tt = mapProcurementMethodToTenderType(project.procurementMethod);
    if (!tt) {
      setLoading(false);
      return;
    }
    setTenderType(tt);
    const meta = TENDER_DOCUMENT_TYPES.find((m) => m.type === tt) ?? TENDER_DOCUMENT_TYPES[0];
    setSelectedMeta(meta);

    const preTender = buildPrefillFromProject(project, tt) as ReadyTenderDraft;
    setTenderDraftForDialog(preTender);

    // Async: parse .docx → 合并预填 + 自动选分类
    parseAnnouncementFields(project.id)
      .then((parsed) => {
        if (!parsed?.fields) return;
        const merged = { ...preTender, ...parsed.fields } as ReadyTenderDraft;
        setTenderDraftForDialog(merged);
        const avail = getAvailableAnnouncementCategories(tt);
        const procCat = avail.find((c) => c === 'procurement_document') ?? avail[0];
        if (procCat) {
          const empty = createEmptyAnnouncementDraft(tt, procCat);
          const filled = applyAutoFill(
            empty,
            merged as Record<string, string>,
            getAnnouncementFields(tt, procCat),
          );
          const withParsed = { ...filled, ...parsed.fields } as AnnouncementDraft;
          setCategory(procCat);
          setDraft(withParsed);
        }
      })
      .catch(() => {
        /* .docx 解析可选，失败静默 */
      })
      .finally(() => setLoading(false));
  }, [isOpen, project]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ESC 关闭
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Supplier list for picker
  useEffect(() => {
    if (visibility === 'RESTRICTED' && isOpen) {
      getSupplierList({ status: 'APPROVED', search: supplierSearch || undefined, pageSize: 200 })
        .then((r) => setAllSuppliers(r.items))
        .catch(() => {
          /* ignore */
        });
    }
  }, [visibility, isOpen, supplierSearch]);

  const handleNext = () => {
    if (!draft || !category) {
      toast.error('请先选择公告类型并填写内容');
      return;
    }
    setStep(2);
  };

  // Notification callback from embedded AnnouncementDialog
  const handleDraftChange = useCallback((d: AnnouncementDraft, cat: AnnouncementCategory) => {
    setDraft(d);
    setCategory(cat);
  }, []);

  const loadAttachments = async (id: string) => {
    try {
      setAttachments(await listAttachments(id));
    } catch {
      /* ignore */
    }
  };

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

  const handlePublish = async () => {
    if (!draft || !category || !tenderType) {
      toast.error('请先完成公告制作');
      return;
    }
    if (publishTiming === 'scheduled' && !scheduledDate) {
      toast.error('请选择定时发布时间');
      return;
    }
    if (visibility === 'RESTRICTED' && restrictedSupplierIds.length === 0) {
      toast.error('请至少选择一家可见供应商');
      return;
    }
    const title = `${getAnnouncementLabel(tenderType, category)} — ${project?.title || ''}`;
    const draftRecord = draft as Record<string, string>;
    const content = `<p>${Object.entries(draftRecord)
      .filter(([, v]) => v?.trim())
      .map(([k, v]) => `<strong>${k}:</strong> ${v}`)
      .join('</p><p>')}</p>`;
    setBusy(true);
    const meta: Record<string, unknown> = { ...draft, visibility };
    if (visibility === 'RESTRICTED') meta.restrictedSupplierIds = restrictedSupplierIds;
    if (publishTiming === 'scheduled') meta.scheduledPublishDate = scheduledDate;
    meta.notifyOnPublish = notifyOnPublish;
    const status: AnnouncementStatus = publishTiming === 'scheduled' ? 'DRAFT' : 'PUBLISHED';
    try {
      const saved = await createAnnouncement({
        title,
        content,
        type: 'BID_NOTICE',
        summary: draftRecord.projectOverview?.slice(0, 100) || '',
        status,
        publishDate: publishTiming === 'now' ? new Date().toISOString() : undefined,
        metadata: meta as Record<string, unknown>,
        relatedProjectCode: draftRecord.projectCode || null,
      });
      const id = saved.id;
      setAnnId(id);
      await ensureTenderAttached(id);
      toast.success(publishTiming === 'now' ? '已发布' : '已保存为定时发布');
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
        {/* Header */}
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
                Step {step}/2 · {project.title}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={[
                'text-xs font-semibold',
                step === 1 ? 'text-[var(--accent)]' : 'text-[var(--muted-foreground)]',
              ].join(' ')}
            >
              ● 公告制作
            </span>
            <span className="text-[var(--muted-foreground)]">→</span>
            <span
              className={[
                'text-xs font-semibold',
                step === 2 ? 'text-[var(--accent)]' : 'text-[var(--muted-foreground)]',
              ].join(' ')}
            >
              ○ 发布配置
            </span>
            <button type="button" onClick={onClose} className="neu-btn-soft !p-2">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div
          className="flex-1 min-h-0 overflow-y-auto px-6 py-5"
          style={{
            background: 'oklch(0.975 0.012 258 / 0.32)',
            boxShadow: 'inset 2px 3px 8px oklch(0.5 0.04 258 / 0.1), inset -1px -1px 3px oklch(1 0 0 / 0.55)',
          }}
        >
          {loading ? (
            <div className="flex min-h-[300px] items-center justify-center">
              <Loader2 size={24} className="animate-spin text-[var(--muted-foreground)]" />
              <span className="ml-3 text-sm text-[var(--muted-foreground)]">
                正在加载项目采购数据...
              </span>
            </div>
          ) : !tenderType ? (
            <div className="flex min-h-[300px] items-center justify-center text-sm text-[var(--muted-foreground)]">
              无法识别采购方式对应的招标文件类型，请确认项目采购方式。
            </div>
          ) : step === 1 ? (
            <AnnouncementDialog
              isOpen
              tenderType={tenderType}
              tenderDraft={tenderDraftForDialog}
              selectedMeta={selectedMeta!}
              onClose={onClose}
              embedded
              initialCategory={category}
              initialDraft={draft}
              onDraftChange={handleDraftChange}
            />
          ) : (
            /* Step 2: Publish Config */
            <div className="mx-auto max-w-[720px] space-y-5">
              <h2 className="text-sm font-bold text-[var(--foreground)] flex items-center gap-2">
                <Send size={14} className="text-[var(--accent)]" /> 发布配置
              </h2>

              {/* Visibility */}
              <div className="rounded-xl border border-[var(--border)] p-4 space-y-3">
                <div className="text-xs font-bold text-[var(--accent-strong)]">公告范围</div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="visibility"
                    checked={visibility === 'PUBLIC'}
                    onChange={() => setVisibility('PUBLIC')}
                    className="accent-[var(--accent)]"
                  />
                  全部可见
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="visibility"
                    checked={visibility === 'RESTRICTED'}
                    onChange={() => setVisibility('RESTRICTED')}
                    className="accent-[var(--accent)]"
                  />
                  部分供应商可见
                </label>
                {visibility === 'RESTRICTED' && (
                  <div className="border border-[var(--border)] rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        value={supplierSearch}
                        onChange={(e) => setSupplierSearch(e.target.value)}
                        placeholder="搜索供应商名称"
                        className={inputCls + ' flex-1'}
                      />
                      <span className="text-xs font-semibold text-[var(--accent)] whitespace-nowrap">
                        已选 {restrictedSupplierIds.length}
                      </span>
                    </div>
                    <div className="max-h-40 overflow-y-auto rounded border border-[var(--border)] divide-y divide-[var(--border)]">
                      {allSuppliers.map((s) => (
                        <label
                          key={s.id}
                          className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--muted)] cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={restrictedSupplierIds.includes(s.id)}
                            onChange={() =>
                              setRestrictedSupplierIds((prev) =>
                                prev.includes(s.id)
                                  ? prev.filter((x) => x !== s.id)
                                  : [...prev, s.id],
                              )
                            }
                            className="accent-[var(--accent)]"
                          />
                          <span>{s.name}</span>
                        </label>
                      ))}
                      {allSuppliers.length === 0 && (
                        <p className="px-3 py-2 text-xs text-[var(--muted-foreground)]">
                          无匹配供应商
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Timing */}
              <div className="rounded-xl border border-[var(--border)] p-4 space-y-3">
                <div className="text-xs font-bold text-[var(--accent-strong)]">发布时间</div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="timing"
                    checked={publishTiming === 'now'}
                    onChange={() => setPublishTiming('now')}
                    className="accent-[var(--accent)]"
                  />
                  立即发布
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="timing"
                    checked={publishTiming === 'scheduled'}
                    onChange={() => setPublishTiming('scheduled')}
                    className="accent-[var(--accent)]"
                  />
                  定时发布
                </label>
                {publishTiming === 'scheduled' && (
                  <input
                    type="datetime-local"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className={inputCls}
                  />
                )}
              </div>

              {/* Toggles */}
              <div className="rounded-xl border border-[var(--border)] px-4 py-3 flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={attachOn}
                    onChange={(e) => setAttachOn(e.target.checked)}
                    className="accent-[var(--accent)]"
                  />
                  添加附件
                </label>
                <label
                  className={[
                    'flex items-center gap-2 text-sm',
                    tenderAvailable ? '' : 'opacity-60 cursor-not-allowed',
                  ].join(' ')}
                >
                  <input
                    type="checkbox"
                    checked={tenderOn && tenderAvailable}
                    disabled={!tenderAvailable}
                    onChange={(e) => setTenderOn(e.target.checked)}
                    className="accent-[var(--accent)]"
                  />
                  引用采购文件{tenderAvailable ? ` · ${tenderFiles.length} 份` : ''}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={notifyOnPublish}
                    onChange={(e) => setNotifyOnPublish(e.target.checked)}
                    className="accent-[var(--accent)]"
                  />
                  发布后发送通知
                </label>
              </div>

              {/* Attachment section (only after draft saved) */}
              {attachOn && annId && (
                <AttachmentSection
                  annId={annId}
                  attachments={attachments}
                  onChanged={() => loadAttachments(annId)}
                  inputCls={inputCls}
                />
              )}
              {attachOn && !annId && (
                <p className="text-xs text-[var(--muted-foreground)]">发布后可上传附件。</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex shrink-0 items-center justify-between gap-3 px-6 py-3.5"
          style={{
            background: 'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.975 0.006 258 / 0.58) 60%)',
            borderTop: '1px solid oklch(0.6 0.04 258 / 0.14)',
          }}
        >
          <span className="text-xs text-[var(--muted-foreground)]">
            {annId ? 'ID: ' + annId.slice(-8) : ''}
          </span>
          <div className="flex gap-3">
            <button onClick={onClose} className="neu-btn-soft">
              取消
            </button>
            {step === 1 ? (
              <button onClick={handleNext} disabled={!draft} className="neu-btn-primary disabled:opacity-50">
                下一步 <ArrowRight size={14} />
              </button>
            ) : (
              <>
                <button onClick={() => setStep(1)} className="neu-btn-soft">
                  <ArrowLeft size={14} /> 上一步
                </button>
                <button
                  onClick={handlePublish}
                  disabled={busy}
                  className="neu-btn-primary disabled:opacity-50"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {busy ? '处理中...' : publishTiming === 'now' ? '立即发布' : '保存定时发布'}
                </button>
              </>
            )}
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
  inputCls,
}: {
  annId: string;
  attachments: AnnouncementAttachment[];
  onChanged: () => void;
  inputCls: string;
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
            className={[
              'neu-btn-primary cursor-pointer whitespace-nowrap',
              uploading ? 'opacity-50' : '',
            ].join(' ')}
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
                <div className="text-sm font-semibold">{a.title}</div>
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
