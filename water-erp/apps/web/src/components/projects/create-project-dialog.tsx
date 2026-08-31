"use client";

import { useEffect, useRef, useState } from 'react';
import { X, Upload, FileText, CheckCircle, Loader2, Sparkles, ChevronDown } from 'lucide-react';
import {
  createProjectManagementItem,
  extractInitiationFields,
  extractDemandFields,
  aiIdentifyField,
  compareFields,
  analyzeBudgetReference,
  fetchProjectAttributions,
  polishInitiationField,
  type InitiationFields,
  type DemandFields,
  type BudgetReferenceResult,
  type ProjectAttribution,
} from '@/lib/api/project-management';
import {
  PROCUREMENT_METHODS,
  PROCUREMENT_CATEGORY_OPTIONS,
  type ProcurementMethod,
  type FieldCandidate,
  type FieldComparison,
} from '@/lib/types/project-management';
import { fetchCurrentUser, type AuthUser } from '@/lib/api/auth';
import { LoginErrorDialog } from '@/components/login/login-error-dialog';

type Step = 'upload' | 'compare' | 'review';

type Attachment = {
  fileName: string;
  objectKey: string;
  mimeType: string;
  fileSize: number;
  uploadedById?: string;
};

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
  // Ref mirror of `submitting` — setState is async, so two rapid clicks on the
  // "创建项目" button can both pass the `disabled={submitting}` guard before
  // React re-renders. The second submission reuses the same demand/initiation
  // objectKey and trips the backend's Attachment unique constraint → confusing
  // "登录失败 / 服务处理失败" error even though the first submission succeeded.
  const submittingRef = useRef(false);
  const [extractingDemand, setExtractingDemand] = useState(false);
  const [extractingInitiation, setExtractingInitiation] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

  // Demand document state
  const [demandFile, setDemandFile] = useState<File | null>(null);
  const [demandFields, setDemandFields] = useState<DemandFields>({});
  const [demandAttachment, setDemandAttachment] = useState<Attachment | null>(null);
  const [demandExtractedText, setDemandExtractedText] = useState<string>('');

  // Initiation document state
  const [initiationFile, setInitiationFile] = useState<File | null>(null);
  const [initiationFields, setInitiationFields] = useState({
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
  const [initiationAttachment, setInitiationAttachment] = useState<Attachment | null>(null);
  const [initiationExtractedText, setInitiationExtractedText] = useState<string>('');

  // Procurement method
  const [procurementMethod, setProcurementMethod] = useState<string>('');

  // Field comparison
  const [fieldComparisons, setFieldComparisons] = useState<FieldComparison[]>([]);
  const [aiCandidates, setAiCandidates] = useState<Record<string, FieldCandidate[]>>({});
  const [aiLoading, setAiLoading] = useState<string | null>(null);

  // Track what has been extracted
  const [demandExtracted, setDemandExtracted] = useState(false);
  const [initiationExtracted, setInitiationExtracted] = useState(false);

  // Budget reference analysis
  const [budgetReference, setBudgetReference] = useState<BudgetReferenceResult | null>(null);
  const [analyzingBudget, setAnalyzingBudget] = useState(false);
  const [showBudgetRationale, setShowBudgetRationale] = useState(false);

  // AI polish for 立项事由 / 供方要求
  const [polishing, setPolishing] = useState<{ projectReason: boolean; supplierRequirements: boolean }>({
    projectReason: false,
    supplierRequirements: false,
  });

  // Project attribution dropdown
  const [projectAttributions, setProjectAttributions] = useState<ProjectAttribution[]>([]);
  const [showAttributionDropdown, setShowAttributionDropdown] = useState(false);
  const [attributionSearch, setAttributionSearch] = useState('');

  // Auto-proceed to compare step when documents are extracted
  useEffect(() => {
    if (!isOpen) return;
    
    if (step === 'upload') {
      const hasDemand = demandExtracted && demandAttachment;
      const hasInitiation = initiationExtracted && initiationAttachment;

      // If both are extracted, or only initiation is extracted (no demand file), go to compare
      if ((hasDemand && hasInitiation) || (hasInitiation && !demandFile)) {
        const comparisons = compareFields(demandFields, initiationFields);
        setFieldComparisons(comparisons);
        setStep('compare');
      }
      // If only demand is extracted and no initiation file selected, go to compare (single doc mode)
      else if (hasDemand && !initiationFile) {
        const comparisons = compareFields(demandFields, {});
        setFieldComparisons(comparisons);
        setStep('compare');
      }
    }
  }, [isOpen, demandExtracted, initiationExtracted, demandAttachment, initiationAttachment, demandFile, initiationFile, step, demandFields, initiationFields]);

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

  // Budget rationale floats above the form — dismiss on outside click
  const budgetRationaleBarRef = useRef<HTMLDivElement>(null);
  const budgetRationalePanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showBudgetRationale) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (budgetRationalePanelRef.current?.contains(target)) return;
      if (budgetRationaleBarRef.current?.contains(target)) return; // summary bar toggles itself
      setShowBudgetRationale(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [showBudgetRationale]);

  if (!isOpen) {
    return null;
  }

  const resetState = () => {
    setStep('upload');
    setSubmitting(false);
    setExtractingDemand(false);
    setExtractingInitiation(false);
    setErrorMessage(null);
    setDemandFile(null);
    setDemandFields({});
    setDemandAttachment(null);
    setDemandExtractedText('');
    setInitiationFile(null);
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
    setInitiationAttachment(null);
    setInitiationExtractedText('');
    setProcurementMethod('');
    setFieldComparisons([]);
    setAiCandidates({});
    setAiLoading(null);
    setPolishing({ projectReason: false, supplierRequirements: false });
    setDemandExtracted(false);
    setInitiationExtracted(false);
    setBudgetReference(null);
    setAnalyzingBudget(false);
    setShowBudgetRationale(false);
    setProjectAttributions([]);
    setShowAttributionDropdown(false);
    setAttributionSearch('');
  };

  const getCurrentProjectFields = () => {
    const finalFields: Record<string, string | number> = {};

    for (const comparison of fieldComparisons) {
      if (comparison.selectedValue !== undefined) {
        if (comparison.fieldName === 'budgetAmount') {
          finalFields[comparison.fieldName] = Number(comparison.selectedValue) || 0;
        } else {
          finalFields[comparison.fieldName] = comparison.selectedValue;
        }
      }
    }

    return {
      ...initiationFields,
      ...demandFields,
      ...finalFields,
    };
  };

  const handleAnalyzeBudgetReference = async () => {
    const fields = getCurrentProjectFields();
    const title = String(fields.procurementTitle || '').trim();
    if (!title) return;

    setAnalyzingBudget(true);
    try {
      const result = await analyzeBudgetReference({
        procurementTitle: title,
        procurementCategory: String(fields.procurementCategory || ''),
        procurementType: String((fields as Record<string, unknown>).procurementType || ''),
        projectReason: String(fields.projectReason || ''),
        supplierRequirements: String(fields.supplierRequirements || ''),
        // 行项目/预算清单：当前新建对话框尚无结构化清单，留空由服务端用“标题=单行 qty=1”兜底；
        // 后续接入 BudgetList/抽取行项目时在此透传 lines / budgetListId 即可启用 Tier 1 单价×数量。
      });
      setBudgetReference(result);
    } catch {
      // Silently fail - budget reference is optional
    } finally {
      setAnalyzingBudget(false);
    }
  };

  const handleExtractDemand = async () => {
    if (!demandFile) return;

    setExtractingDemand(true);
    setErrorMessage(null);

    try {
      const result = await extractDemandFields(demandFile);
      setDemandFields(result.fields);
      setDemandAttachment(result.attachment);
      setDemandExtractedText(result.extractedText);
      setDemandExtracted(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '需求表解析失败，请稍后重试。');
    } finally {
      setExtractingDemand(false);
    }
  };

  const handleExtractInitiation = async () => {
    if (!initiationFile) return;

    setExtractingInitiation(true);
    setErrorMessage(null);

    try {
      const result = await extractInitiationFields(initiationFile);
      setInitiationFields({
        requesterName: result.fields.requesterName || '',
        requesterDepartment: result.fields.requesterDepartment || '',
        procurementTitle: result.fields.procurementTitle || '',
        procurementCategory: result.fields.procurementCategory || '',
        budgetAmount: result.fields.budgetAmount || 0,
        projectReason: result.fields.projectReason || '',
        supplierRequirements: result.fields.supplierRequirements || '',
        initiationDate: result.fields.initiationDate || '',
        procurementOrganizationForm: result.fields.procurementOrganizationForm || '',
        isAnnualBudget: result.fields.isAnnualBudget || false,
      });
      setInitiationAttachment(result.attachment);
      setInitiationExtractedText(result.extractedText);
      setInitiationExtracted(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '立项表解析失败，请稍后重试。');
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

  const filteredAttributions = projectAttributions.filter((attr) =>
    attr.name.toLowerCase().includes(attributionSearch.toLowerCase()),
  );

  const handleSelectAttribution = (attr: ProjectAttribution) => {
    setDemandFields((prev) => ({
      ...prev,
      demandProject: attr.name,
      demandContractNumber: attr.contractNumber || prev.demandContractNumber,
    }));
    setAttributionSearch(attr.name);
    setShowAttributionDropdown(false);
  };

  const handleAttributionInputChange = (value: string) => {
    setDemandFields((prev) => ({ ...prev, demandProject: value }));
    setAttributionSearch(value);
    setShowAttributionDropdown(true);
  };

  const canProceedFromUpload = () => {
    const hasDemand = demandExtracted && demandAttachment;
    const hasInitiation = initiationExtracted && initiationAttachment;
    return hasDemand || hasInitiation;
  };

  const isDualDocumentMode = () => {
    return demandExtracted && initiationExtracted;
  };

  /** Whether to show the demand column (需求表) */
  const showDemandColumn = () => demandExtracted && !!demandAttachment;

  /** Whether to show the initiation column (立项表) */
  const showInitiationColumn = () => initiationExtracted && !!initiationAttachment;

  const handleSelectComparisonValue = (fieldName: string, value: string) => {
    setFieldComparisons((prev) =>
      prev.map((c) =>
        c.fieldName === fieldName ? { ...c, selectedValue: value } : c,
      ),
    );
  };

  const handleCreate = async () => {
    if (submittingRef.current) return;
    if (!procurementMethod) {
      setErrorMessage('请选择采购方式。');
      return;
    }

    if (!initiationAttachment && !demandAttachment && !initiationFields.procurementTitle) {
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
        hasProcurementDemand: !!demandAttachment,
        demandAttachment: demandAttachment ?? undefined,
        initiationAttachment: initiationAttachment ?? undefined,
        demandProject: demandFields.demandProject,
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
    file: File | null,
    onFileChange: (file: File | null) => void,
    isExtracted: boolean,
    onClear?: () => void,
    showClearButton?: boolean,
  ) => (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold text-[color:var(--foreground)]">{label}</label>
        <div className="flex items-center gap-2">
          {showClearButton && file && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                onClear?.();
              }}
              className="neu-btn-xs"
              title="清除"
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
        onChange={(event) => {
          onFileChange(event.target.files?.[0] ?? null);
        }}
        className="hidden"
        id={`file-upload-${label.replace(/\s/g, '-')}`}
      />
      <label
        htmlFor={`file-upload-${label.replace(/\s/g, '-')}`}
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
          {file ? file.name : '点击选择 PDF 文件'}
        </span>
        {file && !isExtracted && (
          <span className="text-xs text-[color:var(--muted-foreground)]">{(file.size / 1024).toFixed(0)}KB</span>
        )}
      </label>
    </div>
  );

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

  const handlePolishField = async (field: 'projectReason' | 'supplierRequirements') => {
    const currentValue = String(
      getSelectedFieldValue(field, initiationFields[field] || demandFields[field] || ''),
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
          title: String(getSelectedFieldValue('procurementTitle', initiationFields.procurementTitle || '')) || undefined,
          category: String(getSelectedFieldValue('procurementCategory', initiationFields.procurementCategory || '')) || undefined,
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
      <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-3">
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[color:var(--foreground)]">需求申请人</label>
          <input
            type="text"
            value={getSelectedFieldValue('requesterName', initiationFields.requesterName || demandFields.requesterName || '')}
            onChange={(e) => setInitiationFields((prev) => ({ ...prev, requesterName: e.target.value }))}
            className="workbench-input w-full"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[color:var(--foreground)]">需求部门</label>
          <input
            type="text"
            value={getSelectedFieldValue('requesterDepartment', initiationFields.requesterDepartment || demandFields.requesterDepartment || '')}
            onChange={(e) => setInitiationFields((prev) => ({ ...prev, requesterDepartment: e.target.value }))}
            className="workbench-input w-full"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[color:var(--foreground)]">立项日期</label>
          <input
            type="date"
            value={getSelectedFieldValue('initiationDate', initiationFields.initiationDate || demandFields.initiationDate || '')}
            onChange={(e) => setInitiationFields((prev) => ({ ...prev, initiationDate: e.target.value }))}
            className="workbench-input w-full"
          />
        </div>
        <div className="col-span-3 space-y-2">
          <label className="text-xs font-semibold text-[color:var(--foreground)]">采购事项名称</label>
          <input
            type="text"
            value={getSelectedFieldValue('procurementTitle', initiationFields.procurementTitle || demandFields.procurementTitle || '')}
            onChange={(e) => setInitiationFields((prev) => ({ ...prev, procurementTitle: e.target.value }))}
            className="workbench-input w-full"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[color:var(--foreground)]">采购类别</label>
          <select
            value={getSelectedFieldValue('procurementCategory', initiationFields.procurementCategory || demandFields.procurementCategory || '')}
            onChange={(e) => setInitiationFields((prev) => ({ ...prev, procurementCategory: e.target.value }))}
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
        <div className="space-y-2 relative">
          <label className="text-xs font-semibold text-[color:var(--foreground)]">项目归属</label>
          <input
            type="text"
            value={getSelectedFieldValue('demandProject', demandFields.demandProject || '')}
            onChange={(e) => handleAttributionInputChange(e.target.value)}
            onFocus={() => {
              setAttributionSearch(demandFields.demandProject || '');
              setShowAttributionDropdown(true);
            }}
            onBlur={() => setTimeout(() => setShowAttributionDropdown(false), 200)}
            placeholder="输入或选择项目归属"
            className="workbench-input w-full"
          />
          {showAttributionDropdown && (
            <div className="neu-surface absolute z-10 mt-1 max-h-48 w-full overflow-auto">
              {filteredAttributions.map((option) => (
                <button
                  key={option.name}
                  type="button"
                  onClick={() => handleSelectAttribution(option)}
                  className="w-full px-3 py-2.5 text-left hover:bg-[var(--accent-tint)] flex justify-between items-center transition-colors duration-150"
                >
                  <span className="text-sm text-[color:var(--foreground)]">{option.name}</span>
                  <span className="text-xs text-[color:var(--muted-foreground)]">{option.usageCount}次</span>
                </button>
              ))}
              {!filteredAttributions.some((a) => a.name === '其他') && (
                <button
                  type="button"
                  onClick={() => handleSelectAttribution({ name: '其他', contractNumber: null, usageCount: 0 })}
                  className="w-full px-3 py-2.5 text-left hover:bg-[var(--accent-tint)] flex justify-between items-center transition-colors duration-150"
                >
                  <span className="text-sm text-[color:var(--foreground)]">其他</span>
                  <span className="text-xs text-[color:var(--muted-foreground)]">通用</span>
                </button>
              )}
            </div>
          )}
        </div>
        <div className="col-span-3 grid grid-cols-2 gap-x-5">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-[color:var(--foreground)]">预算金额（元）</label>
            <input
              type="number"
              value={getSelectedFieldValue('budgetAmount', initiationFields.budgetAmount || demandFields.budgetAmount || 0)}
              onChange={(e) => setInitiationFields((prev) => ({ ...prev, budgetAmount: Number(e.target.value) }))}
              className="workbench-input w-full"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-[var(--success)]">预算参考（元）</label>
            {analyzingBudget && (
              <div className="neu-surface flex h-[40px] items-center justify-center">
                <span className="inline-flex items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
                  <Loader2 size={14} className="animate-spin" />
                  分析中...
                </span>
              </div>
            )}
            {!analyzingBudget && budgetReference && budgetReference.hasReference && (
              <div className="space-y-2">
                {(() => {
                  const tier = budgetReference.tier ?? (budgetReference.suggestedBudget ? 1 : 3);
                  const hasPoint = tier <= 2 && budgetReference.suggestedBudget != null;
                  const hasRange = budgetReference.rangeLow != null && budgetReference.rangeHigh != null;
                  return (
                    <>
                      {/* Tier 1/2：单价×数量点估计 —— 可点击填入 */}
                      {hasPoint && (
                        <div
                          onClick={() => setInitiationFields((prev) => ({ ...prev, budgetAmount: budgetReference.suggestedBudget! }))}
                          className="neu-opt flex h-[53px] cursor-pointer items-center justify-between px-3 font-semibold text-[var(--success)]"
                        >
                          <span className="tabular-nums">{budgetReference.suggestedBudget!.toLocaleString()}</span>
                          <span className="text-[10px] font-medium text-[color:var(--muted-foreground)]">点击填入</span>
                        </div>
                      )}
                      {/* Tier 3：仅历史参考区间，规模未核实，不可作单点填入 */}
                      {!hasPoint && hasRange && (
                        <div className="neu-surface flex h-[53px] flex-col items-center justify-center gap-0.5 px-3 text-center">
                          <span className="text-[10px] font-medium text-[color:var(--muted-foreground)]">{budgetReference.tierLabel ?? '历史参考区间'}</span>
                          <span className="tabular-nums text-sm font-semibold text-[color:var(--foreground)]">
                            {budgetReference.rangeLow!.toLocaleString()} – {budgetReference.rangeHigh!.toLocaleString()}
                          </span>
                        </div>
                      )}
                      {!hasPoint && !hasRange && (
                        <div className="neu-surface flex h-[53px] items-center justify-center px-3">
                          <span className="text-[10px] text-[color:var(--muted-foreground)]">{budgetReference.tierLabel ?? '数据不足'}：{budgetReference.confidenceReason}</span>
                        </div>
                      )}
                    </>
                  );
                })()}

                {/* 价格依据卡 —— 摘要条常驻占位，明细悬浮展示，不挤压下方表单 */}
                {budgetReference.hasReference && (budgetReference.tier ?? 1) <= 3 && (
                  <div className="relative">
                    <div ref={budgetRationaleBarRef} className="neu-surface overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowBudgetRationale((v) => !v)}
                      className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] text-[color:var(--muted-foreground)] hover:bg-[var(--success-soft)] transition-colors"
                    >
                      {(() => {
                        const tier = budgetReference.tier ?? (budgetReference.pricing ? 1 : 3);
                        const p = budgetReference.pricing;
                        return (
                          <>
                            <span className="rounded bg-[var(--success-soft)] px-1 py-px font-semibold text-[var(--success)]">T{tier}</span>
                            <span className="font-medium">{budgetReference.tierLabel ?? (p?.anchor === 'contract' ? '合同价加权' : '预算价加权')}</span>
                            {p ? (
                              <>
                                <span className="tabular-nums">{p.anchorPrice.toLocaleString()}</span>
                                <span className="text-[var(--success)] font-semibold">× {p.adjustmentFactor.toFixed(2)}</span>
                                {p.clamped && (<span className="text-[9px] px-1 rounded bg-[var(--warning-soft)] text-[color:var(--warning)]">已夹紧</span>)}
                              </>
                            ) : budgetReference.rangeLow != null ? (
                              <span className="tabular-nums">{budgetReference.rangeLow.toLocaleString()} – {budgetReference.rangeHigh!.toLocaleString()}</span>
                            ) : null}
                            <span className="ml-auto tabular-nums text-[9px]">{Math.round(budgetReference.confidence * 100)}%</span>
                            <ChevronDown size={12} className={`transition-transform ${showBudgetRationale ? 'rotate-180' : ''}`} />
                          </>
                        );
                      })()}
                    </button>
                    </div>

                    {showBudgetRationale && (
                      <div
                        ref={budgetRationalePanelRef}
                        className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-80 space-y-2.5 overflow-y-auto rounded-lg bg-[var(--background)] px-2.5 py-2 text-[10px] shadow-[inset_0_1px_0_oklch(1_0_0/0.75),4px_4px_10px_oklch(0.55_0.03_258/0.16),-2px_-2px_8px_oklch(1_0_0/0.9)]"
                      >
                        {/* ⓪ 行项目明细（方法 C 核心：单价×数量，避免历史总价加权失真）*/}
                        {(budgetReference.lines ?? []).filter((l) => l.unitPrice && l.lineTotal != null).length > 0 && (
                          <div className="space-y-1">
                            <div className="font-medium text-[color:var(--foreground)]">行项目（单价 × 数量）</div>
                            {(budgetReference.lines ?? []).filter((l) => l.unitPrice && l.lineTotal != null).map((l, i) => (
                              <div key={i} className="neu-surface px-2 py-1.5">
                                <div className="flex items-center justify-between gap-1.5">
                                  <span className="min-w-0 flex-1 truncate font-medium text-[color:var(--foreground)]">{l.catalogName ?? l.name}</span>
                                  <span className="shrink-0 rounded-full bg-[var(--success-soft)] px-1.5 py-px text-[9px] font-semibold text-[var(--success)]">{l.match === 'exact' ? '精确' : l.match === 'contained' ? '近似' : '预算'}</span>
                                </div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] tabular-nums text-[color:var(--muted-foreground)]">
                                  <span>{l.unitPrice!.toLocaleString()}/{l.unit ?? '单位'}</span>
                                  <span>× {l.qty}</span>
                                  <span className="font-semibold text-[var(--success)]">= {l.lineTotal!.toLocaleString()}</span>
                                  {l.lineLow != null && l.lineHigh != null && (<span className="text-[color:var(--muted-foreground)]">区间 {l.lineLow.toLocaleString()}–{l.lineHigh.toLocaleString()}</span>)}
                                </div>
                                {l.specWarning && (<div className="mt-0.5 text-[9px] text-[color:var(--warning)] leading-snug">⚠ {l.specWarning}</div>)}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* ① 价格调整项 */}
                        {(budgetReference.pricing?.adjustments ?? []).length > 0 && (
                          <div className="pt-2 space-y-1">
                            <div className="font-medium text-[color:var(--foreground)]">价格调整</div>
                            {(budgetReference.pricing?.adjustments ?? []).map((adj, i) => {
                              const neutral = adj.factor === 0;
                              const positive = adj.factor > 0;
                              return (
                                <div key={i} className="flex items-start gap-1.5">
                                  <span
                                    className={[
                                      'shrink-0 rounded px-1 py-px font-semibold tabular-nums',
                                      neutral
                                        ? 'bg-[color-mix(in_oklch,var(--muted-foreground)_12%,transparent)] text-[color:var(--muted-foreground)]'
                                        : positive
                                          ? 'bg-[var(--warning-soft)] text-[color:var(--warning)]'
                                          : 'bg-[var(--success-soft)] text-[var(--success)]',
                                    ].join(' ')}
                                  >
                                    {neutral ? '持平' : `${positive ? '+' : ''}${(adj.factor * 100).toFixed(0)}%`}
                                  </span>
                                  <span className="text-[color:var(--muted-foreground)] leading-relaxed">{adj.reason}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* ② 参考项目（相关度进度条 + 贡献额 + AI 理由）*/}
                        {budgetReference.references.length > 0 && (
                          <div className="space-y-1">
                            <div className="font-medium text-[color:var(--foreground)]">
                              参考项目（{budgetReference.statistics?.count ?? budgetReference.references.length}）
                            </div>
                            <div className="space-y-1.5">
                              {budgetReference.references.map((ref, idx) => {
                                const isLedger = ref.source === '采购台账';
                                const relPct = Math.round(ref.relevance * 100);
                                const relTone =
                                  ref.relevance >= 0.6
                                    ? 'bg-[var(--success)]'
                                    : ref.relevance >= 0.4
                                      ? 'bg-[var(--warning)]'
                                      : 'bg-[color:var(--muted-foreground)]';
                                return (
                                  <div key={idx} className="neu-surface px-2 py-1.5">
                                    <div className="flex items-center gap-1.5">
                                      <span
                                        className={[
                                          'inline-flex h-1.5 w-1.5 shrink-0 rounded-full',
                                          isLedger ? 'bg-[var(--success)]' : 'bg-[var(--accent)]',
                                        ].join(' ')}
                                      />
                                      <span className="min-w-0 flex-1 truncate font-medium text-[color:var(--foreground)]">{ref.title}</span>
                                      <span
                                        className={[
                                          'shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold',
                                          isLedger
                                            ? 'bg-[var(--success-soft)] text-[var(--success)]'
                                            : 'bg-[var(--accent-tint-strong)] text-[color:var(--accent)]',
                                        ].join(' ')}
                                      >
                                        {ref.source}
                                      </span>
                                    </div>
                                    {/* 相关度进度条 */}
                                    <div className="mt-1 flex items-center gap-1.5">
                                      <div className="relative h-1 flex-1 rounded-full bg-[color-mix(in_oklch,var(--muted-foreground)_12%,transparent)] overflow-hidden">
                                        <div className={`h-full ${relTone} rounded-full`} style={{ width: `${relPct}%` }} />
                                      </div>
                                      <span className="shrink-0 tabular-nums text-[9px] text-[color:var(--muted-foreground)]">{relPct}%</span>
                                    </div>
                                    {/* 价格 + 对主锚点贡献额 */}
                                    <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[9px] text-[color:var(--muted-foreground)]">
                                      <span>预算 {ref.amount ? ref.amount.toLocaleString() : '--'}</span>
                                      <span>合同 {ref.contractAmount ? ref.contractAmount.toLocaleString() : '--'}</span>
                                      <span className="font-semibold text-[var(--success)]">贡献 {ref.contribution.toLocaleString()}</span>
                                    </div>
                                    {/* AI 相关度理由 */}
                                    {ref.aiReason && (
                                      <div className="mt-1 text-[9px] text-[color:var(--muted-foreground)] italic leading-snug">
                                        {ref.aiReason}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* ③ AI 分析报告（引用真实锚点数字）*/}
                        {budgetReference.analysis && (
                          <div className="pt-1.5 border-t border-[color-mix(in_oklch,var(--success)_22%,transparent)]">
                            <div className="font-medium text-[color:var(--foreground)] mb-1">分析</div>
                            <p className="text-[10px] leading-relaxed text-[color:var(--foreground)]">{budgetReference.analysis}</p>
                          </div>
                        )}

                        {/* ④ 置信度 + 理由 */}
                        <div className="flex items-center gap-2 pt-1.5 border-t border-[color-mix(in_oklch,var(--success)_22%,transparent)]">
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-[9px] text-[color:var(--muted-foreground)]">置信度</span>
                            <span className="font-semibold tabular-nums text-[10px] text-[color:var(--foreground)]">
                              {Math.round(budgetReference.confidence * 100)}%
                            </span>
                          </div>
                          {budgetReference.confidenceReason && (
                            <span className="text-[9px] text-[color:var(--muted-foreground)] leading-snug">— {budgetReference.confidenceReason}</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {!analyzingBudget && budgetReference && !budgetReference.hasReference && (
              <div className="neu-surface flex h-[40px] items-center justify-center">
                <span className="text-xs text-[color:var(--muted-foreground)]">{budgetReference.message}</span>
              </div>
            )}
            {!analyzingBudget && !budgetReference && (
              <div className="neu-surface flex h-[40px] items-center justify-center">
                <span className="text-xs text-[color:var(--muted-foreground)]">点击"确认并继续"获取参考</span>
              </div>
            )}
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
            value={getSelectedFieldValue('projectReason', initiationFields.projectReason || demandFields.projectReason || '')}
            onChange={(e) => setInitiationFields((prev) => ({ ...prev, projectReason: e.target.value }))}
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
            value={getSelectedFieldValue('supplierRequirements', initiationFields.supplierRequirements || demandFields.supplierRequirements || '')}
            onChange={(e) => setInitiationFields((prev) => ({ ...prev, supplierRequirements: e.target.value }))}
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
                  '采购需求表（可选）',
                  demandFile,
                  setDemandFile,
                  demandExtracted,
                  () => {
                    setDemandFile(null);
                    setDemandFields({});
                    setDemandAttachment(null);
                    setDemandExtractedText('');
                    setDemandExtracted(false);
                  },
                  true,
                )}
                <div className="wb-section-rule" />
                {renderFileUpload(
                  '采购立项申请表（可选）',
                  initiationFile,
                  setInitiationFile,
                  initiationExtracted,
                  () => {
                    setInitiationFile(null);
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
                    setInitiationAttachment(null);
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
                  onClick={() => { setStep('review'); void handleAnalyzeBudgetReference(); }}
                  className="neu-btn-soft h-[38px]"
                >
                  跳过，手动填写
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (demandFile && !demandExtracted) void handleExtractDemand();
                    if (initiationFile && !initiationExtracted) void handleExtractInitiation();
                  }}
                  disabled={(!demandFile && !initiationFile) || (demandExtracted && initiationExtracted) || extractingDemand || extractingInitiation}
                  className="neu-btn-primary !h-[38px]"
                >
                  {extractingDemand || extractingInitiation ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  {extractingDemand || extractingInitiation ? '解析中...' : '解析文档'}
                </button>
              </div>
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
                  }}
                  className="neu-btn-soft h-[38px]"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                  返回
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep('review');
                    void handleAnalyzeBudgetReference();
                  }}
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
