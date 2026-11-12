"use client";

import { useEffect, useRef, useState } from 'react';
import { X, Upload, FileText, CheckCircle, Loader2, Sparkles, ChevronDown, Info } from 'lucide-react';
import { toast } from 'sonner';
import { validateFileSize } from '@/lib/upload-rules';
import {
  createProjectManagementItem,
  extractInitiationFields,
  extractDemandFields,
  aiIdentifyField,
  compareFields,
  fetchProjectAttributions,
  polishInitiationField,
  type InitiationFields,
  type DemandFields,
  type ProjectAttribution,
} from '@/lib/api/project-management';
import { UploadProgressRow } from '../upload/upload-progress-row';
import {
  PROCUREMENT_METHODS,
  PROCUREMENT_CATEGORY_OPTIONS,
  type ProcurementMethod,
  type FieldCandidate,
  type FieldComparison,
} from '@/lib/types/project-management';
import { fetchCurrentUser, type AuthUser } from '@/lib/api/auth';
import { LoginErrorDialog } from '@/components/login/login-error-dialog';
import { SearchSelect } from '@/components/workbench/search-select';

type Step = 'upload' | 'compare' | 'review';

type Attachment = {
  fileName: string;
  objectKey: string;
  mimeType: string;
  fileSize: number;
  uploadedById?: string;
};

/** 多文件识别字段合并：先解析的文件优先，后续文件只补空白值（不覆盖已识别结果） */
function mergeFieldsFill<T extends Record<string, unknown>>(base: T, patch: T): T {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k];
    const curEmpty = cur == null || cur === '' || (typeof cur === 'number' && cur === 0);
    const has = v != null && v !== '' && !(typeof v === 'number' && v === 0);
    if (curEmpty && has) out[k] = v;
  }
  return out as T;
}

export function CreateProjectDialog({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (newItemId: string) => void;
}) {
  const [step, setStep] = useState<Step>('upload');
  const [submitting, setSubmitting] = useState(false);
  // Ref mirror of `submitting`：setState 异步，双击可在 disabled 生效前都过闸——第二次提交
  // 复用同一 objectKey 触发后端唯一约束，报出误导性的「登录失败 / 服务处理失败」错误。
  const submittingRef = useRef(false);
  const [extractingDemand, setExtractingDemand] = useState(false);
  const [extractingInitiation, setExtractingInitiation] = useState(false);
  const [upPct, setUpPct] = useState(0); // 上传字节进度（2026-11-06 上传进度条，解析按钮旁展示）
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

  // Demand document state（多文件，2026-11-11 用户裁定：需求/立项均可多选上传识别）
  const [demandFiles, setDemandFiles] = useState<File[]>([]);
  const [demandFields, setDemandFields] = useState<DemandFields>({});
  const [demandAttachments, setDemandAttachments] = useState<Attachment[]>([]);
  const [demandExtractedText, setDemandExtractedText] = useState<string>('');

  // Initiation document state
  const [initiationFiles, setInitiationFiles] = useState<File[]>([]);
  const [initiationFields, setInitiationFields] = useState({
    requesterName: '',
    requesterDepartment: '',
    procurementTitle: '',
    procurementCategory: '',
    // number | ''：清空态存 ''（Number('')===0 会把「清空重输」锁死成永删不掉的 0，2026-11-12）
    budgetAmount: 0 as number | '',
    projectReason: '',
    supplierRequirements: '',
    initiationDate: '',
    procurementOrganizationForm: '',
    isAnnualBudget: false,
  });
  const [initiationAttachments, setInitiationAttachments] = useState<Attachment[]>([]);
  const [initiationExtractedText, setInitiationExtractedText] = useState<string>('');

  // Procurement method
  const [procurementMethod, setProcurementMethod] = useState<string>('');

  // Field comparison
  const [fieldComparisons, setFieldComparisons] = useState<FieldComparison[]>([]);
  // 用户已编辑字段锁（2026-10-23 输入稳定性根治）：编辑过的字段恒以 initiationFields 为准
  //（含空串可清空），不被 selectedValue 空值守卫/demand 回退链弹回——同病第三落点
  //（e798639a 单修、363 行推广修均未断根），以「编辑权归用户」收口全部评审字段。
  const [editedFields, setEditedFields] = useState<Set<string>>(new Set());
  const [aiCandidates, setAiCandidates] = useState<Record<string, FieldCandidate[]>>({});
  const [aiLoading, setAiLoading] = useState<string | null>(null);

  // Track what has been extracted
  const [demandExtracted, setDemandExtracted] = useState(false);
  const [initiationExtracted, setInitiationExtracted] = useState(false);


  // AI polish for 立项事由 / 供方要求
  const [polishing, setPolishing] = useState<{ projectReason: boolean; supplierRequirements: boolean }>({
    projectReason: false,
    supplierRequirements: false,
  });

  // Project attribution（2026-10-14 起选择走 SearchSelect，面板内搜索，无本地过滤态）
  const [projectAttributions, setProjectAttributions] = useState<ProjectAttribution[]>([]);

  // Auto-proceed to compare step when documents are extracted
  useEffect(() => {
    if (!isOpen) return;
    
    if (step === 'upload') {
      const hasDemand = demandExtracted && demandAttachments.length > 0;
      const hasInitiation = initiationExtracted && initiationAttachments.length > 0;

      // If both are extracted, or only initiation is extracted (no demand file), go to compare
      if ((hasDemand && hasInitiation) || (hasInitiation && demandFiles.length === 0)) {
        // budgetAmount 清空态（''）对比较环节=未填写，归一为 undefined（compareFields 契约是 number）
        const comparisons = compareFields(
          demandFields,
          { ...initiationFields, budgetAmount: initiationFields.budgetAmount === '' ? undefined : initiationFields.budgetAmount },
        );
        setFieldComparisons(comparisons);
        // 新一轮对比生成 = 新文档数据，编辑锁随 comparisons 一同重置
        setEditedFields(new Set());
        setStep('compare');
      }
      // If only demand is extracted and no initiation file selected, go to compare (single doc mode)
      else if (hasDemand && initiationFiles.length === 0) {
        const comparisons = compareFields(demandFields, {});
        setFieldComparisons(comparisons);
        // 新一轮对比生成 = 新文档数据，编辑锁随 comparisons 一同重置
        setEditedFields(new Set());
        setStep('compare');
      }
    }
  }, [isOpen, demandExtracted, initiationExtracted, demandAttachments, initiationAttachments, demandFiles, initiationFiles, step, demandFields, initiationFields]);

  useEffect(() => {
    if (isOpen) {
      fetchCurrentUser()
        .then(setCurrentUser)
        .catch(() => setCurrentUser(null));
    }
  }, [isOpen]);

  // Load project attributions when dialog opens
  useEffect(() => {
    if (isOpen) {
      fetchProjectAttributions()
        .then(setProjectAttributions)
        .catch(() => setProjectAttributions([]));
    }
  }, [isOpen]);


  if (!isOpen) {
    return null;
  }

  const resetState = () => {
    setStep('upload');
    setSubmitting(false);
    setExtractingDemand(false);
    setExtractingInitiation(false);
    setErrorMessage(null);
    setDemandFiles([]);
    setDemandFields({});
    setDemandAttachments([]);
    setDemandExtractedText('');
    setInitiationFiles([]);
    setInitiationFields({
      requesterName: '',
      requesterDepartment: '',
      procurementTitle: '',
      procurementCategory: '',
      budgetAmount: 0,
      projectReason: '',
      supplierRequirements: '',
      initiationDate: '',
      procurementOrganizationForm: '',
      isAnnualBudget: false,
    });
    setInitiationAttachments([]);
    setInitiationExtractedText('');
    setProcurementMethod('');
    setFieldComparisons([]);
    setEditedFields(new Set());
    setAiCandidates({});
    setAiLoading(null);
    setPolishing({ projectReason: false, supplierRequirements: false });
    setDemandExtracted(false);
    setProjectAttributions([]);
  };

  const getCurrentProjectFields = () => {
    const finalFields: Record<string, string | number> = {};

    for (const comparison of fieldComparisons) {
      if (comparison.selectedValue !== undefined && comparison.selectedValue !== '') {
        if (comparison.fieldName === 'budgetAmount') {
          finalFields[comparison.fieldName] = Number(comparison.selectedValue) || 0;
        } else {
          finalFields[comparison.fieldName] = comparison.selectedValue;
        }
      }
    }

    // 优先级：显式选择（finalFields）> 评审表单手填（initiationFields）> 文档解析（demandFields）。
    // 解析结果含空串键，若后展开会把评审表单的手填值覆盖为空（400 VALIDATION_ERROR）。
    return {
      ...demandFields,
      ...initiationFields,
      ...finalFields,
    };
  };


  const handleExtractDemand = async () => {
    if (demandFiles.length === 0) return;

    setUpPct(0);
    setExtractingDemand(true);
    setErrorMessage(null);

    try {
      let merged: DemandFields = {};
      const atts: Attachment[] = [];
      const texts: string[] = [];
      // 多文件逐份识别（2026-11-11）：字段合并=先解析优先、后续补空白；附件全量保留
      for (let i = 0; i < demandFiles.length; i++) {
        const result = await extractDemandFields(demandFiles[i], {
          onProgress: (l, t) => setUpPct(Math.round(((i + (t > 0 ? l / t : 0)) / demandFiles.length) * 100)),
        });
        merged = mergeFieldsFill(merged, result.fields as Record<string, unknown>) as DemandFields;
        atts.push(result.attachment);
        texts.push(result.extractedText);
      }
      setDemandFields(merged);
      setDemandAttachments(atts);
      setDemandExtractedText(texts.join('\n\n'));
      setDemandExtracted(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '需求文件解析失败，请稍后重试。');
    } finally {
      setExtractingDemand(false);
    }
  };

  const handleExtractInitiation = async () => {
    if (initiationFiles.length === 0) return;

    setUpPct(0);
    setExtractingInitiation(true);
    setErrorMessage(null);

    try {
      let merged: Record<string, unknown> = {};
      const atts: Attachment[] = [];
      const texts: string[] = [];
      for (let i = 0; i < initiationFiles.length; i++) {
        const result = await extractInitiationFields(initiationFiles[i], {
          onProgress: (l, t) => setUpPct(Math.round(((i + (t > 0 ? l / t : 0)) / initiationFiles.length) * 100)),
        });
        merged = mergeFieldsFill(merged, result.fields as unknown as Record<string, unknown>);
        atts.push(result.attachment);
        texts.push(result.extractedText);
      }
      setInitiationFields({
        requesterName: String(merged.requesterName ?? ''),
        requesterDepartment: String(merged.requesterDepartment ?? ''),
        procurementTitle: String(merged.procurementTitle ?? ''),
        procurementCategory: String(merged.procurementCategory ?? ''),
        budgetAmount: Number(merged.budgetAmount ?? 0) || 0,
        projectReason: String(merged.projectReason ?? ''),
        supplierRequirements: String(merged.supplierRequirements ?? ''),
        initiationDate: String(merged.initiationDate ?? ''),
        procurementOrganizationForm: String(merged.procurementOrganizationForm ?? ''),
        isAnnualBudget: Boolean(merged.isAnnualBudget ?? false),
      });
      setInitiationAttachments(atts);
      setInitiationExtractedText(texts.join('\n\n'));
      setInitiationExtracted(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '立项文件解析失败，请稍后重试。');
    } finally {
      setExtractingInitiation(false);
    }
  };

  const handleAiIdentify = async (fieldName: string, documentText: string) => {
    setAiLoading(fieldName);
    try {
      const candidates = await aiIdentifyField(fieldName, documentText, 3);
      setAiCandidates((prev) => ({ ...prev, [fieldName]: candidates }));
    } catch {
      setErrorMessage('AI 识别失败，请手动填写。');
    } finally {
      setAiLoading(null);
    }
  };

  /** 归属选中（SearchSelect onPick）：写 demandFields + 同步比较项
   *  （demandProject 有自动预选值，不同步则选中值被弹回——见 handleReviewFieldChange 注释）；
   *  选项带合同号时一并带入 */
  const handlePickAttribution = (name: string, contractNumber?: string) => {
    setDemandFields((prev) => ({
      ...prev,
      demandProject: name,
      demandContractNumber: contractNumber || prev.demandContractNumber,
    }));
    setFieldComparisons((prev) =>
      prev.map((c) => (c.fieldName === 'demandProject' ? { ...c, selectedValue: name } : c)),
    );
  };

  const canProceedFromUpload = () => {
    const hasDemand = demandExtracted && demandAttachments.length > 0;
    const hasInitiation = initiationExtracted && initiationAttachments.length > 0;
    return hasDemand || hasInitiation;
  };

  const isDualDocumentMode = () => {
    return demandExtracted && initiationExtracted;
  };

  /** Whether to show the demand column (需求表) */
  const showDemandColumn = () => demandExtracted && demandAttachments.length > 0;

  /** Whether to show the initiation column (立项表) */
  const showInitiationColumn = () => initiationExtracted && initiationAttachments.length > 0;

  const handleSelectComparisonValue = (fieldName: string, value: string) => {
    setFieldComparisons((prev) =>
      prev.map((c) =>
        c.fieldName === fieldName ? { ...c, selectedValue: value } : c,
      ),
    );
    // 项目归属双写（2026-10-23 用户实录：比对/AI 推荐选中后创建，归属丢失——
    // 提交读 demandFields.demandProject，仅写 selectedValue 不落库也不进归属库）
    if (fieldName === 'demandProject') {
      setDemandFields((prev) => ({ ...prev, demandProject: value }));
    }
  };

  /** 评审页字段编辑：同时写 initiationFields 与 compare 步 selectedValue。
   *  compareFields 对每字段自动预选 selectedValue（initiationValue || demandValue），
   *  而 getSelectedFieldValue 优先读它——onChange 只写 initiationFields 的话手填值会被旧
   *  预选值弹回（立项日期抽出非 ISO 串时日期框空白且无法选择；e798639a 曾为 budgetAmount
   *  单独修过同病，此处推广到全部评审字段与项目归属两条路径）。 */
  const handleReviewFieldChange = (fieldName: string, value: string) => {
    setInitiationFields((prev) => ({ ...prev, [fieldName]: value }));
    setFieldComparisons((prev) =>
      prev.map((c) => (c.fieldName === fieldName ? { ...c, selectedValue: value } : c)),
    );
    // 编辑权锁定：自此该字段显示/提交均以用户输入为准
    setEditedFields((prev) => { const n = new Set(prev); n.add(fieldName); return n; });
  };

  const handleCreate = async () => {
    if (submittingRef.current) return;
    // 前置校验（2026-10-14）：必填项空缺即时中文提示——不再等服务端 400 往返
    //（服务端 DTO 已有中文校验消息，双保险；解析失败/未解析的手填场景最常见的报错源）
    const precheck = getCurrentProjectFields();
    if (!String(precheck.requesterName ?? '').trim()) {
      setErrorMessage('请填写需求申请人。');
      return;
    }
    if (!String(precheck.requesterDepartment ?? '').trim()) {
      setErrorMessage('请填写需求部门。');
      return;
    }
    if (!procurementMethod) {
      setErrorMessage('请选择采购方式。');
      return;
    }
    if (!String(precheck.procurementTitle ?? '').trim()) {
      setErrorMessage('请填写采购事项名称。');
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const mergedFields = getCurrentProjectFields();

      const createdItem = await createProjectManagementItem({
        requesterName: mergedFields.requesterName || '',
        requesterDepartment: mergedFields.requesterDepartment || '',
        procurementTitle: mergedFields.procurementTitle || '',
        procurementMethod: procurementMethod as ProcurementMethod,
        procurementCategory: mergedFields.procurementCategory || '',
        procurementOrganizationForm: initiationFields.procurementOrganizationForm || '自行招标',
        budgetAmount: mergedFields.budgetAmount || 0,
        projectReason: mergedFields.projectReason || '',
        supplierRequirements: mergedFields.supplierRequirements || '',
        isAnnualBudget: initiationFields.isAnnualBudget || false,
        hasProcurementDemand: demandAttachments.length > 0,
        demandAttachments: demandAttachments.length > 0 ? demandAttachments : undefined,
        initiationAttachments: initiationAttachments.length > 0 ? initiationAttachments : undefined,
        demandProject: String(resolveFieldValue('demandProject', demandFields.demandProject || '')) || undefined,
        demandContractNumber: demandFields.demandContractNumber,
        initiationDate: mergedFields.initiationDate || undefined,
        createdById: currentUser?.id,
      });
      onCreated(createdItem.id);
      onClose();
      resetState();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '创建项目失败，请稍后重试。');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const renderProcurementMethodSelector = () => (
    <div className="space-y-3">
      <label className="text-sm font-semibold text-[color:var(--foreground)]">采购方式</label>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {PROCUREMENT_METHODS.map((method) => (
          <button
            key={method}
            type="button"
            onClick={() => setProcurementMethod(method)}
            className={[
              "neu-opt px-4 py-2.5 text-xs font-medium",
              procurementMethod === method
                ? "is-on"
                : "",
            ].join(" ")}
          >
            {method}
          </button>
        ))}
      </div>
    </div>
  );

  const renderFileUpload = (
    label: string,
    files: File[],
    onFilesChange: (files: File[]) => void,
    isExtracted: boolean,
    onClear?: () => void,
    showClearButton?: boolean,
  ) => {
    const inputId = `file-upload-${label.replace(/[\s、，,]/g, '-')}`;
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-semibold text-[color:var(--foreground)]">{label}</label>
          <div className="flex items-center gap-2">
            {showClearButton && files.length > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  onClear?.();
                }}
                className="neu-btn-xs"
                title="清除全部"
              >
                <X size={16} />
              </button>
            )}
            {isExtracted && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--success-soft)] text-xs font-medium text-[var(--success)]">
                <CheckCircle size={12} />
                已解析
              </span>
            )}
          </div>
        </div>
        <input
          type="file"
          accept="application/pdf"
          multiple
          onChange={(event) => {
            const picked = Array.from(event.target.files ?? []);
            // 附件统一限制（2026-10-19）：解析入口仅大小校验（PDF 解析业务约束保持）；
            // 超限文件跳过并提示，其余照常入列；重选同一文件也能再次触发
            const ok: File[] = [];
            for (const f of picked) {
              const sizeErr = validateFileSize(f);
              if (sizeErr) toast.error(`${f.name}：${sizeErr}`);
              else ok.push(f);
            }
            if (ok.length > 0) onFilesChange([...files, ...ok]);
            event.target.value = '';
          }}
          className="hidden"
          id={inputId}
        />
        <label
          htmlFor={inputId}
          className={`neu-drop group flex items-center justify-center gap-2.5 px-4 py-4 ${
            isExtracted ? 'is-done' : ''
          }`}
        >
          {isExtracted ? (
            <FileText size={20} className="text-[var(--success)]" />
          ) : (
            <Upload size={20} className="text-[var(--accent)]" />
          )}
          <span className={`text-sm ${isExtracted ? 'text-[var(--success)]' : 'text-[color:var(--muted-foreground)]'}`}>
            {files.length > 0 ? `已选 ${files.length} 个文件` : '点击选择 PDF 文件，可多选'}
          </span>
        </label>
        {/* 已选文件清单：解析前可逐个移除；解析后仅展示（移除需整体清除重选） */}
        {files.length > 0 && (
          <div className="space-y-1.5">
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-[10px] bg-[color-mix(in_oklch,var(--muted-foreground)_5%,transparent)] px-3 py-1.5">
                <FileText size={13} className="shrink-0 text-[var(--accent)]" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-[color:var(--foreground)]" title={f.name}>{f.name}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-[color:var(--muted-foreground)]">{(f.size / 1024).toFixed(0)}KB</span>
                {!isExtracted && (
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); onFilesChange(files.filter((_, idx) => idx !== i)); }}
                    className="shrink-0 text-[color:var(--muted-foreground)] transition-colors hover:text-[var(--danger)]"
                    title="移除该文件"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderFieldComparison = () => (
    <div className="space-y-5 pb-[1.7rem]">
      {renderProcurementMethodSelector()}
      <div className="wb-section-rule mt-3 mb-1" />
      <div className="text-sm text-[color:var(--muted-foreground)] mb-2">
        {isDualDocumentMode() ? '对比两份文档的字段信息，选择正确的值' : '确认提取的字段信息'}
      </div>
      {fieldComparisons.map((comparison) => (
          <div key={comparison.fieldName}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-[color:var(--foreground)]">{comparison.label}</span>
              {aiLoading === comparison.fieldName ? (
                <span className="neu-btn-xs pointer-events-none text-[var(--accent)]">
                  <Loader2 size={14} className="animate-spin" />
                </span>
              ) : (
                <button
                  type="button"
                  title="AI 识别"
                  onClick={() => { const text = demandExtractedText || initiationExtractedText; if (text) { void handleAiIdentify(comparison.fieldName, text); } else { setErrorMessage('请先上传并解析 PDF 文档，再使用 AI 识别功能。'); } }}
                  className="neu-btn-xs text-[var(--accent)]"
                >
                  <Sparkles size={14} />
                </button>
              )}
            </div>
            {comparison.fieldName === 'demandProject' ? (
              <div className="grid grid-cols-1 gap-3">
                <button
                  type="button"
                  onClick={() => handleSelectComparisonValue(comparison.fieldName, comparison.demandValue || '')}
                  className={[
                    "neu-opt p-2.5 text-left w-full block",
                    comparison.selectedValue === comparison.demandValue
                      ? "is-on"
                      : "",
                  ].join(" ")}
                >
                  <div className="text-[11px] font-medium text-[color:var(--muted-foreground)]">需求表</div>
                  <div className="text-sm mt-0.5 truncate font-medium text-[color:var(--foreground)]">{comparison.demandValue || '（空）'}</div>
                </button>
              </div>
            ) : comparison.fieldName === 'initiationDate' ? (
              <div className="grid grid-cols-1 gap-3">
                <button
                  type="button"
                  onClick={() => handleSelectComparisonValue(comparison.fieldName, comparison.initiationValue || '')}
                  className={[
                    "neu-opt p-2.5 text-left w-full block",
                    comparison.selectedValue === comparison.initiationValue
                      ? "is-on"
                      : "",
                  ].join(" ")}
                >
                  <div className="text-[11px] font-medium text-[color:var(--muted-foreground)]">立项表</div>
                  <div className="text-sm mt-0.5 truncate font-medium text-[color:var(--foreground)]">{comparison.initiationValue || '（空）'}</div>
                </button>
              </div>
            ) : comparison.fieldName === 'projectReason' || comparison.fieldName === 'supplierRequirements' ? (
              <div className={isDualDocumentMode() ? "grid grid-cols-2 gap-3" : "grid grid-cols-1 gap-3"}>
                {showDemandColumn() && (
                  <button
                    type="button"
                    onClick={() => handleSelectComparisonValue(comparison.fieldName, comparison.demandValue || '')}
                    className={[
                      "neu-opt p-2.5 text-left w-full block",
                      comparison.selectedValue === comparison.demandValue
                        ? "is-on"
                        : "",
                    ].join(" ")}
                  >
                    <div className="text-[11px] font-medium text-[color:var(--muted-foreground)]">需求表</div>
                    <div className="text-sm mt-0.5 whitespace-pre-wrap font-medium text-[color:var(--foreground)]">{comparison.demandValue || '（空）'}</div>
                  </button>
                )}
                {showInitiationColumn() && (
                  <button
                    type="button"
                    onClick={() => handleSelectComparisonValue(comparison.fieldName, comparison.initiationValue || '')}
                    className={[
                      "neu-opt p-2.5 text-left w-full block",
                      comparison.selectedValue === comparison.initiationValue
                        ? "is-on"
                        : "",
                    ].join(" ")}
                  >
                    <div className="text-[11px] font-medium text-[color:var(--muted-foreground)]">立项表</div>
                    <div className="text-sm mt-0.5 whitespace-pre-wrap font-medium text-[color:var(--foreground)]">{comparison.initiationValue || '（空）'}</div>
                  </button>
                )}
              </div>
            ) : (
              <div className={isDualDocumentMode() ? "grid grid-cols-2 gap-3" : "grid grid-cols-1 gap-3"}>
                {showDemandColumn() && (
                  <button
                    type="button"
                    onClick={() => handleSelectComparisonValue(comparison.fieldName, comparison.demandValue || '')}
                    className={[
                      "neu-opt p-2.5 text-left w-full block",
                      comparison.selectedValue === comparison.demandValue
                        ? "is-on"
                        : "",
                    ].join(" ")}
                  >
                    <div className="text-[11px] font-medium text-[color:var(--muted-foreground)]">需求表</div>
                    <div className="text-sm mt-0.5 truncate font-medium text-[color:var(--foreground)]">{comparison.demandValue || '（空）'}</div>
                  </button>
                )}
                {showInitiationColumn() && (
                  <button
                    type="button"
                    onClick={() => handleSelectComparisonValue(comparison.fieldName, comparison.initiationValue || '')}
                    className={[
                      "neu-opt p-2.5 text-left w-full block",
                      comparison.selectedValue === comparison.initiationValue
                        ? "is-on"
                        : "",
                    ].join(" ")}
                  >
                    <div className="text-[11px] font-medium text-[color:var(--muted-foreground)]">立项表</div>
                    <div className="text-sm mt-0.5 truncate font-medium text-[color:var(--foreground)]">{comparison.initiationValue || '（空）'}</div>
                  </button>
                )}
              </div>
            )}
            {aiCandidates[comparison.fieldName]?.length > 0 && (
              <div className="mt-2 pt-2 border-t border-[oklch(0.6_0.04_258_/_0.16)]">
                <div className="text-[11px] font-medium text-[color:var(--muted-foreground)] mb-1.5">AI 推荐</div>
                <div className="space-y-1.5">
                  {aiCandidates[comparison.fieldName].map((candidate, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectComparisonValue(comparison.fieldName, candidate.value)}
                      className={[
                        "neu-opt w-full p-2 text-left block",
                        comparison.selectedValue === candidate.value
                          ? "is-on"
                          : "",
                      ].join(" ")}
                    >
                      <span className="text-sm font-medium text-[color:var(--foreground)]">{candidate.value}</span>
                      <span className="ml-2 text-xs text-[color:var(--muted-foreground)]">({(candidate.confidence * 100).toFixed(0)}%)</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
    </div>
  );


  const getSelectedFieldValue = (fieldName: string, fallbackValue: string | number): string | number => {
    const comparison = fieldComparisons.find(c => c.fieldName === fieldName);
    if (comparison?.selectedValue !== undefined && comparison.selectedValue !== '') {
      return comparison.selectedValue;
    }
    return fallbackValue;
  };

  /** 评审字段取值（2026-10-23）：用户编辑过 → 恒显用户值（initiationFields，空串亦然）；
   *  未编辑 → 原预填语义（对比选中值 → 回退链）。显示/提交/AI 上下文统一走此口，所见即所提交。 */
  const resolveFieldValue = (fieldName: string, fallbackValue: string | number): string | number => {
    if (editedFields.has(fieldName)) {
      // 编辑锁字段集恒为文本/数字字段（isAnnualBudget 等布尔项不经此口），经 unknown 中转窄化
      return (initiationFields as unknown as Record<string, string | number | undefined>)[fieldName] ?? '';
    }
    return getSelectedFieldValue(fieldName, fallbackValue);
  };

  const handlePolishField = async (field: 'projectReason' | 'supplierRequirements') => {
    const currentValue = String(
      resolveFieldValue(field, initiationFields[field] || demandFields[field] || ''),
    ).trim();
    if (!currentValue) {
      setErrorMessage(`请先填写${field === 'projectReason' ? '立项事由' : '供方要求'}的初步内容，再进行 AI 优化。`);
      return;
    }
    setPolishing((prev) => ({ ...prev, [field]: true }));
    setErrorMessage(null);
    try {
      const { polished } = await polishInitiationField({
        field,
        text: currentValue,
        demandDocText: demandExtractedText || undefined,
        initiationDocText: initiationExtractedText || undefined,
        projectContext: {
          title: String(resolveFieldValue('procurementTitle', initiationFields.procurementTitle || '')) || undefined,
          category: String(resolveFieldValue('procurementCategory', initiationFields.procurementCategory || '')) || undefined,
          method: procurementMethod || undefined,
        },
      });
      setInitiationFields((prev) => ({ ...prev, [field]: polished }));
      // 同步覆盖 compare 步骤的 selectedValue，避免回看时被旧值覆盖
      setFieldComparisons((prev) =>
        prev.map((c) => (c.fieldName === field ? { ...c, selectedValue: polished } : c)),
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'AI 优化失败，请稍后重试。');
    } finally {
      setPolishing((prev) => ({ ...prev, [field]: false }));
    }
  };

  const renderReview = () => (
    <div className="space-y-5 pb-[1.7rem]">
      {/* 两表未传时预告（2026-11-09）：建项后这两阶段为「待补充」 */}
      {!demandFiles.length && !initiationFiles.length && (
        <div className="flex items-start gap-3 rounded-xl bg-[color-mix(in_oklch,var(--accent-soft)_30%,transparent)] px-4 py-3">
          <Info size={16} className="mt-0.5 shrink-0 text-[color:var(--accent)]" />
          <span className="text-xs leading-5 text-[color:var(--foreground)]">
            未上传采购需求表与采购立项申请表：创建后这两个阶段将显示为<b>待补充</b>，
            可随时在项目详情中补传文件并完成补录。
          </span>
        </div>
      )}
      <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-3">
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[color:var(--foreground)]">需求申请人</label>
          <input
            type="text"
            value={resolveFieldValue('requesterName', initiationFields.requesterName || demandFields.requesterName || '')}
            onChange={(e) => handleReviewFieldChange('requesterName', e.target.value)}
            className="workbench-input w-full"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[color:var(--foreground)]">需求部门</label>
          <input
            type="text"
            value={resolveFieldValue('requesterDepartment', initiationFields.requesterDepartment || demandFields.requesterDepartment || '')}
            onChange={(e) => handleReviewFieldChange('requesterDepartment', e.target.value)}
            className="workbench-input w-full"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[color:var(--foreground)]">立项日期</label>
          <input
            type="date"
            value={resolveFieldValue('initiationDate', initiationFields.initiationDate || demandFields.initiationDate || '')}
            onChange={(e) => handleReviewFieldChange('initiationDate', e.target.value)}
            className="workbench-input w-full"
          />
        </div>
        <div className="col-span-3 space-y-2">
          <label className="text-xs font-semibold text-[color:var(--foreground)]">采购事项名称</label>
          <input
            type="text"
            value={resolveFieldValue('procurementTitle', initiationFields.procurementTitle || demandFields.procurementTitle || '')}
            onChange={(e) => handleReviewFieldChange('procurementTitle', e.target.value)}
            className="workbench-input w-full"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[color:var(--foreground)]">采购类别</label>
          <select
            value={resolveFieldValue('procurementCategory', initiationFields.procurementCategory || demandFields.procurementCategory || '')}
            onChange={(e) => handleReviewFieldChange('procurementCategory', e.target.value)}
            className="workbench-input w-full"
          >
            <option value="">请选择采购类别</option>
            {PROCUREMENT_CATEGORY_OPTIONS.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[color:var(--foreground)]">采购方式</label>
          <select
            value={procurementMethod}
            onChange={(e) => setProcurementMethod(e.target.value)}
            className="workbench-input w-full"
          >
            <option value="">请选择采购方式</option>
            {PROCUREMENT_METHODS.map((method) => (
              <option key={method} value={method}>{method}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[color:var(--foreground)]">项目归属</label>
          {/* 归属选择：cgzxui SearchSelect 规范形态（瓷片渐变面板 + sticky 搜索 + 白瓷片激活；
              携带合同号 meta、使用次数 sub；允许自定义名（原自由输入能力保留）；「其他」兜底列尾 */}
          <SearchSelect
            options={[
              ...projectAttributions.map((a) => ({
                value: a.name,
                label: a.name,
                meta: a.contractNumber ?? undefined,
                sub: a.usageCount > 0 ? `已使用 ${a.usageCount} 次` : undefined,
              })),
              ...(projectAttributions.some((a) => a.name === '其他') ? [] : [{ value: '其他', label: '其他', sub: '通用' }]),
            ]}
            value={String(resolveFieldValue('demandProject', demandFields.demandProject || ''))}
            onPick={(o) => handlePickAttribution(o.value, o.meta)}
            placeholder="选择或搜索项目归属"
            searchPlaceholder="搜索归属项目…"
            emptyText="无匹配归属"
            allowCustom
          />
        </div>
        <div className="col-span-3 grid grid-cols-2 gap-x-5">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-[color:var(--foreground)]">预算金额（元）</label>
            <input
              type="number"
              value={resolveFieldValue('budgetAmount', initiationFields.budgetAmount || demandFields.budgetAmount || 0)}
              onChange={(e) => {
                const raw = e.target.value;
                // 空串原样保留：清空后回填 0 会立刻被 value 回显成 "0"，无法清空重输
                const v = raw === '' ? ('' as number | '') : Number(raw);
                setInitiationFields((prev) => ({ ...prev, budgetAmount: v }));
                // 同步覆盖 compare 步骤的 selectedValue，避免解析模式预置值（如 0）锁死手工修正
                setFieldComparisons((prev) =>
                  prev.map((c) => (c.fieldName === 'budgetAmount' ? { ...c, selectedValue: String(v) } : c)),
                );
                // 编辑权锁定（2026-10-23）：与 handleReviewFieldChange 同语义——此输入框绕过统一入口，单独补锁
                setEditedFields((prev) => (prev.has('budgetAmount') ? prev : new Set(prev).add('budgetAmount')));
              }}
              className="workbench-input w-full"
            />
          </div>
        </div>
        <div className="col-span-3 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-[color:var(--foreground)]">立项事由</label>
            <button
              type="button"
              onClick={() => handlePolishField('projectReason')}
              disabled={polishing.projectReason}
              className="neu-btn-xs"
            >
              {polishing.projectReason ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              AI 优化
            </button>
          </div>
          <textarea
            value={resolveFieldValue('projectReason', initiationFields.projectReason || demandFields.projectReason || '')}
            onChange={(e) => handleReviewFieldChange('projectReason', e.target.value)}
            rows={3}
            className="neu-input text-sm min-h-[80px] resize-y"
          />
        </div>
        <div className="col-span-3 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-[color:var(--foreground)]">供方要求</label>
            <button
              type="button"
              onClick={() => handlePolishField('supplierRequirements')}
              disabled={polishing.supplierRequirements}
              className="neu-btn-xs"
            >
              {polishing.supplierRequirements ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              AI 优化
            </button>
          </div>
          <textarea
            value={resolveFieldValue('supplierRequirements', initiationFields.supplierRequirements || demandFields.supplierRequirements || '')}
            onChange={(e) => handleReviewFieldChange('supplierRequirements', e.target.value)}
            rows={3}
            className="neu-input text-sm min-h-[80px] resize-y"
          />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-[color:var(--background)]/70 backdrop-blur-[6px]"
          onClick={() => { resetState(); onClose(); }}
        />
        <div className="neu-dialog relative flex max-h-[90vh] w-full max-w-[min(720px,92vw)] flex-col">

          <button
            type="button"
            onClick={() => { resetState(); onClose(); }}
            className="neu-btn-xs absolute right-4 top-4 z-[2]"
          >
            <X size={16} />
          </button>

          {/* Fixed Header */}
          <div className="flex-shrink-0 pr-[3.8rem]">
            <h2 className="text-[clamp(1.34rem,2.7vw,1.58rem)] font-semibold leading-tight tracking-[-0.05em] text-[color:var(--foreground)]">新建采购项目</h2>
          </div>

          <div className="wb-section-rule mt-4 flex-shrink-0" />

          {/* Scrollable Content Area */}
          <div className="flex-1 min-h-0 mt-5 px-[1.7rem] overflow-y-auto">
            {step === 'upload' && (
              <div className="space-y-6 pb-[1.7rem]">
                {renderFileUpload(
                  '需求或调研文件、需求审批文件',
                  demandFiles,
                  setDemandFiles,
                  demandExtracted,
                  () => {
                    setDemandFiles([]);
                    setDemandFields({});
                    setDemandAttachments([]);
                    setDemandExtractedText('');
                    setDemandExtracted(false);
                  },
                  true,
                )}
                <div className="wb-section-rule" />
                {renderFileUpload(
                  '立项证明文件',
                  initiationFiles,
                  setInitiationFiles,
                  initiationExtracted,
                  () => {
                    setInitiationFiles([]);
                    setInitiationFields({
                      requesterName: '',
                      requesterDepartment: '',
                      procurementTitle: '',
                      procurementCategory: '',
                      budgetAmount: 0,
                      projectReason: '',
                      supplierRequirements: '',
                      initiationDate: '',
                      procurementOrganizationForm: '',
                      isAnnualBudget: false,
                    });
                    setInitiationAttachments([]);
                    setInitiationExtractedText('');
                    setInitiationExtracted(false);
                  },
                  true,
                )}
              </div>
            )}
            {step === 'compare' && renderFieldComparison()}
            {step === 'review' && renderReview()}
          </div>

          {/* Fixed Footer */}
          <div className="flex-shrink-0 px-[1.7rem] py-4" style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
            {step === 'upload' && (
              <div className="flex justify-between">
                <button
                  type="button"
                  onClick={() => setStep('review')}
                  className="neu-btn-soft h-[38px]"
                >
                  跳过，手动填写
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (demandFiles.length > 0 && !demandExtracted) void handleExtractDemand();
                    if (initiationFiles.length > 0 && !initiationExtracted) void handleExtractInitiation();
                  }}
                  disabled={(demandFiles.length === 0 && initiationFiles.length === 0) || (demandExtracted && initiationExtracted) || extractingDemand || extractingInitiation}
                  className="neu-btn-primary !h-[38px]"
                >
                  {extractingDemand || extractingInitiation ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  {extractingDemand || extractingInitiation ? '解析中...' : '解析文档'}
                </button>
              </div>
            )}

            {/* 上传/解析进度（2026-11-06 上传进度条）：解析按钮在底部时也在其上方给出水波条 */}
            {(extractingDemand || extractingInitiation) && (
              <UploadProgressRow pct={upPct} className="mb-2" />
            )}

            {step === 'compare' && (
              <div className="flex justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setStep('upload');
                    setDemandExtracted(false);
                    setInitiationExtracted(false);
                    setFieldComparisons([]);
                    setEditedFields(new Set());
                  }}
                  className="neu-btn-soft h-[38px]"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                  返回
                </button>
                <button
                  type="button"
                  onClick={() => setStep('review')}
                  className="neu-btn-primary !h-[38px]"
                >
                  确认并继续
                </button>
              </div>
            )}

            {step === 'review' && (
              <div className="flex justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setStep('compare')}
                  className="neu-btn-soft h-[38px]"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                  返回
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={submitting}
                  className="neu-btn-primary !h-[38px]"
                >
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
                  {submitting ? '创建中...' : '创建项目'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <LoginErrorDialog
        title="操作失败" isOpen={Boolean(errorMessage)} message={errorMessage ?? ''} onClose={() => setErrorMessage(null)} />
    </>
  );
}
