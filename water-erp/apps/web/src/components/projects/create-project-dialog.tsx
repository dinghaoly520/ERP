"use client";

import { useEffect, useState } from 'react';
import { X, Upload, FileText, CheckCircle, Loader2, Sparkles, ArrowLeft } from 'lucide-react';
import {
  createProjectManagementItem,
  extractInitiationFields,
  extractDemandFields,
  aiIdentifyField,
  compareFields,
  analyzeBudgetReference,
  fetchProjectAttributions,
  type InitiationFields,
  type DemandFields,
  type BudgetReferenceResult,
  type ProjectAttribution,
} from '@/lib/api/project-management';
import {
  PROCUREMENT_METHODS,
  type ProcurementMethod,
  type FieldCandidate,
  type FieldComparison,
} from '@/lib/types/project-management';
import { fetchCurrentUser, type AuthUser } from '@/lib/api/auth';
import { LoginErrorDialog } from '@/components/login/login-error-dialog';

type Step = 'upload' | 'compare' | 'review';

const PROCUREMENT_CATEGORY_OPTIONS = [
  '生产技术类采购',
  'EPC项目采购',
  'EPC管理采购',
  '公用集中采购',
  '科技研发类采购',
  '信息化采购',
  '其他',
];

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
    setDemandExtracted(false);
    setInitiationExtracted(false);
    setBudgetReference(null);
    setAnalyzingBudget(false);
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
        projectReason: String(fields.projectReason || ''),
        supplierRequirements: String(fields.supplierRequirements || ''),
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
    if (!procurementMethod) {
      setErrorMessage('请选择采购方式。');
      return;
    }

    if (!initiationAttachment && !demandAttachment && !initiationFields.procurementTitle) {
      setErrorMessage('请填写采购事项名称。');
      return;
    }

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
      setSubmitting(false);
    }
  };

  const renderProcurementMethodSelector = () => (
    <div className="space-y-3">
      <label className="password-dialog__label">采购方式</label>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {PROCUREMENT_METHODS.map((method) => (
          <button
            key={method}
            type="button"
            onClick={() => setProcurementMethod(method)}
            className={[
              "px-4 py-2.5 text-xs font-medium rounded-lg transition-all duration-200",
              procurementMethod === method
                ? "bg-[linear-gradient(135deg,rgba(96,145,246,0.96),rgba(138,176,251,0.9))] text-white"
                : "border border-[rgba(171,191,227,0.54)] bg-[rgba(255,255,255,0.6)] text-[color:var(--foreground)] hover:border-[rgba(102,148,245,0.6)] hover:bg-[rgba(255,255,255,0.8)]",
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
              className="p-1 rounded-full text-[rgba(88,107,142,0.6)] hover:text-[rgba(200,80,80,0.9)] hover:bg-[rgba(200,80,80,0.08)] transition-all duration-200"
              title="清除"
            >
              <X size={16} />
            </button>
          )}
          {isExtracted && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[rgba(92,156,133,0.12)] text-xs font-medium text-[rgba(92,156,133,0.95)]">
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
        className={`group flex items-center justify-center gap-2.5 rounded-xl border px-4 py-4 cursor-pointer transition-all duration-200 ${
          isExtracted
            ? 'border-[rgba(92,156,133,0.54)] bg-[rgba(232,242,235,0.5)]'
            : 'border-[rgba(171,191,227,0.54)] bg-[rgba(255,255,255,0.6)] hover:border-[rgba(102,148,245,0.6)] hover:bg-[rgba(255,255,255,0.8)]'
        }`}
      >
        {isExtracted ? (
          <FileText size={20} className="text-[rgba(92,156,133,0.88)]" />
        ) : (
          <Upload size={20} className="text-[rgba(98,137,214,0.88)]" />
        )}
        <span className={`text-sm ${isExtracted ? 'text-[rgba(92,156,133,0.9)]' : 'text-[rgba(88,107,142,0.9)]'}`}>
          {file ? file.name : '点击选择 PDF 文件'}
        </span>
        {file && !isExtracted && (
          <span className="text-xs text-[rgba(88,107,142,0.82)]">{(file.size / 1024).toFixed(0)}KB</span>
        )}
      </label>
    </div>
  );

  const renderFieldComparison = () => (
    <div className="space-y-5 pb-[1.7rem]">
      {renderProcurementMethodSelector()}
      <div className="h-px bg-[rgba(184,199,227,0.36)] mt-4 mb-2" />
      <div className="text-sm text-[rgba(88,107,142,0.9)] mb-2">
        {isDualDocumentMode() ? '对比两份文档的字段信息，选择正确的值' : '确认提取的字段信息'}
      </div>
      {fieldComparisons.map((comparison) => (
          <div key={comparison.fieldName}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-[color:var(--foreground)]">{comparison.label}</span>
              {aiLoading === comparison.fieldName ? (
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br from-[rgba(147,112,219,0.15)] to-[rgba(96,145,246,0.15)]">
                  <Loader2 size={14} className="animate-spin text-[rgba(118,100,180,0.9)]" />
                </span>
              ) : (
                <button
                  type="button"
                  title="AI 识别"
                  onClick={() => { const text = demandExtractedText || initiationExtractedText; if (text) void handleAiIdentify(comparison.fieldName, text); }}
                  className="group inline-flex items-center justify-center w-7 h-7 rounded-full border border-[rgba(147,112,219,0.2)] bg-[rgba(147,112,219,0.06)] transition-all duration-300 hover:border-[rgba(147,112,219,0.4)] hover:bg-[rgba(147,112,219,0.14)] hover:shadow-[0_0_10px_rgba(147,112,219,0.18)] active:scale-95"
                >
                  <Sparkles size={14} className="text-[rgba(118,100,180,0.85)] transition-transform duration-300 group-hover:rotate-12 group-hover:scale-110" />
                </button>
              )}
            </div>
            {comparison.fieldName === 'demandProject' ? (
              <div className="grid grid-cols-1 gap-3">
                <button
                  type="button"
                  onClick={() => handleSelectComparisonValue(comparison.fieldName, comparison.demandValue || '')}
                  className={[
                    "p-2.5 text-left rounded-lg border transition-all duration-200",
                    comparison.selectedValue === comparison.demandValue
                      ? "border-[rgba(102,148,245,0.6)] bg-[rgba(232,240,255,0.6)]"
                      : "border-[rgba(171,191,227,0.54)] bg-white hover:bg-[rgba(246,249,255,0.5)]",
                  ].join(" ")}
                >
                  <div className="text-[11px] font-medium text-[rgba(88,107,142,0.9)]">需求表</div>
                  <div className="text-sm mt-0.5 truncate font-medium text-[color:var(--foreground)]">{comparison.demandValue || '（空）'}</div>
                </button>
              </div>
            ) : comparison.fieldName === 'initiationDate' ? (
              <div className="grid grid-cols-1 gap-3">
                <button
                  type="button"
                  onClick={() => handleSelectComparisonValue(comparison.fieldName, comparison.initiationValue || '')}
                  className={[
                    "p-2.5 text-left rounded-lg border transition-all duration-200",
                    comparison.selectedValue === comparison.initiationValue
                      ? "border-[rgba(102,148,245,0.6)] bg-[rgba(232,240,255,0.6)]"
                      : "border-[rgba(171,191,227,0.54)] bg-white hover:bg-[rgba(246,249,255,0.5)]",
                  ].join(" ")}
                >
                  <div className="text-[11px] font-medium text-[rgba(88,107,142,0.9)]">立项表</div>
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
                      "p-2.5 text-left rounded-lg border transition-all duration-200",
                      comparison.selectedValue === comparison.demandValue
                        ? "border-[rgba(102,148,245,0.6)] bg-[rgba(232,240,255,0.6)]"
                        : "border-[rgba(171,191,227,0.54)] bg-white hover:bg-[rgba(246,249,255,0.5)]",
                    ].join(" ")}
                  >
                    <div className="text-[11px] font-medium text-[rgba(88,107,142,0.9)]">需求表</div>
                    <div className="text-sm mt-0.5 whitespace-pre-wrap font-medium text-[color:var(--foreground)]">{comparison.demandValue || '（空）'}</div>
                  </button>
                )}
                {showInitiationColumn() && (
                  <button
                    type="button"
                    onClick={() => handleSelectComparisonValue(comparison.fieldName, comparison.initiationValue || '')}
                    className={[
                      "p-2.5 text-left rounded-lg border transition-all duration-200",
                      comparison.selectedValue === comparison.initiationValue
                        ? "border-[rgba(102,148,245,0.6)] bg-[rgba(232,240,255,0.6)]"
                        : "border-[rgba(171,191,227,0.54)] bg-white hover:bg-[rgba(246,249,255,0.5)]",
                    ].join(" ")}
                  >
                    <div className="text-[11px] font-medium text-[rgba(88,107,142,0.9)]">立项表</div>
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
                      "p-2.5 text-left rounded-lg border transition-all duration-200",
                      comparison.selectedValue === comparison.demandValue
                        ? "border-[rgba(102,148,245,0.6)] bg-[rgba(232,240,255,0.6)]"
                        : "border-[rgba(171,191,227,0.54)] bg-white hover:bg-[rgba(246,249,255,0.5)]",
                    ].join(" ")}
                  >
                    <div className="text-[11px] font-medium text-[rgba(88,107,142,0.9)]">需求表</div>
                    <div className="text-sm mt-0.5 truncate font-medium text-[color:var(--foreground)]">{comparison.demandValue || '（空）'}</div>
                  </button>
                )}
                {showInitiationColumn() && (
                  <button
                    type="button"
                    onClick={() => handleSelectComparisonValue(comparison.fieldName, comparison.initiationValue || '')}
                    className={[
                      "p-2.5 text-left rounded-lg border transition-all duration-200",
                      comparison.selectedValue === comparison.initiationValue
                        ? "border-[rgba(102,148,245,0.6)] bg-[rgba(232,240,255,0.6)]"
                        : "border-[rgba(171,191,227,0.54)] bg-white hover:bg-[rgba(246,249,255,0.5)]",
                    ].join(" ")}
                  >
                    <div className="text-[11px] font-medium text-[rgba(88,107,142,0.9)]">立项表</div>
                    <div className="text-sm mt-0.5 truncate font-medium text-[color:var(--foreground)]">{comparison.initiationValue || '（空）'}</div>
                  </button>
                )}
              </div>
            )}
            {aiCandidates[comparison.fieldName]?.length > 0 && (
              <div className="mt-2 pt-2 border-t border-[rgba(184,199,227,0.36)]">
                <div className="text-[11px] font-medium text-[rgba(88,107,142,0.9)] mb-1.5">AI 推荐</div>
                <div className="space-y-1.5">
                  {aiCandidates[comparison.fieldName].map((candidate, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectComparisonValue(comparison.fieldName, candidate.value)}
                      className={[
                        "w-full p-2 text-left rounded-lg border transition-all duration-200",
                        comparison.selectedValue === candidate.value
                          ? "border-[rgba(102,148,245,0.6)] bg-[rgba(232,240,255,0.6)]"
                          : "border-[rgba(171,191,227,0.54)] bg-white hover:bg-[rgba(246,249,255,0.5)]",
                      ].join(" ")}
                    >
                      <span className="text-sm font-medium text-[color:var(--foreground)]">{candidate.value}</span>
                      <span className="ml-2 text-xs text-[rgba(88,107,142,0.82)]">({(candidate.confidence * 100).toFixed(0)}%)</span>
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

  const renderReview = () => (
    <div className="space-y-5 pb-[1.7rem]">
      <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-3">
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[rgba(52,67,96,0.96)]">需求申请人</label>
          <input
            type="text"
            value={getSelectedFieldValue('requesterName', initiationFields.requesterName || demandFields.requesterName || '')}
            onChange={(e) => setInitiationFields((prev) => ({ ...prev, requesterName: e.target.value }))}
            className="password-dialog__input"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[rgba(52,67,96,0.96)]">需求部门</label>
          <input
            type="text"
            value={getSelectedFieldValue('requesterDepartment', initiationFields.requesterDepartment || demandFields.requesterDepartment || '')}
            onChange={(e) => setInitiationFields((prev) => ({ ...prev, requesterDepartment: e.target.value }))}
            className="password-dialog__input"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[rgba(52,67,96,0.96)]">立项日期</label>
          <input
            type="date"
            value={getSelectedFieldValue('initiationDate', initiationFields.initiationDate || demandFields.initiationDate || '')}
            onChange={(e) => setInitiationFields((prev) => ({ ...prev, initiationDate: e.target.value }))}
            className="password-dialog__input"
          />
        </div>
        <div className="col-span-3 space-y-2">
          <label className="text-xs font-semibold text-[rgba(52,67,96,0.96)]">采购事项名称</label>
          <input
            type="text"
            value={getSelectedFieldValue('procurementTitle', initiationFields.procurementTitle || demandFields.procurementTitle || '')}
            onChange={(e) => setInitiationFields((prev) => ({ ...prev, procurementTitle: e.target.value }))}
            className="password-dialog__input"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[rgba(52,67,96,0.96)]">采购类别</label>
          <select
            value={getSelectedFieldValue('procurementCategory', initiationFields.procurementCategory || demandFields.procurementCategory || '')}
            onChange={(e) => setInitiationFields((prev) => ({ ...prev, procurementCategory: e.target.value }))}
            className="password-dialog__input h-[53px] rounded-lg"
          >
            <option value="">请选择采购类别</option>
            {PROCUREMENT_CATEGORY_OPTIONS.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[rgba(52,67,96,0.96)]">采购方式</label>
          <select
            value={procurementMethod}
            onChange={(e) => setProcurementMethod(e.target.value)}
            className="password-dialog__input h-[53px] rounded-lg"
          >
            <option value="">请选择采购方式</option>
            {PROCUREMENT_METHODS.map((method) => (
              <option key={method} value={method}>{method}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2 relative">
          <label className="text-xs font-semibold text-[rgba(52,67,96,0.96)]">项目归属</label>
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
            className="password-dialog__input"
          />
          {showAttributionDropdown && (
            <div className="absolute z-10 w-full mt-1 max-h-48 overflow-auto rounded-lg border border-[rgba(171,191,227,0.54)] bg-white shadow-lg">
              {filteredAttributions.map((option) => (
                <button
                  key={option.name}
                  type="button"
                  onClick={() => handleSelectAttribution(option)}
                  className="w-full px-3 py-2.5 text-left hover:bg-[rgba(246,249,255,0.8)] flex justify-between items-center transition-colors duration-150"
                >
                  <span className="text-sm text-[color:var(--foreground)]">{option.name}</span>
                  <span className="text-xs text-[rgba(88,107,142,0.6)]">{option.usageCount}次</span>
                </button>
              ))}
              {!filteredAttributions.some((a) => a.name === '其他') && (
                <button
                  type="button"
                  onClick={() => handleSelectAttribution({ name: '其他', contractNumber: null, usageCount: 0 })}
                  className="w-full px-3 py-2.5 text-left hover:bg-[rgba(246,249,255,0.8)] flex justify-between items-center transition-colors duration-150"
                >
                  <span className="text-sm text-[color:var(--foreground)]">其他</span>
                  <span className="text-xs text-[rgba(88,107,142,0.6)]">通用</span>
                </button>
              )}
            </div>
          )}
        </div>
        <div className="col-span-3 grid grid-cols-2 gap-x-5">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-[rgba(52,67,96,0.96)]">预算金额（元）</label>
            <input
              type="number"
              value={getSelectedFieldValue('budgetAmount', initiationFields.budgetAmount || demandFields.budgetAmount || 0)}
              onChange={(e) => setInitiationFields((prev) => ({ ...prev, budgetAmount: Number(e.target.value) }))}
              className="password-dialog__input"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-[rgba(92,181,150,0.96)]">预算参考（元）</label>
            {analyzingBudget && (
              <div className="h-[53px] flex items-center justify-center rounded-lg border border-[rgba(92,181,150,0.3)] bg-[rgba(92,181,150,0.06)]">
                <span className="inline-flex items-center gap-2 text-xs text-[rgba(88,107,142,0.9)]">
                  <Loader2 size={14} className="animate-spin" />
                  分析中...
                </span>
              </div>
            )}
            {!analyzingBudget && budgetReference && budgetReference.suggestedBudget && (
              <div
                onClick={() => setInitiationFields((prev) => ({ ...prev, budgetAmount: budgetReference.suggestedBudget! }))}
                className="group relative cursor-pointer"
              >
                <div className="h-[53px] flex items-center px-3 rounded-lg border border-[rgba(92,181,150,0.4)] bg-[rgba(92,181,150,0.08)] text-[rgba(92,181,150,1)] font-semibold transition-all duration-200 hover:bg-[rgba(92,181,150,0.15)]">
                  {budgetReference.suggestedBudget.toLocaleString()}
                </div>
                {budgetReference.hasReference && (
                  <div className="absolute bottom-full right-0 mb-2 w-80 p-3 rounded-lg border border-[rgba(92,181,150,0.3)] bg-white shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                    {budgetReference.analysis && (
                      <p className="text-xs text-[color:var(--foreground)] mb-2">{budgetReference.analysis}</p>
                    )}
                    {budgetReference.statistics && (
                      <div className="pt-2 border-t border-[rgba(184,199,227,0.36)] flex flex-wrap gap-3 text-[10px] text-[color:var(--muted-foreground)]">
                        <span>均值: {budgetReference.statistics.average.toLocaleString()} 元</span>
                        <span>范围: {budgetReference.statistics.min.toLocaleString()} - {budgetReference.statistics.max.toLocaleString()}</span>
                        <span>参考: {budgetReference.statistics.count} 个项目</span>
                      </div>
                    )}
                    {budgetReference.references && budgetReference.references.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-[rgba(184,199,227,0.36)]">
                        <div className="text-[10px] font-medium text-[rgba(88,107,142,0.9)] mb-1">参考项目</div>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {budgetReference.references.map((ref, idx) => {
                            const isLedger = ref.source === '采购台账';
                            return (
                              <div key={idx} className="rounded-lg border border-[rgba(184,199,227,0.28)] bg-white/70 px-2.5 py-2 text-[10px] text-[color:var(--foreground)]">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={[
                                      'inline-flex h-1.5 w-1.5 shrink-0 rounded-full',
                                      isLedger ? 'bg-[rgba(92,181,150,0.9)]' : 'bg-[rgba(102,148,245,0.9)]',
                                    ].join(' ')}
                                  />
                                  <span className="min-w-0 flex-1 truncate font-medium">{ref.title}</span>
                                  <span
                                    className={[
                                      'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                                      isLedger
                                        ? 'bg-[rgba(92,181,150,0.12)] text-[rgba(64,139,110,0.95)]'
                                        : 'bg-[rgba(102,148,245,0.12)] text-[rgba(74,116,210,0.95)]',
                                    ].join(' ')}
                                  >
                                    {ref.source}
                                  </span>
                                </div>
                                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[rgba(88,107,142,0.9)]">
                                  <span>预算: {ref.amount ? ref.amount.toLocaleString() : '--'} 元</span>
                                  <span>合同: {ref.contractAmount ? ref.contractAmount.toLocaleString() : '--'} 元</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {!analyzingBudget && budgetReference && !budgetReference.hasReference && (
              <div className="h-[53px] flex items-center justify-center rounded-lg border border-[rgba(184,199,227,0.36)] bg-[rgba(246,249,255,0.5)]">
                <span className="text-xs text-[color:var(--muted-foreground)]">{budgetReference.message}</span>
              </div>
            )}
            {!analyzingBudget && !budgetReference && (
              <div className="h-[53px] flex items-center justify-center rounded-lg border border-[rgba(184,199,227,0.36)] bg-[rgba(246,249,255,0.5)]">
                <span className="text-xs text-[color:var(--muted-foreground)]">点击"确认并继续"获取参考</span>
              </div>
            )}
          </div>
        </div>
        <div className="col-span-3 space-y-2">
          <label className="text-xs font-semibold text-[rgba(52,67,96,0.96)]">立项事由</label>
          <textarea
            value={getSelectedFieldValue('projectReason', initiationFields.projectReason || demandFields.projectReason || '')}
            onChange={(e) => setInitiationFields((prev) => ({ ...prev, projectReason: e.target.value }))}
            rows={3}
            className="password-dialog__input min-h-[80px] resize-y"
          />
        </div>
        <div className="col-span-3 space-y-2">
          <label className="text-xs font-semibold text-[rgba(52,67,96,0.96)]">供方要求</label>
          <textarea
            value={getSelectedFieldValue('supplierRequirements', initiationFields.supplierRequirements || demandFields.supplierRequirements || '')}
            onChange={(e) => setInitiationFields((prev) => ({ ...prev, supplierRequirements: e.target.value }))}
            rows={3}
            className="password-dialog__input min-h-[80px] resize-y"
          />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-[rgba(235,241,252,0.7)] backdrop-blur-[18px]"
          onClick={() => { resetState(); onClose(); }}
        />
        <div className="password-dialog relative w-full max-w-[min(720px,92vw)] max-h-[90vh] flex flex-col">
          <div className="password-dialog__glow" />
          <button
            type="button"
            onClick={() => { resetState(); onClose(); }}
            className="password-dialog__close"
          >
            <X size={18} />
          </button>

          {/* Fixed Header */}
          <div className="password-dialog__header flex-shrink-0">
            <h2 className="password-dialog__title">新建采购项目</h2>
          </div>

          <div className="password-dialog__divider flex-shrink-0" />

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
                <div className="h-px bg-[rgba(184,199,227,0.36)]" />
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
          <div className="flex-shrink-0 border-t border-[rgba(184,199,227,0.48)] px-[1.7rem] py-4">
            {step === 'upload' && (
              <div className="flex justify-between">
                <button
                  type="button"
                  onClick={() => {
                    const comparisons = compareFields(demandFields, initiationFields);
                    setFieldComparisons(comparisons);
                    setStep('compare');
                  }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-full border border-[rgba(171,191,227,0.54)] bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(241,246,255,0.72))] px-4 py-2.5 text-sm font-medium text-[rgba(92,109,141,0.92)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_12px_24px_rgba(69,99,158,0.06)] transition-all duration-200 hover:-translate-y-px hover:bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(243,248,255,0.8))] hover:text-[rgba(57,73,103,0.95)]"
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
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-[rgba(102,148,245,0.72)] bg-[linear-gradient(135deg,rgba(96,145,246,0.96),rgba(138,176,251,0.9))] px-5 py-2.5 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.32),0_18px_32px_rgba(74,109,175,0.18)] transition-all duration-200 hover:-translate-y-px hover:border-[rgba(122,168,255,0.82)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.36),0_20px_38px_rgba(74,109,175,0.22)] disabled:pointer-events-none disabled:opacity-56"
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
                  className="inline-flex items-center justify-center gap-1.5 rounded-full border border-[rgba(171,191,227,0.54)] bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(241,246,255,0.72))] px-4 py-2.5 text-sm font-medium text-[rgba(92,109,141,0.92)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_12px_24px_rgba(69,99,158,0.06)] transition-all duration-200 hover:-translate-y-px hover:bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(243,248,255,0.8))] hover:text-[rgba(57,73,103,0.95)]"
                >
                  <ArrowLeft size={16} />
                  返回
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep('review');
                    void handleAnalyzeBudgetReference();
                  }}
                  className="inline-flex items-center justify-center rounded-full border border-[rgba(102,148,245,0.72)] bg-[linear-gradient(135deg,rgba(96,145,246,0.96),rgba(138,176,251,0.9))] px-5 py-2.5 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.32),0_18px_32px_rgba(74,109,175,0.18)] transition-all duration-200 hover:-translate-y-px hover:border-[rgba(122,168,255,0.82)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.36),0_20px_38px_rgba(74,109,175,0.22)]"
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
                  className="inline-flex items-center justify-center gap-1.5 rounded-full border border-[rgba(171,191,227,0.54)] bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(241,246,255,0.72))] px-4 py-2.5 text-sm font-medium text-[rgba(92,109,141,0.92)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_12px_24px_rgba(69,99,158,0.06)] transition-all duration-200 hover:-translate-y-px hover:bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(243,248,255,0.8))] hover:text-[rgba(57,73,103,0.95)]"
                >
                  <ArrowLeft size={16} />
                  返回
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={submitting}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-[rgba(102,148,245,0.72)] bg-[linear-gradient(135deg,rgba(96,145,246,0.96),rgba(138,176,251,0.9))] px-5 py-2.5 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.32),0_18px_32px_rgba(74,109,175,0.18)] transition-all duration-200 hover:-translate-y-px hover:border-[rgba(122,168,255,0.82)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.36),0_20px_38px_rgba(74,109,175,0.22)] disabled:pointer-events-none disabled:opacity-56"
                >
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
                  {submitting ? '创建中...' : '创建项目'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <LoginErrorDialog isOpen={Boolean(errorMessage)} message={errorMessage ?? ''} onClose={() => setErrorMessage(null)} />
    </>
  );
}
