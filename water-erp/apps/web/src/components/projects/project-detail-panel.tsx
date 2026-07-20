"use client";

import { Archive, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, FileText, Gavel, Loader2, Paperclip, Pencil, Recycle, RefreshCw, Save, ScrollText, Shield, UploadCloud, UserPlus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { LoginErrorDialog } from '@/components/login/login-error-dialog';
import {
  analyzeProjectManagementItem,
  completeProjectManagementItem,
  fetchProjectAttributions,
  refreshProjectSummary,
  updateProjectStage,
  updateProjectExtractedInfo,
  uploadProjectStageAttachment,
  auditStageCompliance,
  type ComplianceAuditResponse,
  type ExtractedInfo,
} from '@/lib/api/project-management';
import {
  PROJECT_STAGE_STATUS_LABELS,
  PROJECT_WORKFLOW_STAGES,
  type ProjectDetailAnalysis,
  type ProjectManagementItem,
  type ProjectManagementStage,
} from '@/lib/types/project-management';
import { ProjectStageTimeline } from './project-stage-timeline';
import { StageFileList } from './stage-file-list';
import { TenderWriteModal } from './tender-write-modal';
import { ExpertExtractModal } from './expert-extract-modal';
import { SupplierExtractModal } from './supplier-extract-modal';
import { AnnouncementPublishWizard } from './announcement-publish-wizard';
import { TenderFileEditorModal } from './tender-file-editor-modal';
import { Modal } from '@/components/workbench';

// ─── Extracted Info Field Components ───────────────────────────────────────────

// Expert info display component - handles structured expert data
function ExpertInfoField({
  value,
  isEditing,
  editValue,
  onEditValueChange,
  onStartEdit,
  onSave,
}: {
  value: string | null | undefined;
  isEditing: boolean;
  editValue: string;
  onEditValueChange: (value: string) => void;
  onStartEdit: () => void;
  onSave: () => void;
}) {
  const hasValue = value !== null && value !== undefined && value !== '';

  // Parse experts from a pipe-delimited string: "姓名|部门|专业|职称" per line
  const parseExperts = (raw: string | null | undefined) => {
    if (!raw || !raw.trim()) return [];
    return raw.split('\n').filter(line => line.trim()).map(line => {
      const parts = line.split('|');
      return {
        name: (parts[0] ?? '').trim(),
        department: (parts[1] ?? '').trim(),
        specialty: (parts[2] ?? '').trim(),
        title: (parts[3] ?? '').trim(),
      };
    });
  };

  const experts = parseExperts(hasValue ? String(value) : null);

  // Parse edit value for table editing — always start from editValue,
  // falling back to display value when edit is first entered
  const editExperts = parseExperts(editValue);

  const syncEditValue = (rows: Array<{ name: string; department: string; specialty: string; title: string }>) => {
    onEditValueChange(rows.map(e => `${e.name}|${e.department}|${e.specialty}|${e.title}`).join('\n'));
  };

  const updateExpertField = (index: number, field: 'name' | 'department' | 'specialty' | 'title', newValue: string) => {
    const updated = [...editExperts];
    if (index >= updated.length) {
      for (let i = updated.length; i <= index; i++) {
        updated.push({ name: '', department: '', specialty: '', title: '' });
      }
    }
    updated[index] = { ...updated[index], [field]: newValue };
    syncEditValue(updated);
  };

  const addExpertRow = () => {
    syncEditValue([...editExperts, { name: '', department: '', specialty: '', title: '' }]);
  };

  const removeExpertRow = (index: number) => {
    syncEditValue(editExperts.filter((_, i) => i !== index));
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">专家信息</span>
        {!isEditing && (
          <button type="button" onClick={onStartEdit} className="text-[11px] font-medium text-[color:var(--accent)] hover:underline">
            <Pencil size={11} className="inline mr-1" />{hasValue ? `编辑（${experts.length}人）` : '添加专家'}
          </button>
        )}
      </div>

      {isEditing ? (
        <div className="space-y-2">
          {editExperts.map((expert, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-1.5 items-center">
              <input type="text" value={expert.name} onChange={(e) => updateExpertField(i, 'name', e.target.value)} className="workbench-input !h-[32px] !text-xs" placeholder="姓名" />
              <input type="text" value={expert.department} onChange={(e) => updateExpertField(i, 'department', e.target.value)} className="workbench-input !h-[32px] !text-xs" placeholder="部门" />
              <input type="text" value={expert.specialty} onChange={(e) => updateExpertField(i, 'specialty', e.target.value)} className="workbench-input !h-[32px] !text-xs" placeholder="专业" />
              <input type="text" value={expert.title} onChange={(e) => updateExpertField(i, 'title', e.target.value)} className="workbench-input !h-[32px] !text-xs" placeholder="职称" />
              <button type="button" onClick={() => removeExpertRow(i)} className="neu-btn-xs !px-2"><X size={13} /></button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button type="button" onClick={addExpertRow} className="text-[11px] font-medium text-[color:var(--accent)] hover:underline">+ 添加专家</button>
            <span className="text-[10px] text-[color:var(--muted-foreground)]">{editExperts.length} 人</span>
            <div className="flex-1" />
            <button type="button" onClick={onSave} className="neu-btn-xs"><Save size={13} />保存</button>
          </div>
        </div>
      ) : hasValue && experts.length > 0 ? (
        <div className="space-y-1">
          {experts.map((expert, i) => (
            <div key={i} className="flex items-baseline gap-2 text-sm">
              <span className="font-semibold text-[color:var(--foreground)]">{expert.name}</span>
              <span className="text-[color:var(--muted-foreground)]/70">·</span>
              <span className="text-[color:var(--muted-foreground)]">{expert.department}</span>
              <span className="text-[color:var(--muted-foreground)]/70">·</span>
              <span className="text-[color:var(--muted-foreground)]">{expert.specialty}</span>
              <span className="text-[color:var(--muted-foreground)]/70">·</span>
              <span className="text-[color:var(--muted-foreground)]">{expert.title}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-[color:var(--muted-foreground)]/50">待补充</div>
      )}
    </div>
  );
}

function BiddingUnitsField({
  label,
  value,
  isEditing,
  editValue,
  onEditValueChange,
  onStartEdit,
  onSave,
}: {
  label: string;
  value: string | number | null | undefined;
  isEditing: boolean;
  editValue: string;
  onEditValueChange: (value: string) => void;
  onStartEdit: () => void;
  onSave: () => void;
}) {
  const hasValue = value !== null && value !== undefined && value !== '';
  // 解析投标单位（用顿号、逗号或换行分隔）
  const units = hasValue ? String(value).split(/[、,\n]/).filter(u => u.trim()) : [];
  const unitName = label.replace('邀请的 ', '');

  // Parse edit value — keep empty rows visible during editing so "+" works
  const editUnits = editValue ? editValue.split('\n') : [''];

  const updateUnit = (index: number, newValue: string) => {
    const updated = [...editUnits];
    if (index >= updated.length) {
      for (let i = updated.length; i <= index; i++) {
        updated.push('');
      }
    }
    updated[index] = newValue;
    onEditValueChange(updated.join('\n'));
  };

  const addUnitRow = () => {
    onEditValueChange([...editUnits, ''].join('\n'));
  };

  const removeUnitRow = (index: number) => {
    const updated = editUnits.filter((_, i) => i !== index);
    onEditValueChange(updated.join('\n'));
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">{label}</span>
        {!isEditing && (
          <button type="button" onClick={onStartEdit} className="text-[11px] font-medium text-[color:var(--accent)] hover:underline">
            <Pencil size={11} className="inline mr-1" />{hasValue && units.length > 0 ? `编辑（${units.length}家）` : '添加'}
          </button>
        )}
      </div>

      {isEditing ? (
        <div className="space-y-2">
          {editUnits.map((unit, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="w-5 text-center text-[11px] font-semibold text-[color:var(--muted-foreground)]">{i + 1}</span>
              <input type="text" value={unit} onChange={(e) => updateUnit(i, e.target.value)} className="workbench-input !h-[32px] !text-xs flex-1" placeholder={`输入${unitName}名称`} />
              <button type="button" onClick={() => removeUnitRow(i)} className="neu-btn-xs !px-2"><X size={13} /></button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button type="button" onClick={addUnitRow} className="text-[11px] font-medium text-[color:var(--accent)] hover:underline">+ 添加{unitName}</button>
            <span className="text-[10px] text-[color:var(--muted-foreground)]">{editUnits.length} 家</span>
            <div className="flex-1" />
            <button type="button" onClick={onSave} className="neu-btn-xs"><Save size={13} />保存</button>
          </div>
        </div>
      ) : hasValue && units.length > 0 ? (
        <div className="space-y-0.5">
          {units.map((unit, i) => (
            <div key={i} className="text-sm text-[color:var(--foreground)]">{i + 1}. {unit.trim()}</div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-[color:var(--muted-foreground)]/50">待补充</div>
      )}
    </div>
  );
}

type ArchiveStepState = 'PENDING' | 'READY' | 'DONE';

function getArchiveStepState(item: ProjectManagementItem): ArchiveStepState {
  if (item.status === 'ARCHIVED') {
    return 'DONE';
  }

  const contractStage = item.stages.find((stage) => stage.stageKey === 'CONTRACT');
  if (contractStage?.status === 'COMPLETED') {
    return 'READY';
  }

  return 'PENDING';
}

function getArchiveStepDescription(state: ArchiveStepState, item: ProjectManagementItem) {
  const contractStage = item.stages.find((stage) => stage.stageKey === 'CONTRACT');
  const missingFields: string[] = [];
  if (!item.departmentNumber || !item.departmentNumber.trim()) {
    missingFields.push('部门编号');
  }

  switch (state) {
    case 'DONE':
      return '项目已完成归档，并已同步生成正式采购台账记录。';
    case 'READY': {
      const base = '合同阶段已经完成。执行归档后，项目会从项目管理中移除，并生成采购台账记录。';
      if (missingFields.length > 0) {
        return `${base}（提示：${missingFields.join('、')}尚未填写，可在归档前补充。）`;
      }
      return base;
    }
    default: {
      if (contractStage?.status !== 'COMPLETED') {
        return '合同阶段尚未完成，完成后才会解锁归档。';
      }
      return '归档完成后项目会从项目管理中移除，只有合同阶段完成后才会解锁。';
    }
  }
}


export function ProjectDetailPanel({
  item,
  onClose,
  onUpdated,
  onMoveToRecycleBin,
  canModify = true,
  currentUsername,
}: {
  item: ProjectManagementItem;
  onClose: () => void;
  onUpdated: () => Promise<void>;
  onMoveToRecycleBin: (projectId: string) => Promise<void>;
  canModify?: boolean;
  currentUsername?: string;
}) {
  const [selectedStageKey, setSelectedStageKey] = useState(item.currentStage);

  // 本地 item 镜像 —— 上传后立即注入附件，不等父组件 onUpdated 回流
  const [localItem, setLocalItem] = useState(item);

  // 父组件重新渲染后同步本地镜像
  useEffect(() => { setLocalItem(item); }, [item]);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ completed: number; total: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [analysis, setAnalysis] = useState<ProjectDetailAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(true);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [extractedInfoOverride, setExtractedInfoOverride] = useState<Partial<ExtractedInfo> | null>(null);

  // 归属自动补全
  const [projectAttributions, setProjectAttributions] = useState<Array<{ name: string; contractNumber: string | null; usageCount: number }>>([]);
  const [attributionSearch, setAttributionSearch] = useState('');
  const [showAttributionDropdown, setShowAttributionDropdown] = useState(false);
  const attributionInputRef = useRef<HTMLDivElement | null>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  // 提取信息编辑状态
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValues, setEditValues] = useState({
    title: '',
    initiationDate: '',
    expertInfo: '',
    biddingUnits: '',
    awardedSupplier: '',
    contractAmount: '',
    demandProject: '',
    demandContractNumber: '',
    contractNumber: '',
    departmentNumber: '',
    projectOverview: '',
    bidOpeningTime: '',
    invitedSuppliers: '',
    paymentPerformance: '',
  });

  const selectedStage = useMemo(
    () =>
      localItem.stages.find((stage) => stage.stageKey === selectedStageKey) ??
      localItem.stages[0],
    [localItem.stages, selectedStageKey],
  );

  const archiveStepState = getArchiveStepState(item);
  const showArchiveStep = archiveStepState !== 'PENDING';
  const isCurrentStage = selectedStage.stageKey === localItem.currentStage;
  const stageLocked = selectedStage.status === 'NOT_STARTED';
  const hasStageFiles = (selectedStage.attachments?.length ?? 0) > 0;
  const stageProcessing = uploading || analysisLoading;
  const canCompleteStage =
    isCurrentStage && selectedStage.status !== 'COMPLETED' && !stageLocked && !stageProcessing;
  const canArchive = archiveStepState === 'READY';
  const focusAccentClassName = `pm-stage-accent--${selectedStage.stageKey.toLowerCase()}`;

  // 采购文件步骤中已上传的 .docx 附件（供阶段卡片编辑按钮使用）
  const tenderDocxFiles = useMemo(() => {
    const stage = localItem.stages.find((s) => s.stageKey === 'TENDER_DOCUMENT');
    if (!stage) return [];
    return stage.attachments
      .filter((a) => a.fileName.toLowerCase().endsWith('.docx'))
      .map((a) => ({ id: a.id!, fileName: a.fileName }));
  }, [localItem.stages]);

  const stageFileAnalysis = useMemo(
    () => analysis?.fileAnalyses ?? [],
    [analysis],
  );

  const currentFileAnalysis = stageFileAnalysis[currentFileIndex];

  // 用于触发文件分析刷新的计数器（仅在文件上传后增加）
  const [summaryRefreshing, setSummaryRefreshing] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [tenderWriteStageAction, setTenderWriteStageAction] = useState<string | null>(null);
  const [expertExtractOpen, setExpertExtractOpen] = useState(false);
  const [supplierExtractOpen, setSupplierExtractOpen] = useState(false);
  const [announcementPublishOpen, setAnnouncementPublishOpen] = useState(false);
  const [editingFile, setEditingFile] = useState<{ attachmentId: string; fileName: string } | null>(null);

  // 步骤检查状态 —— 按 stageKey 缓存结果
  const complianceCache = useRef<Map<string, ComplianceAuditResponse>>(new Map());
  const [complianceAudit, setComplianceAudit] = useState<ComplianceAuditResponse | null>(null);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [complianceError, setComplianceError] = useState<string | null>(null);

  // 自动触发步骤检查：阶段切换时优先使用缓存，缓存未命中时请求 API
  // 未开始的阶段（NOT_STARTED）不触发步骤检查
  const runComplianceAudit = useCallback((force = false) => {
    if (stageLocked) {
      setComplianceAudit(null);
      setComplianceError(null);
      setComplianceLoading(false);
      return;
    }
    if (!hasStageFiles) {
      setComplianceAudit(null);
      setComplianceError(null);
      setComplianceLoading(false);
      return;
    }
    const cacheKey = `${item.id}:${selectedStage.stageKey}`;
    if (!force) {
      const cached = complianceCache.current.get(cacheKey);
      if (cached) {
        setComplianceAudit(cached);
        setComplianceError(null);
        return;
      }
    }
    setComplianceLoading(true);
    setComplianceError(null);
    auditStageCompliance(item.id, selectedStage.stageKey, force)
      .then((result) => {
        // Only cache successful results (not AI fallback)
        const isFallback = result.results.every(r => r.evidence.includes('AI 审查服务暂不可用'));
        if (!isFallback) {
          complianceCache.current.set(cacheKey, result);
        }
        setComplianceAudit(result);
      })
      .catch((err) => { setComplianceError(err instanceof Error ? err.message : '步骤检查请求失败'); })
      .finally(() => setComplianceLoading(false));
  }, [item.id, selectedStage.stageKey, stageLocked, hasStageFiles]);
  // 项目切换时清空步骤检查缓存
  useEffect(() => {
    complianceCache.current.clear();
    setComplianceAudit(null);
    setComplianceError(null);
  }, [item.id]);

  useEffect(() => {
    runComplianceAudit();
  }, [runComplianceAudit]);

  // Load project attributions for autocomplete
  useEffect(() => {
    fetchProjectAttributions()
      .then(setProjectAttributions)
      .catch(() => setProjectAttributions([]));
  }, []);

  const filteredAttributions = projectAttributions.filter((attr) =>
    attr.name.toLowerCase().includes(attributionSearch.toLowerCase()),
  );

  // Reset file index when stage changes
  useEffect(() => {
    setCurrentFileIndex(0);
    // Clear selected files and reset file input when stage changes
    setSelectedFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [selectedStage.stageKey]);

  const openAttributionDropdown = () => {
    setAttributionSearch(editValues.demandProject);
    setShowAttributionDropdown(true);
    // Compute fixed position so the dropdown escapes overflow-hidden ancestors
    if (attributionInputRef.current) {
      const rect = attributionInputRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        zIndex: 200,
      });
    }
  };
  useEffect(() => {
    if (!showAttributionDropdown) return;
    const close = () => setShowAttributionDropdown(false);
    const reposition = () => {
      if (attributionInputRef.current) {
        const rect = attributionInputRef.current.getBoundingClientRect();
        setDropdownStyle({
          position: 'fixed',
          top: rect.bottom + 4,
          left: rect.left,
          width: rect.width,
          zIndex: 200,
        });
      }
    };
    const timer = setTimeout(() => document.addEventListener('click', close), 0);
    window.addEventListener('scroll', reposition, { passive: true, capture: true });
    window.addEventListener('resize', reposition);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', close);
      window.removeEventListener('scroll', reposition, { capture: true });
      window.removeEventListener('resize', reposition);
    };
  }, [showAttributionDropdown]);

  // 文件分析：组件挂载或切换阶段时加载（使用缓存）
  // 上传后的分析由 uploadStageFiles 直接调用，避免 useEffect 竞态
  const loadAnalysis = useCallback(() => {
    setAnalysisLoading(true);
    setAnalysisError(null);
    analyzeProjectManagementItem(item.id, selectedStage.stageKey)
      .then((nextAnalysis) => { setAnalysis(nextAnalysis); })
      .catch((error) => { setAnalysisError(error instanceof Error ? error.message : 'AI 分析暂不可用。'); })
      .finally(() => { setAnalysisLoading(false); });
  }, [item.id, selectedStage.stageKey]);

  useEffect(() => {
    loadAnalysis();
  }, [loadAnalysis]);


  const markStageCompleted = async (stage: ProjectManagementStage) => {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      // Determine the next stage BEFORE onUpdated so the closure isn't stale
      const currentIndex = localItem.stages.findIndex(
        (s) => s.stageKey === stage.stageKey,
      );
      const nextStageKey = localItem.stages[currentIndex + 1]?.stageKey;

      await updateProjectStage(item.id, stage.stageKey, { status: 'COMPLETED' });
      await onUpdated();

      // Auto-advance to the next stage; useEffect on selectedStageKey triggers analysis
      if (nextStageKey) {
        setSelectedStageKey(nextStageKey);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '更新阶段失败。');
    } finally {
      setSubmitting(false);
    }
  };

  const uploadStageFiles = async () => {
    if (selectedFiles.length === 0) {
      setErrorMessage('请先选择要上传的文件。');
      return;
    }

    if (stageLocked) {
      setErrorMessage('请先完成上一阶段后再上传当前阶段材料。');
      return;
    }

    setUploading(true);
    setErrorMessage(null);
    setUploadProgress({ completed: 0, total: selectedFiles.length });

    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        setUploadProgress({ completed: i, total: selectedFiles.length });
        const result = await uploadProjectStageAttachment(
          item.id,
          selectedStage.stageKey,
          selectedFiles[i],
        );
        // 立即注入本地附件列表（不等父组件刷新）
        if (result.objectKey) {
          setLocalItem(prev => {
            const newStages = prev.stages.map(s =>
              s.stageKey !== selectedStage.stageKey ? s
                : { ...s, attachments: [...s.attachments, result] }
            );
            return { ...prev, stages: newStages };
          });
        }
        // Update extracted info immediately from upload response
        if (result.extractedInfo) {
          const info = result.extractedInfo;
          setExtractedInfoOverride((prev) => {
            const next = { ...prev };
            for (const [key, value] of Object.entries(info)) {
              if (value !== null && value !== undefined && value !== '') {
                next[key as keyof ExtractedInfo] = value as never;
              }
            }
            return next;
          });
        }
      }

      setSelectedFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      // End upload phase, start analysis phase
      setUploading(false);
      setUploadProgress(null);
      setAnalysisLoading(true);

      // 后台异步刷新父组件数据（不阻塞后续分析）
      onUpdated().catch(() => {});

      // 2. Load analysis directly (not via useEffect) to avoid race conditions
      setAnalysisError(null);
      try {
        const nextAnalysis = await analyzeProjectManagementItem(item.id, selectedStage.stageKey);
        setAnalysis(nextAnalysis);
        // Jump to the newest uploaded file
        if (nextAnalysis.fileAnalyses && nextAnalysis.fileAnalyses.length > 0) {
          setCurrentFileIndex(nextAnalysis.fileAnalyses.length - 1);
        }
      } catch (analysisErr) {
        setAnalysisError(analysisErr instanceof Error ? analysisErr.message : 'AI 分析暂不可用。');
      } finally {
        setAnalysisLoading(false);
      }

      // 3. 上传文件后刷新当前阶段的步骤检查
      complianceCache.current.delete(`${item.id}:${selectedStage.stageKey}`);
      runComplianceAudit(true);

    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '上传阶段文件失败。');
      setUploading(false);
      setAnalysisLoading(false);
      setUploadProgress(null);
    }
  };

  const archiveProject = async () => {
    // Show confirmation dialog first
    setShowArchiveConfirm(true);
  };

  const confirmArchive = async () => {
    setShowArchiveConfirm(false);
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await completeProjectManagementItem(item.id);
      await onUpdated();
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '项目归档失败。');
    } finally {
      setSubmitting(false);
    }
  };

  const moveToRecycleBin = async () => {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await onMoveToRecycleBin(item.id);
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '移至回收站失败。');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartEdit = (field: string, currentValue: string | number | null | undefined) => {
    setEditingField(field);
    let value = currentValue != null ? String(currentValue) : '';
    // 投标单位字段：将顿号分隔转换为换行分隔，以便表格正确解析
    if (field === 'biddingUnits' && value) {
      value = value.split(/[、,]/).join('\n');
    }
    setEditValues((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSaveField = async (field: string) => {
    const value = editValues[field as keyof typeof editValues];
    const payload: Record<string, unknown> = {};

    if (field === 'contractAmount') {
      const num = Number.parseFloat(value);
      payload[field] = Number.isNaN(num) ? null : num;
    } else if (field === 'initiationDate') {
      payload[field] = value || null;
    } else {
      payload[field] = value || null;
    }

    try {
      await updateProjectExtractedInfo(item.id, payload);
      setEditingField(null);
      // Clear the override for this field so the DB value takes display precedence
      setExtractedInfoOverride((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        delete next[field as keyof ExtractedInfo];
        if (Object.keys(next).length === 0) return null;
        return next;
      });
      await onUpdated();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '保存失败。');
    }
  };

  const formatDate = (value: string | number | null | undefined) => {
    if (!value) return '';
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('zh-CN');
  };

  const formatAmount = (value: string | number | null | undefined) => {
    if (value == null) return '';
    const num = Number(value);
    if (Number.isNaN(num)) return String(value);
    return `${num.toLocaleString('zh-CN')} 元`;
  };

  return (
    <>
      <div className="pm-detail-overlay absolute inset-0 z-[120] rounded-[24px] bg-[var(--background)]/60 backdrop-blur-[3px]" />

      <section className="absolute inset-0 z-[121] overflow-y-auto rounded-[24px] bg-[var(--background)] shadow-[0_20px_60px_rgba(0,0,0,0.12)]">
        {/* ══════ page-hero: 标题 + 简报 + 流程 ══════ */}
        <div className="page-hero">
          {/* ── row 1: 标题 + meta + 操作按钮 ── */}
          <div className="page-hero__row">
            <div className="page-hero__left">
              <div className="page-hero__icon">
                <FileText size={17} />
              </div>
              <div>
                <div className="page-hero__title">{item.title}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-[6px] bg-[color-mix(in_oklch,var(--muted-foreground)_8%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--muted-foreground)]">{item.requesterDepartment}</span>
                  <span className="inline-flex items-center rounded-[6px] bg-[color-mix(in_oklch,var(--muted-foreground)_8%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--muted-foreground)]">{item.requesterName}</span>
                  <span className="inline-flex items-center rounded-[6px] bg-[color-mix(in_oklch,var(--muted-foreground)_8%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--muted-foreground)]">{item.procurementMethod || '待补充采购方式'}</span>
                  <span className="inline-flex items-center gap-1 rounded-[6px] bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] px-2.5 py-1 text-[11px] font-bold text-[color:var(--accent)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />{selectedStage.stageName}
                  </span>
                </div>
              </div>
            </div>
            <div className="page-hero__right">
              {canModify && (
                <button type="button" onClick={() => void moveToRecycleBin()} disabled={submitting || uploading} className="neu-btn-soft is-danger">
                  <Recycle size={16} />移至回收站
                </button>
              )}
              <button type="button" onClick={onClose} className="neu-btn-soft">
                <X size={16} />关闭
              </button>
            </div>
          </div>

          {/* ── hairline + 项目简报 ── */}
          <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">项目简报</span>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[color:var(--muted-foreground)] transition-colors hover:bg-[color:var(--muted)] hover:text-[color:var(--foreground)] disabled:opacity-50"
                disabled={summaryRefreshing}
                onClick={() => {
                  setSummaryRefreshing(true);
                  refreshProjectSummary(item.id)
                    .then((result) => {
                      setAnalysis((prev) => ({
                        summary: { stageMatch: '项目简报', contentSummary: result.summary },
                        fileAnalyses: prev?.fileAnalyses ?? [],
                      }));
                    })
                    .catch(() => {})
                    .finally(() => setSummaryRefreshing(false));
                }}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${summaryRefreshing ? 'animate-spin' : ''}`} />
                刷新简报
              </button>
            </div>
            <div className="rounded-[16px] bg-[color-mix(in_oklch,var(--muted)_30%,transparent)] px-4 py-4 min-h-[80px]" style={{boxShadow:"inset 1px 2px 4px oklch(0.55 0.03 258 / 0.12), inset -1px -1px 2px oklch(1 0 0 / 0.4)"}}>
              <div className="text-sm leading-6 text-[color:var(--foreground)]">
                {analysisLoading
                  ? '正在生成项目简报...'
                  : analysis?.summary.contentSummary || '当前没有可供分析的项目文件内容。'}
              </div>
              {analysisError ? (
                <div className="mt-2 text-xs text-[color:var(--danger)]">{analysisError}</div>
              ) : null}
            </div>
          </div>

          {/* ── hairline + 采购流程 ── */}
          <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">采购流程</span>
              <span className="text-[10px] font-semibold text-[color:var(--accent)]">当前聚焦：{selectedStage.stageName}</span>
            </div>
            <ProjectStageTimeline
              stages={localItem.stages}
              activeStageKey={selectedStage.stageKey}
              onSelect={setSelectedStageKey}
              onStageAction={(stageKey) => {
                if (stageKey === 'TENDER_DOCUMENT') {
                  setTenderWriteStageAction(stageKey);
                } else if (stageKey === 'EXPERT_SELECTION') {
                  setExpertExtractOpen(true);
                } else if (stageKey === 'SUPPLIER_INVITATION') {
                  setSupplierExtractOpen(true);
                } else if (stageKey === 'PUBLIC_ANNOUNCEMENT') {
                  setAnnouncementPublishOpen(true);
                }
              }}
              showArchiveStep={showArchiveStep}
              archiveStepState={archiveStepState}
              tenderDocxAttachments={tenderDocxFiles}
              onEditTenderFile={(attachmentId, fileName) => setEditingFile({ attachmentId, fileName })}
            />

            {showArchiveStep ? (
              <div className={[
                'mt-4 rounded-[16px] px-4 py-3 text-sm',
                archiveStepState === 'DONE'
                  ? 'bg-[color-mix(in_oklch,var(--success)_10%,transparent)] border border-[color-mix(in_oklch,var(--success)_22%,transparent)]'
                  : 'bg-[color-mix(in_oklch,var(--warning)_8%,transparent)] border border-[color-mix(in_oklch,var(--warning)_18%,transparent)]',
              ].join(' ')}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <span className={archiveStepState === 'DONE' ? 'text-[color:var(--success)]' : 'text-[color:var(--warning)]'} style={{fontWeight:700,fontSize:'0.8rem'}}>
                      {archiveStepState === 'DONE' ? '已归档' : archiveStepState === 'READY' ? '待确认归档' : '未解锁'}
                    </span>
                    <p className="mt-1 max-w-[72ch] text-xs leading-5 text-[color:var(--muted-foreground)]">
                      {getArchiveStepDescription(archiveStepState, item)}
                    </p>
                  </div>
                  {archiveStepState === 'READY' && (
                    <button
                      type="button"
                      disabled={!canArchive || submitting}
                      onClick={() => void archiveProject()}
                      className="neu-btn-primary shrink-0"
                    >
                      <Archive size={14} />
                      {submitting ? '归档中...' : '确认归档'}
                    </button>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* ══════ 双栏正文 —— 列 bg 无外层 px 包裹，文本左缘 = page-hero 左缘(均为 px-5) ══════ */}
        <div className="pb-5">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
            {/* ── 左栏：wb-panel 玻璃容器（渐变 + 内高光 + 方向性三影）── */}
            <div className="wb-panel gap-5 px-5 py-5">
              <div className="flex items-center gap-2.5 -mx-5 -mt-5 px-5 py-3.5 rounded-t-[20px]"
                style={{
                  background: "linear-gradient(105deg, oklch(1 0 0 / 0.9) 0%, oklch(0.98 0.003 258 / 0.55) 60%)",
                  borderBottom: "1px solid oklch(0.6 0.04 258 / 0.16)",
                }}>
                <div className="flex h-8 w-8 items-center justify-center rounded-[10px]"
                  style={{background:"color-mix(in oklch,var(--accent-soft) 45%,transparent)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)"}}>
                  <FileText size={15} className="text-[color:var(--accent)]" />
                </div>
                <div>
                  <div className="text-sm font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                    项目基本信息
                  </div>
                </div>
              </div>

              {/* ── 采购需求及立项 ── */}
              <div className="rounded-[16px] px-4 py-3.5"
                style={{background:"oklch(1 0 0 / 0.32)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.7)"}}>
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]" style={{background:"var(--stage-demand-soft)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)"}}>
                    <ClipboardList size={14} style={{color:"var(--stage-demand)"}} />
                  </div>
                  <span className="text-sm font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">采购需求及立项</span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="col-span-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">项目名称</span>
                    {editingField === 'title' ? (
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <input type="text" value={editValues.title} onChange={(e) => setEditValues((prev) => ({ ...prev, title: e.target.value }))} className="workbench-input !h-[28px] !text-xs flex-1" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveField('title'); if (e.key === 'Escape') setEditingField(null); }} />
                        <button type="button" onClick={() => void handleSaveField('title')} className="neu-btn-xs"><Save size={13} /></button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => handleStartEdit('title', item.title)} className="group mt-0.5 flex items-center gap-1 w-full text-left">
                        <span className="font-semibold text-[color:var(--foreground)]">{item.title || <span className="text-[color:var(--muted-foreground)]/50">未命名项目</span>}</span>
                        <Pencil size={10} className="opacity-0 transition group-hover:opacity-100 shrink-0 text-[color:var(--muted-foreground)]" />
                      </button>
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">申请人</span>
                    <div className="mt-0.5 text-[color:var(--foreground)]">{item.requesterName}</div>
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">申请部门</span>
                    <div className="mt-0.5 text-[color:var(--foreground)]">{item.requesterDepartment}</div>
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">采购方式</span>
                    <div className="mt-0.5 text-sm text-[color:var(--foreground)]">{item.procurementMethod || <span className="text-[color:var(--muted-foreground)]/50">待补充</span>}</div>
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">采购类别</span>
                    <div className="mt-0.5 text-sm text-[color:var(--foreground)]">{item.procurementCategory || <span className="text-[color:var(--muted-foreground)]/50">待补充</span>}</div>
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">预算金额</span>
                    <div className="mt-0.5 font-black tracking-[-0.02em] tabular-nums text-[color:var(--foreground)]">{item.budgetAmount.toLocaleString('zh-CN')} <span className="text-[10px] font-semibold text-[color:var(--muted-foreground)]">元</span></div>
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">立项时间</span>
                    {editingField === 'initiationDate' ? (
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <input type="date" value={editValues.initiationDate} onChange={(e) => setEditValues((prev) => ({ ...prev, initiationDate: e.target.value }))} className="workbench-input !h-[28px] !text-xs" autoFocus />
                        <button type="button" onClick={() => void handleSaveField('initiationDate')} className="neu-btn-xs"><Save size={13} /></button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => handleStartEdit('initiationDate', extractedInfoOverride?.initiationDate ?? item.initiationDate)} className="group mt-0.5 flex items-center gap-1">
                        <span className="text-sm text-[color:var(--foreground)]">{formatDate(extractedInfoOverride?.initiationDate ?? item.initiationDate) || <span className="text-[color:var(--muted-foreground)]/50">待补充</span>}</span>
                        <Pencil size={10} className="opacity-0 transition group-hover:opacity-100 text-[color:var(--muted-foreground)]" />
                      </button>
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">所属项目</span>
                    {editingField === 'demandProject' ? (
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <div ref={attributionInputRef} className="relative flex-1">
                          <input type="text" value={editValues.demandProject} onChange={(e) => { setEditValues((prev) => ({ ...prev, demandProject: e.target.value })); openAttributionDropdown(); }} onFocus={openAttributionDropdown} onScroll={(e) => e.stopPropagation()} className="workbench-input !h-[28px] !text-xs" placeholder="输入或选择归属项目" autoFocus />
                          {showAttributionDropdown && (
                            <div className="absolute left-0 right-0 top-full z-[200] mt-1 overflow-hidden rounded-xl border border-[color-mix(in_oklch,var(--border)_60%,transparent)] bg-[var(--background)] shadow-[0_12px_32px_rgba(0,0,0,0.1)] py-1">
                              {filteredAttributions.slice(0, 7).map((attr) => (
                                <button key={attr.name} type="button" onClick={() => { setEditValues((prev) => ({ ...prev, demandProject: attr.name, demandContractNumber: attr.contractNumber || prev.demandContractNumber })); setShowAttributionDropdown(false); }} className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-[color:var(--muted)]">
                                  <span className="text-[color:var(--foreground)]">{attr.name}</span>
                                  {attr.contractNumber && <span className="text-[11px] text-[color:var(--muted-foreground)]">{attr.contractNumber}</span>}
                                </button>
                              ))}
                              {!filteredAttributions.some((a) => a.name === '其他') && (
                                <button type="button" onClick={() => { setEditValues((prev) => ({ ...prev, demandProject: '其他' })); setShowAttributionDropdown(false); }} className="flex w-full items-center px-3 py-1.5 text-left text-sm hover:bg-[color:var(--muted)] text-[color:var(--foreground)]">其他</button>
                              )}
                            </div>
                          )}
                        </div>
                        <button type="button" onClick={() => void handleSaveField('demandProject')} className="neu-btn-xs"><Save size={13} /></button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => { handleStartEdit('demandProject', item.demandProject || ''); setAttributionSearch(item.demandProject || ''); }} className="group mt-0.5 flex items-center gap-1">
                        <span className={item.demandProject ? 'text-sm text-[color:var(--foreground)]' : 'text-sm text-[color:var(--muted-foreground)]/50'}>{item.demandProject || '待补充'}</span>
                        <Pencil size={10} className="opacity-0 transition group-hover:opacity-100 text-[color:var(--muted-foreground)]" />
                      </button>
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">合同编号</span>
                    {editingField === 'contractNumber' ? (
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <input type="text" value={editValues.contractNumber} onChange={(e) => setEditValues((prev) => ({ ...prev, contractNumber: e.target.value }))} className="workbench-input !h-[28px] !text-xs" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveField('contractNumber'); if (e.key === 'Escape') setEditingField(null); }} />
                        <button type="button" onClick={() => void handleSaveField('contractNumber')} className="neu-btn-xs"><Save size={13} /></button>
                        <button type="button" onClick={() => setEditingField(null)} className="neu-btn-xs"><X size={13} /></button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => handleStartEdit('contractNumber', extractedInfoOverride?.contractNumber ?? (item.contractNumber || item.demandContractNumber || ''))} className="group mt-0.5 flex items-center gap-1">
                        <span className="text-[color:var(--foreground)]">{extractedInfoOverride?.contractNumber ?? item.contractNumber ?? item.demandContractNumber ?? '无'}</span>
                        <Pencil size={10} className="opacity-0 transition group-hover:opacity-100 text-[color:var(--muted-foreground)]" />
                      </button>
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">部门编号</span>
                    <div className="mt-0.5 text-[color:var(--foreground)]">{item.departmentNumber || '无'}</div>
                  </div>
                </div>
                <div className="mt-3 pt-3" style={{borderTop:"1px solid oklch(0.6 0.04 258 / 0.12)"}}>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">申请立项事由</span>
                  <div className="mt-1 text-sm leading-6 text-[color:var(--foreground)]">{item.projectReason || <span className="text-[color:var(--muted-foreground)]/50">待补充</span>}</div>
                </div>
                <div className="mt-3">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">对供方的主要要求</span>
                  <div className="mt-1 text-sm leading-6 text-[color:var(--foreground)]">{item.supplierRequirements || '无'}</div>
                </div>
              </div>

              {/* ── 采购文件 ── */}
              <div className="rounded-[16px] px-4 py-3.5"
                style={{background:"oklch(1 0 0 / 0.32)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.7)"}}>
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]" style={{background:"var(--stage-tender-soft)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)"}}>
                    <FileText size={14} style={{color:"var(--stage-tender)"}} />
                  </div>
                  <span className="text-sm font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">采购文件</span>
                </div>
                <div className="space-y-3">
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">项目概况</span>
                    {editingField === 'projectOverview' ? (
                      <div className="mt-1 flex items-start gap-2">
                        <textarea value={editValues.projectOverview} onChange={(e) => setEditValues((prev) => ({ ...prev, projectOverview: e.target.value }))} className="workbench-input !text-xs flex-1 min-h-[60px]" autoFocus />
                        <button type="button" onClick={() => void handleSaveField('projectOverview')} className="neu-btn-xs mt-1"><Save size={13} /></button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => handleStartEdit('projectOverview', extractedInfoOverride?.projectOverview ?? item.projectOverview ?? null)} className="group mt-1 block w-full text-left">
                        <span className={`text-sm leading-6 ${(extractedInfoOverride?.projectOverview ?? item.projectOverview) ? 'text-[color:var(--foreground)]' : 'text-[color:var(--muted-foreground)]/50'}`}>{(extractedInfoOverride?.projectOverview ?? item.projectOverview) || '待补充'}</span>
                        <Pencil size={10} className="inline opacity-0 transition group-hover:opacity-100 text-[color:var(--muted-foreground)] ml-1" />
                      </button>
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">开标时间</span>
                    {editingField === 'bidOpeningTime' ? (
                      <div className="mt-1 flex items-center gap-1.5">
                        <input type="text" value={editValues.bidOpeningTime} onChange={(e) => setEditValues((prev) => ({ ...prev, bidOpeningTime: e.target.value }))} className="workbench-input !h-[28px] !text-xs" placeholder="如 2026年8月15日" autoFocus />
                        <button type="button" onClick={() => void handleSaveField('bidOpeningTime')} className="neu-btn-xs"><Save size={13} /></button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => handleStartEdit('bidOpeningTime', extractedInfoOverride?.bidOpeningTime ?? item.bidOpeningTime ?? null)} className="group mt-0.5 flex items-center gap-1">
                        <span className={`text-sm ${(extractedInfoOverride?.bidOpeningTime ?? item.bidOpeningTime) ? 'text-[color:var(--foreground)]' : 'text-[color:var(--muted-foreground)]/50'}`}>{(extractedInfoOverride?.bidOpeningTime ?? item.bidOpeningTime) || '待补充'}</span>
                        <Pencil size={10} className="opacity-0 transition group-hover:opacity-100 text-[color:var(--muted-foreground)]" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* ── 供应商邀请（谈判采购、询比采购）── */}
              {(item.procurementMethod === '谈判采购' || item.procurementMethod === '询比采购') && (
              <div className="rounded-[16px] px-4 py-3.5"
                style={{background:"oklch(1 0 0 / 0.32)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.7)"}}>
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]" style={{background:"var(--stage-announce-soft)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)"}}>
                    <UserPlus size={14} style={{color:"var(--stage-announce)"}} />
                  </div>
                  <span className="text-sm font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">供应商邀请</span>
                </div>
                <BiddingUnitsField
                  label="邀请的供应商"
                  value={extractedInfoOverride?.invitedSuppliers ?? item.invitedSuppliers ?? null}
                  isEditing={editingField === 'invitedSuppliers'}
                  editValue={editValues.invitedSuppliers}
                  onEditValueChange={(v) => setEditValues((prev) => ({ ...prev, invitedSuppliers: v }))}
                  onStartEdit={() => handleStartEdit('invitedSuppliers', extractedInfoOverride?.invitedSuppliers ?? item.invitedSuppliers ?? null)}
                  onSave={() => void handleSaveField('invitedSuppliers')}
                />
              </div>
              )}

              {/* ── 专家评审 ── */}
              <div className="rounded-[16px] px-4 py-3.5"
                style={{background:"oklch(1 0 0 / 0.32)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.7)"}}>
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]" style={{background:"var(--stage-expert-soft)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)"}}>
                    <Shield size={14} style={{color:"var(--stage-expert)"}} />
                  </div>
                  <span className="text-sm font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">专家评审</span>
                </div>
                <ExpertInfoField
                  value={extractedInfoOverride?.expertInfo ?? item.expertInfo}
                  isEditing={editingField === 'expertInfo'}
                  editValue={editValues.expertInfo}
                  onEditValueChange={(v) => setEditValues((prev) => ({ ...prev, expertInfo: v }))}
                  onStartEdit={() => handleStartEdit('expertInfo', extractedInfoOverride?.expertInfo ?? item.expertInfo)}
                  onSave={() => void handleSaveField('expertInfo')}
                />
              </div>

              {/* ── 开标评标 ── */}
              <div className="rounded-[16px] px-4 py-3.5"
                style={{background:"oklch(1 0 0 / 0.32)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.7)"}}>
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]" style={{background:"var(--stage-evaluation-soft)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)"}}>
                    <Gavel size={14} style={{color:"var(--stage-evaluation)"}} />
                  </div>
                  <span className="text-sm font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">开标评标</span>
                </div>
                <div className="space-y-3">
                  {/* 谈判采购和询比采购不展示投标单位（已在供应商邀请中展示）*/}
                  {item.procurementMethod !== '谈判采购' && item.procurementMethod !== '询比采购' && (
                    <BiddingUnitsField
                      label="投标单位"
                      value={extractedInfoOverride?.biddingUnits ?? item.biddingUnits}
                      isEditing={editingField === 'biddingUnits'}
                      editValue={editValues.biddingUnits}
                      onEditValueChange={(v) => setEditValues((prev) => ({ ...prev, biddingUnits: v }))}
                      onStartEdit={() => handleStartEdit('biddingUnits', extractedInfoOverride?.biddingUnits ?? item.biddingUnits)}
                      onSave={() => void handleSaveField('biddingUnits')}
                    />
                  )}
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">中标单位</span>
                    {editingField === 'awardedSupplier' ? (
                      <div className="mt-1 flex items-center gap-1.5">
                        <input type="text" value={editValues.awardedSupplier} onChange={(e) => setEditValues((prev) => ({ ...prev, awardedSupplier: e.target.value }))} className="workbench-input !h-[28px] !text-xs" autoFocus />
                        <button type="button" onClick={() => void handleSaveField('awardedSupplier')} className="neu-btn-xs"><Save size={13} /></button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => handleStartEdit('awardedSupplier', extractedInfoOverride?.awardedSupplier ?? item.awardedSupplier)} className="group mt-1 flex items-center gap-1">
                        <span className="text-sm text-[color:var(--foreground)]">{(extractedInfoOverride?.awardedSupplier ?? item.awardedSupplier) || <span className="text-[color:var(--muted-foreground)]/50">待确定</span>}</span>
                        <Pencil size={10} className="opacity-0 transition group-hover:opacity-100 text-[color:var(--muted-foreground)]" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* ── 合同 ── */}
              <div className="rounded-[16px] px-4 py-3.5"
                style={{background:"oklch(1 0 0 / 0.32)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.7)"}}>
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]" style={{background:"var(--stage-contract-soft)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)"}}>
                    <ScrollText size={14} style={{color:"var(--stage-contract)"}} />
                  </div>
                  <span className="text-sm font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">合同</span>
                </div>
                <div className="space-y-3">
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">支付及履约内容</span>
                    {editingField === 'paymentPerformance' ? (
                      <div className="mt-1 flex items-start gap-2">
                        <textarea value={editValues.paymentPerformance} onChange={(e) => setEditValues((prev) => ({ ...prev, paymentPerformance: e.target.value }))} className="workbench-input !text-xs flex-1 min-h-[60px]" autoFocus />
                        <button type="button" onClick={() => void handleSaveField('paymentPerformance')} className="neu-btn-xs mt-1"><Save size={13} /></button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => handleStartEdit('paymentPerformance', extractedInfoOverride?.paymentPerformance ?? item.paymentPerformance ?? null)} className="group mt-1 block w-full text-left">
                        <span className={`text-sm leading-6 ${(extractedInfoOverride?.paymentPerformance ?? item.paymentPerformance) ? 'text-[color:var(--foreground)]' : 'text-[color:var(--muted-foreground)]/50'}`}>{(extractedInfoOverride?.paymentPerformance ?? item.paymentPerformance) || '待补充'}</span>
                        <Pencil size={10} className="inline opacity-0 transition group-hover:opacity-100 text-[color:var(--muted-foreground)] ml-1" />
                      </button>
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">合同金额</span>
                    {editingField === 'contractAmount' ? (
                      <div className="mt-1 flex items-center gap-1.5">
                        <input type="number" value={editValues.contractAmount} onChange={(e) => setEditValues((prev) => ({ ...prev, contractAmount: e.target.value }))} className="workbench-input !h-[28px] !text-xs" placeholder="输入金额" autoFocus />
                        <button type="button" onClick={() => void handleSaveField('contractAmount')} className="neu-btn-xs"><Save size={13} /></button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => handleStartEdit('contractAmount', extractedInfoOverride?.contractAmount ?? item.contractAmount)} className="group mt-1 flex items-center gap-1">
                        <span className="text-base font-black tracking-[-0.03em] tabular-nums text-[color:var(--foreground)]">{formatAmount(extractedInfoOverride?.contractAmount ?? item.contractAmount) || <span className="text-sm font-normal text-[color:var(--muted-foreground)]/50">待确定</span>}</span>
                        <Pencil size={10} className="opacity-0 transition group-hover:opacity-100 text-[color:var(--muted-foreground)]" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* 阶段提示 */}
              <div className="flex items-start gap-3 rounded-xl bg-[color-mix(in_oklch,var(--accent-soft)_30%,transparent)] px-4 py-3">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 shrink-0 text-[color:var(--accent)]">
                  <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
                </svg>
                <span className="text-xs leading-5 text-[color:var(--foreground)]">
                  {isCurrentStage ? '当前阶段可以继续补充材料，完成后系统会自动解锁下一步。' : stageLocked ? '该阶段尚未解锁，需要先完成前一个阶段。' : '该阶段已完成，可继续查看或补充附件。'}
                </span>
              </div>
            </div>

            {/* ── 右栏：wb-panel 玻璃容器（渐变 + 内高光 + 方向性三影）── */}
            <div className="wb-panel gap-5 px-5 py-5">
              {/* 阶段标题行 —— cgzxui header bar */}
              <div className="flex items-center justify-between gap-3 -mx-5 -mt-5 px-5 py-3.5 rounded-t-[20px]"
                style={{
                  background: "linear-gradient(105deg, oklch(1 0 0 / 0.9) 0%, oklch(0.98 0.003 258 / 0.55) 60%)",
                  borderBottom: "1px solid oklch(0.6 0.04 258 / 0.16)",
                }}>
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-[10px]"
                    style={{background:"color-mix(in oklch,var(--accent-soft) 45%,transparent)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)"}}>
                    <UploadCloud size={15} className="text-[color:var(--accent)]" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">{selectedStage.stageName}</div>
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center rounded-[5px] px-2 py-0.5 text-[10px] font-semibold tracking-[0.1em]"
                  style={{background:"color-mix(in oklch,var(--accent-soft) 40%,transparent)",color:"var(--accent)"}}>
                  {PROJECT_STAGE_STATUS_LABELS[selectedStage.status]}
                </span>
              </div>

              {/* 阶段描述 */}
              <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">
                {stageLocked ? '当前阶段尚未解锁。请先完成上一个阶段，再继续上传当前材料。' : selectedStage.status === 'COMPLETED' ? '当前阶段已完成。仍可继续补充材料，保持归档完整。' : '请上传当前阶段所需材料，确认无误后再推进到下一阶段。'}
              </p>

              {/* 已上传文件列表 */}
              <StageFileList
                files={selectedStage.attachments}
                projectId={item.id}
                onDeleted={async (deletedObjectKey) => {
                  await onUpdated();
                  if (analysis) { setAnalysis({ ...analysis, fileAnalyses: analysis.fileAnalyses.filter((fa) => fa.objectKey !== deletedObjectKey) }); }
                  // 删除文件后刷新当前阶段的步骤检查
                  complianceCache.current.delete(`${item.id}:${selectedStage.stageKey}`);
                  runComplianceAudit(true);
                }}
                onEdit={(attachmentId, fileName) => setEditingFile({ attachmentId, fileName })}
              />

              {/* ── 上传区 —— cgzxui 内凹底 ── */}
              <div className="rounded-xl p-4" style={{background:"color-mix(in oklch,var(--muted) 25%,transparent)",boxShadow:"inset 1px 2px 5px oklch(0.55 0.03 258 / 0.14), inset -1px -1px 2px oklch(1 0 0 / 0.5)"}}>
                <label className={`flex cursor-pointer items-center justify-center gap-3 rounded-lg px-4 py-3 transition ${stageLocked ? 'cursor-not-allowed opacity-40' : 'bg-[oklch(1_0_0/0.5)] hover:bg-[oklch(1_0_0/0.75)]'}`} style={stageLocked ? {} : {boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.8)"}}>
                  <UploadCloud size={20} className="shrink-0 text-[color:var(--muted-foreground)]" />
                  <div className="min-w-0 text-left">
                    <span className="text-sm font-medium text-[color:var(--foreground)]">{selectedFiles.length > 0 ? `已选择 ${selectedFiles.length} 个文件` : '选取文件（支持多选）'}</span>
                    <span className="mt-0.5 block text-xs text-[color:var(--muted-foreground)]">{selectedFiles.length > 0 ? '点击重新选择' : '点击浏览或拖拽文件到此区域'}</span>
                  </div>
                  <input ref={fileInputRef} type="file" multiple disabled={stageLocked} onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))} className="sr-only" />
                </label>

                {selectedFiles.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedFiles.map((file, index) => (
                      <span key={index} className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_oklch,var(--accent-soft)_40%,transparent)] px-3 py-1 text-xs text-[color:var(--foreground)]">
                        <Paperclip size={11} className="text-[color:var(--muted-foreground)]" />{file.name}
                      </span>
                    ))}
                  </div>
                )}

                {(uploading || analysisLoading) && (
                  <div className="mt-3 flex items-center gap-3 rounded-lg bg-[color-mix(in_oklch,var(--muted)_55%,transparent)] px-4 py-3">
                    <Loader2 size={14} className="animate-spin text-[color:var(--accent)]" />
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[0.82rem] font-semibold text-[color:var(--foreground)]">{uploading ? '正在上传文件…' : '正在智能分析文件内容…'}</span>
                      <span className="text-[11px] text-[color:var(--muted-foreground)]">{uploading ? `已完成 ${uploadProgress?.completed ?? 0} / ${uploadProgress?.total ?? selectedFiles.length}` : 'AI 正在识别文件类型与内容，分析完成后即可确认阶段完成'}</span>
                    </div>
                    {uploadProgress && uploading && (
                      <div className="ml-auto h-1.5 w-24 overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--muted-foreground)_15%,transparent)]">
                        <div className="h-full rounded-full bg-[color:var(--accent)] transition-all duration-500" style={{ width: `${((uploadProgress.completed + 0.3) / Math.max(uploadProgress.total, 1)) * 100}%` }} />
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button type="button" onClick={() => void uploadStageFiles()} disabled={uploading || selectedFiles.length === 0 || stageLocked} className="neu-btn-primary">
                    {uploading ? (<><Loader2 size={15} className="animate-spin" />上传中…</>) : (<><UploadCloud size={15} />{selectedStage.status === 'COMPLETED' ? '补充材料' : '上传所选文件'}</>)}
                  </button>
                  <button type="button" onClick={() => void markStageCompleted(selectedStage)} disabled={!canCompleteStage || submitting} className="neu-btn-primary is-success">
                    {submitting ? (<><Loader2 size={15} className="animate-spin" />提交中…</>) : selectedStage.status === 'COMPLETED' ? (<><CheckCircle2 size={15} />已完成</>) : stageProcessing ? (<><Loader2 size={15} className="animate-spin opacity-50" />等待分析完成…</>) : (<><CheckCircle2 size={15} />标记本阶段完成</>)}
                  </button>
                  {selectedFiles.length > 0 && !uploading && (
                    <button type="button" onClick={() => { setSelectedFiles([]); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="neu-btn-soft !px-3 !py-1.5 !text-[11px]"><X size={12} />清空选择</button>
                  )}
                </div>
              </div>

              {/* ── 文件分析 ── */}
              <hr className="wb-section-rule" />
              <div className="flex items-center justify-between gap-3">
                <span className="text-[0.95rem] font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">文件分析</span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-[color:var(--muted-foreground)]">已上传 {stageFileAnalysis.length} 份</span>
                  <button
                    type="button"
                    disabled={analysisLoading || stageLocked || stageFileAnalysis.length === 0}
                    onClick={() => { loadAnalysis(); }}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium text-[color:var(--accent)] transition-colors hover:bg-[color-mix(in_oklch,var(--accent-soft)_30%,transparent)] disabled:opacity-50"
                  >
                    <RefreshCw size={11} className={analysisLoading ? 'animate-spin' : ''} />重新分析
                  </button>
                </div>
              </div>

              <div className="max-h-[320px] overflow-y-auto pr-1">
                {analysisError ? (
                  <div className="rounded-lg px-4 py-4 text-sm leading-6" style={{background:"color-mix(in oklch,var(--danger) 8%,transparent)",boxShadow:"inset 1px 2px 4px oklch(0.55 0.03 258 / 0.1)"}}>{analysisError}</div>
                ) : analysisLoading ? (
                  <div className="rounded-lg px-4 py-4 text-sm leading-6 text-[color:var(--muted-foreground)]" style={{background:"color-mix(in oklch,var(--muted) 30%,transparent)",boxShadow:"inset 1px 2px 4px oklch(0.55 0.03 258 / 0.12), inset -1px -1px 2px oklch(1 0 0 / 0.4)"}}>正在分析已上传文件...</div>
                ) : currentFileAnalysis ? (
                  <div className="rounded-lg px-4 py-4" style={{background:"color-mix(in oklch,var(--muted) 30%,transparent)",boxShadow:"inset 1px 2px 4px oklch(0.55 0.03 258 / 0.12), inset -1px -1px 2px oklch(1 0 0 / 0.4)"}}>
                    <div className="text-sm font-semibold text-[color:var(--foreground)]">{currentFileAnalysis.fileName}</div>
                    <div className="mt-2 text-[11px] font-semibold tracking-[0.14em] text-[color:var(--muted-foreground)]">与当前步骤是否匹配</div>
                    <div className="mt-1 text-sm leading-6 text-[color:var(--foreground)]">{currentFileAnalysis.stageMatch}</div>
                    <div className="mt-3 text-[11px] font-semibold tracking-[0.14em] text-[color:var(--muted-foreground)]">核心内容摘要</div>
                    <div className="mt-1 text-sm leading-6 text-[color:var(--foreground)] whitespace-pre-wrap">{currentFileAnalysis.contentSummary}</div>
                  </div>
                ) : (
                  <div className="rounded-lg px-4 py-4 text-sm leading-6 text-[color:var(--muted-foreground)]" style={{background:"color-mix(in oklch,var(--muted) 30%,transparent)",boxShadow:"inset 1px 2px 4px oklch(0.55 0.03 258 / 0.12), inset -1px -1px 2px oklch(1 0 0 / 0.4)"}}>当前还没有可分析的上传文件。</div>
                )}
              </div>

              {stageFileAnalysis.length > 1 && !analysisLoading && (
                <div className="flex items-center justify-between gap-3">
                  <button type="button" onClick={() => setCurrentFileIndex(Math.max(0, currentFileIndex - 1))} disabled={currentFileIndex === 0} className="neu-btn-xs"><ChevronLeft size={14} />上一份</button>
                  <span className="text-xs font-semibold text-[color:var(--muted-foreground)]">{currentFileIndex + 1} / {stageFileAnalysis.length}</span>
                  <button type="button" onClick={() => setCurrentFileIndex(Math.min(stageFileAnalysis.length - 1, currentFileIndex + 1))} disabled={currentFileIndex === stageFileAnalysis.length - 1} className="neu-btn-xs"><ChevronRight size={14} />下一份</button>
                </div>
              )}

            {/* ══════ 步骤检查 —— 放在右栏文件分析下方 ══════ */}
            <hr className="wb-section-rule" />
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Shield size={15} className="text-[color:var(--accent)]" />
                <span className="text-[0.95rem] font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">步骤检查</span>
                {complianceAudit && (
                  <span className="text-[10px] font-semibold text-[color:var(--muted-foreground)]">
                    {complianceAudit.results.filter(r => r.verdict === '通过').length}通过 / {complianceAudit.results.filter(r => r.verdict === '警告').length}警告 / {complianceAudit.results.filter(r => r.verdict === '违规').length}违规
                  </span>
                )}
              </div>
              <button
                type="button"
                disabled={complianceLoading || stageLocked || !hasStageFiles}
                onClick={() => {
                  complianceCache.current.delete(`${item.id}:${selectedStage.stageKey}`);
                  runComplianceAudit(true);
                }}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-[color:var(--accent)] transition-colors hover:bg-[color-mix(in_oklch,var(--accent-soft)_30%,transparent)] disabled:opacity-50"
              >
                {complianceLoading ? (
                  <><Loader2 size={12} className="animate-spin" />审查中...</>
                ) : (
                  <><Shield size={12} />{complianceLoading ? '检查中...' : '重新检查'}</>
                )}
              </button>
            </div>

            {complianceError && (
              <div className="rounded-lg px-3 py-2 text-xs text-[color:var(--danger)]" style={{background:"color-mix(in oklch,var(--danger) 6%,transparent)",boxShadow:"inset 1px 2px 4px oklch(0.55 0.03 258 / 0.1)"}}>
                {complianceError}
              </div>
            )}

            {stageLocked && (
              <div className="rounded-lg px-4 py-3 text-xs text-[color:var(--muted-foreground)]" style={{background:"color-mix(in oklch,var(--muted) 20%,transparent)",boxShadow:"inset 1px 2px 4px oklch(0.55 0.03 258 / 0.08)"}}>
                当前阶段尚未开始，无需进行步骤检查。
              </div>
            )}

            {!stageLocked && !hasStageFiles && !complianceLoading && (
              <div className="rounded-lg px-4 py-3 text-xs text-[color:var(--muted-foreground)]" style={{background:"color-mix(in oklch,var(--muted) 20%,transparent)",boxShadow:"inset 1px 2px 4px oklch(0.55 0.03 258 / 0.08)"}}>
                请先上传采购文件，再进行步骤检查。
              </div>
            )}

            {complianceLoading && !complianceAudit && !stageLocked && (
              <div className="rounded-lg px-4 py-4 text-sm text-[color:var(--muted-foreground)]" style={{background:"color-mix(in oklch,var(--muted) 30%,transparent)",boxShadow:"inset 1px 2px 4px oklch(0.55 0.03 258 / 0.12)"}}>
                正在调用 AI 进行步骤检查，请稍候...
              </div>
            )}

            {complianceAudit && !stageLocked && (
              <div className="space-y-2">
                {/* 审查总结 */}
                <div className="rounded-lg px-4 py-3 text-sm leading-6 text-[color:var(--foreground)]" style={{background:"color-mix(in oklch,var(--accent-soft) 20%,transparent)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.5)"}}>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">审查总结</span>
                  <div className="mt-1">
                    {complianceAudit.summary.split(/(不通过)/g).map((part, i) =>
                      part === '不通过' ? (
                        <span key={i} className="font-semibold text-[color:var(--danger)]">{part}</span>
                      ) : (
                        part
                      ),
                    )}
                  </div>
                </div>

                {/* 逐项审查结果 — 直接展示，无需点击 */}
                {complianceAudit.results.map((item, i) => {
                  const iconColor = item.verdict === '通过' ? 'var(--success)' : item.verdict === '警告' ? 'var(--warning)' : 'var(--danger)';
                  const bgColor = item.verdict === '通过' ? 'color-mix(in oklch,var(--success) 6%,transparent)' : item.verdict === '警告' ? 'color-mix(in oklch,var(--warning) 8%,transparent)' : 'color-mix(in oklch,var(--danger) 6%,transparent)';
                  return (
                    <div key={i} className="rounded-lg px-4 py-3 text-sm" style={{background:bgColor}}>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[11px] font-semibold text-[color:var(--muted-foreground)] shrink-0">{item.dimension}</span>
                          <span className="text-sm font-semibold text-[color:var(--foreground)] truncate">{item.checkpoint}</span>
                        </div>
                        <span className="shrink-0 rounded-[4px] px-2 py-0.5 text-[10px] font-bold" style={{color:iconColor,background:`color-mix(in oklch,${iconColor} 12%,transparent)`}}>
                          {item.verdict}
                        </span>
                      </div>
                      <div className="text-xs leading-5 text-[color:var(--foreground)] mt-1">{item.evidence}</div>
                      {item.suggestion && (
                        <div className="mt-2 flex items-start gap-1.5 text-xs leading-5">
                          <span className="shrink-0 text-[color:var(--accent)] font-semibold">建议：</span>
                          <span className="text-[color:var(--foreground)]">{item.suggestion}</span>
                        </div>
                      )}
                      <div className="mt-1.5 text-[10px] text-[color:var(--muted-foreground)]/60 leading-relaxed">{item.regulationRef}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>

      <LoginErrorDialog
        isOpen={Boolean(errorMessage)}
        message={errorMessage ?? ''}
        onClose={() => setErrorMessage(null)}
      />

      {/* 归档确认对话框 */}
      {showArchiveConfirm && (
        <Modal
          open
          onClose={() => setShowArchiveConfirm(false)}
          title="确认归档"
          size="sm"
          footer={
            <>
              <button className="neu-btn-soft" onClick={() => setShowArchiveConfirm(false)}>取消</button>
              <button className="neu-btn-primary is-success" onClick={() => void confirmArchive()}>确认归档</button>
            </>
          }
        >
          <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">
            归档后项目将从项目管理列表中移除，并同步生成正式采购台账记录。归档完成后可在归档文件中查看。
          </p>

          {/* 缺失字段提醒 */}
          {(!item.departmentNumber || !item.departmentNumber.trim()) && (
            <div className="rounded-[14px] bg-[color-mix(in_oklch,var(--warning)_10%,transparent)] px-4 py-3">
              <p className="text-sm leading-5 text-[color:var(--muted-foreground)]">
                ⚠️ 部门编号尚未填写，建议在归档前补充。归档后仍可在台账中修改。
              </p>
            </div>
          )}
        </Modal>
      )}

      {/* 采购文件编写弹窗 */}
      {tenderWriteStageAction === 'TENDER_DOCUMENT' && (
        <TenderWriteModal
          isOpen
          onClose={() => setTenderWriteStageAction(null)}
          procurementMethod={item.procurementMethod}
          projectTitle={item.title}
          project={item}
        />
      )}

      {/* 招标文件编辑修改弹窗 */}
      {editingFile && (
        <TenderFileEditorModal
          isOpen
          projectId={item.id}
          attachmentId={editingFile.attachmentId}
          attachmentName={editingFile.fileName}
          onClose={() => setEditingFile(null)}
          onFileReplaced={onUpdated}
        />
      )}

      {/* 专家抽取弹窗 */}
      <ExpertExtractModal
        isOpen={expertExtractOpen}
        onClose={() => setExpertExtractOpen(false)}
        project={item}
      />

      {/* 供应商抽取弹窗 */}
      <SupplierExtractModal
        isOpen={supplierExtractOpen}
        onClose={() => setSupplierExtractOpen(false)}
        project={item}
      />

      {/* 公告制作与发布弹窗（两步向导）*/}
      <AnnouncementPublishWizard
        isOpen={announcementPublishOpen}
        onClose={() => setAnnouncementPublishOpen(false)}
        project={item}
        onPublished={onUpdated}
      />
    </>
  );
}
