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
import { uploadProjectStageAttachment, reprocProject, type UploadStageAttachmentResult } from '@/lib/api/project-management';
import { generateFieldContent } from '@/lib/api/tender-sample';
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

/** 今天 + n 天后的截止时刻（YYYY-MM-DDTHH:MM），时分默认 23:59
 *  （datetime-local 时分上限为 23:59，无法表示 24:00，以 23:59 表示当天截止） */
function deadlineAfterDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}T23:59`;
}

/** 从 datetime-local 字符串格式化为中文显示（YYYY-MM-DDTHH:MM → "YYYY年M月D日 HH:MM"） */
function formatDateTimeDisplay(iso: string): string {
  if (!iso) return '—';
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (m) return `${m[1]}年${parseInt(m[2])}月${parseInt(m[3])}日 ${m[4]}:${m[5]}`;
  const d = iso.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (d) return `${d[1]}年${parseInt(d[2])}月${parseInt(d[3])}日`;
  return iso;
}

/** 计算开标时间前 24 小时的 datetime-local 值 */
function hoursBeforeOpenTime(openTimeIso: string, hours: number): string {
  if (!openTimeIso) return '';
  const dt = new Date(openTimeIso);
  if (isNaN(dt.getTime())) return '';
  dt.setHours(dt.getHours() - hours);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  const h = String(dt.getHours()).padStart(2, '0');
  const min = String(dt.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}`;
}

/** 中文日期 "2026年8月1日" → YYYY-MM-DD；已是数字格式则直接返回 */
function toDateInputValue(text: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const m = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) {
    const y = m[1];
    const mo = m[2].padStart(2, '0');
    const d = m[3].padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  return text;
}

/** 中文日期时间 "2026年3月26日15:00" → YYYY-MM-DDTHH:MM（datetime-local input 格式） */
function toDatetimeLocalValue(text: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return text;
  // 匹配 "2026年03月26日15:00" 或 "2026年3月26日15:00"
  const m = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2}):(\d{2})/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T${m[4].padStart(2, '0')}:${m[5]}`;
  }
  // fallback: date-only
  return toDateInputValue(text);
}

/** sessionStorage key per project */
function wizardStorageKey(projectId: string): string { return `ann-wizard-${projectId}`; }
function loadWizardState(projectId: string): Record<string, any> | null {
  try { const r = sessionStorage.getItem(wizardStorageKey(projectId)); return r ? JSON.parse(r) : null; } catch { return null; }
}
function saveWizardState(projectId: string, state: Record<string, any>) {
  try { const prev = loadWizardState(projectId) || {}; sessionStorage.setItem(wizardStorageKey(projectId), JSON.stringify({ ...prev, ...state, _ts: Date.now() })); } catch {}
}
function clearWizardState(projectId: string) { try { sessionStorage.removeItem(wizardStorageKey(projectId)); } catch {} }

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
  const [publishTiming, setPublishTiming] = useState<'now' | 'scheduled' | 'announcement_start'>('now');
  const [scheduledDate, setScheduledDate] = useState('');
  // 公告截止时间（从公告制作提取到发布配置）+ 标书投递截止时间
  const [announcementEndDate, setAnnouncementEndDate] = useState('');
  const [bidSubmissionDeadline, setBidSubmissionDeadline] = useState('');
  // 采购文件下载方式：免费 / 解密密码 / 付费（占位）
  const [downloadMode, setDownloadMode] = useState<'free' | 'encrypted' | 'paid'>('free');
  const [downloadPassword, setDownloadPassword] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [attachOn, setAttachOn] = useState(false);
  const [tenderOn, setTenderOn] = useState(false);
  // 多份采购文件时，公告引用哪一份（objectKey 唯一标识）；单份默认选它
  const [selectedTenderObjectKey, setSelectedTenderObjectKey] = useState<string>('');
  const [notifyOnPublish, setNotifyOnPublish] = useState(true);
  const [annId, setAnnId] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<Array<{ file: File; title: string }>>([]);
  const [busy, setBusy] = useState(false);

  // Supplier picker
  const [allSuppliers, setAllSuppliers] = useState<Supplier[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [showSupplierPicker, setShowSupplierPicker] = useState(false);
  // 直接采购：自动匹配公告中拟定供应商的待匹配名称（匹配完清空）
  const [autoMatchName, setAutoMatchName] = useState('');

  // #20 公告类型配置：控制各类型公告的发布配置区块可见性；新增类型仅需加一行
  const categoryConfig = useMemo(() => {
    const on: { showTiming: boolean; showKeyTime: boolean; showFullToggles: boolean } = { showTiming: true, showKeyTime: true, showFullToggles: true };
    const map: Record<string, typeof on> = {
      procurement_document: on,
      winning_bid: on,
      failed_bid: { showTiming: false, showKeyTime: false, showFullToggles: false },
    };
    return map[category ?? 'procurement_document'] ?? on;
  }, [category]);

  const tenderFiles = useMemo<ProjectManagementAttachment[]>(
    () => project?.stages.find((s) => s.stageKey === 'TENDER_DOCUMENT')?.attachments ?? [],
    [project],
  );

  // 打开时：确定 tenderType + 构造预填 draft + 解析 .docx
  /* eslint-disable react-hooks/set-state-in-effect -- 弹窗打开时重置表单值，符合模态惯例 */
  useEffect(() => {
    if (!isOpen || !project) return;

    // ★ 检查 sessionStorage 缓存 —— 有则恢复，无则全新预填
    const cachedWiz = loadWizardState(project.id);

    setLoading(true);
    setStep(1);
    setAnnId(null);
    setAttachOn(false);
    setTenderOn(false);
    setNotifyOnPublish(true);
    setVisibility('PUBLIC');
    setRestrictedSupplierIds([]);
    setShowSupplierPicker(false);
    setAutoMatchName('');
    setPublishTiming('now');
    setScheduledDate('');
    setBusy(false);
    setPendingFiles([]); // File 对象不可序列化，关闭即丢弃

    const tt = mapProcurementMethodToTenderType(project.procurementMethod);
    if (!tt) { setLoading(false); return; }
    setTenderType(tt);
    const meta = TENDER_DOCUMENT_TYPES.find((m) => m.type === tt) ?? TENDER_DOCUMENT_TYPES[0];
    setSelectedMeta(meta);

    const preTender = buildPrefillFromProject(project, tt) as ReadyTenderDraft;
    setTenderDraftForDialog(preTender);

    // ★ 缓存命中 —— 恢复上次完整状态，跳过全新预填
    if (cachedWiz?.draft) {
      setStep(cachedWiz.step ?? 1);
      setCategory((cachedWiz.category as AnnouncementCategory) ?? initialCategory);
      setDraft(cachedWiz.draft as AnnouncementDraft);
      setVisibility(cachedWiz.visibility ?? 'PUBLIC');
      setRestrictedSupplierIds(cachedWiz.restrictedSupplierIds ?? []);
      setPublishTiming(cachedWiz.publishTiming ?? 'now');
      setScheduledDate(cachedWiz.scheduledDate ?? '');
      setAnnouncementEndDate(cachedWiz.announcementEndDate ?? '');
      setBidSubmissionDeadline(cachedWiz.bidSubmissionDeadline ?? '');
      setDownloadMode(cachedWiz.downloadMode ?? 'free');
      setDownloadPassword(cachedWiz.downloadPassword ?? '');
      setPaidAmount(cachedWiz.paidAmount ?? '');
      setAttachOn(cachedWiz.attachOn ?? false);
      setTenderOn(cachedWiz.tenderOn ?? tenderFiles.length > 0);
      setSelectedTenderObjectKey(cachedWiz.selectedTenderObjectKey ?? tenderFiles[0]?.objectKey ?? '');
      setNotifyOnPublish(cachedWiz.notifyOnPublish ?? true);
      if (tt === 'SINGLE_SOURCE') {
        const sn = (cachedWiz.draft as Record<string, string>).supplierName?.trim();
        if (sn) setAutoMatchName(sn);
      }
      setLoading(false);
      // 后台 .docx 解析仅作增量
      parseAnnouncementFields(project.id)
        .then((parsed) => {
          if (!parsed?.fields) return;
          setDraft((prev) => prev ? ({ ...(prev as any), ...parsed.fields }) : prev);
        }).catch(() => {});
      return;
    }

    // ── 无缓存：全新预填 ──

    // ★ 同步锁定 procurement_document（项目管理入口只做采购文件公告）+ 项目数据预填
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

    // ★ 增强预填：直接从项目数据填入公告字段（无需 AI）
    // 判断是否直接采购（SINGLE_SOURCE）—— 直接采购有更多可自动填入的数据
    const isSingleSource = tt === 'SINGLE_SOURCE';
    {
      const fd = filledDraft as Record<string, string>;
      if (!fd.maxPriceNumeric?.trim() && project.budgetAmount != null) fd.maxPriceNumeric = String(project.budgetAmount);
      if (!fd.projectOverview?.trim() && project.projectOverview?.trim()) fd.projectOverview = project.projectOverview;
      if (!fd.qualificationRequirements?.trim() && project.supplierRequirements?.trim()) fd.qualificationRequirements = project.supplierRequirements;

      // 采购时间 = 开标时间
      if (!fd.procurementTime?.trim() && project.bidOpeningTime?.trim()) fd.procurementTime = project.bidOpeningTime;

      // 落款日期 = 当前日期
      if (!fd.signatureDate?.trim()) {
        const today = new Date();
        fd.signatureDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      }

      // 直接采购：供应商名称补充来源
      if (isSingleSource && !fd.supplierName?.trim()) {
        // 优先级：awardedSupplier → 采购文件编写草稿
        let sn = project.awardedSupplier?.trim();
        if (!sn) {
          try {
            const raw = localStorage.getItem(`tender-write:project-drafts:v1:${project.id}`);
            if (raw) sn = (JSON.parse(raw)?.SINGLE_SOURCE as Record<string, string>)?.supplierName?.trim();
          } catch {}
        }
        if (sn) fd.supplierName = sn;
      }
    }

    // 从采购文件获取时间(documentAcquireTime)区间自动填入公示期限起/止（带 HH:MM）
    // documentAcquireTime 格式如 "2026年03月23日09:00至2026年03月26日15:00"
    // 分隔符可能是 "至" 或 "-"
    const acquireTime = project.documentAcquireTime?.trim();
    if (acquireTime) {
      const sepMatch = acquireTime.match(/至|-|~/);
      const sepIdx = sepMatch ? acquireTime.indexOf(sepMatch[0]) : -1;
      if (sepIdx > 0) {
        const startRaw = acquireTime.slice(0, sepIdx).trim();
        const endRaw = acquireTime.slice(sepIdx + 1).trim();
        const fd = filledDraft as Record<string, string>;
        if (!fd.announcementStart) fd.announcementStart = toDateInputValue(startRaw);
        // 公示期限（止）保留完整日期时间（含时分）
        if (!fd.announcementEnd) fd.announcementEnd = isSingleSource ? endRaw : toDateInputValue(endRaw);
        // 自动计算天数
        if (!fd.announcementDays) {
          try {
            const startDate = new Date(toDateInputValue(startRaw));
            const endDate = new Date(toDateInputValue(endRaw));
            const days = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
            if (days > 0) fd.announcementDays = String(days);
          } catch {}
        }
      }
    }

    setDraft(filledDraft);

    // ★ 默认引用采购文件（多份时默认选第一份）
    setTenderOn(tenderFiles.length > 0);
    setSelectedTenderObjectKey(tenderFiles[0]?.objectKey ?? '');
    // 默认截止时间：优先取公示期限（止）→ 兜底按采购方式给默认
    const isQuickDeadlineCategory = project.procurementMethod === '询比采购' || project.procurementMethod === '竞价采购';
    const inheritEnd = (filledDraft as Record<string, string>).announcementEnd ?? '';
    if (inheritEnd) {
      // 转换为 ISO 格式（datetime-local input 需要）
      const isoEnd = isSingleSource ? toDatetimeLocalValue(inheritEnd) : (inheritEnd.length <= 10 ? `${inheritEnd}T23:59` : inheritEnd);
      setAnnouncementEndDate(isoEnd);
    } else {
      setAnnouncementEndDate(deadlineAfterDays(isQuickDeadlineCategory ? 3 : 5));
    }
    // 标书投递截止时间 = 开标时间前 24 小时
    if (!isSingleSource) {
      const openTime = (filledDraft as Record<string, string>).procurementTime?.trim()
        || (filledDraft as Record<string, string>).bidOpeningTime?.trim()
        || project.bidOpeningTime?.trim()
        || '';
      const openTimeIso = openTime ? toDatetimeLocalValue(openTime) : '';
      if (openTimeIso) {
        setBidSubmissionDeadline(hoursBeforeOpenTime(openTimeIso, 24));
      } else {
        setBidSubmissionDeadline(deadlineAfterDays(isQuickDeadlineCategory ? 5 : 10));
      }
    }

    // ★ 默认公告范围：全部可见
    setVisibility('PUBLIC');

    // 流标公告：强制全部可见 + 立即发布
    if (initialCategory === 'failed_bid') {
      setVisibility('PUBLIC');
      setPublishTiming('now');
    }

    // ★ 加载投标项目中被邀供应商
    {
      const defaultRestricted =
        tt === 'COMPETITIVE_NEGOTIATION' || tt === 'INTERNAL_BIDDING' || tt === 'SINGLE_SOURCE';
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
    }

    // ★ 直接采购：自动读取公告中的拟定供应商
    if (tt === 'SINGLE_SOURCE') {
      const sn = (filledDraft as Record<string, string>).supplierName || '';
      if (sn.trim()) setAutoMatchName(sn);
    }

    // ★ 直接采购：异步补充供应商地址 + AI 生成论证意见
    if (isSingleSource) {
      const sn = (filledDraft as Record<string, string>).supplierName?.trim();
      if (sn) {
        // 1. 供应商地址查库
        getSupplierList({ status: 'APPROVED', search: sn, pageSize: 5 })
          .then((r) => {
            const match = r.items.find((s: any) => s.name === sn || s.name.includes(sn) || sn.includes(s.name));
            if (match?.registeredAddress) {
              setDraft((prev) => {
                if (!prev) return prev;
                const next = { ...(prev as Record<string, string>) };
                if (!next.supplierAddress?.trim()) next.supplierAddress = match.registeredAddress;
                return next as AnnouncementDraft;
              });
            }
          }).catch(() => {});
        // 2. AI 论证意见
        if (!(filledDraft as Record<string, string>).argumentOpinion?.trim()) {
          const argContext: Record<string, string> = {};
          if (project?.title) argContext['项目名称'] = project.title;
          if (project?.projectOverview) argContext['项目概况'] = project.projectOverview;
          if (project?.projectReason) argContext['立项事由'] = project.projectReason;
          argContext['拟定供应商'] = sn;
          if (project?.supplierRequirements) argContext['供方要求'] = project.supplierRequirements;
          generateFieldContent({
            fieldKey: 'argumentOpinion' as any,
            fieldLabel: '论证意见',
            currentValue: '',
            aiPrompt: '根据项目名称、采购内容和拟定供应商信息，生成单一来源直接采购的论证意见。说明采购必要性、为什么只能从该供应商处采购（如技术唯一性、专利专有性、地域专属性、服务延续性等论证理由）。论证语言正式专业，200-400字。不要使用#、*等符号。',
            context: argContext,
          }).then((res) => {
            if (res?.content) {
              setDraft((prev) => {
                if (!prev) return prev;
                const next = { ...(prev as Record<string, string>) };
                if (!next.argumentOpinion?.trim()) next.argumentOpinion = res.content;
                return next as AnnouncementDraft;
              });
            }
          }).catch(() => {});
        }
      }
    }

    // ★ Async: .docx 解析仅作额外字段叠加
    parseAnnouncementFields(project.id)
      .then((parsed) => {
        if (!parsed?.fields) return;
        const merged = { ...preTender, ...parsed.fields } as ReadyTenderDraft;
        setTenderDraftForDialog(merged);
        setDraft((prev) =>
          prev ? ({ ...prev, ...parsed.fields } as AnnouncementDraft) : prev,
        );
      })
      .catch(() => {})
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

  // 已选供应商名称解析（从 allSuppliers + 额外按 id 查询兜底）
  const restrictedSuppliers = useMemo(() => {
    const known = new Map(allSuppliers.map((s) => [s.id, s.name]));
    return restrictedSupplierIds.map((id) => ({ id, name: known.get(id) || id.slice(-8) }));
  }, [restrictedSupplierIds, allSuppliers]);

  const handleNext = () => {
    if (!draft || !category) {
      toast.error('请先选择公告类型并填写内容');
      return;
    }
    setStep(2);
    if (project && draft) saveWizardState(project.id, { step: 2, category, draft: draft as Record<string, string> });
  };

  // Notification callback from embedded AnnouncementDialog
  const handleDraftChange = useCallback((d: AnnouncementDraft, cat: AnnouncementCategory) => {
    setDraft(d);
    setCategory(cat);
    if (project) saveWizardState(project.id, { draft: d as Record<string, string>, category: cat });
  }, [project]);

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
    if (publishTiming === 'announcement_start') {
      const startDate = (draft as Record<string, string>).announcementStart;
      if (!startDate) {
        toast.error('公告制作中未填写公示期限（起），请返回填写');
        return;
      }
    }
    if (visibility === 'RESTRICTED' && restrictedSupplierIds.length === 0) {
      toast.error('请至少选择一家可见供应商');
      return;
    }
    const title = `${getAnnouncementLabel(tenderType, category)} — ${project?.title || ''}`;
    const draftRecord = draft as Record<string, string>;
    setBusy(true);
    try {
      // 1. 用公告模板渲染生成 docx + 提取公告全文（mammoth）
      // 公告截止时间由发布配置接管（step1 已隐藏 announcementEnd），合并进 draft
      const finalDraft = { ...(draft as Record<string, string>), announcementEnd: announcementEndDate } as AnnouncementDraft;
      const { blob, fileName, textContent } = await buildAnnouncement({
        tenderType,
        category,
        draft: finalDraft,
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
      const meta: Record<string, unknown> = { ...finalDraft, visibility, category, ...buildCanonicalMeta(project, finalDraft) };
      if (visibility === 'RESTRICTED') meta.restrictedSupplierIds = restrictedSupplierIds;
      if (publishTiming === 'scheduled') meta.scheduledPublishDate = scheduledDate;
      else if (publishTiming === 'announcement_start') meta.scheduledPublishDate = (finalDraft as Record<string, string>).announcementStart;
      meta.notifyOnPublish = notifyOnPublish;
      if (selectedTenderObjectKey) {
        meta.selectedTenderObjectKey = selectedTenderObjectKey;
        const tenderFile = tenderFiles.find((f) => f.objectKey === selectedTenderObjectKey) ?? tenderFiles[0];
        // P1b：后端据此自动生成加密 BidDocument（附文件名/MIME，docx 会转 PDF）
        if (tenderFile) {
          meta.selectedTenderFileName = tenderFile.fileName;
          meta.selectedTenderMimeType = tenderFile.mimeType;
        }
      }
      // 投递截止（bid deadline）—— 优先标书投递截止，兜底公告截止
      meta.deadline = bidSubmissionDeadline.trim() || announcementEndDate;
      // 下载截止（downloadDeadline）—— 公告截止时间
      if (announcementEndDate) meta.downloadDeadline = announcementEndDate;
      // 下载方式 —— 引用采购文件时生效
      if (tenderOn) {
        meta.downloadMode = downloadMode;
        if (downloadMode === 'encrypted') meta.downloadPassword = downloadPassword;
        if (downloadMode === 'paid') meta.paidAmount = paidAmount;
      }
      const status: AnnouncementStatus = publishTiming !== 'now' ? 'DRAFT' : 'PUBLISHED';
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

      toast.success(publishTiming === 'now' ? '已发布' : publishTiming === 'announcement_start' ? '已设定按公示期限起始时间发布' : '已保存为定时发布');
      // 流标公告发布后：自动触发再次采购（按采购方式新增新一轮「立项后→开标评标」阶段）
      if (category === 'failed_bid' && project?.id) {
        try {
          await reprocProject(project.id);
          toast.success('已开启新一轮采购');
        } catch (e) {
          toast.error('再次采购失败：' + (e instanceof Error ? e.message : '未知错误'));
        }
      }
      if (project) clearWizardState(project.id);
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
              project={project}
            />
          ) : (
            /* Step 2: Publish Config */
            <div className="space-y-5">
              <h2 className="text-sm font-bold text-[var(--foreground)] flex items-center gap-2">
                <Send size={14} className="text-[var(--accent)]" /> 发布配置
              </h2>
              <p className="text-[11px] text-[var(--muted-foreground)] leading-relaxed">以下配置已根据项目采购方式智能填入，可直接点击底部「立即发布」；如需调整，修改后发布。</p>

              {/* 公告范围 + 发布时间 — 同一行 */}
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {/* Visibility */}
              <div className="flex flex-col rounded-[20px] p-5 space-y-3" style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 1px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.8)' }}>
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
                    onChange={() => { setVisibility('RESTRICTED'); setShowSupplierPicker(true); }}
                    className="accent-[var(--accent)]"
                  />
                  部分供应商可见
                </label>
                {visibility === 'RESTRICTED' && (
                  <div className="pt-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {restrictedSupplierIds.length > 0 ? (
                        <>
                          {restrictedSuppliers.map((s) => (
                            <span
                              key={s.id}
                              className="inline-flex items-center gap-1 rounded-lg bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] px-2 py-1 text-xs font-semibold text-[var(--accent)]"
                            >
                              {s.name}
                              <button
                                type="button"
                                onClick={() => setRestrictedSupplierIds((prev) => prev.filter((x) => x !== s.id))}
                                className="opacity-70 hover:opacity-100"
                              >
                                <X size={11} />
                              </button>
                            </span>
                          ))}
                        </>
                      ) : (
                        <span className="text-xs text-[var(--muted-foreground)]">未选择供应商</span>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowSupplierPicker(true)}
                        className="neu-btn-xs ml-auto shrink-0"
                      >
                        <Search size={11} />选择供应商
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {categoryConfig.showTiming ? (
              <div className="flex flex-col rounded-[20px] p-5 space-y-3" style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 1px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.8)' }}>
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
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="timing"
                    checked={publishTiming === 'announcement_start'}
                    onChange={() => setPublishTiming('announcement_start')}
                    className="accent-[var(--accent)]"
                  />
                  按公示期限（起）发布
                </label>
                {publishTiming === 'announcement_start' && (
                  <div className="rounded-lg bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-3 py-2 text-xs text-[var(--accent-strong)]">
                    将于公示期限起始时间
                    <strong className="mx-1">
                      {(draft as Record<string, string>).announcementStart
                        ? (draft as Record<string, string>).announcementStart
                        : '（未填写）'}
                    </strong>
                    自动发布
                  </div>
                )}
              </div>
              ) : <div />}
              </div>

              {categoryConfig.showKeyTime && (() => {
                const dr = (draft ?? {}) as Record<string, string>;
                const pubStart = dr.announcementStart || '';
                const pubEnd = announcementEndDate || dr.announcementEnd || '';
                const openTime = dr.procurementTime || dr.bidOpeningTime || '';
                const openTimeIso = openTime ? toDatetimeLocalValue(openTime) : '';
                return (
              <div className="rounded-[20px] p-5 space-y-4" style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 1px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.8)' }}>
                <div className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">关键事件</div>

                {/* 关键事件时间线（只读展示） */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl px-3 py-2.5" style={{ background: 'oklch(1 0 0 / 0.5)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
                    <div className="text-[10px] font-semibold text-[var(--muted-foreground)] mb-1">公示期限（起）</div>
                    <div className="text-xs font-semibold text-[var(--foreground)]">{formatDateTimeDisplay(pubStart)}</div>
                  </div>
                  <div className="rounded-xl px-3 py-2.5" style={{ background: 'oklch(1 0 0 / 0.5)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
                    <div className="text-[10px] font-semibold text-[var(--muted-foreground)] mb-1">公示期限（止）</div>
                    <div className="text-xs font-semibold text-[var(--foreground)]">{formatDateTimeDisplay(pubEnd)}</div>
                  </div>
                  <div className="rounded-xl px-3 py-2.5" style={{ background: 'color-mix(in oklch, var(--accent) 6%, oklch(1 0 0 / 0.5))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
                    <div className="text-[10px] font-semibold text-[var(--accent)] mb-1">开标时间</div>
                    <div className="text-xs font-semibold text-[var(--foreground)]">{formatDateTimeDisplay(openTimeIso)}</div>
                  </div>
                </div>

                {/* 可编辑：公告截止 + 标书投递截止 */}
                {tenderType !== 'SINGLE_SOURCE' && (
                <div className="grid grid-cols-2 gap-3 pt-1" style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.1)' }}>
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs text-[var(--muted-foreground)]">公告截止时间</span>
                      <div className="flex gap-1">
                        {[3, 5].map((n) => (
                          <button key={n} type="button" onClick={() => setAnnouncementEndDate(deadlineAfterDays(n))} className={`neu-btn-xs !h-[24px] !px-2 !text-[11px] ${announcementEndDate === deadlineAfterDays(n) ? 'is-info' : ''}`}>{n}天</button>
                        ))}
                      </div>
                    </div>
                    <input type="datetime-local" value={announcementEndDate} onChange={(e) => setAnnouncementEndDate(e.target.value)} className="workbench-input w-full text-sm" />
                  </div>
                  <div>
                    <div className="mb-1">
                      <span className="text-xs text-[var(--muted-foreground)]">标书投递截止（开标前24h）</span>
                    </div>
                    <input type="datetime-local" value={bidSubmissionDeadline} onChange={(e) => setBidSubmissionDeadline(e.target.value)} className="workbench-input w-full text-sm" />
                  </div>
                </div>
                )}
              </div>
                );
              })()}

              {/* Toggles */}
              {categoryConfig.showFullToggles ? (
                <>
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
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={notifyOnPublish}
                          onChange={(e) => setNotifyOnPublish(e.target.checked)}
                          className="accent-[var(--accent)]"
                        />
                        发布后发送通知
                      </label>
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

                  {/* 下载方式 —— 仅在引用采购文件时显示 */}
                  {tenderOn && (
                    <div className="rounded-[20px] p-4" style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 1px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.8)' }}>
                      <div className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">下载方式</div>
                      <div className="mt-2 space-y-2">
                        {([
                          { value: 'free', label: '免费下载', desc: '供应商可直接下载采购文件' },
                          { value: 'encrypted', label: '解密下载', desc: '供应商需输入密码才可下载' },
                          { value: 'paid', label: '付费下载', desc: '供应商需付费后下载（功能开发中，暂为占位）' },
                        ] as const).map((m) => (
                          <label key={m.value} className="flex items-start gap-2 text-sm cursor-pointer">
                            <input
                              type="radio"
                              name="downloadMode"
                              checked={downloadMode === m.value}
                              onChange={() => {
                                setDownloadMode(m.value);
                                if (m.value === 'encrypted' && !downloadPassword) {
                                  setDownloadPassword(String(Math.floor(100000 + Math.random() * 900000)));
                                }
                              }}
                              className="accent-[var(--accent)] mt-0.5"
                            />
                            <div>
                              <div className="font-semibold text-[var(--foreground)]">{m.label}</div>
                              <div className="text-[10px] text-[var(--muted-foreground)]">{m.desc}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                      {downloadMode === 'encrypted' && (
                        <div className="mt-3 rounded-lg px-3 py-2 flex items-center gap-2" style={{ background: 'color-mix(in oklch, var(--accent-soft) 15%, transparent)' }}>
                          <span className="text-[11px] font-bold text-[var(--foreground)]">下载密码：</span>
                          <code className="text-[11px] font-mono tabular-nums tracking-[0.15em] text-[var(--accent-strong)]">{downloadPassword}</code>
                          <button type="button" onClick={() => setDownloadPassword(String(Math.floor(100000 + Math.random() * 900000)))} className="neu-btn-xs ml-auto">刷新</button>
                        </div>
                      )}
                      {downloadMode === 'paid' && (
                        <div className="mt-3">
                          <input
                            type="number"
                            value={paidAmount}
                            onChange={(e) => setPaidAmount(e.target.value)}
                            placeholder="请输入售价（元）"
                            className="workbench-input w-full text-sm"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
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
                  </div>
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
                <button onClick={() => { setStep(1); if (project && draft) saveWizardState(project.id, { step: 1 }); }} type="button" className="neu-btn-soft !h-[34px]">
                  <ChevronLeft size={14} /> 上一步
                </button>
                <button
                  onClick={handlePublish}
                  disabled={busy}
                  className="neu-btn-primary !h-[34px] disabled:opacity-50"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {busy ? '处理中...' : publishTiming === 'now' ? '立即发布' : publishTiming === 'announcement_start' ? '保存（公示期起发送）' : '保存定时发布'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 供应商选择弹窗 */}
      {showSupplierPicker && (
        <div className="fixed inset-0 z-[600] flex items-center justify-center">
          <div
            className="absolute inset-0"
            style={{ background: 'oklch(0.1 0.02 258 / 0.42)', backdropFilter: 'blur(4px)' }}
            onClick={() => setShowSupplierPicker(false)}
          />
          <div
            className="relative z-10 flex max-h-[80vh] w-full max-w-[520px] flex-col overflow-hidden rounded-[24px]"
            style={{
              background: 'linear-gradient(170deg, oklch(1 0 0 / 0.97), oklch(0.99 0.003 258 / 0.72))',
              boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.9), 4px 5px 18px oklch(0.45 0.07 258 / 0.2), -2px -2px 8px oklch(1 0 0 / 0.9)',
            }}
          >
            {/* 标题 */}
            <div className="flex shrink-0 items-center justify-between gap-3 px-6 py-4" style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.14)' }}>
              <div className="text-[0.92rem] font-semibold text-[var(--foreground)]">选择可见供应商</div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold tabular-nums text-[var(--accent)]">已选 {restrictedSupplierIds.length}</span>
                <button type="button" onClick={() => setShowSupplierPicker(false)} className="neu-btn-xs"><X size={16} /></button>
              </div>
            </div>

            {/* 搜索 + 列表 */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 space-y-2">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
                <input
                  value={supplierSearch}
                  onChange={(e) => setSupplierSearch(e.target.value)}
                  placeholder="搜索供应商名称..."
                  className="workbench-input w-full !pl-9 text-sm"
                  autoFocus
                />
              </div>
              <div className="max-h-[420px] overflow-y-auto rounded-[12px] divide-y divide-[oklch(0.6_0.04_258_/_0.08)]"
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
                  <p className="px-3 py-6 text-xs text-[var(--muted-foreground)] text-center">
                    无匹配供应商
                  </p>
                )}
              </div>
            </div>

            {/* 底栏 */}
            <div className="flex shrink-0 items-center justify-end gap-3 px-6 py-3.5" style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.14)' }}>
              <button type="button" onClick={() => setShowSupplierPicker(false)} className="neu-btn-soft">取消</button>
              <button type="button" onClick={() => setShowSupplierPicker(false)} className="neu-btn-primary !h-[38px]">
                确定（{restrictedSupplierIds.length}）
              </button>
            </div>
          </div>
        </div>
      )}
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
