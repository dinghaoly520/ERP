'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Megaphone, X, Send, Upload, Loader2, ChevronLeft, ChevronRight, Search,
} from 'lucide-react';
import {
  createAnnouncement,
  listAttachments,
  addAttachment,
  uploadFile,
  attachFromObject,
  parseAnnouncementFields,
  buildAnnouncement,
} from '@/lib/api/announcement';
import type { AnnouncementStatus } from '@/lib/api/announcement';
import { uploadProjectStageAttachment, type UploadStageAttachmentResult } from '@/lib/api/project-management';
import { getSupplierList } from '@/lib/api/supplier';
import { listBidProjects, getBidProjectDetail, type BidProjectOption } from '@/lib/api/expert';
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
  /** 公告文件上传至 PUBLIC_ANNOUNCEMENT 阶段成功后回调，供父面板即时刷新（无需手动刷新页面） */
  onStageAttachmentUploaded?: (result: UploadStageAttachmentResult) => void;
  /** 锁定的公告分类；默认 procurement_document（采购文件公告）。定标阶段复用时传 winning_bid / failed_bid */
  initialCategory?: AnnouncementCategory;
};

const inputCls =
  'w-full px-3 py-2 border border-[var(--border)] bg-[var(--background)] rounded-lg text-sm placeholder-[var(--muted-foreground)]/60 focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10';

/**
 * 把公告 draft + 项目数据映射成「信息发布」渲染器与后端 createFromAnnouncement
 * 共同约定的 canonical 键（projectCode/method/budget/scope/qualification/deadline/openTime/contact）。
 * 只写有值的键 —— 渲染器按 truthy 过滤，缺值的字段自动不显示对应芯片。
 */
function buildCanonicalMeta(
  project: ProjectManagementItem | null,
  draft: AnnouncementDraft | null,
): Record<string, unknown> {
  const d = (draft ?? {}) as Record<string, string>;
  const out: Record<string, unknown> = {};
  const put = (key: string, value: unknown) => {
    const v = typeof value === 'string' ? value.trim() : value;
    if (v !== undefined && v !== null && v !== '') out[key] = v;
  };
  const contact = [d.contactName || project?.requesterName || '', d.contactPhone || '']
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');
  put('projectCode', project?.projectCode);
  put('method', project?.procurementMethod);
  put('budget', d.maxPriceNumeric || (project?.budgetAmount != null ? String(project.budgetAmount) : undefined));
  put('scope', d.projectOverview);
  put('qualification', d.qualificationRequirements || project?.supplierRequirements);
  put('deadline', d.announcementEnd);
  put('openTime', d.bidOpeningTime || d.procurementTime);
  put('contact', contact);
  return out;
}

export function AnnouncementPublishWizard({ isOpen, onClose, project, onPublished, onStageAttachmentUploaded, initialCategory = 'procurement_document' }: Props) {
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
  // 多份采购文件时，公告引用哪一份（objectKey 唯一标识）；单份默认选它
  const [selectedTenderObjectKey, setSelectedTenderObjectKey] = useState<string>('');
  // 文件下载时间：从项目台账 documentAcquireTime 预填，无则必填
  const [documentDownloadTime, setDocumentDownloadTime] = useState('');
  const [notifyOnPublish, setNotifyOnPublish] = useState(true);
  const [annId, setAnnId] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<Array<{ file: File; title: string }>>([]);
  const [busy, setBusy] = useState(false);

  // Supplier picker
  const [allSuppliers, setAllSuppliers] = useState<Supplier[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  // 直接采购：自动匹配公告中拟定供应商的待匹配名称（匹配完清空）
  const [autoMatchName, setAutoMatchName] = useState('');

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
    setNotifyOnPublish(true);
    setVisibility('PUBLIC');
    setRestrictedSupplierIds([]);
    setAutoMatchName('');
    setPublishTiming('now');
    setScheduledDate('');
    setPendingFiles([]);

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

    // ★ 同步锁定 procurement_document（项目管理入口只做采购文件公告）+ 项目数据预填
    // 不依赖 .docx 解析，确保无论解析成功与否都直接进入编辑页、不显示分类选择
    const avail = getAvailableAnnouncementCategories(tt);
    const procCat = avail.find((c) => c === initialCategory);
    if (!procCat) {
      setCategory(null);
      setDraft(null);
      setLoading(false);
      return;
    }
    const emptyDraft = createEmptyAnnouncementDraft(tt, procCat);
    const filledDraft = applyAutoFill(
      emptyDraft,
      preTender as Record<string, string>,
      getAnnouncementFields(tt, procCat),
    );
    setCategory(procCat);
    setDraft(filledDraft);

    // ★ 默认引用采购文件（多份时默认选第一份）
    setTenderOn(tenderFiles.length > 0);
    setSelectedTenderObjectKey(tenderFiles[0]?.objectKey ?? '');
    // ★ 文件下载时间：从采购文件获取时间(documentAcquireTime)预填；无则发布时必填
    setDocumentDownloadTime(project.documentAcquireTime ?? '');

    // ★ 默认公告范围
    // 谈判采购 → 部分供应商可见（供应商已在上一邀请步骤中确定）（内置以上步骤禁止公开）
    // 竞价采购/直接采购 → 部分供应商可见（历史逻辑兼容）
    const defaultRestricted =
      tt === 'COMPETITIVE_NEGOTIATION' || tt === 'INTERNAL_BIDDING' || tt === 'SINGLE_SOURCE';
    setVisibility(defaultRestricted ? 'RESTRICTED' : 'PUBLIC');

    // ★ 加载投标项目中被邀供应商 → 自动预选为"部分可见"的已选供应商
    if (defaultRestricted) {
      listBidProjects()
        .then(async (bidProjects: BidProjectOption[]) => {
          const match = bidProjects.find(
            (bp) => bp.name === project.title || project.title.includes(bp.name) || bp.name.includes(project.title),
          );
          if (!match) return;
          const detail = await getBidProjectDetail(match.id).catch(() => null);
          if (!detail?.suppliers?.length) return;
          const ids = detail.suppliers
            .filter((s: { supplierId: string | null }) => s.supplierId)
            .map((s: { supplierId: string | null }) => s.supplierId!);
          if (ids.length > 0) setRestrictedSupplierIds(ids);
        })
        .catch(() => {});
    }

    // ★ 直接采购：自动读取公告中的拟定供应商（draft.supplierName，来自项目 awardedSupplier）
    //   匹配供应商库并选中；供应商列表加载后由下方 useEffect 消费 autoMatchName
    if (tt === 'SINGLE_SOURCE') {
      const sn = (filledDraft as Record<string, string>).supplierName || '';
      if (sn.trim()) setAutoMatchName(sn);
    }

    // ★ Async: .docx 解析仅作额外字段叠加（失败不影响进入编辑页）
    parseAnnouncementFields(project.id)
      .then((parsed) => {
        if (!parsed?.fields) return;
        const merged = { ...preTender, ...parsed.fields } as ReadyTenderDraft;
        setTenderDraftForDialog(merged);
        setDraft((prev) =>
          prev ? ({ ...prev, ...parsed.fields } as AnnouncementDraft) : prev,
        );
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

  // Supplier list for picker（visibility 为部分可见时加载；并消费 autoMatchName 自动选中）
  useEffect(() => {
    if (visibility !== 'RESTRICTED' || !isOpen) return;
    getSupplierList({ status: 'APPROVED', search: supplierSearch || undefined, pageSize: 200 })
      .then((r) => {
        setAllSuppliers(r.items);
        if (autoMatchName.trim()) {
          const name = autoMatchName.trim();
          const matched = r.items.filter(
            (s) => s.name === name || s.name.includes(name) || name.includes(s.name),
          );
          if (matched.length > 0) {
            setRestrictedSupplierIds(matched.map((s) => s.id));
          }
          setAutoMatchName('');
        }
      })
      .catch(() => {
        /* ignore */
      });
  }, [visibility, isOpen, supplierSearch, autoMatchName]);

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

  // 发布时上传本地暂存的附件（附件 API 需要 announcementId，故在 create 之后批量上传）
  const uploadPendingFiles = async (id: string) => {
    for (const item of pendingFiles) {
      try {
        const asset = await uploadFile(item.file, 'announcement');
        await addAttachment(id, asset.id, item.title || item.file.name);
      } catch (e) {
        toast.error(`附件上传失败：${item.file.name} ${(e as Error).message}`);
      }
    }
  };

  const ensureTenderAttached = async (id: string) => {
    if (!tenderOn || tenderFiles.length === 0) return;
    const existing = await listAttachments(id);
    const have = new Set(existing.map((a) => a.fileAsset.originalName));
    // 多份采购文件时只引用用户选中的那份；单份直接引用
    const filesToAttach = tenderFiles.length > 1
      ? tenderFiles.filter((f) => f.objectKey === selectedTenderObjectKey)
      : tenderFiles;
    for (const f of filesToAttach) {
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
    if (tenderOn && !documentDownloadTime.trim()) {
      toast.error('请填写文件下载时间');
      return;
    }
    const title = `${getAnnouncementLabel(tenderType, category)} — ${project?.title || ''}`;
    const draftRecord = draft as Record<string, string>;
    setBusy(true);
    try {
      // 1. 用公告模板渲染生成 docx + 提取公告全文（mammoth）
      const { blob, fileName, textContent } = await buildAnnouncement({
        tenderType,
        category,
        draft,
      });

      // 2. 正文 = 公告全文 → HTML 段落（escape 防注入，空行分段，段内换行转 <br/>）
      const esc = (s: string) =>
        s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
      const content = textContent.trim()
        ? textContent
            .split(/\n\s*\n/)
            .map((p) => `<p>${esc(p).replace(/\n/g, '<br/>')}</p>`)
            .join('')
        : `<p>${esc(title)}</p>`;

      // 3. 创建公告（正文为全文；canonical 精炼字段供「信息发布」详情页与后端消费）
      const meta: Record<string, unknown> = { ...draft, visibility, ...buildCanonicalMeta(project, draft) };
      if (visibility === 'RESTRICTED') meta.restrictedSupplierIds = restrictedSupplierIds;
      if (publishTiming === 'scheduled') meta.scheduledPublishDate = scheduledDate;
      meta.notifyOnPublish = visibility === 'RESTRICTED' && notifyOnPublish;
      if (documentDownloadTime.trim()) meta.documentDownloadTime = documentDownloadTime.trim();
      if (selectedTenderObjectKey) meta.selectedTenderObjectKey = selectedTenderObjectKey;
      const status: AnnouncementStatus = publishTiming === 'scheduled' ? 'DRAFT' : 'PUBLISHED';
      const saved = await createAnnouncement({
        title,
        content,
        type: 'BID_NOTICE',
        summary: draftRecord.projectOverview?.slice(0, 100) || '',
        status,
        publishDate: publishTiming === 'now' ? new Date().toISOString() : undefined,
        metadata: meta,
        relatedProjectCode: project?.projectCode || undefined,
      });
      const id = saved.id;
      setAnnId(id);

      // 4. 把生成的公告 docx 上传到项目 PUBLIC_ANNOUNCEMENT 阶段
      try {
        const docFile = new File([blob], fileName, {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        const uploaded = await uploadProjectStageAttachment(project!.id, 'PUBLIC_ANNOUNCEMENT', docFile);
        onStageAttachmentUploaded?.(uploaded);
      } catch (e) {
        toast.error(`公告文件上传到阶段失败：${(e as Error).message}`);
      }

      // 5. 其他附件 + 引用采购文件
      await uploadPendingFiles(id);
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
              <div className="rounded-[20px] p-5 space-y-3" style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 1px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.8)' }}>
                <div className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">公告范围</div>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="visibility"
                    checked={visibility === 'PUBLIC'}
                    onChange={() => setVisibility('PUBLIC')}
                    className="accent-[var(--accent)]"
                  />
                  全部可见
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
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
                  <div className="space-y-2 pt-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 relative">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
                        <input
                          value={supplierSearch}
                          onChange={(e) => setSupplierSearch(e.target.value)}
                          placeholder="搜索供应商名称"
                          className="workbench-input w-full !pl-8 text-sm"
                        />
                      </div>
                      <span className="text-[11px] font-bold tabular-nums text-[var(--muted-foreground)] whitespace-nowrap">
                        已选 {restrictedSupplierIds.length}
                      </span>
                    </div>
                    <div className="max-h-48 overflow-y-auto rounded-[12px] divide-y divide-[oklch(0.6_0.04_258_/_0.08)]"
                      style={{ background: 'oklch(1 0 0 / 0.38)', boxShadow: 'inset 1px 1px 3px oklch(0.55 0.03 258 / 0.08), inset -1px -1px 2px oklch(1 0 0 / 0.6)' }}>
                      {allSuppliers.map((s) => (
                        <label
                          key={s.id}
                          className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-[oklch(1_0_0_/_0.3)] cursor-pointer transition-colors"
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
                          <span className="text-[var(--foreground)]">{s.name}</span>
                        </label>
                      ))}
                      {allSuppliers.length === 0 && (
                        <p className="px-3 py-3 text-xs text-[var(--muted-foreground)] text-center">
                          无匹配供应商
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Timing */}
              <div className="rounded-[20px] p-5 space-y-3" style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 1px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.8)' }}>
                <div className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">发布时间</div>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="timing"
                    checked={publishTiming === 'now'}
                    onChange={() => setPublishTiming('now')}
                    className="accent-[var(--accent)]"
                  />
                  立即发布
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
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
                    className="workbench-input w-full text-sm"
                  />
                )}
              </div>

              {/* Toggles */}
              <div className="rounded-[20px] p-4" style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 1px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.8)' }}>
                <div className="flex flex-wrap items-center gap-6">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
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
                      tenderAvailable ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed',
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
                  {visibility === 'RESTRICTED' && (
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={notifyOnPublish}
                        onChange={(e) => setNotifyOnPublish(e.target.checked)}
                        className="accent-[var(--accent)]"
                      />
                      发布后发送通知
                    </label>
                  )}
                </div>
              </div>

              {/* 采购文件选择 —— 多份时让用户指定公告引用哪一份 */}
              {tenderOn && tenderFiles.length > 1 && (
                <div className="rounded-[20px] p-4" style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 1px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.8)' }}>
                  <div className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
                    选择引用的采购文件 <span className="text-[var(--danger)]">*</span>
                  </div>
                  <div className="mt-2 space-y-2">
                    {tenderFiles.map((f) => (
                      <label key={f.objectKey} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="radio"
                          name="tenderFile"
                          checked={selectedTenderObjectKey === f.objectKey}
                          onChange={() => setSelectedTenderObjectKey(f.objectKey)}
                          className="accent-[var(--accent)]"
                        />
                        <span className="truncate">{f.fileName}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* 文件下载时间 —— 仅在引用采购文件时需要：从台账 documentAcquireTime 预填，无则必填 */}
              {tenderOn && (
                <div className="rounded-[20px] p-4" style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 1px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.8)' }}>
                  <div className="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
                    文件下载时间
                    {!project?.documentAcquireTime && <span className="text-[var(--danger)]">*</span>}
                  </div>
                  <input
                    type="text"
                    value={documentDownloadTime}
                    onChange={(e) => setDocumentDownloadTime(e.target.value)}
                    placeholder="如 2026年8月1日-8月5日"
                    className="workbench-input mt-2 w-full text-sm"
                  />
                  <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
                    {project?.documentAcquireTime
                      ? '已从采购文件获取时间自动填入，可调整'
                      : '采购文件未提取到获取时间，请填写（必填）'}
                  </p>
                </div>
              )}

              {/* Attachment section — 本地暂存，发布时统一上传 */}
              {attachOn && (
                <AttachmentSection
                  pendingFiles={pendingFiles}
                  onAdd={(file, title) => setPendingFiles((prev) => [...prev, { file, title }])}
                  onRemove={(idx) => setPendingFiles((prev) => prev.filter((_, i) => i !== idx))}
                  inputCls={inputCls}
                />
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
            {step === 1 ? (
              <button onClick={handleNext} disabled={!draft} className="neu-btn-primary !h-[34px] disabled:opacity-50">
                下一步 <ChevronRight size={14} />
              </button>
            ) : (
              <>
                <button onClick={() => setStep(1)} className="neu-btn-soft !h-[34px]">
                  <ChevronLeft size={14} /> 上一步
                </button>
                <button
                  onClick={handlePublish}
                  disabled={busy}
                  className="neu-btn-primary !h-[34px] disabled:opacity-50"
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
  pendingFiles,
  onAdd,
  onRemove,
  inputCls,
}: {
  pendingFiles: Array<{ file: File; title: string }>;
  onAdd: (file: File, title: string) => void;
  onRemove: (index: number) => void;
  inputCls: string;
}) {
  const [attTitle, setAttTitle] = useState('');

  const onSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    onAdd(f, attTitle);
    setAttTitle('');
    e.target.value = '';
  };

  return (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <div className="text-xs font-bold text-[var(--accent-strong)] mb-3">
        附件（公开可下载 · 发布时上传）
      </div>
      <div className="space-y-3">
        <div className="flex gap-2">
          <input
            value={attTitle}
            onChange={(e) => setAttTitle(e.target.value)}
            placeholder="附件标题（可选）"
            className={inputCls + ' flex-1'}
          />
          <label className="neu-btn-primary cursor-pointer whitespace-nowrap">
            <Upload size={14} />
            添加附件
            <input type="file" className="hidden" onChange={onSelect} />
          </label>
        </div>
        {pendingFiles.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)]">暂无附件</p>
        ) : (
          pendingFiles.map((item, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2"
            >
              <div>
                <div className="text-sm font-semibold">{item.title || item.file.name}</div>
                <div className="text-xs text-[var(--muted-foreground)]">
                  {item.file.name} · {(item.file.size / 1024).toFixed(0)} KB
                </div>
              </div>
              <button onClick={() => onRemove(idx)} className="neu-btn-xs is-danger">
                移除
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
