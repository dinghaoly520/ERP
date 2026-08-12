"use client";

import { AlertTriangle, Archive, Award, Building2, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, FileText, Gavel, Loader2, Megaphone, Paperclip, Pencil, Recycle, RefreshCw, Save, ScrollText, Shield, Sparkles, UploadCloud, UserPlus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { LoginErrorDialog } from '@/components/login/login-error-dialog';
import {
  analyzeProjectManagementItem,
  analyzeProjectStep,
  completeProjectManagementItem,
  extractTenderFields,
  reprocProject,
  fetchProjectAttributions,
  refreshProjectSummary,
  updateProjectStage,
  updateProjectExtractedInfo,
  uploadProjectStageAttachment,
  auditStageCompliance,
  optimizeInitiationFields,
  type ComplianceAuditResponse,
  type ExtractedInfo,
  type UploadStageAttachmentResult,
} from '@/lib/api/project-management';
import {
  PROCUREMENT_METHODS,
  PROCUREMENT_CATEGORY_OPTIONS,
  PROJECT_STAGE_STATUS_LABELS,
  PROJECT_WORKFLOW_STAGES,
  type ProjectDetailAnalysis,
  type ProjectManagementItem,
  type ProjectManagementStage,
  type ProjectWorkflowStageKey,
} from '@/lib/types/project-management';
import { ProjectStageTimeline } from './project-stage-timeline';
import { StageFileList } from './stage-file-list';
import { TenderWriteModal } from './tender-write-modal';
import { SupplierExtractModal } from './supplier-extract-modal';
import { ExpertExtractModal } from './expert-extract-modal';
import { AnnouncementPublishWizard } from './announcement-publish-wizard';
import { BidConfirmPanel } from './bid-confirm-panel';
import { AwardFileMaker } from './award-file-maker';
import { TenderFileEditorModal } from './tender-file-editor-modal';
import { Modal, StatusBadge } from '@/components/workbench';

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
        role: (parts[4] ?? '').trim(),
      };
    });
  };

  const experts = parseExperts(hasValue ? String(value) : null);

  // Parse edit value for table editing — always start from editValue,
  // falling back to display value when edit is first entered
  const editExperts = parseExperts(editValue);

  const syncEditValue = (rows: Array<{ name: string; department: string; specialty: string; title: string; role: string }>) => {
    onEditValueChange(rows.map(e => `${e.name}|${e.department}|${e.specialty}|${e.title}|${e.role||''}`).join('\n'));
  };

  const updateExpertField = (index: number, field: 'name' | 'department' | 'specialty' | 'title' | 'role', newValue: string) => {
    const updated = [...editExperts];
    if (index >= updated.length) {
      for (let i = updated.length; i <= index; i++) {
        updated.push({ name: '', department: '', specialty: '', title: '', role: '' });
      }
    }
    updated[index] = { ...updated[index], [field]: newValue };
    syncEditValue(updated);
  };

  const addExpertRow = () => {
    syncEditValue([...editExperts, { name: '', department: '', specialty: '', title: '', role: '' }]);
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
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_80px_auto] gap-1.5 items-center">
              <input type="text" value={expert.name} onChange={(e) => updateExpertField(i, 'name', e.target.value)} className="workbench-input !h-[32px] !text-xs" placeholder="姓名" />
              <input type="text" value={expert.department} onChange={(e) => updateExpertField(i, 'department', e.target.value)} className="workbench-input !h-[32px] !text-xs" placeholder="部门" />
              <input type="text" value={expert.specialty} onChange={(e) => updateExpertField(i, 'specialty', e.target.value)} className="workbench-input !h-[32px] !text-xs" placeholder="专业" />
              <input type="text" value={expert.title} onChange={(e) => updateExpertField(i, 'title', e.target.value)} className="workbench-input !h-[32px] !text-xs" placeholder="职称" />
              <input type="text" value={(expert as any).role || ''} onChange={(e) => updateExpertField(i, 'role', e.target.value)} className="workbench-input !h-[32px] !text-xs" placeholder="角色" />
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
        <div className="overflow-x-auto rounded-[10px]" style={{ background: 'oklch(1 0 0 / 0.3)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
          <table className="neu-table w-full min-w-[500px]">
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th>专家</th>
                <th>部门</th>
                <th>专业</th>
                <th>职称</th>
                <th style={{ width: 80 }}>角色</th>
              </tr>
            </thead>
            <tbody>
              {experts.map((expert, i) => (
                <tr key={i}>
                  <td className="text-center tabular-nums" style={{ paddingTop: 6, paddingBottom: 6, fontSize: 13, color: 'var(--muted-foreground)' }}>{i + 1}</td>
                  <td className="font-medium" style={{ paddingTop: 6, paddingBottom: 6, fontSize: 13, color: 'var(--foreground)' }}>{expert.name}</td>
                  <td style={{ paddingTop: 6, paddingBottom: 6, fontSize: 13, color: 'var(--muted-foreground)' }}>{expert.department}</td>
                  <td style={{ paddingTop: 6, paddingBottom: 6, fontSize: 13, color: 'var(--muted-foreground)' }}>{expert.specialty}</td>
                  <td style={{ paddingTop: 6, paddingBottom: 6, fontSize: 13, color: 'var(--muted-foreground)' }}>{expert.title}</td>
                  <td className="text-center" style={{ paddingTop: 6, paddingBottom: 6 }}>{((expert as any).role === '候补' || (expert as any).role === '补选') ? <StatusBadge tone="orange">候补</StatusBadge> : ((expert as any).role ? <StatusBadge tone="blue">正选</StatusBadge> : null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
        <div className="space-y-1.5">
          {units.map((unit, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-[10px] px-3 py-2 text-sm text-[color:var(--foreground)]"
              style={{
                background: 'color-mix(in oklch, var(--accent) 4%, oklch(1 0 0 / 0.5))',
                boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.55), 1px 1px 2px oklch(0.55 0.03 258 / 0.06)',
              }}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] text-[9px] font-bold text-white tabular-nums"
                style={{ background: 'linear-gradient(135deg, oklch(0.52 0.16 258), oklch(0.45 0.14 258))' }}>
                {i + 1}
              </span>
              <Building2 size={13} className="shrink-0 text-[color:var(--accent)]" />
              <span className="min-w-0 truncate">{unit.trim()}</span>
            </div>
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


// ─── 阶段视觉映射：当前步骤 hero 用 — 按 stageKey 取专属图标 + 阶段色 ───
type StageIcon = typeof FileText;
const STAGE_HERO_VISUAL: Record<string, { Icon: StageIcon; colorVar: string }> = {
  PROCUREMENT_DEMAND: { Icon: ClipboardList, colorVar: 'var(--stage-demand)' },
  INITIATION: { Icon: ClipboardList, colorVar: 'var(--stage-initiation)' },
  TENDER_DOCUMENT: { Icon: FileText, colorVar: 'var(--stage-tender)' },
  SUPPLIER_INVITATION: { Icon: UserPlus, colorVar: 'var(--stage-supplier)' },
  PUBLIC_ANNOUNCEMENT: { Icon: Megaphone, colorVar: 'var(--stage-announce)' },
  EXPERT_SELECTION: { Icon: Shield, colorVar: 'var(--stage-expert)' },
  BID_EVALUATION: { Icon: Gavel, colorVar: 'var(--stage-evaluation)' },
  AWARD_DECISION: { Icon: Award, colorVar: 'var(--stage-award)' },
  CONTRACT: { Icon: ScrollText, colorVar: 'var(--stage-contract)' },
};

export function ProjectDetailPanel({
  item,
  onClose,
  onUpdated,
  onMoveToRecycleBin,
  canModify = true,
  currentUsername,
  autoOpenBidConfirm = false,
}: {
  item: ProjectManagementItem;
  onClose: () => void;
  onUpdated: () => Promise<void>;
  onMoveToRecycleBin: (projectId: string) => Promise<void>;
  canModify?: boolean;
  currentUsername?: string;
  autoOpenBidConfirm?: boolean;
}) {
  const [selectedStageKey, setSelectedStageKey] = useState(item.currentStage);
  const [selectedRound, setSelectedRound] = useState(item.currentRound ?? 1);
  const [bidConfirmRound, setBidConfirmRound] = useState(1);

  // 本地 item 镜像 —— 上传后立即注入附件，不等父组件 onUpdated 回流
  const [localItem, setLocalItem] = useState(item);

  // 父组件重新渲染后同步本地镜像
  useEffect(() => {
    if (tenderFileJustDeletedRef.current) {
      tenderFileJustDeletedRef.current = false;
      // 删除采购文件后：同步非提取字段（stages等），但保持提取字段为 null
      setLocalItem((prev) => prev ? {
        ...item,
        projectOverview: null,
        bidOpeningTime: null,
        documentAcquireTime: null,
        evaluationMethod: null,
      } : item);
      return;
    }
    setLocalItem(item);
  }, [item]);

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
    documentAcquireTime: '',
    invitedSuppliers: '',
    paymentPerformance: '',
    requesterName: '',
    requesterDepartment: '',
    procurementMethod: '',
    procurementCategory: '',
    budgetAmount: '',
    projectReason: '',
    supplierRequirements: '',
  });

  const selectedStage = useMemo(
    () =>
      localItem.stages.find((stage) => stage.stageKey === selectedStageKey) ??
      localItem.stages[0],
    [localItem.stages, selectedStageKey],
  );

  const archiveStepState = getArchiveStepState(item);
  const showArchiveStep = archiveStepState !== 'PENDING';
  const isCurrentStage = selectedStage.stageKey === localItem.currentStage && selectedRound === (localItem.currentRound ?? 1);
  const stageLocked = selectedStage.status === 'NOT_STARTED';
  const hasStageFiles = (selectedStage.attachments?.length ?? 0) > 0;
  const stageProcessing = uploading || analysisLoading;
  const canCompleteStage =
    isCurrentStage && selectedStage.status !== 'COMPLETED' && !stageLocked && !stageProcessing;
  const canArchive = archiveStepState === 'READY';

	const heroVisual = STAGE_HERO_VISUAL[selectedStage.stageKey] ?? { Icon: UploadCloud, colorVar: 'var(--accent)' };
	const stepPosition = useMemo(() => {
	  const idx = localItem.stages.findIndex(
	    (s) => s.stageKey === selectedStage.stageKey && (s.round ?? 1) === selectedRound,
	  );
	  return { number: idx >= 0 ? idx + 1 : selectedStage.stageOrder, total: localItem.stages.length };
	}, [localItem.stages, selectedStage.stageKey, selectedRound, selectedStage.stageOrder]);
	const { Icon: HeroIcon } = heroVisual;
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
  // 步骤检查是否进行的依据：AI 是否分析出文件内容（与"文件分析"区口径一致），而非仅看是否上传了附件。
  // 仅上传附件但尚未分析出内容时，不进行步骤检查，避免 AI 在空内容上臆造结论。
  const hasAnalyzedFiles = stageFileAnalysis.length > 0;

  // 当前阶段是否为「步骤分析」类型阶段（供应商邀请 / 专家抽取）
  const isStepAnalysisStage =
    selectedStage.stageKey === 'SUPPLIER_INVITATION' || selectedStage.stageKey === 'EXPERT_SELECTION';

  // ── 步骤分析 state（供应商邀请 / 专家抽取）──
  const [stepAnalysisContent, setStepAnalysisContent] = useState('');
  const [stepAnalysisLoading, setStepAnalysisLoading] = useState(false);
  const [stepAnalysisError, setStepAnalysisError] = useState<string | null>(null);
  const [stepAnalysisEmpty, setStepAnalysisEmpty] = useState(false);
  const [stepAnalysisTab, setStepAnalysisTab] = useState<'step' | 'file'>('step');

  // 用于触发文件分析刷新的计数器（仅在文件上传后增加）
  const [summaryRefreshing, setSummaryRefreshing] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [tenderWriteStageAction, setTenderWriteStageAction] = useState<string | null>(null);
  const [aiExtracting, setAiExtracting] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);
  const [supplierExtractOpen, setSupplierExtractOpen] = useState(false);
  const [expertExtractOpen, setExpertExtractOpen] = useState(false);
  const [announcementPublishOpen, setAnnouncementPublishOpen] = useState(false);
  const [announcementCategory, setAnnouncementCategory] = useState<'procurement_document' | 'failed_bid' | 'winning_bid'>('procurement_document');
  const [bidConfirmOpen, setBidConfirmOpen] = useState(false);
  // 深链自动弹开标确认面板（一次性：触发后即清标记，关闭后不复发）
  const autoOpenedBidConfirm = useRef(false);
  useEffect(() => {
    if (autoOpenBidConfirm && !autoOpenedBidConfirm.current) {
      autoOpenedBidConfirm.current = true;
      setBidConfirmOpen(true);
    }
  }, [autoOpenBidConfirm]);
  const [awardFileMakerOpen, setAwardFileMakerOpen] = useState(false);
  const [editingFile, setEditingFile] = useState<{ attachmentId: string; fileName: string; stageKey: ProjectWorkflowStageKey } | null>(null);

  // 步骤检查状态 —— 按 stageKey 缓存结果
  const complianceCache = useRef<Map<string, ComplianceAuditResponse>>(new Map());
  const tenderFileJustDeletedRef = useRef(false); // 删除采购文件时标记，阻止 useEffect[item] 恢复提取字段
  const [complianceAudit, setComplianceAudit] = useState<ComplianceAuditResponse | null>(null);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [complianceError, setComplianceError] = useState<string | null>(null);

  // 自动触发步骤检查：阶段切换时优先使用缓存，缓存未命中时请求 API
  // 未开始的阶段（NOT_STARTED）不触发步骤检查
  // 无附件的阶段不触发步骤检查——没有文件就没有审查依据
  const runComplianceAudit = useCallback((force = false) => {
    // 缓存 key 含 round，避免多轮采购时不同轮次同一 stageKey 冲突
    const cacheKey = `${item.id}:${selectedStage.stageKey}:${selectedRound}`;
    // 当前阶段没有任何附件：没有审查依据，不进行步骤检查，并清掉旧缓存
    // 步骤分析阶段（供应商邀请/专家抽取）无附件也可基于步骤分析结果审查
    const hasFiles = selectedStage.attachments && selectedStage.attachments.length > 0;
    const hasStepContent = stepAnalysisContent.trim().length > 0;
    if (!hasFiles && !isStepAnalysisStage) {
      complianceCache.current.delete(cacheKey);
      setComplianceAudit(null);
      setComplianceError(null);
      setComplianceLoading(false);
      return;
    }
    // 先判定是否有可分析的文件内容：没有则不进行步骤检查，并清掉该阶段旧缓存，
    // 避免在"无文件 / 分析被清空 / 分析失败"时误展示历史结论（含旧缓存里的善意推断结论）。
    // 该判定必须早于缓存读取，否则同 cacheKey 的旧缓存会先命中并覆盖清空意图。
    if (!hasAnalyzedFiles && !hasStepContent) {
      complianceCache.current.delete(cacheKey);
      setComplianceAudit(null);
      setComplianceError(null);
      setComplianceLoading(false);
      return;
    }
    // 优先使用缓存（非强制模式下命中即直接展示）——切换步骤时立即显示已有结果
    if (!force) {
      const cached = complianceCache.current.get(cacheKey);
      if (cached) {
        setComplianceAudit(cached);
        setComplianceError(null);
        setComplianceLoading(false);
        return;
      }
    }
    if (stageLocked) {
      setComplianceAudit(null);
      setComplianceError(null);
      setComplianceLoading(false);
      return;
    }
    // AI loading：清空旧值避免展示上一步骤结果
    setComplianceAudit(null);
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
  }, [item.id, selectedStage.stageKey, stageLocked, hasAnalyzedFiles, isStepAnalysisStage, stepAnalysisContent]);
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
  const loadAnalysis = useCallback((refresh = false) => {
    setAnalysisLoading(true);
    setAnalysisError(null);
    analyzeProjectManagementItem(item.id, selectedStage.stageKey, refresh)
      .then((nextAnalysis) => { setAnalysis(nextAnalysis); })
      .catch((error) => { setAnalysisError(error instanceof Error ? error.message : 'AI 分析暂不可用。'); })
      .finally(() => { setAnalysisLoading(false); });
  }, [item.id, selectedStage.stageKey]);

  useEffect(() => {
    loadAnalysis();
  }, [loadAnalysis]);

  // 步骤分析：仅在供应商邀请/专家抽取阶段加载
  const loadStepAnalysis = useCallback((refresh = false) => {
    if (!isStepAnalysisStage) return;
    setStepAnalysisLoading(true);
    setStepAnalysisError(null);
    analyzeProjectStep(item.id, selectedStage.stageKey, refresh)
      .then((res) => {
        setStepAnalysisContent(res.content);
        setStepAnalysisEmpty(res.empty);
      })
      .catch((error) => {
        setStepAnalysisError(error instanceof Error ? error.message : '步骤分析暂不可用。');
        setStepAnalysisContent('');
        setStepAnalysisEmpty(false);
      })
      .finally(() => setStepAnalysisLoading(false));
  }, [item.id, selectedStage.stageKey, isStepAnalysisStage]);

  useEffect(() => {
    setStepAnalysisContent('');
    setStepAnalysisEmpty(false);
    setStepAnalysisError(null);
    setStepAnalysisTab('step');
    loadStepAnalysis();
  }, [loadStepAnalysis]);


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
      complianceCache.current.delete(`${item.id}:${selectedStage.stageKey}:${selectedRound}`);
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

  // 流标归档：绕过合同完成校验（allowIncomplete）
  const handleAwardArchive = async () => {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await completeProjectManagementItem(item.id, true);
      await onUpdated();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '归档失败。');
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
    } else if (field === 'budgetAmount') {
      // 预算金额在 schema 中为必填 Decimal，清空时回退为 0 而非 null
      const num = Number.parseFloat(value);
      payload[field] = Number.isNaN(num) ? 0 : num;
    } else if (
      field === 'requesterName' ||
      field === 'requesterDepartment' ||
      field === 'procurementMethod' ||
      field === 'procurementCategory' ||
      field === 'projectReason' ||
      field === 'supplierRequirements'
    ) {
      // 必填字符串字段，空值保留为空串而非 null
      payload[field] = value.trim();
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

  const handleAiExtractTender = async (field: string) => {
    const tenderStage = localItem.stages.find((s) => s.stageKey === 'TENDER_DOCUMENT');
    const hasTenderFile = tenderStage?.attachments?.some(
      (a) => /采购文件|招标文件/.test(a.fileName) && !/审批表|公告|合同|通知书|需求|立项/.test(a.fileName),
    );
    if (!hasTenderFile) {
      setAiResult({ type: 'warning', message: '请先在「采购文件」步骤上传采购文件后再使用 AI 提取' });
      return;
    }
    setAiExtracting(field);
    try {
      const result = await extractTenderFields(item.id, field);
      const val = result[field];
      if (val) {
        // 成功：静默更新左侧，不弹窗
        await onUpdated();
      } else {
        setAiResult({ type: 'error', message: '未能提取到该字段信息，请检查采购文件内容。' });
      }
    } catch (e) {
      setAiResult({ type: 'error', message: e instanceof Error ? e.message : 'AI 提取失败' });
    } finally {
      setAiExtracting(null);
    }
  };

  // AI 提取并优化"申请立项事由 / 对供方的主要要求"：直接持久化结果并刷新，
  // 不再进入编辑态让用户确认——AI 输出即终值，用户想微调可点字段右侧铅笔。
  const handleAiOptimizeInitiation = async () => {
    setAiExtracting('initiation');
    try {
      const res = await optimizeInitiationFields(item.id);
      const pr = typeof res?.projectReason === 'string' ? res.projectReason.trim() : '';
      const sr = typeof res?.supplierRequirements === 'string' ? res.supplierRequirements.trim() : '';
      if (!pr && !sr) {
        setAiResult({ type: 'warning', message: 'AI 未能从采购需求/采购立项文件中提炼出相关内容，请检查是否已上传并分析文件。' });
        return;
      }
      // 持久化：未提取到的字段回退到原值，避免空值覆盖已有内容
      await updateProjectExtractedInfo(item.id, {
        projectReason: pr || localItem.projectReason || '',
        supplierRequirements: sr || localItem.supplierRequirements || '',
      });
      await onUpdated();
    } catch (e) {
      setAiResult({ type: 'error', message: e instanceof Error ? e.message : 'AI 提取并优化失败' });
    } finally {
      setAiExtracting(null);
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

  // 阶段附件发生变化（新增 / 替换）后的统一处理，避免需手动刷新页面才可见：
  //  - 拿到上传结果（客户端上传）时即时注入 localItem，文件立即可见；
  //  - 服务端创建/替换（无 result）时由弹窗的 onPublished/onFileReplaced 回流更新列表；
  //  - 始终刷新后端文件分析 + 步骤检查缓存（即使当前没选中该阶段），
  //    这样从弹窗（如采购文件编写）回到该阶段时缓存已就绪、不会报"没有文件内容"。
  //  - UI 态（analysis / complianceAudit / loading）仅当选中的正是该阶段时才更新。
  const handleStageAttachmentChanged = useCallback(
    (stageKey: ProjectWorkflowStageKey, result?: UploadStageAttachmentResult) => {
      if (result) {
        setLocalItem((prev) => ({
          ...prev,
          stages: prev.stages.map((s) =>
            s.stageKey === stageKey
              ? { ...s, attachments: [...s.attachments, result] }
              : s,
          ),
        }));
      }
      const isCurrentStage = selectedStageKey === stageKey;
      if (isCurrentStage) {
        setAnalysisLoading(true);
        setAnalysisError(null);
      }
      // 清缓存后等分析完成再触发合规检查——否则后端 auditStageCompliance
      // 读到的分析缓存还是旧版本/空，全部显示"未检测到采购文件"
      complianceCache.current.delete(`${item.id}:${stageKey}:${selectedRound}`);
      analyzeProjectManagementItem(item.id, stageKey)
        .then((next) => { if (isCurrentStage) setAnalysis(next); })
        .catch((e) => { if (isCurrentStage) setAnalysisError(e instanceof Error ? e.message : 'AI 分析暂不可用。'); })
        .finally(() => {
          if (isCurrentStage) setAnalysisLoading(false);
          // 文件分析已完成（后端缓存已更新）→ 直接发起合规检查
          if (isCurrentStage) {
            setComplianceLoading(true);
            setComplianceError(null);
          }
          auditStageCompliance(item.id, stageKey, true)
            .then((auditResult) => {
              const isFallback = auditResult.results.every(r => r.evidence.includes('AI 审查服务暂不可用'));
              if (!isFallback) {
                complianceCache.current.set(`${item.id}:${stageKey}:${selectedRound}`, auditResult);
              }
              if (isCurrentStage) setComplianceAudit(auditResult);
            })
            .catch((err) => { if (isCurrentStage) setComplianceError(err instanceof Error ? err.message : '步骤检查请求失败'); })
            .finally(() => { if (isCurrentStage) setComplianceLoading(false); });
        });
    },
    [item.id, selectedStageKey, selectedRound],
  );

  // 采购方式 / 采购类别下拉选项 —— 确保当前值始终在选项中（历史数据可能不在标准枚举内）
  const methodOptions = item.procurementMethod && !(PROCUREMENT_METHODS as readonly string[]).includes(item.procurementMethod)
    ? [item.procurementMethod, ...PROCUREMENT_METHODS]
    : [...PROCUREMENT_METHODS];
  const categoryOptions = item.procurementCategory && !PROCUREMENT_CATEGORY_OPTIONS.includes(item.procurementCategory)
    ? [item.procurementCategory, ...PROCUREMENT_CATEGORY_OPTIONS]
    : PROCUREMENT_CATEGORY_OPTIONS;

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
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <div className="page-hero__title">{item.title}</div>
                  {item.projectCode && (
                    <span className="inline-flex items-center rounded-[6px] bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] px-2.5 py-1 font-mono text-[11px] font-bold tracking-tight text-[color:var(--accent-strong)]">
                      {item.projectCode}
                    </span>
                  )}
                </div>
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
                className="neu-btn-xs"
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
                <RefreshCw size={12} className={summaryRefreshing ? 'animate-spin' : ''} />
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
              activeRound={selectedRound}
              onSelect={(key, round) => { setSelectedStageKey(key); setSelectedRound(round); }}
              onStageAction={(stageKey) => {
                if (stageKey === 'TENDER_DOCUMENT') {
                  setTenderWriteStageAction(stageKey);
                } else if (stageKey === 'EXPERT_SELECTION') {
                  setExpertExtractOpen(true);
                } else if (stageKey === 'SUPPLIER_INVITATION') {
                  setSupplierExtractOpen(true);
                } else if (stageKey === 'PUBLIC_ANNOUNCEMENT') {
                  setAnnouncementPublishOpen(true);
                } else if (stageKey === 'BID_EVALUATION') {
                  setBidConfirmRound(selectedRound);
                  setBidConfirmOpen(true);
                } else if (stageKey === 'AWARD_DECISION') {
                  setAwardFileMakerOpen(true);
                }
              }}
              showArchiveStep={showArchiveStep}
              archiveStepState={archiveStepState}
              tenderDocxAttachments={tenderDocxFiles}
              onEditTenderFile={(attachmentId, fileName) => setEditingFile({ attachmentId, fileName, stageKey: 'TENDER_DOCUMENT' })}
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
                {/* 项目名称 — 核心标识，突出展示（脱离 grid） */}
                <div className="mb-3 rounded-[12px] px-3.5 py-3" style={{ background: "color-mix(in oklch,var(--accent-soft) 14%, transparent)", boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.5)" }}>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">项目名称</span>
                  {editingField === 'title' ? (
                    <div className="mt-1 flex items-center gap-1.5">
                      <input type="text" value={editValues.title} onChange={(e) => setEditValues((prev) => ({ ...prev, title: e.target.value }))} className="workbench-input !h-[30px] !text-sm flex-1" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveField('title'); if (e.key === 'Escape') setEditingField(null); }} />
                      <button type="button" onClick={() => void handleSaveField('title')} className="neu-btn-xs"><Save size={13} /></button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => handleStartEdit('title', item.title)} className="group mt-1 flex w-full items-center gap-1.5 text-left">
                      <span className="text-[15px] font-bold tracking-[-0.02em] text-[color:var(--foreground)]">{item.title || <span className="text-[color:var(--muted-foreground)]/50">未命名项目</span>}</span>
                      <Pencil size={11} className="shrink-0 text-[color:var(--muted-foreground)] opacity-0 transition group-hover:opacity-100" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">申请人</span>
                    {editingField === 'requesterName' ? (
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <input type="text" value={editValues.requesterName} onChange={(e) => setEditValues((prev) => ({ ...prev, requesterName: e.target.value }))} className="workbench-input !h-[28px] !text-xs flex-1" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveField('requesterName'); if (e.key === 'Escape') setEditingField(null); }} />
                        <button type="button" onClick={() => void handleSaveField('requesterName')} className="neu-btn-xs"><Save size={13} /></button>
                        <button type="button" onClick={() => setEditingField(null)} className="neu-btn-xs"><X size={13} /></button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => handleStartEdit('requesterName', item.requesterName)} className="group mt-0.5 flex items-center gap-1 w-full text-left">
                        <span className="text-[color:var(--foreground)]">{item.requesterName || <span className="text-[color:var(--muted-foreground)]/50">待补充</span>}</span>
                        <Pencil size={10} className="opacity-0 transition group-hover:opacity-100 shrink-0 text-[color:var(--muted-foreground)]" />
                      </button>
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">申请部门</span>
                    {editingField === 'requesterDepartment' ? (
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <input type="text" value={editValues.requesterDepartment} onChange={(e) => setEditValues((prev) => ({ ...prev, requesterDepartment: e.target.value }))} className="workbench-input !h-[28px] !text-xs flex-1" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveField('requesterDepartment'); if (e.key === 'Escape') setEditingField(null); }} />
                        <button type="button" onClick={() => void handleSaveField('requesterDepartment')} className="neu-btn-xs"><Save size={13} /></button>
                        <button type="button" onClick={() => setEditingField(null)} className="neu-btn-xs"><X size={13} /></button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => handleStartEdit('requesterDepartment', item.requesterDepartment)} className="group mt-0.5 flex items-center gap-1 w-full text-left">
                        <span className="text-[color:var(--foreground)]">{item.requesterDepartment || <span className="text-[color:var(--muted-foreground)]/50">待补充</span>}</span>
                        <Pencil size={10} className="opacity-0 transition group-hover:opacity-100 shrink-0 text-[color:var(--muted-foreground)]" />
                      </button>
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">采购方式</span>
                    {editingField === 'procurementMethod' ? (
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <select value={editValues.procurementMethod} onChange={(e) => setEditValues((prev) => ({ ...prev, procurementMethod: e.target.value }))} className="workbench-input !h-[28px] !text-xs flex-1" autoFocus>
                          <option value="">请选择</option>
                          {methodOptions.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                        <button type="button" onClick={() => void handleSaveField('procurementMethod')} className="neu-btn-xs"><Save size={13} /></button>
                        <button type="button" onClick={() => setEditingField(null)} className="neu-btn-xs"><X size={13} /></button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => handleStartEdit('procurementMethod', item.procurementMethod)} className="group mt-0.5 flex items-center gap-1 w-full text-left">
                        <span className="text-sm text-[color:var(--foreground)]">{item.procurementMethod || <span className="text-[color:var(--muted-foreground)]/50">待补充</span>}</span>
                        <Pencil size={10} className="opacity-0 transition group-hover:opacity-100 shrink-0 text-[color:var(--muted-foreground)]" />
                      </button>
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">采购类别</span>
                    {editingField === 'procurementCategory' ? (
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <select value={editValues.procurementCategory} onChange={(e) => setEditValues((prev) => ({ ...prev, procurementCategory: e.target.value }))} className="workbench-input !h-[28px] !text-xs flex-1" autoFocus>
                          <option value="">请选择</option>
                          {categoryOptions.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                        <button type="button" onClick={() => void handleSaveField('procurementCategory')} className="neu-btn-xs"><Save size={13} /></button>
                        <button type="button" onClick={() => setEditingField(null)} className="neu-btn-xs"><X size={13} /></button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => handleStartEdit('procurementCategory', item.procurementCategory)} className="group mt-0.5 flex items-center gap-1 w-full text-left">
                        <span className="text-sm text-[color:var(--foreground)]">{item.procurementCategory || <span className="text-[color:var(--muted-foreground)]/50">待补充</span>}</span>
                        <Pencil size={10} className="opacity-0 transition group-hover:opacity-100 shrink-0 text-[color:var(--muted-foreground)]" />
                      </button>
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">预算金额</span>
                    {editingField === 'budgetAmount' ? (
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <input type="number" value={editValues.budgetAmount} onChange={(e) => setEditValues((prev) => ({ ...prev, budgetAmount: e.target.value }))} className="workbench-input !h-[28px] !text-xs flex-1" placeholder="输入金额" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveField('budgetAmount'); if (e.key === 'Escape') setEditingField(null); }} />
                        <button type="button" onClick={() => void handleSaveField('budgetAmount')} className="neu-btn-xs"><Save size={13} /></button>
                        <button type="button" onClick={() => setEditingField(null)} className="neu-btn-xs"><X size={13} /></button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => handleStartEdit('budgetAmount', item.budgetAmount)} className="group mt-0.5 flex items-center gap-1 w-full text-left">
                        <span className="text-[15px] font-black tracking-[-0.02em] tabular-nums text-[color:var(--accent)]">{item.budgetAmount.toLocaleString('zh-CN')} <span className="text-[10px] font-semibold text-[color:var(--muted-foreground)]">元</span></span>
                        <Pencil size={10} className="opacity-0 transition group-hover:opacity-100 shrink-0 text-[color:var(--muted-foreground)]" />
                      </button>
                    )}
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
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">部门编号</span>
                    <div className="mt-0.5 text-[color:var(--foreground)]">{item.departmentNumber || '无'}</div>
                  </div>
                </div>
                <div className="mt-3 pt-3" style={{borderTop:"1px solid oklch(0.6 0.04 258 / 0.12)"}}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">申请立项事由</span>
                    <button
                      type="button"
                      onClick={() => void handleAiOptimizeInitiation()}
                      disabled={aiExtracting === 'initiation' || stageLocked}
                      title="依据采购需求、采购立项阶段上传的文件，AI 提取并优化以下两项内容"
                      className="neu-btn-xs is-info !h-[22px] !px-2 !text-[10px]"
                    >
                      {aiExtracting === 'initiation' ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />} AI 提取并优化
                    </button>
                  </div>
                  {editingField === 'projectReason' ? (
                    <div className="mt-1 flex items-start gap-2">
                      <textarea
                        value={editValues.projectReason}
                        onChange={(e) => setEditValues((prev) => ({ ...prev, projectReason: e.target.value }))}
                        className="workbench-input !text-xs flex-1 min-h-[64px] leading-6"
                        placeholder="申请立项事由"
                        autoFocus
                      />
                      <button type="button" onClick={() => void handleSaveField('projectReason')} className="neu-btn-xs mt-1"><Save size={13} /></button>
                      <button type="button" onClick={() => setEditingField(null)} className="neu-btn-xs mt-1"><X size={13} /></button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => handleStartEdit('projectReason', localItem.projectReason ?? null)} disabled={stageLocked} className="group mt-1 block w-full text-left">
                      <span className={`text-sm leading-6 ${localItem.projectReason ? 'text-[color:var(--foreground)]' : 'text-[color:var(--muted-foreground)]/50'}`}>{localItem.projectReason || '待补充'}</span>
                      {!stageLocked && <Pencil size={10} className="inline opacity-0 transition group-hover:opacity-100 text-[color:var(--muted-foreground)] ml-1" />}
                    </button>
                  )}
                </div>
                <div className="mt-3">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">对供方的主要要求</span>
                  {editingField === 'supplierRequirements' ? (
                    <div className="mt-1 flex items-start gap-2">
                      <textarea
                        value={editValues.supplierRequirements}
                        onChange={(e) => setEditValues((prev) => ({ ...prev, supplierRequirements: e.target.value }))}
                        className="workbench-input !text-xs flex-1 min-h-[64px] leading-6"
                        placeholder="对供方的主要要求"
                        autoFocus
                      />
                      <button type="button" onClick={() => void handleSaveField('supplierRequirements')} className="neu-btn-xs mt-1"><Save size={13} /></button>
                      <button type="button" onClick={() => setEditingField(null)} className="neu-btn-xs mt-1"><X size={13} /></button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => handleStartEdit('supplierRequirements', localItem.supplierRequirements ?? null)} disabled={stageLocked} className="group mt-1 block w-full text-left">
                      <span className={`text-sm leading-6 ${localItem.supplierRequirements ? 'text-[color:var(--foreground)]' : 'text-[color:var(--muted-foreground)]/50'}`}>{localItem.supplierRequirements || '无'}</span>
                      {!stageLocked && <Pencil size={10} className="inline opacity-0 transition group-hover:opacity-100 text-[color:var(--muted-foreground)] ml-1" />}
                    </button>
                  )}
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
                    <div className="flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">项目概况</span><button type="button" onClick={() => void handleAiExtractTender('projectOverview')} disabled={aiExtracting === 'projectOverview'} className="neu-btn-xs is-info !h-[22px] !px-2 !text-[10px]">{aiExtracting === 'projectOverview' ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} AI提取</button></div>
                    {editingField === 'projectOverview' ? (
                      <div className="mt-1 flex items-start gap-2">
                        <textarea value={editValues.projectOverview} onChange={(e) => setEditValues((prev) => ({ ...prev, projectOverview: e.target.value }))} className="workbench-input !text-xs flex-1 min-h-[60px]" autoFocus />
                        <button type="button" onClick={() => void handleSaveField('projectOverview')} className="neu-btn-xs mt-1"><Save size={13} /></button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => handleStartEdit('projectOverview', extractedInfoOverride?.projectOverview ?? localItem.projectOverview ?? null)} className="group mt-1 block w-full text-left">
                        <span className={`text-sm leading-6 ${(extractedInfoOverride?.projectOverview ?? localItem.projectOverview) ? 'text-[color:var(--foreground)]' : 'text-[color:var(--muted-foreground)]/50'}`}>{(extractedInfoOverride?.projectOverview ?? localItem.projectOverview) || '待补充'}</span>
                        <Pencil size={10} className="inline opacity-0 transition group-hover:opacity-100 text-[color:var(--muted-foreground)] ml-1" />
                      </button>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">开标时间</span><button type="button" onClick={() => void handleAiExtractTender('bidOpeningTime')} disabled={aiExtracting === 'bidOpeningTime'} className="neu-btn-xs is-info !h-[22px] !px-2 !text-[10px]">{aiExtracting === 'bidOpeningTime' ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} AI提取</button></div>
                    {editingField === 'bidOpeningTime' ? (
                      <div className="mt-1 flex items-center gap-1.5">
                        <input type="text" value={editValues.bidOpeningTime} onChange={(e) => setEditValues((prev) => ({ ...prev, bidOpeningTime: e.target.value }))} className="workbench-input !h-[28px] !text-xs" placeholder="如 2026年8月15日" autoFocus />
                        <button type="button" onClick={() => void handleSaveField('bidOpeningTime')} className="neu-btn-xs"><Save size={13} /></button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => handleStartEdit('bidOpeningTime', extractedInfoOverride?.bidOpeningTime ?? localItem.bidOpeningTime ?? null)} className="group mt-0.5 flex items-center gap-1">
                        <span className={`text-sm ${(extractedInfoOverride?.bidOpeningTime ?? localItem.bidOpeningTime) ? 'text-[color:var(--foreground)]' : 'text-[color:var(--muted-foreground)]/50'}`}>{(extractedInfoOverride?.bidOpeningTime ?? localItem.bidOpeningTime) || '待补充'}</span>
                        <Pencil size={10} className="opacity-0 transition group-hover:opacity-100 text-[color:var(--muted-foreground)]" />
                      </button>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">采购文件获取时间</span><button type="button" onClick={() => void handleAiExtractTender('documentAcquireTime')} disabled={aiExtracting === 'documentAcquireTime'} className="neu-btn-xs is-info !h-[22px] !px-2 !text-[10px]">{aiExtracting === 'documentAcquireTime' ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} AI提取</button></div>
                    {editingField === 'documentAcquireTime' ? (
                      <div className="mt-1 flex items-center gap-1.5">
                        <input type="text" value={editValues.documentAcquireTime} onChange={(e) => setEditValues((prev) => ({ ...prev, documentAcquireTime: e.target.value }))} className="workbench-input !h-[28px] !text-xs" placeholder="如 2026年3月23日9:00-3月26日15:00" autoFocus />
                        <button type="button" onClick={() => void handleSaveField('documentAcquireTime')} className="neu-btn-xs"><Save size={13} /></button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => handleStartEdit('documentAcquireTime', extractedInfoOverride?.documentAcquireTime ?? localItem.documentAcquireTime ?? null)} className="group mt-0.5 flex items-center gap-1">
                        <span className={`text-sm ${(extractedInfoOverride?.documentAcquireTime ?? localItem.documentAcquireTime) ? 'text-[color:var(--foreground)]' : 'text-[color:var(--muted-foreground)]/50'}`}>{(extractedInfoOverride?.documentAcquireTime ?? localItem.documentAcquireTime) || '待补充'}</span>
                        <Pencil size={10} className="opacity-0 transition group-hover:opacity-100 text-[color:var(--muted-foreground)]" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* ── 供应商邀请/参与 ── */}
              {['谈判采购', '询比采购', '直接采购', '邀请招标', '竞价采购'].includes(item.procurementMethod) && (
              <div className="rounded-[16px] px-4 py-3.5"
                style={{background:"oklch(1 0 0 / 0.32)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.7)"}}>
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]" style={{background:"var(--stage-announce-soft)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)"}}>
                    <UserPlus size={14} style={{color:"var(--stage-announce)"}} />
                  </div>
                  <span className="text-sm font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">{item.procurementMethod === '谈判采购' ? '供应商邀请' : '供应商参与'}</span>
                </div>
                <BiddingUnitsField
                  label={item.procurementMethod === '谈判采购' ? '邀请的供应商' : '参与的供应商'}
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
                  {/* 中标单位 — 重要结果，突出展示 */}
                  <div className="col-span-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">中标单位</span>
                    {editingField === 'awardedSupplier' ? (
                      <div className="mt-1 flex items-center gap-1.5">
                        <input type="text" value={editValues.awardedSupplier} onChange={(e) => setEditValues((prev) => ({ ...prev, awardedSupplier: e.target.value }))} className="workbench-input !h-[28px] !text-xs" autoFocus />
                        <button type="button" onClick={() => void handleSaveField('awardedSupplier')} className="neu-btn-xs"><Save size={13} /></button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => handleStartEdit('awardedSupplier', extractedInfoOverride?.awardedSupplier ?? item.awardedSupplier)} className="group mt-1 flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left"
                        style={{ background: 'color-mix(in oklch, var(--success) 6%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
                        <Award size={14} className="shrink-0" style={{ color: 'var(--success)' }} />
                        <span className="text-sm font-semibold text-[color:var(--foreground)]">{(extractedInfoOverride?.awardedSupplier ?? item.awardedSupplier) || <span className="text-[color:var(--muted-foreground)]/50">待确定</span>}</span>
                        <Pencil size={10} className="opacity-0 transition group-hover:opacity-100 ml-auto text-[color:var(--muted-foreground)]" />
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
              {/* ══════ 当前步骤 hero —— 阶段焦点面板 ══════ */}
              <div
                className="pm-current-step-hero -mx-5 -mt-5 mb-1 overflow-hidden rounded-t-[20px]"
                style={{
                  '--step-color': heroVisual.colorVar,
                  '--step-color-soft': `color-mix(in oklch, ${heroVisual.colorVar} 10%, transparent)`,
                  background:
                    `linear-gradient(105deg, oklch(1 0 0 / 0.95) 0%, color-mix(in oklch, ${heroVisual.colorVar} 7%, oklch(0.98 0.003 258 / 0.5)) 65%)`,
                  borderBottom: '1px solid oklch(0.6 0.04 258 / 0.14)',
                } as React.CSSProperties}
              >
                <span className="pm-current-step-hero__glow" />
                {/* eyebrow：当前步骤 + 步骤进度 */}
                <div className="relative flex items-center justify-between gap-3 px-5 pt-4 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="pm-current-step-hero__dot" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--step-color)' }}>
                      当前步骤
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold tabular-nums text-[color:var(--muted-foreground)]">
                    第 {stepPosition.number} 步 / 共 {stepPosition.total} 步
                  </span>
                </div>
                {/* 主标题：大图标 + 阶段名 + 状态徽章 */}
                <div className="relative flex items-center gap-3.5 px-5 pb-4">
                  <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px]"
                    style={{
                      background: 'color-mix(in oklch, var(--step-color) 15%, transparent)',
                      boxShadow:
                        'inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 5px oklch(0.55 0.03 258 / 0.1), -1px -1px 3px oklch(1 0 0 / 0.8)',
                    }}
                  >
                    <HeroIcon size={22} style={{ color: 'var(--step-color)' }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[1.05rem] font-bold leading-tight tracking-[-0.02em] text-[color:var(--foreground)]">
                      {selectedStage.stageName}
                    </div>
                  </div>
                  <span
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[11px] font-bold tracking-[0.04em]"
                    style={{
                      background: 'color-mix(in oklch, var(--step-color) 13%, transparent)',
                      color: 'var(--step-color)',
                      boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)',
                    }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--step-color)' }} />
                    {PROJECT_STAGE_STATUS_LABELS[selectedStage.status]}
                  </span>
                </div>
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
                  // 判断被删文件是否"采购文件"（信息来源），而非审批表/公告/合同等附件
                  const deletedFile = selectedStage.attachments.find((a) => a.objectKey === deletedObjectKey);
                  const deletedName = deletedFile?.fileName || '';
                  const isTenderDoc = /采购文件|招标文件/.test(deletedName) && !/审批表|公告|合同|通知书|需求|立项/.test(deletedName);

                  if (isTenderDoc && selectedStage.stageKey === 'TENDER_DOCUMENT') {
                    // 删除采购文件：清空提取信息（DB 持久化）+ 文件分析 + 步骤检查
                    tenderFileJustDeletedRef.current = true; // 阻止 onUpdated 后 useEffect[item] 恢复提取字段
                    try {
                      await updateProjectExtractedInfo(item.id, { projectOverview: '', bidOpeningTime: '', documentAcquireTime: '', evaluationMethod: '' });
                    } catch (e) {
                      setErrorMessage(e instanceof Error ? e.message : '清空提取信息失败');
                    }
                    // 前端立即清空 localItem（乐观更新，不等 onUpdated）
                    setLocalItem((prev) => prev ? {
                      ...prev,
                      projectOverview: null,
                      bidOpeningTime: null,
                      documentAcquireTime: null,
                      evaluationMethod: null,
                    } : prev);
                    setExtractedInfoOverride((prev) => prev ? {
                      ...prev,
                      projectOverview: null,
                      bidOpeningTime: null,
                      documentAcquireTime: null,
                    } : null);
                    setAnalysis(null);
                    setComplianceAudit(null);
                    setComplianceError(null);
                  }

                  await onUpdated();
                  // 非采购文件：仅过滤被删文件的 analysis
                  if (!isTenderDoc && analysis) {
                    setAnalysis({ ...analysis, fileAnalyses: analysis.fileAnalyses.filter((fa) => fa.objectKey !== deletedObjectKey) });
                  }
                  // 删除文件后刷新步骤检查（采购文件已清空，不重跑）
                  complianceCache.current.delete(`${item.id}:${selectedStage.stageKey}:${selectedRound}`);
                  if (!isTenderDoc) runComplianceAudit(true);
                }}
                onEdit={(attachmentId, fileName) => setEditingFile({ attachmentId, fileName, stageKey: selectedStage.stageKey })}
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

              {/* ── 文件分析 / 步骤分析 ── */}
              <hr className="wb-section-rule" />

              {/* 步骤分析阶段：Tab 切换（有文件时）/ 仅步骤分析（无文件时）*/}
              {isStepAnalysisStage && stageFileAnalysis.length > 0 ? (
                <div className="flex items-center gap-1 mb-3">
                  <button
                    type="button"
                    onClick={() => setStepAnalysisTab('step')}
                    className={stepAnalysisTab === 'step' ? 'neu-btn-xs is-info' : 'neu-btn-xs'}
                  >步骤分析</button>
                  <button
                    type="button"
                    onClick={() => setStepAnalysisTab('file')}
                    className={stepAnalysisTab === 'file' ? 'neu-btn-xs is-info' : 'neu-btn-xs'}
                  >文件分析</button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[0.95rem] font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
                    {isStepAnalysisStage ? '步骤分析' : '文件分析'}
                  </span>
                  {!isStepAnalysisStage && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-[color:var(--muted-foreground)]">已上传 {stageFileAnalysis.length} 份</span>
                      <button
                        type="button"
                        disabled={analysisLoading || stageLocked || stageFileAnalysis.length === 0}
                        onClick={() => { loadAnalysis(true); }}
                        className="neu-btn-xs is-info"
                      >
                        <RefreshCw size={12} className={analysisLoading ? 'animate-spin' : ''} />重新分析
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 步骤分析阶段 + (无文件 或 当前Tab=step)：显示步骤分析内容 */}
              {isStepAnalysisStage && (stageFileAnalysis.length === 0 || stepAnalysisTab === 'step') && (
                <div>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <span className="text-[11px] font-semibold text-[color:var(--muted-foreground)]">
                      {selectedStage.stageKey === 'EXPERT_SELECTION' ? '专家抽取过程与名单' : '供应商邀请过程与名单'}
                    </span>
                    <button type="button" disabled={stepAnalysisLoading || stageLocked} onClick={() => loadStepAnalysis(true)} className="neu-btn-xs is-info">
                      <RefreshCw size={12} className={stepAnalysisLoading ? 'animate-spin' : ''} />重新分析
                    </button>
                  </div>
                  <div className="max-h-[320px] overflow-y-auto pr-1">
                    {stepAnalysisError ? (
                      <div className="rounded-lg px-4 py-4 text-sm leading-6" style={{background:"color-mix(in oklch,var(--danger) 8%,transparent)",boxShadow:"inset 1px 2px 4px oklch(0.55 0.03 258 / 0.1)"}}>{stepAnalysisError}</div>
                    ) : stepAnalysisLoading ? (
                      <div className="rounded-lg px-4 py-4 text-sm leading-6 text-[color:var(--muted-foreground)]" style={{background:"color-mix(in oklch,var(--muted) 30%,transparent)",boxShadow:"inset 1px 2px 4px oklch(0.55 0.03 258 / 0.12), inset -1px -1px 2px oklch(1 0 0 / 0.4)"}}>
                        <Loader2 size={14} className="animate-spin inline mr-2 text-[color:var(--accent)]" />正在分析抽取过程与名单...
                      </div>
                    ) : stepAnalysisEmpty ? (
                      <div className="rounded-lg px-4 py-4 text-sm leading-6 text-[color:var(--muted-foreground)]" style={{background:"color-mix(in oklch,var(--muted) 30%,transparent)",boxShadow:"inset 1px 2px 4px oklch(0.55 0.03 258 / 0.12), inset -1px -1px 2px oklch(1 0 0 / 0.4)"}}>
                        尚未完成{selectedStage.stageKey === 'EXPERT_SELECTION' ? '专家抽取' : '供应商邀请'}，请先通过阶段操作生成名单。
                      </div>
                    ) : stepAnalysisContent ? (
                      <div className="rounded-lg px-4 py-4 text-sm leading-6 text-[color:var(--foreground)] whitespace-pre-wrap" style={{background:"color-mix(in oklch,var(--muted) 30%,transparent)",boxShadow:"inset 1px 2px 4px oklch(0.55 0.03 258 / 0.12), inset -1px -1px 2px oklch(1 0 0 / 0.4)"}}>
                        {stepAnalysisContent}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}

              {/* 文件分析内容：非步骤分析阶段始终显示；步骤分析阶段仅 Tab=file 时显示 */}
              {(!isStepAnalysisStage || stepAnalysisTab === 'file') && (
                <>
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
                </>
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
                disabled={complianceLoading || stageProcessing || stageLocked || analysisLoading || !hasAnalyzedFiles}
                onClick={() => {
                  complianceCache.current.delete(`${item.id}:${selectedStage.stageKey}:${selectedRound}`);
                  runComplianceAudit(true);
                }}
                className="neu-btn-xs is-info"
              >
                {complianceLoading || stageProcessing ? (
                  <><Loader2 size={12} className="animate-spin" />{complianceLoading ? '审查中...' : '处理中...'}</>
                ) : (
                  <><Shield size={12} />重新检查</>
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

            {!stageLocked && !hasStageFiles && !isStepAnalysisStage && !complianceLoading && (
              <div className="rounded-lg px-4 py-3 text-xs text-[color:var(--muted-foreground)]" style={{background:"color-mix(in oklch,var(--muted) 20%,transparent)",boxShadow:"inset 1px 2px 4px oklch(0.55 0.03 258 / 0.08)"}}>
                请先上传采购文件，再进行步骤检查。
              </div>
            )}

            {!stageLocked && !hasStageFiles && isStepAnalysisStage && !stepAnalysisContent.trim() && !complianceLoading && (
              <div className="rounded-lg px-4 py-3 text-xs text-[color:var(--muted-foreground)]" style={{background:"color-mix(in oklch,var(--muted) 20%,transparent)",boxShadow:"inset 1px 2px 4px oklch(0.55 0.03 258 / 0.08)"}}>
                请先完成步骤分析，再进行步骤检查。
              </div>
            )}

            {!stageLocked && hasStageFiles && analysisLoading && !complianceLoading && (
              <div className="rounded-lg px-4 py-3 text-xs text-[color:var(--muted-foreground)]" style={{background:"color-mix(in oklch,var(--muted) 20%,transparent)",boxShadow:"inset 1px 2px 4px oklch(0.55 0.03 258 / 0.08)"}}>
                正在分析上传文件，分析完成后将自动进行步骤检查。
              </div>
            )}

            {!stageLocked && hasStageFiles && !analysisLoading && !hasAnalyzedFiles && !isStepAnalysisStage && !complianceLoading && (
              <div className="rounded-lg px-4 py-3 text-xs text-[color:var(--muted-foreground)]" style={{background:"color-mix(in oklch,var(--muted) 20%,transparent)",boxShadow:"inset 1px 2px 4px oklch(0.55 0.03 258 / 0.08)"}}>
                未分析出文件内容，暂不进行步骤检查。请点击"重新分析"后再检查。
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
          onAttachmentUploaded={(result) => handleStageAttachmentChanged('TENDER_DOCUMENT', result)}
          onUpdated={onUpdated}
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
          onFileReplaced={async () => {
            if (editingFile) handleStageAttachmentChanged(editingFile.stageKey);
            await onUpdated();
          }}
        />
      )}

      {/* 供应商邀请弹窗 */}
      <SupplierExtractModal
        isOpen={supplierExtractOpen}
        onClose={() => {
          setSupplierExtractOpen(false);
          if (isStepAnalysisStage) setTimeout(() => loadStepAnalysis(true), 200);
        }}
        project={item}
      />

      {/* 专家抽取弹窗 */}
      <ExpertExtractModal
        isOpen={expertExtractOpen}
        onClose={() => {
          setExpertExtractOpen(false);
          if (isStepAnalysisStage) setTimeout(() => loadStepAnalysis(true), 200);
        }}
        project={item}
      />

      {/* 公告制作与发布弹窗（两步向导）*/}
      <AnnouncementPublishWizard
        isOpen={announcementPublishOpen}
        onClose={() => { setAnnouncementPublishOpen(false); setAnnouncementCategory('procurement_document'); }}
        project={item}
        onPublished={onUpdated}
        initialCategory={announcementCategory}
        onStageAttachmentUploaded={(result) => handleStageAttachmentChanged('PUBLIC_ANNOUNCEMENT', result)}
      />

      {/* 开标确认面板：投标状态 / 专家确认 / 评分标准 / 开标决策 */}
      <BidConfirmPanel
        isOpen={bidConfirmOpen}
        onClose={() => setBidConfirmOpen(false)}
        project={item}
        round={bidConfirmRound}
        onSyncProjectInfo={(info) => {
          const hasInvited = info.invitedSuppliers.length > 0;
          const hasExpert = info.expertInfo.length > 0;
          if (!hasInvited && !hasExpert) return;
          const payload: Record<string, string | null> = {};
          if (hasInvited) payload.invitedSuppliers = info.invitedSuppliers;
          if (hasExpert) payload.expertInfo = info.expertInfo;
          // 直接落库持久化
          updateProjectExtractedInfo(item.id, payload as any).then((updated) => {
            setExtractedInfoOverride((prev) => ({
              ...prev,
              ...(hasInvited ? { invitedSuppliers: info.invitedSuppliers } : {}),
              ...(hasExpert ? { expertInfo: info.expertInfo } : {}),
            }));
          }).catch(() => {});
        }}
        onAbort={() => {
          setBidConfirmOpen(false);
          setAnnouncementCategory('failed_bid');
          setAnnouncementPublishOpen(true);
        }}
      />

      {/* 评分标准编制面板（2026-07-24 从开评标管理端 :3007 前置到采购文件阶段）*/}
      {/* 定标 · 文件制作（中标公告 / 中标通知书）—— 流标公告已移至开标确认面板 */}
      <AwardFileMaker
        isOpen={awardFileMakerOpen}
        onClose={() => setAwardFileMakerOpen(false)}
        project={item}
        onPublished={onUpdated}
      />

      {/* AI 提取结果弹窗（cgzxui Modal） */}
      {aiResult && (
        <div className="fixed inset-0 z-[550] flex items-center justify-center">
          <div className="absolute inset-0" style={{ background: 'oklch(0.975 0.012 258 / 0.6)', backdropFilter: 'blur(3px)' }} onClick={() => setAiResult(null)} />
          <div className="relative z-10 mx-5 w-full max-w-[420px] rounded-[22px] p-6" style={{ background: 'linear-gradient(170deg, oklch(1 0 0 / 0.97), oklch(0.99 0.003 258 / 0.72))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.9), 3px 4px 18px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)' }}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]" style={{ background: aiResult.type === 'success' ? 'color-mix(in oklch, var(--success) 14%, transparent)' : aiResult.type === 'warning' ? 'color-mix(in oklch, var(--warning) 14%, transparent)' : 'color-mix(in oklch, var(--danger) 14%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)' }}>
                  {aiResult.type === 'success' ? <CheckCircle2 size={16} style={{ color: 'var(--success)' }} /> : aiResult.type === 'warning' ? <AlertTriangle size={16} style={{ color: 'var(--warning)' }} /> : <X size={16} style={{ color: 'var(--danger)' }} />}
                </div>
                <span className="text-sm font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                  {aiResult.type === 'success' ? '提取完成' : aiResult.type === 'warning' ? '提示' : '提取失败'}
                </span>
              </div>
              <button type="button" onClick={() => setAiResult(null)} className="neu-btn-xs"><X size={16} /></button>
            </div>
            <p className="mt-3 text-sm leading-[1.6] text-[color:var(--muted-foreground)]">{aiResult.message}</p>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={() => setAiResult(null)} className="neu-btn-primary !h-[36px] !text-xs">知道了</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
