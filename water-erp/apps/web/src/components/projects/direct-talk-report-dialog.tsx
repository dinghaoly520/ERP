'use client';

/**
 * 直接采购商谈报告编写（2026-11-18，模板文件/直接采购评审报告模板.docx）
 *
 * 版式与公告编写（公告发布向导 Step 1 内嵌 announcement-dialog）一致：
 * - 左栏编辑区：头部填写进度条 + 「智能填入未填项」按钮；平铺字段行（border-b 分隔），
 *   内容类字段右上角带 收藏/样本库/AI 三按钮（TenderFieldActions，与公告编写同组件），
 *   商谈地点挂「地点」条目选择按钮（公司维护开标地点，公告编写 openingLocation 同款）；
 * - 右栏纸质文档实时预览：填写内容 text-blue-600 着色 + 空位占位符，
 *   双击可直接编辑（contentEditable，与公告编写 PreviewValue 同机制）。
 * 解锁：过了开标时间 10 分钟方可打开填写（父级入口按钮控制）。
 * 草稿持久化（2026-11-19）：编辑内容随写随存 localStorage（按项目+轮次），关闭重开恢复
 * 上次全部内容而非重新预填；生成上传成功后清空、下次打开重新预填。
 * 预填导入（2026-11-19）：商谈时间 ← 开标时间（openTimeIso）；商谈地点 ← 专家抽取
 * 步骤的开标地点（抽取会话快照 localStorage，见 readExtractedOpeningPlace）。
 * 产出：生成并上传「开标评标」步骤附件。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ScrollText, Sparkles, Upload } from 'lucide-react';
import { Modal } from '@/components/workbench';
import { TenderFieldActions } from '@/components/tender-write/tender-field-actions';
import { TenderFieldSampleDialog } from '@/components/tender-write/tender-field-sample-drawer';
import { CompanyEntryPickerDialog } from '@/components/tender-write/company-entry-picker-dialog';
import { createFieldSample, fetchFieldSamples, generateFieldContent } from '@/lib/api/tender-sample';
import type { TenderFieldKey } from '@/lib/types/tender-write';
import { buildDirectTalkReport, type DirectTalkReportDraft } from '@/lib/api/announcement';
import { polishInitiationField, uploadProjectStageAttachment } from '@/lib/api/project-management';
import type { ProjectManagementItem } from '@/lib/types/project-management';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectManagementItem;
  bidProjectId: string;
  openTimeIso: string | null;
  round?: number;
  /** 已确认回执供应商（预填优先源） */
  acceptedSupplier?: string;
  /** 专家名册（预填商谈小组） */
  expertMembers: string;
  onUploaded?: () => void;
};

const pad = (n: number) => String(n).padStart(2, '0');

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtCn(local: string): string {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return local;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日 ${m[4]}:${m[5]}`;
}
function fmtDateCn(local: string): string {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return local;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

/** 金额输入过滤（最终报价）：全角数字/小数点转半角后仅保留数字与小数点，小数点最多一位 */
function sanitizeAmount(v: string): string {
  const half = v.replace(/[０-９．]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  return half.replace(/[^\d.]/g, '').replace(/(\..*?)\./g, '$1');
}

/** 专家抽取步骤的开标地点（2026-11-19 用户裁定直接导入）：抽取向导「通知关键词」里的
 *  开标地点存于抽取会话快照 localStorage（expert-extract-session-{bidProjectId} →
 *  expertNotifyKeywords.openLocation，pid 即 BidProject.id）——与商谈时间导入开标时间同口径 */
function readExtractedOpeningPlace(bidProjectId: string): string {
  try {
    const raw = localStorage.getItem(`expert-extract-session-${bidProjectId}`);
    if (!raw) return '';
    const loc = JSON.parse(raw)?.expertNotifyKeywords?.openLocation;
    return typeof loc === 'string' ? loc.trim() : '';
  } catch {
    return '';
  }
}

/** 草稿持久化键（按项目+轮次）：关闭重开恢复上次编辑内容；生成上传成功后清空 */
function talkDraftStorageKey(projectId: string, round?: number): string {
  return `direct-talk-report-draft-${projectId}-${round ?? 1}`;
}
function loadTalkDraft(key: string): (DirectTalkReportDraft & { _coverDateLocal: string; _openTimeLocal: string }) | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as DirectTalkReportDraft & { _coverDateLocal: string; _openTimeLocal: string })
      : null;
  } catch {
    return null;
  }
}

function buildPrefill(props: Props): DirectTalkReportDraft & { _coverDateLocal: string; _openTimeLocal: string } {
  const now = new Date();
  const otLocal = toLocalInput(props.openTimeIso);
  return {
    purchaserName: props.project.companyName || props.project.requesterDepartment || '',
    coverDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    projectOverview: props.project.projectOverview || '',
    supplierName: props.acceptedSupplier || props.project.awardedSupplier || '',
    openingPlace: readExtractedOpeningPlace(props.bidProjectId),
    openingTime: otLocal ? fmtCn(otLocal) : '',
    expertMembers: props.expertMembers,
    supervisors: '',
    talkProcess: '',
    finalQuote: '',
    projectCode: props.project.projectCode ?? '',
    projectName: props.project.title ?? '',
    _coverDateLocal: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    _openTimeLocal: otLocal,
  };
}

/* ── AI 生成提示词（智能填入未填项仅填这两个内容类字段；人名/地点/价格/日期
      为事实类字段不 AI 生成——同公告编写「供应商名称禁止 AI」裁定精神） ── */
const AI_FIELD_PROMPTS: Record<string, string> = {
  projectOverview:
    '直接采购商谈报告「一、采购项目基本情况介绍」：依据项目名称、采购方式、预算金额等素材，客观介绍项目背景、内容与规模，150～300字，不得编造数据',
  talkProcess:
    '直接采购商谈报告「四、商谈过程」：依据项目与供应商信息起草商谈过程记录草稿——商询要点、供应商回应与达成的共识（含报价沟通），体现商谈现场气氛与双方情绪态度，行文逻辑流畅，全文不超过 600 字，供人工核对修改',
};
const FIELD_LABELS: Record<string, string> = {
  purchaserName: '采购人名称',
  supplierName: '供应商名称',
  expertMembers: '商谈小组成员',
  openingPlace: '商谈地点',
  supervisors: '监督人员',
  finalQuote: '最终报价（万元）',
  projectOverview: '项目概况',
  talkProcess: '商谈过程',
};
/** 右上角带 收藏/样本库/AI 按钮的字段（supervisors 在 FIELDS_WITHOUT_AI 中仅显收藏/样本库；
    事实类字段不挂：公司名/名册人名/日期/价格；商谈地点挂「地点」条目选择按钮——公告编写同款） */
const ACTION_FIELD_KEYS = ['supplierName', 'supervisors', 'projectOverview', 'talkProcess'];

/** 多行文本预览排版（公告编写同款：编号/序号前断行） */
function formatMultilineText(text: string): string {
  if (!text || !text.trim()) return text;
  let result = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  result = result.replace(/(\(\d+\))/g, '\n$1');
  result = result.replace(/(\d+\.\s)/g, '\n$1');
  result = result.replace(/([①②③④⑤⑥⑦⑧⑨⑩]+)/g, '\n  $1');
  result = result.replace(/^\n/, '');
  result = result.replace(/\n+/g, '\n');
  return result.trim();
}

/**
 * 预览可编辑值（公告编写 PreviewValue 同机制）：填写内容 text-blue-600 着色、
 * 空位显示占位符（tender-preview-placeholder）；contentEditable + IME 组合输入保护，
 * blur 回写草稿；编辑中冻结外部值防止光标跳动。
 */
function PreviewValue({
  value,
  placeholder,
  multiline = false,
  onValueChange,
}: {
  value: string;
  placeholder: string;
  multiline?: boolean;
  onValueChange: (text: string) => void;
}) {
  const isEmpty = typeof value !== 'string' || !value.trim();
  const elementRef = useRef<HTMLSpanElement | null>(null);
  const isComposingRef = useRef(false);
  const isFocusedRef = useRef(false);
  const [frozen, setFrozen] = useState<string | null>(null);

  const displayValue = multiline ? formatMultilineText(value) : value;
  const shouldRenderChildren = !isEmpty || frozen !== null;

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    if (isFocusedRef.current) return;
    const nextText = isEmpty ? '' : displayValue;
    if (element.textContent !== nextText) {
      element.innerHTML = '';
      if (!nextText) return;
      for (const part of nextText.split('\n')) {
        element.appendChild(document.createTextNode(part));
        element.appendChild(document.createElement('br'));
      }
      const lastChild = element.lastChild;
      if (lastChild?.nodeName === 'BR') {
        element.removeChild(lastChild);
      }
    }
  }, [isEmpty, displayValue]);

  const extractText = (el: HTMLElement): string => (el.innerText || '').replace(/\r\n/g, '\n');

  return (
    <span
      ref={elementRef}
      contentEditable
      suppressContentEditableWarning
      data-empty={isEmpty}
      data-placeholder={placeholder}
      onFocus={() => {
        isFocusedRef.current = true;
        setFrozen(value);
      }}
      onCompositionStart={() => {
        isComposingRef.current = true;
      }}
      onCompositionEnd={(e) => {
        isComposingRef.current = false;
        onValueChange(extractText(e.currentTarget));
      }}
      onInput={(e) => {
        if (!isComposingRef.current) {
          onValueChange(extractText(e.currentTarget));
        }
      }}
      onBlur={(e) => {
        isFocusedRef.current = false;
        const rawValue = extractText(e.currentTarget);
        setFrozen(null);
        onValueChange(rawValue);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && multiline) {
          e.preventDefault();
          const selection = window.getSelection();
          if (!selection || selection.rangeCount === 0) return;
          const range = selection.getRangeAt(0);
          range.deleteContents();
          const br = document.createElement('br');
          range.insertNode(br);
          range.setStartAfter(br);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }}
      className={`tender-preview-editable outline-none rounded-[4px] px-1 -mx-1 hover:bg-[rgba(96,139,239,0.08)] focus:bg-[rgba(96,139,239,0.12)] transition-colors cursor-text ${multiline ? 'whitespace-pre-wrap block' : ''} ${isEmpty && frozen === null ? 'tender-preview-placeholder min-w-[4rem] inline-block' : 'text-blue-600'}`}
    >
      {shouldRenderChildren ? (frozen !== null ? frozen : displayValue) : null}
    </span>
  );
}

export function DirectTalkReportDialog(props: Props) {
  const { isOpen, onClose, project, round, onUploaded } = props;
  /* 草稿初始化（2026-11-19 用户裁定）：优先恢复上次关闭时的编辑内容（localStorage 按项目+
     轮次存键，弹窗每次开关重新挂载、state 不跨开关存活）；无草稿才走预填导入 */
  const draftKey = talkDraftStorageKey(project.id, round);
  const [draft, setDraft] = useState(() => loadTalkDraft(draftKey) ?? buildPrefill(props));
  const [busy, setBusy] = useState(false);
  /* 字段级 AI 生成中状态（三按钮 Sparkles 脉冲）+ 收藏状态 + 批量填入 + 样本库抽屉 */
  const [generatingStates, setGeneratingStates] = useState<Record<string, boolean>>({});
  const [favoriteStates, setFavoriteStates] = useState<Record<string, boolean>>({});
  const [batchFilling, setBatchFilling] = useState(false);
  const [sampleDrawerState, setSampleDrawerState] = useState<{ isOpen: boolean; fieldKey: string; fieldLabel: string } | null>(null);
  /* 商谈地点=开标地点条目选择器（公告编写同款） */
  const [placePickerOpen, setPlacePickerOpen] = useState(false);

  /* 草稿随编辑即时落盘：挂载期每次变更即写 localStorage，关闭后内容已在盘，重开即恢复 */
  useEffect(() => {
    if (!isOpen) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch { /* 存储满/隐私模式：不阻断编辑 */ }
  }, [draftKey, draft, isOpen]);

  /* 收藏态回填（打开时查样本库已收藏项——星标按服务端真实状态点亮） */
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    for (const k of ACTION_FIELD_KEYS) {
      fetchFieldSamples(k, true)
        .then((list) => {
          if (!cancelled && list.length > 0) setFavoriteStates((prev) => ({ ...prev, [k]: true }));
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const setField = (key: string, value: string) => setDraft(prev => ({ ...prev, [key]: value }));

  /** AI 上下文（公告编写同款口径）：已填字段按标签名 + [项目] 前缀项目素材 */
  const buildAiContext = (excludeKey: string): Record<string, string> => {
    const context: Record<string, string> = {};
    for (const [key, val] of Object.entries(draft)) {
      if (key.startsWith('_')) continue;
      if (typeof val === 'string' && val.trim() && key !== excludeKey) {
        context[FIELD_LABELS[key] ?? key] = val;
      }
    }
    const pmEntries: Array<[string, string]> = [
      ['项目名称', project.title ?? ''],
      ['采购方式', project.procurementMethod ?? ''],
      ['项目概况', project.projectOverview ?? ''],
      ['预算金额', project.budgetAmount != null ? String(project.budgetAmount) : ''],
    ];
    for (const [k, v] of pmEntries) {
      if (v.trim()) context[`[项目]${k}`] = v;
    }
    return context;
  };

  /**
   * 字段 AI 生成/优化（公告编写同款单入口：空值=AI 生成、有值=AI 优化）。
   * projectOverview/talkProcess 有值时走立项润色轨（后端专用提示词），
   * 其余/空值走通用 /ai/tender-field-generate（fieldKey 自由串、供应商名后端纵深拦截）。
   */
  const handleAiGenerate = async (fieldKey: string, fieldLabel: string, currentValue: string) => {
    setGeneratingStates(prev => ({ ...prev, [fieldKey]: true }));
    try {
      let content: string;
      if (currentValue.trim() && (fieldKey === 'projectOverview' || fieldKey === 'talkProcess')) {
        const { polished } = await polishInitiationField({
          field: fieldKey,
          text: currentValue,
          projectContext: { title: project.title, method: project.procurementMethod },
        });
        content = polished;
      } else {
        const result = await generateFieldContent({
          fieldKey,
          fieldLabel,
          currentValue,
          aiPrompt: AI_FIELD_PROMPTS[fieldKey],
          context: buildAiContext(fieldKey),
        });
        content = result.content;
      }
      if (!content?.trim()) throw new Error('AI 返回的内容为空');
      // 清理 token 截断乱码（公告编写同款清理链）
      const cleaned = content
        .replace(/�/g, '')
        .replace(/\?{2,}(?=\s|$|。|，|；)/g, '')
        .replace(/\s+$/, '');
      setField(fieldKey, cleaned);
      // AI 产物入样本库（公告编写同款 sourceType=ai_generated，样本库可复用）
      void createFieldSample({
        fieldKey: fieldKey as TenderFieldKey,
        content: cleaned,
        sourceType: 'ai_generated',
        context: { generatedAt: new Date().toISOString(), prompt: AI_FIELD_PROMPTS[fieldKey] },
      }).catch(() => {});
      toast.success(currentValue.trim() ? 'AI 优化完成' : 'AI 生成完成');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'AI 生成失败，请稍后重试');
    } finally {
      setGeneratingStates(prev => ({ ...prev, [fieldKey]: false }));
    }
  };

  /** 收藏/取消收藏（公告编写同款：收藏=存样本 isFavorite；取消=仅本地灭星） */
  const handleFavoriteToggle = async (fieldKey: string, currentValue: string) => {
    if (!currentValue.trim()) return;
    if (favoriteStates[fieldKey]) {
      setFavoriteStates(prev => ({ ...prev, [fieldKey]: false }));
      return;
    }
    try {
      await createFieldSample({
        fieldKey: fieldKey as TenderFieldKey,
        content: currentValue,
        isFavorite: true,
        sourceType: 'manual',
      });
      setFavoriteStates(prev => ({ ...prev, [fieldKey]: true }));
    } catch (e) {
      console.error('Failed to toggle favorite:', e);
    }
  };

  /** 智能填入未填项（公告编写同款）：预填已覆盖事实类字段，此处对空的内容类字段逐项 AI 生成 */
  const handleAutoFillAll = async () => {
    const aiFields = Object.keys(AI_FIELD_PROMPTS).filter(k => !String(draft[k as keyof typeof draft] ?? '').trim());
    if (aiFields.length === 0) {
      toast.info('所有字段均已填写');
      return;
    }
    setBatchFilling(true);
    for (const k of aiFields) {
      await handleAiGenerate(k, FIELD_LABELS[k] ?? k, '');
      await new Promise(r => setTimeout(r, 200));
    }
    setBatchFilling(false);
    toast.success(`AI 已生成 ${aiFields.length} 项内容`);
  };

  const requiredMissing = !draft.supplierName?.trim() || !draft.talkProcess?.trim() || !draft.finalQuote?.trim();

  const buildFile = async () => {
    const payload: DirectTalkReportDraft = {
      ...draft,
      coverDate: draft._coverDateLocal || draft.coverDate,
      openingTime: draft._openTimeLocal ? fmtCn(draft._openTimeLocal) : draft.openingTime,
    };
    const { blob, fileName } = await buildDirectTalkReport(payload);
    const file = new File([blob], fileName, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    return { file, fileName };
  };

  /** 生成并上传「开标评标」步骤附件（备案表同款链路） */
  const handleUpload = async () => {
    setBusy(true);
    try {
      const { file } = await buildFile();
      await uploadProjectStageAttachment(project.id, 'BID_EVALUATION', file, round);
      /* 上传成功=草稿使命完成：清空持久化，重开走全新预填 */
      try { localStorage.removeItem(draftKey); } catch { /* 忽略 */ }
      toast.success('商谈报告已生成并上传至「开标评标」步骤');
      onUploaded?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '上传失败');
    } finally {
      setBusy(false);
    }
  };

  /* ── 编辑区（公告编写同款）：填写进度 + 平铺字段行 + 字段三按钮。
     字段行用普通渲染函数而非内部组件——内部组件随父渲染重挂载，输入即失焦。 ── */
  const inputCls =
    'mt-2 w-full rounded-[18px] border border-[oklch(0.6_0.04_258_/_0.25)] bg-[oklch(1_0_0_/_0.5)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition-all duration-200 focus:border-[rgba(107,149,240,0.34)] focus:bg-[oklch(1_0_0_/_0.7)] focus:shadow-[0_0_0_4px_rgba(113,152,242,0.08)] hover:border-[oklch(0.6_0.04_258_/_0.35)]';
  const rowCls = 'border-b border-[oklch(0.6_0.04_258_/_0.12)] py-3.5';
  const badgeCls = (hasValue: boolean) => [
    'rounded-[5px] px-2 py-0.5 text-[10px] font-semibold',
    hasValue
      ? 'bg-[color-mix(in_oklch,var(--success)_12%,transparent)] text-[var(--success)]'
      : 'bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] text-[var(--danger)]',
  ].join(' ');

  // textarea 自适应高度（公告编写同款：min 120px；AI 回填/预填重置亦随动）
  const overviewTaRef = useRef<HTMLTextAreaElement | null>(null);
  const processTaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    for (const el of [overviewTaRef.current, processTaRef.current]) {
      if (!el) continue;
      el.style.height = 'auto';
      el.style.height = `${Math.max(120, el.scrollHeight)}px`;
    }
  }, [draft.projectOverview, draft.talkProcess, isOpen]);

  // 填写进度（公告编写编辑区头部同款口径：可见字段计数 + 进度条）
  const progressFields = [
    draft.purchaserName, draft._coverDateLocal, draft.projectOverview,
    draft._openTimeLocal, draft.openingPlace, draft.supplierName,
    draft.expertMembers, draft.supervisors, draft.talkProcess, draft.finalQuote,
  ];
  const totalCount = progressFields.length;
  const filledCount = progressFields.filter(v => String(v ?? '').trim().length > 0).length;
  const remainingFields = totalCount - filledCount;
  const progressPercent = Math.round((filledCount / Math.max(totalCount, 1)) * 100);

  /** 字段右上角三按钮（公告编写 TenderFieldActions 同组件：收藏/样本库/AI） */
  const fieldActions = (k: string, label: string) => (
    <TenderFieldActions
      fieldKey={k as TenderFieldKey}
      currentValue={String(draft[k as keyof typeof draft] ?? '')}
      isFavorite={favoriteStates[k] ?? false}
      isGenerating={generatingStates[k] ?? false}
      onSampleOpen={() => setSampleDrawerState({ isOpen: true, fieldKey: k, fieldLabel: label })}
      onFavoriteToggle={() => void handleFavoriteToggle(k, String(draft[k as keyof typeof draft] ?? ''))}
      onAiGenerate={() => void handleAiGenerate(k, label, String(draft[k as keyof typeof draft] ?? ''))}
    />
  );

  /** 商谈地点=「商谈地点」条目选择按钮（公告编写 openingLocation 同款：无三按钮，仅条目选择）。
      fieldKey 借用 'openingLocation' 以命中 TenderFieldActions 内置的事实类豁免（隐藏收藏/样本库/AI） */
  const placeActions = (
    <TenderFieldActions
      fieldKey={'openingLocation' as TenderFieldKey}
      currentValue={String(draft.openingPlace ?? '')}
      isFavorite={false}
      isGenerating={false}
      isPlaceField
      placeLabel="商谈地点"
      onPlaceOpen={() => setPlacePickerOpen(true)}
      onSampleOpen={() => {}}
      onFavoriteToggle={() => {}}
      onAiGenerate={() => {}}
    />
  );

  /** 短字段行（公告编写同款：label + 字段操作节点 + 已填写/待补充徽章 + 输入；sanitize=输入过滤） */
  const renderField = (k: string, label: string, type = 'text', placeholder?: string, actions?: React.ReactNode, sanitize?: (v: string) => string) => {
    const value = String(draft[k as keyof typeof draft] ?? '');
    const hasValue = value.trim().length > 0;
    return (
      <div className={rowCls}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-[color:var(--foreground)]">{label}</span>
          <div className="flex items-center gap-2">
            {actions}
            <span className={badgeCls(hasValue)}>{hasValue ? '已填写' : '待补充'}</span>
          </div>
        </div>
        <input
          type={type}
          inputMode={sanitize ? 'decimal' : undefined}
          value={value}
          onChange={(e) => setField(k, sanitize ? sanitize(e.target.value) : e.target.value)}
          placeholder={placeholder ?? `请输入${label}`}
          className={inputCls}
        />
      </div>
    );
  };

  /** 长文本行：三按钮 + 徽章 + 自适应高度 textarea */
  const renderLongField = (k: 'projectOverview' | 'talkProcess', label: string, placeholder: string, taRef: React.RefObject<HTMLTextAreaElement | null>) => {
    const value = String(draft[k] ?? '');
    const hasValue = value.trim().length > 0;
    return (
      <div className={rowCls}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-[color:var(--foreground)]">{label}</span>
          <div className="flex items-center gap-2">
            {fieldActions(k, label)}
            <span className={badgeCls(hasValue)}>{hasValue ? '已填写' : '待补充'}</span>
          </div>
        </div>
        <textarea ref={taRef} value={value} onChange={(e) => setField(k, e.target.value)} placeholder={placeholder} className={`${inputCls} resize-none overflow-hidden`} />
      </div>
    );
  };

  /** 预览值（可编辑着色，公告编写同款；sanitize=回写过滤，如最终报价仅数字） */
  const PV = (value: string | undefined | null, placeholder: string, fieldKey: string, multiline = false, sanitize?: (v: string) => string) => (
    <PreviewValue value={value ?? ''} placeholder={placeholder} multiline={multiline} onValueChange={(text) => setField(fieldKey, sanitize ? sanitize(text) : text)} />
  );

  return (
    <>
      <Modal
        open={isOpen}
        onClose={() => { if (!busy) onClose(); }}
        icon={<ScrollText size={14} strokeWidth={1.9} />}
        title="直接采购商谈报告 · 编写"
        description="开标后填写商谈情况——生成并上传「开标评标」步骤附件"
        size="lg"
        className="!max-w-[min(1320px,95vw)]"
        footer={
          <>
            <button type="button" onClick={() => onClose()} disabled={busy} className="neu-btn-soft">取消</button>
            <button
              type="button"
              onClick={() => void handleUpload()}
              disabled={busy || requiredMissing}
              title={requiredMissing ? '请先填写供应商名称、商谈过程与最终报价' : undefined}
              className="tender-btn tender-btn--export disabled:cursor-not-allowed"
            >
              <span className="tb-icon tb-anim-bob">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              </span>
              {busy ? '生成中...' : '生成并上传'}
            </button>
          </>
        }
      >
        <div className="flex flex-row gap-4">
          {/* 左：编辑区（公告编写同款——头部填写进度 + 智能填入 + 平铺字段行） */}
          <section className="flex min-h-0 flex-1 flex-col rounded-[20px] wb-panel">
            <div className="shrink-0 border-b border-[oklch(0.6_0.04_258_/_0.16)] px-5 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-[.16em] text-[color-mix(in_oklch,var(--accent)_50%,transparent)]">编辑区</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
                    <span className="tabular-nums">{filledCount}/{totalCount} 项已填写</span>
                    {remainingFields > 0 && (
                      <span className="text-[10px]">还差 {remainingFields} 项即可完成报告填写</span>
                    )}
                  </div>
                  {/* 填写进度条（与公告编写编辑器头部样式一致） */}
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[oklch(0.55_0.03_258_/_0.1)]">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${progressPercent}%`,
                          background: progressPercent === 100
                            ? 'oklch(0.6 0.13 164)'
                            : 'linear-gradient(90deg, oklch(0.5 0.16 258 / 0.9), oklch(0.6 0.1 258 / 0.7))',
                        }}
                      />
                    </div>
                    <span className="text-[11px] font-semibold tabular-nums text-[color:var(--muted-foreground)]">
                      {progressPercent}%
                    </span>
                  </div>
                </div>
                {/* 智能填入未填项（公告编写同款按钮） */}
                <button
                  type="button"
                  onClick={() => void handleAutoFillAll()}
                  disabled={batchFilling}
                  className="group relative flex shrink-0 items-center gap-2 rounded-[10px] px-4 py-2 text-[12px] font-bold tracking-[-0.01em] transition-all duration-300 disabled:opacity-60"
                  style={{
                    background: batchFilling
                      ? 'linear-gradient(135deg, oklch(0.7 0.08 258), oklch(0.65 0.06 258))'
                      : 'linear-gradient(135deg, oklch(0.55 0.18 258), oklch(0.48 0.16 258))',
                    color: 'white',
                    boxShadow: batchFilling
                      ? 'inset 0 1px 0 oklch(1 0 0 / 0.3), 0 2px 8px oklch(0.4 0.1 258 / 0.25)'
                      : 'inset 0 1px 0 oklch(1 0 0 / 0.35), 2px 3px 8px oklch(0.42 0.14 258 / 0.3), -1px -1px 4px oklch(1 0 0 / 0.15)',
                  }}
                  title="AI 自动填充所有未填写的字段"
                >
                  {batchFilling ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Sparkles size={15} className="transition-transform duration-300 group-hover:scale-110 group-hover:rotate-12" />
                  )}
                  {batchFilling ? '填入中…' : '智能填入未填项'}
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5 tender-scroll">
              <div className="grid gap-3">
                {renderField('purchaserName', '采购人名称')}
                {renderField('_coverDateLocal', '封面时间', 'date')}
                {renderLongField('projectOverview', '项目概况', '一、采购项目基本情况介绍（可 AI 生成/优化）', overviewTaRef)}
                {renderField('_openTimeLocal', '商谈时间', 'datetime-local')}
                {renderField('openingPlace', '商谈地点', 'text', undefined, placeActions)}
                {renderField('supplierName', '供应商名称', 'text', undefined, fieldActions('supplierName', '供应商名称'))}
                {renderField('expertMembers', '商谈小组成员', 'text', '姓名（职称）、姓名（职称）…')}
                {renderField('supervisors', '监督人员', 'text', undefined, fieldActions('supervisors', '监督人员'))}
                {renderLongField('talkProcess', '商谈过程', '请详细描述商谈过程', processTaRef)}
                {renderField('finalQuote', '最终报价（万元）', 'text', undefined, undefined, sanitizeAmount)}
              </div>
            </div>
          </section>

          {/* 右：纸质文档实时预览（公告编写同款——填写内容蓝色着色、空位占位符、双击编辑） */}
          <aside className="flex min-h-0 flex-[1.1] flex-col overflow-hidden rounded-[24px] wb-panel">
            <div className="shrink-0 border-b border-[oklch(0.6_0.04_258_/_0.16)] px-5 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[.16em] text-[color-mix(in_oklch,var(--accent)_50%,transparent)]">预览区</div>
              <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">直接采购商谈报告 · 实时预览（支持双击编辑）</div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto tender-scroll">
              <div className="mx-4 my-3 rounded-[10px] bg-white px-8 py-8 text-[#18243a] shadow-sm" style={{ fontFamily: '"FangSong","仿宋","SimSun",serif' }}>
                <div className="text-center text-[15px] font-bold tracking-wide">{PV(draft.purchaserName, '采购人名称', 'purchaserName')}</div>
                <div className="mt-4 text-center text-[22px] font-bold tracking-[.3em]">直接采购</div>
                <div className="text-center text-[22px] font-bold tracking-[.3em]">商谈报告</div>
                <div className="mt-4 text-center text-[12px]">{PV(draft._coverDateLocal ? fmtDateCn(draft._coverDateLocal) : '', '封面时间', '_coverDateLocal')}</div>
                <div className="mt-2 text-center text-[11px] text-[#3a4658]">四川·成都</div>

                <div className="mt-6 text-[13px] font-bold">一、采购项目基本情况介绍</div>
                <p className="mt-1 text-[12px] leading-6">{PV(draft.projectOverview, '项目概况', 'projectOverview', true)}</p>

                <div className="mt-4 text-[13px] font-bold">二、供应商名称</div>
                <p className="mt-1 text-[12px] leading-6">{PV(draft.supplierName, '供应商名称', 'supplierName')}</p>

                <div className="mt-4 text-[13px] font-bold">三、商谈地点、时间以及商谈小组成员名单</div>
                <p className="mt-1 text-[12px] leading-6">（一）地点：{PV(draft.openingPlace, '商谈地点', 'openingPlace')}</p>
                <p className="text-[12px] leading-6">（二）时间：{PV(draft._openTimeLocal ? fmtCn(draft._openTimeLocal) : '', '商谈时间', '_openTimeLocal')}</p>
                <p className="mt-1 text-[12px] leading-6">（三）商谈小组成员：{PV(draft.expertMembers, '商谈小组成员', 'expertMembers')}</p>
                <p className="text-[12px] leading-6">　　监督人员：{PV(draft.supervisors, '监督人员', 'supervisors')}</p>

                <div className="mt-4 text-[13px] font-bold">四、商谈过程</div>
                <p className="mt-1 text-[12px] leading-6">{PV(draft.talkProcess, '商谈过程', 'talkProcess', true)}</p>

                <div className="mt-4 text-[13px] font-bold">五、商谈结果</div>
                <p className="mt-1 text-[12px] leading-6">（一）供应商名称：{PV(draft.supplierName, '供应商名称', 'supplierName')}</p>
                <p className="text-[12px] leading-6">（二）报价：{PV(draft.finalQuote, '最终报价', 'finalQuote', false, sanitizeAmount)} 万元</p>

                <div className="mt-8 flex justify-between text-[12px]">
                  <span>商谈小组签字：</span>
                  <span>监督人员签字：</span>
                </div>
              </div>
              <div className="mx-4 mb-3 flex items-start gap-2 rounded-[12px] px-4 py-3 text-[11px] leading-relaxed text-[color:var(--muted-foreground)]"
                style={{ background: 'color-mix(in oklch, var(--accent-soft) 18%, transparent)' }}>
                <ScrollText size={14} className="mt-0.5 shrink-0 text-[color:var(--accent)]" />
                <span>「生成并上传」将商谈报告落「开标评标」步骤附件。纸质报告须商谈小组与监督人员线下签字后归档。</span>
              </div>
            </div>
          </aside>
        </div>
      </Modal>

      {/* 字段样本库（公告编写同款：收藏/生成的内容沉淀，选中即回填字段） */}
      {sampleDrawerState && (
        <TenderFieldSampleDialog
          isOpen={sampleDrawerState.isOpen}
          fieldKey={sampleDrawerState.fieldKey as TenderFieldKey}
          fieldLabel={sampleDrawerState.fieldLabel}
          onSelect={(content) => {
            setField(sampleDrawerState.fieldKey, content);
            setSampleDrawerState(null);
          }}
          onClose={() => setSampleDrawerState(null)}
        />
      )}

      {/* 开标地点条目选择（公告编写同款）：公司信息管理维护的开标地点，选中回填商谈地点（选中后选择器自关） */}
      <CompanyEntryPickerDialog
        isOpen={placePickerOpen}
        kind="place"
        onSelectPlace={(address) => setField('openingPlace', address)}
        onClose={() => setPlacePickerOpen(false)}
      />
    </>
  );
}
