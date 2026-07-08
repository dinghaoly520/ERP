"use client";

import { Archive, Award, Calendar, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Edit3, FileText, Landmark, Loader2, Paperclip, Pencil, Recycle, RefreshCw, Save, UploadCloud, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LoginErrorDialog } from '@/components/login/login-error-dialog';
import {
  analyzeProjectManagementItem,
  completeProjectManagementItem,
  fetchProjectAttributions,
  refreshProjectSummary,
  updateProjectStage,
  updateProjectExtractedInfo,
  uploadProjectStageAttachment,
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

// ─── Extracted Info Field Components ───────────────────────────────────────────

function DateField({
  label,
  value,
  isEditing,
  editValue,
  onEditValueChange,
  onStartEdit,
  onSave,
  formatValue,
}: {
  label: string;
  value: string | number | null | undefined;
  isEditing: boolean;
  editValue: string;
  onEditValueChange: (value: string) => void;
  onStartEdit: () => void;
  onSave: () => void;
  formatValue?: (value: string | number | null | undefined) => string;
}) {
  const hasValue = value !== null && value !== undefined && value !== '';
  const displayValue = formatValue ? formatValue(value) : String(value ?? '');

  return (
    <div className="pm-info-card pm-info-card--editable">
      {isEditing ? (
        <div className="extracted-field__edit">
          <input
            type="date"
            value={editValue}
            onChange={(e) => onEditValueChange(e.target.value)}
            className="extracted-field__input extracted-field__input--date"
            autoFocus
          />
          <button type="button" onClick={onSave} className="extracted-field__save">
            <Save size={14} />
          </button>
        </div>
      ) : (
        <button type="button" onClick={onStartEdit} className="pm-info-card__editable-trigger">
          <div className="pm-info-card__label">{label}</div>
          <div className={`pm-info-card__value ${hasValue ? '' : 'pm-info-card__value--empty'}`}>
            {hasValue ? displayValue : '待补充'}
          </div>
          <Pencil size={10} className="pm-info-card__edit-icon" />
        </button>
      )}
    </div>
  );
}

function SelectField({
  label,
  value,
  isEditing,
  editValue,
  onEditValueChange,
  onStartEdit,
  onSave,
  options,
}: {
  label: string;
  value: string | number | null | undefined;
  isEditing: boolean;
  editValue: string;
  onEditValueChange: (value: string) => void;
  onStartEdit: () => void;
  onSave: () => void;
  options: readonly string[];
}) {
  const hasValue = value !== null && value !== undefined && value !== '';

  return (
    <div className="extracted-field extracted-field--select">
      {isEditing ? (
        <div className="extracted-field__edit">
          <select
            value={editValue}
            onChange={(e) => onEditValueChange(e.target.value)}
            className="extracted-field__input extracted-field__input--select"
            autoFocus
          >
            <option value="">请选择</option>
            {options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          <button type="button" onClick={onSave} className="extracted-field__save">
            <Save size={14} />
          </button>
        </div>
      ) : (
        <button type="button" onClick={onStartEdit} className="extracted-field__display extracted-field__display--select">
          <div className="extracted-field__icon">
            <ClipboardCheck size={16} />
          </div>
          <div className="extracted-field__content">
            <span className="extracted-field__label">{label}</span>
            <span className={`extracted-field__value ${hasValue ? '' : 'extracted-field__value--empty'}`}>
              {hasValue ? String(value) : '待选择'}
            </span>
          </div>
          <Pencil size={12} className="extracted-field__edit-icon" />
        </button>
      )}
    </div>
  );
}

function TextareaField({
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

  return (
    <div className="extracted-field extracted-field--textarea">
      {isEditing ? (
        <div className="extracted-field__edit extracted-field__edit--textarea">
          <textarea
            value={editValue}
            onChange={(e) => onEditValueChange(e.target.value)}
            className="extracted-field__input extracted-field__input--textarea"
            rows={3}
            autoFocus
          />
          <button type="button" onClick={onSave} className="extracted-field__save">
            <Save size={14} />
          </button>
        </div>
      ) : (
        <button type="button" onClick={onStartEdit} className="extracted-field__display extracted-field__display--textarea">
          <div className="extracted-field__icon">
            <Users size={16} />
          </div>
          <div className="extracted-field__content">
            <span className="extracted-field__label">{label}</span>
            <span className={`extracted-field__value extracted-field__value--multiline ${hasValue ? '' : 'extracted-field__value--empty'}`}>
              {hasValue ? String(value) : '待补充'}
            </span>
          </div>
          <Pencil size={12} className="extracted-field__edit-icon" />
        </button>
      )}
    </div>
  );
}

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
    <div className="expert-info-field">
      {isEditing ? (
        <div className="expert-info-field__edit">
          <div className="expert-info-table">
            <div className="expert-info-table__header">
              <div className="expert-info-table__cell">姓名</div>
              <div className="expert-info-table__cell">部门</div>
              <div className="expert-info-table__cell">专业</div>
              <div className="expert-info-table__cell">职称</div>
              <div className="expert-info-table__cell expert-info-table__cell--action"></div>
            </div>
            {editExperts.map((expert, i) => (
              <div key={i} className="expert-info-table__row">
                <div className="expert-info-table__cell">
                  <input
                    type="text"
                    value={expert.name}
                    onChange={(e) => updateExpertField(i, 'name', e.target.value)}
                    className="expert-info-table__input"
                    placeholder="姓名"
                  />
                </div>
                <div className="expert-info-table__cell">
                  <input
                    type="text"
                    value={expert.department}
                    onChange={(e) => updateExpertField(i, 'department', e.target.value)}
                    className="expert-info-table__input"
                    placeholder="部门"
                  />
                </div>
                <div className="expert-info-table__cell">
                  <input
                    type="text"
                    value={expert.specialty}
                    onChange={(e) => updateExpertField(i, 'specialty', e.target.value)}
                    className="expert-info-table__input"
                    placeholder="专业"
                  />
                </div>
                <div className="expert-info-table__cell">
                  <input
                    type="text"
                    value={expert.title}
                    onChange={(e) => updateExpertField(i, 'title', e.target.value)}
                    className="expert-info-table__input"
                    placeholder="职称"
                  />
                </div>
                <div className="expert-info-table__cell expert-info-table__cell--action">
                  <button
                    type="button"
                    onClick={() => removeExpertRow(i)}
                    className="expert-info-table__remove"
                    title="删除"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
            <button type="button" onClick={addExpertRow} className="expert-info-table__add">
              + 添加专家
            </button>
          </div>
          <div className="expert-info-field__edit-actions">
            <span className="expert-info-field__edit-count">{editExperts.length} 位专家</span>
            <button type="button" onClick={onSave} className="expert-info-field__save">
              <Save size={14} />
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={onStartEdit} className="expert-info-field__display">
          <div className="expert-info-field__header">
            <div className="expert-info-field__icon">
              <Users size={16} />
            </div>
            <span className="expert-info-field__label">专家信息</span>
            {hasValue && (
              <span className="expert-info-field__count">{experts.length} 人</span>
            )}
          </div>
          {hasValue && experts.length > 0 ? (
            <div className="expert-info-field__list">
              {experts.map((expert, i) => (
                <div key={i} className="expert-info-card">
                  <div className="expert-info-card__index">{i + 1}</div>
                  <div className="expert-info-card__content">
                    <div className="expert-info-card__name">{expert.name}</div>
                    <div className="expert-info-card__details">
                      <span className="expert-info-card__dept">{expert.department}</span>
                      <span className="expert-info-card__divider">·</span>
                      <span className="expert-info-card__specialty">{expert.specialty}</span>
                      <span className="expert-info-card__divider">·</span>
                      <span className="expert-info-card__title">{expert.title}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="expert-info-field__empty">待补充专家信息</div>
          )}
          <Pencil size={12} className="expert-info-field__edit-icon" />
        </button>
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

  // Parse edit value for table editing
  const editUnits = editValue ? editValue.split('\n').filter(u => u.trim()) : [];

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
    <div className="extracted-field extracted-field--bidding">
      {isEditing ? (
        <div className="extracted-field__edit extracted-field__edit--textarea">
          <div className="bidding-units-table">
            <div className="bidding-units-table__header">
              <div className="bidding-units-table__cell bidding-units-table__cell--index">序号</div>
              <div className="bidding-units-table__cell">投标单位名称</div>
              <div className="bidding-units-table__cell bidding-units-table__cell--action"></div>
            </div>
            {editUnits.map((unit, i) => (
              <div key={i} className="bidding-units-table__row">
                <div className="bidding-units-table__cell bidding-units-table__cell--index">
                  {i + 1}
                </div>
                <div className="bidding-units-table__cell">
                  <input
                    type="text"
                    value={unit}
                    onChange={(e) => updateUnit(i, e.target.value)}
                    className="bidding-units-table__input"
                    placeholder="投标单位名称"
                  />
                </div>
                <div className="bidding-units-table__cell bidding-units-table__cell--action">
                  <button
                    type="button"
                    onClick={() => removeUnitRow(i)}
                    className="bidding-units-table__remove"
                    title="删除"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
            <button type="button" onClick={addUnitRow} className="bidding-units-table__add">
              + 添加投标单位
            </button>
          </div>
          <div className="extracted-field__edit-actions">
            <span className="extracted-field__edit-count">{editUnits.length} 家单位</span>
            <button type="button" onClick={onSave} className="extracted-field__save">
              <Save size={14} />
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={onStartEdit} className="extracted-field__display extracted-field__display--bidding">
          <div className="extracted-field__icon">
            <FileText size={16} />
          </div>
          <div className="extracted-field__content">
            <span className="extracted-field__label">{label}</span>
            {hasValue && units.length > 0 ? (
              <div className="extracted-field__list">
                {units.map((unit, i) => (
                  <div key={i} className="extracted-field__list-item">
                    <span className="extracted-field__list-index">{i + 1}</span>
                    <span className="extracted-field__list-value">{unit.trim()}</span>
                  </div>
                ))}
              </div>
            ) : (
              <span className="extracted-field__value extracted-field__value--empty">待补充</span>
            )}
          </div>
          <Pencil size={12} className="extracted-field__edit-icon" />
        </button>
      )}
    </div>
  );
}

function AwardedSupplierField({
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

  return (
    <div className="extracted-field extracted-field--awarded">
      {isEditing ? (
        <div className="extracted-field__edit">
          <input
            type="text"
            value={editValue}
            onChange={(e) => onEditValueChange(e.target.value)}
            className="extracted-field__input"
            autoFocus
          />
          <button type="button" onClick={onSave} className="extracted-field__save">
            <Save size={14} />
          </button>
        </div>
      ) : (
        <button type="button" onClick={onStartEdit} className="extracted-field__display extracted-field__display--awarded">
          <div className="extracted-field__icon extracted-field__icon--highlight">
            <Award size={16} />
          </div>
          <div className="extracted-field__content">
            <span className="extracted-field__label">{label}</span>
            <span className={`extracted-field__value extracted-field__value--highlight ${hasValue ? '' : 'extracted-field__value--empty'}`}>
              {hasValue ? String(value) : '待确定'}
            </span>
          </div>
          <Pencil size={12} className="extracted-field__edit-icon" />
        </button>
      )}
    </div>
  );
}

function AmountField({
  label,
  value,
  isEditing,
  editValue,
  onEditValueChange,
  onStartEdit,
  onSave,
  formatValue,
}: {
  label: string;
  value: string | number | null | undefined;
  isEditing: boolean;
  editValue: string;
  onEditValueChange: (value: string) => void;
  onStartEdit: () => void;
  onSave: () => void;
  formatValue?: (value: string | number | null | undefined) => string;
}) {
  const hasValue = value !== null && value !== undefined && value !== '';
  const displayValue = formatValue ? formatValue(value) : String(value ?? '');

  return (
    <div className="extracted-field extracted-field--amount">
      {isEditing ? (
        <div className="extracted-field__edit">
          <input
            type="number"
            value={editValue}
            onChange={(e) => onEditValueChange(e.target.value)}
            className="extracted-field__input extracted-field__input--amount"
            placeholder="输入金额"
            autoFocus
          />
          <button type="button" onClick={onSave} className="extracted-field__save">
            <Save size={14} />
          </button>
        </div>
      ) : (
        <button type="button" onClick={onStartEdit} className="extracted-field__display extracted-field__display--amount">
          <div className="extracted-field__icon extracted-field__icon--amount">
            <Landmark size={16} />
          </div>
          <div className="extracted-field__content">
            <span className="extracted-field__label">{label}</span>
            <span className={`extracted-field__value extracted-field__value--amount ${hasValue ? '' : 'extracted-field__value--empty'}`}>
              {hasValue ? displayValue : '待确定'}
            </span>
          </div>
          <Pencil size={12} className="extracted-field__edit-icon" />
        </button>
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
    initiationDate: '',
    expertInfo: '',
    biddingUnits: '',
    awardedSupplier: '',
    contractAmount: '',
    demandProject: '',
    demandContractNumber: '',
    contractNumber: '',
    departmentNumber: '',
  });

  const selectedStage = useMemo(
    () =>
      item.stages.find((stage) => stage.stageKey === selectedStageKey) ??
      item.stages[0],
    [item.stages, selectedStageKey],
  );

  const archiveStepState = getArchiveStepState(item);
  const showArchiveStep = archiveStepState !== 'PENDING';
  const isCurrentStage = selectedStage.stageKey === item.currentStage;
  const stageLocked = selectedStage.status === 'NOT_STARTED';
  const stageProcessing = uploading || analysisLoading;
  const canCompleteStage =
    isCurrentStage && selectedStage.status !== 'COMPLETED' && !stageLocked && !stageProcessing;
  const canArchive = archiveStepState === 'READY';
  const focusAccentClassName = `pm-stage-accent--${selectedStage.stageKey.toLowerCase()}`;
  const stageFileAnalysis = useMemo(
    () => analysis?.fileAnalyses ?? [],
    [analysis],
  );

  const currentFileAnalysis = stageFileAnalysis[currentFileIndex];

  // 用于触发文件分析刷新的计数器（仅在文件上传后增加）
  const [summaryRefreshing, setSummaryRefreshing] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);

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
  useEffect(() => {
    let active = true;

    const loadAnalysis = async () => {
      setAnalysisLoading(true);
      setAnalysisError(null);
      try {
        const nextAnalysis = await analyzeProjectManagementItem(item.id, selectedStage.stageKey);
        if (active) {
          setAnalysis(nextAnalysis);
        }
      } catch (error) {
        if (active) {
          setAnalysisError(error instanceof Error ? error.message : 'AI 分析暂不可用。');
        }
      } finally {
        if (active) {
          setAnalysisLoading(false);
        }
      }
    };

    void loadAnalysis();

    return () => {
      active = false;
    };
  }, [item.id, selectedStage.stageKey]);


  const markStageCompleted = async (stage: ProjectManagementStage) => {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      // Determine the next stage BEFORE onUpdated so the closure isn't stale
      const currentIndex = item.stages.findIndex(
        (s) => s.stageKey === stage.stageKey,
      );
      const nextStageKey = item.stages[currentIndex + 1]?.stageKey;

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

      // 1. Refresh parent data immediately so the file list shows new attachments NOW
      await onUpdated();

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
            <div className="rounded-[16px] bg-[color-mix(in_oklch,var(--muted)_40%,transparent)] px-4 py-4 min-h-[80px]">
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

          {/* ── hairline + 归档流程 ── */}
          <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">归档流程</span>
              <span className="text-[10px] font-semibold text-[color:var(--accent)]">当前聚焦：{selectedStage.stageName}</span>
            </div>
            <ProjectStageTimeline
              stages={item.stages}
              activeStageKey={selectedStage.stageKey}
              onSelect={setSelectedStageKey}
              showArchiveStep={showArchiveStep}
              archiveStepState={archiveStepState}
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

        {/* ══════ 双栏正文 ══════ */}
        <div className="grid gap-5 px-5 pb-5 sm:px-6 lg:px-7 xl:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
          {/* ── 左栏：项目基本信息 ── */}
          <div className="wb-panel p-5 sm:p-6">
            <div className="text-base font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
              项目基本信息
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="pm-info-card pm-info-card--stage">
                <div className="pm-info-card__label">当前阶段</div>
                <div className="pm-info-card__value pm-info-card__value--status">
                  {selectedStage.stageName}
                  <span className={`pm-status-dot pm-status-dot--${selectedStage.status.toLowerCase()} ml-2`} />
                  {PROJECT_STAGE_STATUS_LABELS[selectedStage.status]}
                </div>
              </div>
              <DateField
                label="立项时间"
                value={extractedInfoOverride?.initiationDate ?? item.initiationDate}
                isEditing={editingField === 'initiationDate'}
                editValue={editValues.initiationDate}
                onEditValueChange={(v) => setEditValues((prev) => ({ ...prev, initiationDate: v }))}
                onStartEdit={() => handleStartEdit('initiationDate', extractedInfoOverride?.initiationDate ?? item.initiationDate)}
                onSave={() => void handleSaveField('initiationDate')}
                formatValue={formatDate}
              />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="pm-info-card">
                <div className="pm-info-card__label">采购类别</div>
                <div className="pm-info-card__value">{item.procurementCategory || '待补充'}</div>
              </div>
              <div className={`pm-info-card pm-info-card--editable ${editingField === 'demandProject' ? 'pm-info-card--editing' : ''}`}>
                {editingField === 'demandProject' ? (
                  <div className="pm-info-card__edit-row">
                    <div className="pm-info-card__edit-input-wrap" ref={attributionInputRef}>
                      <input
                        type="text"
                        value={editValues.demandProject}
                        onChange={(e) => {
                          setEditValues((prev) => ({ ...prev, demandProject: e.target.value }));
                          openAttributionDropdown();
                        }}
                        onFocus={openAttributionDropdown}
                        onScroll={(e) => e.stopPropagation()}
                        className="pm-info-card__input"
                        placeholder="输入或选择归属项目"
                        autoFocus
                      />
                      {showAttributionDropdown && (
                        <div className="pm-info-card__dropdown" style={dropdownStyle}>
                          {filteredAttributions.slice(0, 7).map((attr) => (
                            <button
                              key={attr.name}
                              type="button"
                              onClick={() => {
                                setEditValues((prev) => ({
                                  ...prev,
                                  demandProject: attr.name,
                                  demandContractNumber: attr.contractNumber || prev.demandContractNumber,
                                }));
                                setShowAttributionDropdown(false);
                              }}
                              className="pm-info-card__dropdown-item"
                            >
                              {attr.name}
                              {attr.contractNumber && (
                                <span className="pm-info-card__dropdown-hint">{attr.contractNumber}</span>
                              )}
                            </button>
                          ))}
                          {!filteredAttributions.some((a) => a.name === '其他') && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditValues((prev) => ({ ...prev, demandProject: '其他' }));
                                setShowAttributionDropdown(false);
                              }}
                              className="pm-info-card__dropdown-item"
                            >
                              其他
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <button type="button" onClick={() => void handleSaveField('demandProject')} className="pm-info-card__save-btn">
                      <Save size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      handleStartEdit('demandProject', item.demandProject || '');
                      setAttributionSearch(item.demandProject || '');
                    }}
                    className="pm-info-card__editable-trigger"
                  >
                    <div className="pm-info-card__label">所属项目</div>
                    <div className={`pm-info-card__value ${item.demandProject ? '' : 'pm-info-card__value--empty'}`}>
                      {item.demandProject || '待补充'}
                    </div>
                    <Pencil size={10} className="pm-info-card__edit-icon" />
                  </button>
                )}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="pm-info-card">
                <div className="pm-info-card__label">合同编号</div>
                {editingField === 'contractNumber' ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={editValues.contractNumber}
                      onChange={(e) => setEditValues((prev) => ({ ...prev, contractNumber: e.target.value }))}
                      className="pm-info-card__edit-input"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleSaveField('contractNumber');
                        if (e.key === 'Escape') setEditingField(null);
                      }}
                    />
                    <button type="button" onClick={() => void handleSaveField('contractNumber')} className="pm-info-card__save-btn">
                      <Save size={12} />
                    </button>
                    <button type="button" onClick={() => setEditingField(null)} className="pm-info-card__cancel-btn">
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      handleStartEdit('contractNumber', extractedInfoOverride?.contractNumber ?? (item.contractNumber || item.demandContractNumber || ''));
                    }}
                    className="pm-info-card__editable-trigger"
                  >
                    <div className={`pm-info-card__value ${(extractedInfoOverride?.contractNumber ?? item.contractNumber ?? item.demandContractNumber) ? '' : 'pm-info-card__value--empty'}`}>
                      {extractedInfoOverride?.contractNumber ?? item.contractNumber ?? item.demandContractNumber ?? '无'}
                    </div>
                    <Pencil size={10} className="pm-info-card__edit-icon" />
                  </button>
                )}
              </div>
              <div className="pm-info-card">
                <div className="pm-info-card__label">部门编号</div>
                {currentUsername === 'Swhi-CGZX-07' && editingField === 'departmentNumber' ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={editValues.departmentNumber}
                      onChange={(e) => setEditValues((prev) => ({ ...prev, departmentNumber: e.target.value }))}
                      className="pm-info-card__input min-w-0 flex-1"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleSaveField('departmentNumber');
                        if (e.key === 'Escape') setEditingField(null);
                      }}
                    />
                    <button type="button" onClick={() => void handleSaveField('departmentNumber')} className="pm-info-card__save-btn">
                      <Save size={12} />
                    </button>
                    <button type="button" onClick={() => setEditingField(null)} className="pm-info-card__cancel-btn">
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (currentUsername === 'Swhi-CGZX-07') {
                        handleStartEdit('departmentNumber', item.departmentNumber || '');
                      }
                    }}
                    className="pm-info-card__editable-wrap"
                  >
                    <div className="pm-info-card__value">{item.departmentNumber || '无'}</div>
                    {currentUsername === 'Swhi-CGZX-07' && <Pencil size={10} className="pm-info-card__edit-icon" />}
                  </button>
                )}
              </div>
            </div>

            <hr className="wb-section-rule my-5" />

            <div>
              <ExpertInfoField
                value={extractedInfoOverride?.expertInfo ?? item.expertInfo}
                isEditing={editingField === 'expertInfo'}
                editValue={editValues.expertInfo}
                onEditValueChange={(v) => setEditValues((prev) => ({ ...prev, expertInfo: v }))}
                onStartEdit={() => handleStartEdit('expertInfo', extractedInfoOverride?.expertInfo ?? item.expertInfo)}
                onSave={() => void handleSaveField('expertInfo')}
              />
            </div>

            <div className="mt-3">
              <BiddingUnitsField
                label="投标单位"
                value={extractedInfoOverride?.biddingUnits ?? item.biddingUnits}
                isEditing={editingField === 'biddingUnits'}
                editValue={editValues.biddingUnits}
                onEditValueChange={(v) => setEditValues((prev) => ({ ...prev, biddingUnits: v }))}
                onStartEdit={() => handleStartEdit('biddingUnits', extractedInfoOverride?.biddingUnits ?? item.biddingUnits)}
                onSave={() => void handleSaveField('biddingUnits')}
              />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="extracted-field extracted-field--amount">
                <div className="extracted-field__display extracted-field__display--amount extracted-field__display--static">
                  <div className="extracted-field__icon extracted-field__icon--amount">
                    <Landmark size={16} />
                  </div>
                  <div className="extracted-field__content">
                    <span className="extracted-field__label">预算金额</span>
                    <span className="extracted-field__value extracted-field__value--amount extracted-field__value--highlight">
                      {item.budgetAmount.toLocaleString('zh-CN')} 元
                    </span>
                  </div>
                </div>
              </div>
              <AmountField
                label="合同金额"
                value={extractedInfoOverride?.contractAmount ?? item.contractAmount}
                isEditing={editingField === 'contractAmount'}
                editValue={editValues.contractAmount}
                onEditValueChange={(v) => setEditValues((prev) => ({ ...prev, contractAmount: v }))}
                onStartEdit={() => handleStartEdit('contractAmount', extractedInfoOverride?.contractAmount ?? item.contractAmount)}
                onSave={() => void handleSaveField('contractAmount')}
                formatValue={formatAmount}
              />
            </div>

            <div className="mt-3">
              <AwardedSupplierField
                label="中标单位"
                value={extractedInfoOverride?.awardedSupplier ?? item.awardedSupplier}
                isEditing={editingField === 'awardedSupplier'}
                editValue={editValues.awardedSupplier}
                onEditValueChange={(v) => setEditValues((prev) => ({ ...prev, awardedSupplier: v }))}
                onStartEdit={() => handleStartEdit('awardedSupplier', extractedInfoOverride?.awardedSupplier ?? item.awardedSupplier)}
                onSave={() => void handleSaveField('awardedSupplier')}
              />
            </div>

            <hr className="wb-section-rule my-5" />

            <div className="pm-reason-block">
              <div className="pm-reason-block__item">
                <div className="pm-reason-block__label">申请立项事由</div>
                <div className="pm-reason-block__content">{item.projectReason || '待补充'}</div>
              </div>
              <div className="pm-reason-block__item">
                <div className="pm-reason-block__label">对供方的主要要求</div>
                <div className="pm-reason-block__content">{item.supplierRequirements || '无'}</div>
              </div>
            </div>

            <div className="pm-stage-tip mt-5">
              <div className="pm-stage-tip__icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4M12 8h.01" />
                </svg>
              </div>
              <div className="pm-stage-tip__text">
                {isCurrentStage
                  ? '当前阶段可以继续补充材料，完成后系统会自动解锁下一步。'
                  : stageLocked
                    ? '该阶段尚未解锁，需要先完成前一个阶段。'
                    : '该阶段已完成，可继续查看或补充附件。'}
              </div>
            </div>
          </div>

          {/* ── 右栏：阶段工作区 ── */}
          <div className="wb-panel p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-[1.08rem] font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
                  {selectedStage.stageName}
                </div>
                <p className="mt-2 max-w-[58ch] text-sm leading-6 text-[color:var(--muted-foreground)]">
                  {stageLocked
                    ? '当前阶段尚未解锁。请先完成上一个阶段，再继续上传当前材料。'
                    : selectedStage.status === 'COMPLETED'
                      ? '当前阶段已完成。仍可继续补充材料，保持归档完整。'
                      : '请上传当前阶段所需材料，确认无误后再推进到下一阶段。'}
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center rounded-full bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] px-3 py-1 text-[11px] font-semibold tracking-[0.14em] text-[color:var(--accent)]">
                {PROJECT_STAGE_STATUS_LABELS[selectedStage.status]}
              </span>
            </div>

            <div className="mt-5">
              <StageFileList
                files={selectedStage.attachments}
                projectId={item.id}
                onDeleted={async (deletedObjectKey) => {
                  await onUpdated();
                  if (analysis) {
                    setAnalysis({
                      ...analysis,
                      fileAnalyses: analysis.fileAnalyses.filter((fa) => fa.objectKey !== deletedObjectKey),
                    });
                  }
                }}
              />
            </div>

            {/* ── 上传区 ── */}
            <div className="mt-5 rounded-[16px] bg-[color-mix(in_oklch,var(--muted)_35%,transparent)] p-4 sm:p-5">
              <label
                className={`flex cursor-pointer items-center justify-center gap-3 rounded-xl px-5 py-3 transition ${
                  stageLocked
                    ? 'cursor-not-allowed bg-[color-mix(in_oklch,var(--muted)_20%,transparent)] opacity-50'
                    : 'bg-[color-mix(in_oklch,var(--muted)_50%,transparent)] hover:bg-[color-mix(in_oklch,var(--muted)_70%,transparent)]'
                }`}
              >
                <UploadCloud size={20} className="shrink-0 text-[color:var(--muted-foreground)]" />
                <div className="min-w-0 text-left">
                  <span className="text-sm font-medium text-[color:var(--foreground)]">
                    {selectedFiles.length > 0 ? `已选择 ${selectedFiles.length} 个文件` : '选取文件（支持多选）'}
                  </span>
                  <span className="mt-0.5 block text-xs text-[color:var(--muted-foreground)]">
                    {selectedFiles.length > 0 ? '点击重新选择' : '点击浏览或拖拽文件到此区域'}
                  </span>
                </div>
                <input
                  ref={fileInputRef}
                  type="file" multiple disabled={stageLocked}
                  onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))}
                  className="sr-only"
                />
              </label>

              {selectedFiles.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedFiles.map((file, index) => (
                    <span key={index} className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_oklch,var(--accent-soft)_40%,transparent)] px-3 py-1 text-xs text-[color:var(--foreground)]">
                      <Paperclip size={11} className="text-[color:var(--muted-foreground)]" />
                      {file.name}
                    </span>
                  ))}
                </div>
              )}

              {(uploading || analysisLoading) && (
                <div className="mt-4 flex items-center gap-3 rounded-[12px] bg-[color-mix(in_oklch,var(--muted)_60%,transparent)] px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <Loader2 size={14} className="animate-spin text-[color:var(--accent)]" />
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[0.82rem] font-semibold text-[color:var(--foreground)]">
                        {uploading ? '正在上传文件…' : '正在智能分析文件内容…'}
                      </span>
                      <span className="text-[11px] text-[color:var(--muted-foreground)]">
                        {uploading
                          ? `已完成 ${uploadProgress?.completed ?? 0} / ${uploadProgress?.total ?? selectedFiles.length}`
                          : 'AI 正在识别文件类型与内容，分析完成后即可确认阶段完成'}
                      </span>
                    </div>
                  </div>
                  {uploadProgress && uploading && (
                    <div className="ml-auto h-1.5 w-24 overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--muted-foreground)_15%,transparent)]">
                      <div
                        className="h-full rounded-full bg-[color:var(--accent)] transition-all duration-500"
                        style={{ width: `${((uploadProgress.completed + 0.3) / Math.max(uploadProgress.total, 1)) * 100}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button" onClick={() => void uploadStageFiles()}
                  disabled={uploading || selectedFiles.length === 0 || stageLocked}
                  className="neu-btn-primary"
                >
                  {uploading ? (<><Loader2 size={15} className="animate-spin" />上传中…</>) : (<><UploadCloud size={15} />{selectedStage.status === 'COMPLETED' ? '补充材料' : '上传所选文件'}</>)}
                </button>
                <button
                  type="button" onClick={() => void markStageCompleted(selectedStage)}
                  disabled={!canCompleteStage || submitting}
                  className="neu-btn-primary is-success"
                >
                  {submitting ? (<><Loader2 size={15} className="animate-spin" />提交中…</>) : selectedStage.status === 'COMPLETED' ? (<><CheckCircle2 size={15} />已完成</>) : stageProcessing ? (<><Loader2 size={15} className="animate-spin opacity-50" />等待分析完成…</>) : (<><CheckCircle2 size={15} />标记本阶段完成</>)}
                </button>
                {selectedFiles.length > 0 && !uploading && (
                  <button type="button" onClick={() => { setSelectedFiles([]); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="neu-btn-soft !px-3 !py-1.5 !text-[11px]">
                    <X size={12} />清空选择
                  </button>
                )}
              </div>
            </div>

            {/* ── 文件分析（不再嵌套卡片） ── */}
            <hr className="wb-section-rule mt-5 mb-4" />
            <div className="flex items-center justify-between gap-3">
              <span className="text-[0.98rem] font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">文件分析</span>
              <span className="text-[11px] font-semibold text-[color:var(--muted-foreground)]">已上传 {stageFileAnalysis.length} 份</span>
            </div>

            <div className="mt-4 max-h-[320px] overflow-y-auto pr-1">
              {analysisError ? (
                <div className="rounded-[12px] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-4 py-4 text-sm leading-6 text-[color:var(--danger)]">
                  {analysisError}
                </div>
              ) : analysisLoading ? (
                <div className="rounded-[12px] bg-[color-mix(in_oklch,var(--muted)_40%,transparent)] px-4 py-4 text-sm leading-6 text-[color:var(--muted-foreground)]">
                  正在分析已上传文件...
                </div>
              ) : currentFileAnalysis ? (
                <div className="rounded-[12px] bg-[color-mix(in_oklch,var(--muted)_40%,transparent)] px-4 py-4">
                  <div className="text-sm font-semibold text-[color:var(--foreground)]">{currentFileAnalysis.fileName}</div>
                  <div className="mt-2 text-[11px] font-semibold tracking-[0.14em] text-[color:var(--muted-foreground)]">与当前步骤是否匹配</div>
                  <div className="mt-1 text-sm leading-6 text-[color:var(--foreground)]">{currentFileAnalysis.stageMatch}</div>
                  <div className="mt-3 text-[11px] font-semibold tracking-[0.14em] text-[color:var(--muted-foreground)]">核心内容摘要</div>
                  <div className="mt-1 text-sm leading-6 text-[color:var(--foreground)] whitespace-pre-wrap">{currentFileAnalysis.contentSummary}</div>
                </div>
              ) : (
                <div className="rounded-[12px] bg-[color-mix(in_oklch,var(--muted)_40%,transparent)] px-4 py-4 text-sm leading-6 text-[color:var(--muted-foreground)]">
                  当前还没有可分析的上传文件。
                </div>
              )}
            </div>

            {stageFileAnalysis.length > 1 && !analysisLoading && (
              <div className="mt-4 flex items-center justify-between gap-3">
                <button type="button" onClick={() => setCurrentFileIndex(Math.max(0, currentFileIndex - 1))} disabled={currentFileIndex === 0} className="neu-btn-xs">
                  <ChevronLeft size={14} />上一份
                </button>
                <span className="text-xs font-semibold text-[color:var(--muted-foreground)]">{currentFileIndex + 1} / {stageFileAnalysis.length}</span>
                <button type="button" onClick={() => setCurrentFileIndex(Math.min(stageFileAnalysis.length - 1, currentFileIndex + 1))} disabled={currentFileIndex === stageFileAnalysis.length - 1} className="neu-btn-xs">
                  <ChevronRight size={14} />下一份
                </button>
              </div>
            )}
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
        <div className="fixed inset-0 z-[300] flex items-center justify-center">
          {/* 遮罩 */}
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setShowArchiveConfirm(false)}
          />
          {/* 对话框 */}
          <div className="relative mx-4 w-full max-w-md rounded-[24px] bg-[var(--background)] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.12)]">
            <h3 className="text-lg font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
              确认归档
            </h3>
            <p className="mt-3 text-sm leading-6 text-[color:var(--muted-foreground)]">
              归档后项目将从项目管理列表中移除，并同步生成正式采购台账记录。归档完成后可在归档文件中查看。
            </p>

            {/* 缺失字段提醒 */}
            {(!item.departmentNumber || !item.departmentNumber.trim()) && (
              <div className="mt-4 rounded-2xl bg-[rgba(249,245,235,0.8)] px-4 py-3">
                <p className="text-sm leading-5 text-[color:var(--muted-foreground)]">
                  ⚠️ 部门编号尚未填写，建议在归档前补充。归档后仍可在台账中修改。
                </p>
              </div>
            )}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowArchiveConfirm(false)}
                className="rounded-xl px-4 py-2 text-sm font-medium text-[color:var(--muted-foreground)] transition hover:bg-[rgba(246,249,253,0.8)]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void confirmArchive()}
                className="rounded-xl bg-[rgba(76,154,84,0.12)] px-5 py-2 text-sm font-semibold text-[#4c9a54] transition hover:bg-[rgba(76,154,84,0.2)]"
              >
                确认归档
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
