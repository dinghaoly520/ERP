"use client";

import { useState, useEffect, type CSSProperties } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  FileText,
  ClipboardList,
  Files,
  Building2,
  Calendar,
  Trophy,
  CheckCircle2,
  Clock,
  CalendarClock,
  FolderOpen,
  Loader2,
  Eye,
  Download,
} from "lucide-react";
import Folder from "@/components/Folder";
import { Modal } from "@/components/workbench";
import { ScoreSnapshotSection } from "@/components/projects/bid-confirm/handover-preview";
import { fmtAcquireRangeISO } from '@/lib/utils/format-acquire-time';
import { apiFetch } from '@/lib/api/api-fetch';

// Animation utilities
const easeOutQuint: [number, number, number, number] = [0.22, 1, 0.36, 1];

function fadeIn(index: number, reducedMotion: boolean, baseDelay = 0.04) {
  if (reducedMotion) return { initial: {}, animate: {}, transition: { duration: 0 } };
  return {
    initial: { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, delay: index * baseDelay, ease: easeOutQuint },
  };
}

type ArchiveDetailData = {
  projectId: string;
  projectTitle: string;
  archivedAt: string;
  archiveHook: string | null;
  archiveDir: string | null;
  /** terminated = 项目终止详情（复用本弹窗；附件无归档物理路径，不可预览） */
  kind?: 'archived' | 'terminated';
  /** 归档/终止时轮次（流标再采项目=末轮）；旧载荷缺省视作 1 */
  archivedRound?: number | null;
  terminatedRound?: number | null;
  basicInfo: Record<string, string>;
  extractedInfo: Record<string, string>;
  stages: Array<{
    stageKey: string;
    stageName: string;
    stageDirName: string;
    /** 所属轮次（旧载荷缺省视作 1） */
    round?: number | null;
    status: string;
    /** 终止详情专属：步骤分析缓存直出（2026-11-19「缓存直出+按需生成」裁定）；
     *  归档 TXT 路径不带（逐文件分析在 attachments[].analysis） */
    stageAnalysis?: string;
    attachments: Array<{
      id: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
      filePath: string | null;
      analysis: string;
    }>;
  }>;
  summary: string;
  /** #121②：评分段（关联投标项目有评标结果时下发；复用 ScoreSnapshotSection 渲染数值+通过性双形态） */
  scoreDetail?: {
    bidProject: { id: string; projectCode: string; name: string; stage: string; procurementMethod: string | null };
    items: { id: string; name: string; category?: string; maxScore?: number; points: { id: string; name: string }[] }[];
    records: { expertId: string; supplierId: string; scoreItemId: string; score: number; passed?: boolean | null }[];
    results: { supplierId: string; supplierName: string; totalScore?: number; averageScore?: number; rank?: number; recommended?: boolean; disqualified?: boolean; bidPrice?: number | null }[];
  } | null;
};

type FilePreviewModalProps = {
  fileUrl: string;
  fileName: string;
  mimeType: string;
  onClose: () => void;
};

function FilePreviewModal({ fileUrl, fileName, mimeType, onClose }: FilePreviewModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isPdf = mimeType.includes('pdf');
  const isImage = mimeType.includes('image');
  const isText = mimeType.includes('text') || fileName.endsWith('.txt');

  useEffect(() => {
    setLoading(true);
    setError(null);
  }, [fileUrl]);

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-3">
          <FileText size={18} className="text-[color:var(--accent)]" />
          <span className="text-[0.9rem] font-semibold truncate">{fileName}</span>
        </span>
      }
      size="lg"
      className="!max-w-[900px]"
    >
      <div className="flex justify-end">
        <a
          href={fileUrl}
          download={fileName}
          className="neu-btn-xs"
          title="下载文件"
        >
          <Download size={16} />
        </a>
      </div>

      <div className="h-[calc(80vh-60px)] overflow-auto rounded-[12px] bg-[color-mix(in_oklch,var(--muted-foreground)_5%,transparent)]">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={32} className="animate-spin text-[color:var(--accent)]" />
          </div>
        )}

        {isPdf && (
          <iframe
            src={fileUrl}
            className="w-full h-full"
            title={fileName}
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError('无法加载PDF文件');
            }}
          />
        )}

        {isImage && (
          <div className="flex items-center justify-center p-4">
            <img
              src={fileUrl}
              alt={fileName}
              className="max-w-full max-h-[70vh] object-contain rounded-[8px]"
              onLoad={() => setLoading(false)}
              onError={() => {
                setLoading(false);
                setError('无法加载图片');
              }}
            />
          </div>
        )}

        {isText && (
          <div className="p-6">
            <iframe
              src={fileUrl}
              className="w-full h-[60vh] rounded-[8px] bg-[var(--background)]"
              title={fileName}
              onLoad={() => setLoading(false)}
            />
          </div>
        )}

        {!isPdf && !isImage && !isText && (
          <div className="flex flex-col items-center justify-center h-full py-20">
            <FileText size={64} className="text-[color:var(--muted-foreground)]" />
            <div className="mt-4 text-[0.9rem] text-[color:var(--muted-foreground)]">
              该文件类型暂不支持预览
            </div>
            <a
              href={fileUrl}
              download={fileName}
              className="neu-btn-soft mt-4"
            >
              <Download size={14} />
              下载文件
            </a>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center h-full py-20">
            <div className="text-[0.9rem] text-[var(--danger)]">{error}</div>
          </div>
        )}
      </div>
    </Modal>
  );
}

type ArchiveDetailModalProps = {
  procurementRoundId: string;
  onClose: () => void;
};

/* 项目时间轴（表格排版，2026-11-20 用户裁定）：与 project-timeline-strip 同接口同格式化，
   本弹窗内以「节点 | 时间」两列表格呈现（横条为项目管理详情专用形态，互不影响） */
type TimelineNodeT = {
  key: string; label: string; time: string | null; timeEnd?: string | null; source: string;
  tone?: 'danger';
  group?: { label: string; count: number; time: string | null; detail?: string[] }[];
};
type TimelineDataT = { rounds: { round: number; nodes: TimelineNodeT[] }[]; currentRound?: number };

function timelineFmt(iso: string | null): string {
  if (!iso) return '未登记';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '未登记';
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  const hm = hasTime ? ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}${hm}`;
}
function timelineFmtNode(n: TimelineNodeT): string {
  if (!n.time) return '未登记';
  if (!n.timeEnd) return timelineFmt(n.time);
  return fmtAcquireRangeISO(n.time, n.timeEnd);
}

export function ArchiveDetailModal({ procurementRoundId, onClose }: ArchiveDetailModalProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const [data, setData] = useState<ArchiveDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStageKey, setSelectedStageKey] = useState<string | null>(null);
  // 项目时间轴（表格版）：详情载荷就绪后按 projectId 拉取，失败静默（卡片不渲染数据行）
  const [timeline, setTimeline] = useState<TimelineDataT | null>(null);
  const timelinePmiId = data?.projectId ?? null;
  useEffect(() => {
    if (!timelinePmiId) {
      setTimeline(null);
      return;
    }
    let alive = true;
    setTimeline(null);
    apiFetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api'}/project-management/${timelinePmiId}/timeline`, {
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('加载失败'))))
      .then((d: TimelineDataT) => { if (alive) setTimeline(d); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [timelinePmiId]);

  // File preview state
  const [previewFile, setPreviewFile] = useState<{
    url: string;
    fileName: string;
    mimeType: string;
  } | null>(null);

  const handleClosePreview = () => {
    setPreviewFile(null);
  };
  useEffect(() => {
    const fetchArchiveDetail = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch(
          `${process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api'}/project-management/archive/${procurementRoundId}`,
          { credentials: 'include' }
        );
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('未找到归档信息');
          }
          throw new Error('加载归档详情失败');
        }
        const result = await response.json();
        setData(result);
        // Select first stage with files
        const firstStageWithFiles = result.stages.find((s: ArchiveDetailData['stages'][number]) => s.attachments.length > 0);
        if (firstStageWithFiles) {
          setSelectedStageKey(`${firstStageWithFiles.stageKey}@${firstStageWithFiles.round ?? 1}`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
      }
    };
    fetchArchiveDetail();
  }, [procurementRoundId]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getStatusIcon = (status: string) => {
    if (status === '已完成') return <CheckCircle2 size={14} className="text-[var(--success)]" />;
    if (status === '进行中') return <Clock size={14} className="text-[var(--warning)]" />;
    return <Clock size={14} className="text-[var(--muted-foreground)]" />;
  };

  // 复合键（stageKey@round）：多轮同 stageKey 两行，裸 stageKey 会双命中（tab 键冲突、选中恒取第 1 轮）
  const stageKeyOf = (st: { stageKey: string; round?: number | null }) => `${st.stageKey}@${st.round ?? 1}`;
  const selectedStage = data?.stages.find((s) => stageKeyOf(s) === selectedStageKey);
  const hasMultiRounds = !!data && new Set(data.stages.map((st) => st.round ?? 1)).size > 1;
  const experts = data?.extractedInfo['专家信息']
    ? data.extractedInfo['专家信息'].split('\n').filter(Boolean).map((line) => {
        const normalizedLine = line.replace(/^\s*\d+[、.．]\s*/, '');
        const [namePart, detailPart = ''] = normalizedLine.split(' - ');
        const [department = '', specialty = '', title = ''] = detailPart.split(' / ');
        return { name: namePart.trim(), department: department.trim(), specialty: specialty.trim(), title: title.trim() };
      })
    : [];
  const biddingUnits = data?.extractedInfo['投标单位']
    ? data.extractedInfo['投标单位'].split(/[、,\n]/).map((unit) => unit.trim()).filter(Boolean)
    : [];
  const totalFiles = data?.stages.reduce((sum, stage) => sum + stage.attachments.length, 0) ?? 0;
  // 轮次口径（2026-10-26 流标再采适配）：只数归档/终止轮——多轮平铺会把第 1 轮
  // 完成数灌进末轮分母；兼容归档（英文枚举原值）与终止（中文标签）两种 status 取值
  const finalRound = data ? (data.archivedRound ?? data.terminatedRound ?? 1) : 1;
  const roundStages = data
    ? (data.stages.filter((st) => (st.round ?? 1) === finalRound).length > 0
        ? data.stages.filter((st) => (st.round ?? 1) === finalRound)
        : data.stages)
    : [];
  const completedStages = roundStages.filter((stage) => stage.status === '已完成' || stage.status === 'COMPLETED').length;
  const savingsLabel = data?.basicInfo['预算金额'] && data?.extractedInfo['合同金额']
    ? (() => {
        const budget = parseFloat(data.basicInfo['预算金额'].replace(/[^\d.]/g, ''));
        const contract = parseFloat(data.extractedInfo['合同金额'].replace(/[^\d.]/g, ''));
        const saved = budget - contract;
        return saved > 0 ? `${saved.toLocaleString()}元` : '-';
      })()
    : '-';

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={
          <span className="flex items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-[color-mix(in_oklch,var(--accent)_12%,transparent)]">
              <Folder
                color="#A3B8F2"
                size={0.35}
                items={[
                  <span key="doc" className="flex h-full w-full items-center justify-center"><FileText size={11} /></span>,
                  <span key="list" className="flex h-full w-full items-center justify-center"><ClipboardList size={11} /></span>,
                  <span key="bundle" className="flex h-full w-full items-center justify-center"><Files size={11} /></span>,
                ]}
              />
            </span>
            <span className="text-[1.15rem] font-bold text-[color:var(--foreground)]">
              {loading ? '加载中...' : data?.projectTitle || '归档详情'}
              {data?.kind === 'terminated' && (
                <span className="ml-2 inline-flex items-center rounded-[6px] bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] px-2 py-0.5 align-middle text-[11px] font-bold text-[var(--danger)]">已终止</span>
              )}
            </span>
          </span>
        }
        description={
          data ? (
            <span className="flex items-center gap-4">
              {data.extractedInfo['立项时间'] && (
                <span className="flex items-center gap-1.5">
                  <Calendar size={12} />
                  立项：{data.extractedInfo['立项时间']}
                </span>
              )}
              {data.archivedAt && (
                <span className={`flex items-center gap-1.5 ${data.kind === 'terminated' ? 'text-[var(--danger)] font-semibold' : ''}`}>
                  <FolderOpen size={12} />
                  {data.kind === 'terminated' ? '终止' : '归档'}：{data.archivedAt}
                </span>
              )}
              {data.archiveHook && (
                <span className="font-mono text-[color:var(--muted-foreground)]">
                  {data.archiveHook}
                </span>
              )}
            </span>
          ) : undefined
        }
        size="lg"
        className="!max-w-[1100px]"
      >
        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={32} className="animate-spin text-[color:var(--accent)]" />
            <span className="ml-4 text-[0.9rem] text-[color:var(--muted-foreground)]">正在加载归档信息...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20">
            <FileText size={48} className="text-[color:var(--danger)]" />
            <div className="mt-4 text-[0.9rem] text-[color:var(--danger)]">{error}</div>
            <button
              onClick={onClose}
              className="neu-btn-soft mt-6"
            >
              关闭
            </button>
          </div>
        ) : data ? (
          <div>
              {/* Top - Stage Selector */}
              <div className="flex items-center gap-3 overflow-x-auto px-5 py-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted-foreground)] shrink-0">
                  项目步骤
                </span>
                <div className="neu-tab-bar shrink-0">
                  {data.stages.map((stage) => (
                    <button
                      key={stageKeyOf(stage)}
                      type="button"
                      onClick={() => {
                        setSelectedStageKey(stageKeyOf(stage));
                      }}
                      className={`neu-tab ${selectedStageKey === stageKeyOf(stage) ? 'is-active' : ''}`}
                    >
                      {getStatusIcon(stage.status)}
                      <span>{hasMultiRounds ? `第${stage.round ?? 1}轮·` : ''}{stage.stageName}</span>
                      {stage.attachments.length > 0 && (
                        <span className="neu-tab-count">{stage.attachments.length}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Main Content Area */}
              <div className="flex min-h-0 flex-1 overflow-hidden">
                {/* Left Panel - Basic Info & Summary */}
                <div className="flex-1 overflow-y-auto p-5 space-y-5">
                  {/* 中标单位 - 单独一行 */}
                  <motion.div
                    {...fadeIn(0, reducedMotion)}
                    className="wb-tone-banner wb-tone-banner--success"
                  >
                    <div
                      className="wb-icon-well wb-icon-well--sm"
                      style={{ '--well-bg': 'color-mix(in oklch, var(--success) 15%, transparent)', '--well-fg': 'var(--success)' } as CSSProperties}
                    >
                      <Trophy size={16} />
                    </div>
                    <div className="flex-1">
                      <div className="text-xs opacity-70">中标单位</div>
                      <div className="text-[0.9rem] font-semibold">
                        {data.extractedInfo['中标单位'] || '-'}
                      </div>
                    </div>
                  </motion.div>

                  {/* 预算金额、合同金额、节约资金、节资率 - 四个指标一行 */}
                  <motion.div
                    {...fadeIn(1, reducedMotion)}
                    className="grid grid-cols-2 md:grid-cols-4 gap-2"
                  >
                    <div className="rounded-[10px] bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] shadow-[inset_0_1px_0_oklch(1_0_0_/_0.6)] px-3 py-2 text-center">
                      <div className="text-xs text-[color-mix(in_oklch,var(--accent)_70%,black)]">预算金额</div>
                      <div className="mt-0.5 text-[0.85rem] font-bold text-[color-mix(in_oklch,var(--accent)_85%,black)]">
                        {data.basicInfo['预算金额'] || '-'}
                      </div>
                    </div>
                    <div className="rounded-[10px] bg-[color-mix(in_oklch,var(--warning)_8%,transparent)] shadow-[inset_0_1px_0_oklch(1_0_0_/_0.6)] px-3 py-2 text-center">
                      <div className="text-xs text-[color-mix(in_oklch,var(--warning)_70%,black)]">合同金额</div>
                      <div className="mt-0.5 text-[0.85rem] font-bold text-[color-mix(in_oklch,var(--warning)_85%,black)]">
                        {data.extractedInfo['合同金额'] || '-'}
                      </div>
                    </div>
                    <div className="rounded-[10px] bg-[color-mix(in_oklch,var(--success)_8%,transparent)] shadow-[inset_0_1px_0_oklch(1_0_0_/_0.6)] px-3 py-2 text-center">
                      <div className="text-xs text-[color-mix(in_oklch,var(--success)_70%,black)]">节约资金</div>
                      <div className="mt-0.5 text-[0.85rem] font-bold text-[color-mix(in_oklch,var(--success)_85%,black)]">
                        {savingsLabel}
                      </div>
                    </div>
                    <div className="rounded-[10px] bg-[color-mix(in_oklch,var(--success)_8%,transparent)] shadow-[inset_0_1px_0_oklch(1_0_0_/_0.6)] px-3 py-2 text-center">
                      <div className="text-xs text-[color-mix(in_oklch,var(--success)_70%,black)]">节资率</div>
                      <div className="mt-0.5 text-[0.85rem] font-bold text-[color-mix(in_oklch,var(--success)_85%,black)]">
                        {data?.basicInfo['预算金额'] && data?.extractedInfo['合同金额']
                          ? (() => {
                              const budget = parseFloat(data.basicInfo['预算金额'].replace(/[^\d.]/g, ''));
                              const contract = parseFloat(data.extractedInfo['合同金额'].replace(/[^\d.]/g, ''));
                              if (budget > 0 && contract > 0) {
                                const rate = ((budget - contract) / budget * 100).toFixed(1);
                                return `${rate}%`;
                              }
                              return '-';
                            })()
                          : '-'}
                      </div>
                    </div>
                  </motion.div>

                  {/* Basic Info Card - All fields merged */}
                  <motion.div
                    {...fadeIn(2, reducedMotion)}
                    className="wb-note p-5"
                  >
                    <div className="flex items-center gap-2 mb-4">
                      <Building2 size={16} className="text-[var(--accent)]" />
                      <h3 className="text-base font-semibold">基本信息</h3>
                    </div>
                    <div className="space-y-4">
                      {/* Row 1: 申请人、申请部门、采购方式、采购类别、所属项目、合同编号 */}
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                        <div className="space-y-1">
                          <div className="text-xs text-[color:var(--muted-foreground)]">申请人</div>
                          <div className="text-[0.85rem] font-medium">{data.basicInfo['申请人'] || '-'}</div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs text-[color:var(--muted-foreground)]">申请部门</div>
                          <div className="text-[0.85rem]">{data.basicInfo['申请部门'] || '-'}</div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs text-[color:var(--muted-foreground)]">采购方式</div>
                          <div className="text-[0.85rem]">{data.basicInfo['采购方式'] || '-'}</div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs text-[color:var(--muted-foreground)]">采购类别</div>
                          <div className="text-[0.85rem]">{data.basicInfo['采购类别'] || '-'}</div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs text-[color:var(--muted-foreground)]">所属项目</div>
                          <div className="text-[0.85rem]">{data.basicInfo['所属项目'] || '-'}</div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs text-[color:var(--muted-foreground)]">项目编号</div>
                          <div className="text-[0.85rem] font-mono font-semibold text-[color:var(--accent-strong)]">{data.basicInfo['项目编号'] || '-'}</div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs text-[color:var(--muted-foreground)]">合同编号</div>
                          <div className="text-[0.85rem] font-mono">{data.basicInfo['合同编号'] || '-'}</div>
                        </div>
                      </div>
                      {data.kind === 'terminated' && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 rounded-[10px] bg-[color-mix(in_oklch,var(--danger)_6%,transparent)] p-3">
                          <div className="space-y-1">
                            <div className="text-xs text-[color:var(--muted-foreground)]">项目编号</div>
                            <div className="text-[0.85rem] font-mono">{data.basicInfo['项目编号'] || '-'}</div>
                          </div>
                          <div className="space-y-1">
                            <div className="text-xs text-[color:var(--muted-foreground)]">终止日期</div>
                            <div className="text-[0.85rem] font-semibold text-[var(--danger)]">{data.basicInfo['终止日期'] || '-'}</div>
                          </div>
                          <div className="space-y-1">
                            <div className="text-xs text-[color:var(--muted-foreground)]">终止时所在阶段</div>
                            <div className="text-[0.85rem]">{data.basicInfo['终止时所在阶段'] || '-'}</div>
                          </div>
                          <div className="space-y-1">
                            <div className="text-xs text-[color:var(--muted-foreground)]">终止人</div>
                            <div className="text-[0.85rem]">{data.basicInfo['终止人'] || '-'}</div>
                          </div>
                        </div>
                      )}
                      <div className="space-y-2 pt-3 border-t border-[color-mix(in_oklch,var(--muted-foreground)_12%,transparent)]">
                        <div className="text-xs text-[color:var(--muted-foreground)]">专家信息</div>
                        {experts.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {experts.map((expert, i) => {
                              const detail = [expert.department, expert.specialty, expert.title].filter(Boolean).join(' / ');
                              return (
                                <span
                                  key={i}
                                  className="group relative rounded-full bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] px-3 py-1 text-xs font-medium text-[var(--accent-strong)] cursor-default hover:bg-[color-mix(in_oklch,var(--accent)_18%,transparent)] transition-colors"
                                >
                                  {expert.name}
                                  {detail && (
                                    <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-2.5 py-1.5 rounded-[8px] bg-[oklch(0.25_0.03_258)] text-xs text-white whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 z-10 pointer-events-none">
                                      {detail}
                                    </span>
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-[0.85rem] text-[var(--danger)]">暂缺</span>
                        )}
                      </div>

                      {/* Row 5: 投标单位 */}
                      <div className="space-y-2 pt-2 border-t border-[color-mix(in_oklch,var(--muted-foreground)_12%,transparent)]">
                        <div className="text-xs text-[color:var(--muted-foreground)]">投标单位</div>
                        {biddingUnits.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {biddingUnits.map((unit, i) => (
                              <span key={i} className="rounded-[6px] bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] px-3 py-1 text-xs text-[color:var(--foreground)]">
                                {unit}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[0.85rem] text-[color:var(--muted-foreground)]">-</span>
                        )}
                      </div>

                      {/* Row 6: 申请立项事由 */}
                      <div className="space-y-2 pt-2 border-t border-[color-mix(in_oklch,var(--muted-foreground)_12%,transparent)]">
                        <div className="text-xs text-[color:var(--muted-foreground)]">申请立项事由</div>
                        <p className="text-[0.85rem] leading-relaxed text-[color:var(--foreground)] whitespace-pre-line">{data.basicInfo['申请立项事由'] || '-'}</p>
                      </div>

                      {/* Row 7: 对供方主要要求 */}
                      <div className="space-y-2 pt-2 border-t border-[color-mix(in_oklch,var(--muted-foreground)_12%,transparent)]">
                        <div className="text-xs text-[color:var(--muted-foreground)]">对供方主要要求</div>
                        <p className="text-[0.85rem] leading-relaxed text-[color:var(--foreground)] whitespace-pre-line">{data.basicInfo['对供方主要要求'] || '-'}</p>
                      </div>
                    </div>
                  </motion.div>

                  {/* Summary Card */}
                  <motion.div
                    {...fadeIn(1, reducedMotion)}
                    className="wb-note p-5"
                  >
                    <div className="flex items-center gap-2 mb-4">
                      <FileText size={16} className="text-[var(--accent)]" />
                      <h3 className="text-base font-semibold">项目简报</h3>
                    </div>
                    <div className="rounded-[12px] bg-[color-mix(in_oklch,var(--background)_60%,transparent)] px-4 py-3 max-h-[200px] overflow-y-auto">
                      <p className="text-[0.85rem] leading-relaxed text-[color:var(--foreground)] whitespace-pre-line">
                        {data.summary || '暂无项目简报信息。'}
                      </p>
                    </div>
                  </motion.div>

                  {/* 项目时间轴（2026-11-20 用户裁定表格排版）：节点 | 时间 两列，hairline 分隔；
                      未登记灰显、警示节点红显、组合节点（供应商参与）显家数 */}
                  <motion.div
                    {...fadeIn(2, reducedMotion)}
                    className="wb-note p-5"
                  >
                    <div className="flex items-center gap-2 mb-4">
                      <CalendarClock size={16} className="text-[var(--accent)]" />
                      <h3 className="text-base font-semibold">项目时间轴</h3>
                    </div>
                    {timeline && timeline.rounds.length > 0 ? (
                      <div className="rounded-[12px] bg-[color-mix(in_oklch,var(--background)_60%,transparent)] overflow-hidden">
                        {timeline.rounds.map((r, ri) => (
                          <div key={r.round}>
                            {timeline.rounds.length > 1 && (
                              <div className={`px-4 py-1.5 text-[11px] font-bold ${ri > 0 ? 'border-t border-[oklch(0.6_0.04_258_/_0.16)]' : ''} bg-[color-mix(in_oklch,var(--warning)_6%,transparent)] text-[color-mix(in_oklch,var(--warning)_80%,black)]`}>
                                第 {r.round} 轮
                              </div>
                            )}
                            <table className="w-full">
                              <tbody>
                                {r.nodes.map((n, ni) => (
                                  <tr
                                    key={n.key}
                                    className={ni > 0 ? 'border-t border-[oklch(0.6_0.04_258_/_0.12)]' : ''}
                                    title={[`${n.label}（来源：${n.source}）`, ...(n.group ?? []).flatMap((g) => [`${g.label} · ${g.count} 家`, ...(g.detail ?? [])])].join('\n')}
                                  >
                                    <td className="px-4 py-[7px]">
                                      <span className="flex items-center gap-2 text-[0.82rem]">
                                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${n.tone === 'danger' ? 'bg-[var(--danger)]' : n.time ? 'bg-[var(--accent)]' : 'bg-[color-mix(in_oklch,var(--muted-foreground)_40%,transparent)]'}`} />
                                        <span className={n.tone === 'danger' ? 'font-semibold text-[var(--danger)]' : n.time ? 'text-[color:var(--foreground)]' : 'text-[color:var(--muted-foreground)]/70'}>
                                          {n.label}
                                        </span>
                                      </span>
                                    </td>
                                    <td className="px-4 py-[7px] text-right">
                                      {n.group ? (
                                        <span className="text-[0.78rem] tabular-nums text-[color:var(--muted-foreground)]">
                                          {n.group.map((g) => g.count).join('/')} 家
                                        </span>
                                      ) : (
                                        <span className={`text-[0.78rem] tabular-nums ${n.tone === 'danger' && n.time ? 'text-[var(--danger)]' : 'text-[color:var(--muted-foreground)]'}`}>
                                          {timelineFmtNode(n)}
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-[12px] bg-[color-mix(in_oklch,var(--background)_60%,transparent)] px-4 py-3 text-xs text-[color:var(--muted-foreground)]">
                        暂无时间节点
                      </div>
                    )}
                  </motion.div>

                  {/* #121②：评分明细卡（关联投标项目有评标结果时才下发；复用回流包查验的快照组件——数值+通过性双形态） */}
                  {data.scoreDetail && (
                    <motion.div
                      {...fadeIn(3, reducedMotion)}
                      className="wb-note p-5"
                    >
                      <div className="flex items-center gap-2 mb-4">
                        <ClipboardList size={16} className="text-[var(--accent)]" />
                        <h3 className="text-base font-semibold">评分明细</h3>
                        <span className="text-xs text-[color:var(--muted-foreground)]">
                          关联投标项目 {data.scoreDetail.bidProject.projectCode} · {data.scoreDetail.results.length} 家供应商
                        </span>
                      </div>
                      <ScoreSnapshotSection
                        pkg={{
                          evaluationSnapshot: {
                            scoreItemDefinitions: data.scoreDetail.items,
                            scoreRecords: data.scoreDetail.records,
                          },
                          evaluationResults: data.scoreDetail.results,
                        }}
                      />
                    </motion.div>
                  )}
                </div>

                {/* Right Panel - 阶段材料（2026-11-20 用户裁定：台账不做分析——「步骤分析」
                    页签与生成入口全撤，仅展示载荷自带内容；分析生成归项目管理详情） */}
                <div className="w-[240px] xl:w-[320px] shrink-0 overflow-y-auto border-l border-[oklch(0.6_0.04_258_/_0.16)] bg-[color-mix(in_oklch,var(--success)_4%,transparent)]">
                  {selectedStage ? (
                    <>
                      {/* Stage Header */}
                      <div className="sticky top-0 z-10 px-4 py-3 border-b border-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)] bg-[color-mix(in_oklch,var(--background)_96%,transparent)] backdrop-blur">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(selectedStage.status)}
                          <span className="text-[0.85rem] font-semibold">{selectedStage.stageName}</span>
                          <span className="ml-auto rounded-[6px] bg-[color-mix(in_oklch,var(--success)_8%,transparent)] px-1.5 py-0.5 text-[10px] font-bold text-[color-mix(in_oklch,var(--success)_80%,black)]">
                            文件 {selectedStage.attachments.length}
                          </span>
                        </div>
                      </div>

                      {selectedStage.attachments.length > 0 ? (
                      /* Files with Analysis */
                      <div className="p-3 space-y-4">
                        {selectedStage.attachments.map((file, i) => (
                          <motion.div
                            key={file.id}
                            {...fadeIn(i, reducedMotion, 0.03)}
                            className="rounded-[12px] bg-[color-mix(in_oklch,var(--background)_60%,transparent)] shadow-[inset_0_1px_0_oklch(1_0_0_/_0.5)] overflow-hidden"
                          >
                            {/* File Header */}
                            <div className="px-3 py-2 bg-[color-mix(in_oklch,var(--success)_6%,transparent)] border-b border-[color-mix(in_oklch,var(--muted-foreground)_12%,transparent)]">
                              <div className="flex items-center gap-2">
                                <span className="wb-status-pill" style={{ '--tone': 'var(--success)' } as CSSProperties}>
                                  文件{i + 1}
                                </span>
                                <span className="text-[0.8rem] font-medium truncate flex-1">{file.fileName}</span>
                                {(() => {
                                  /* 查看（2026-11-20 用户要求）：归档走 archive-file（TXT 目录物理文件），
                                     终止走 attachment-file（uploads/{objectKey} 附件本体，payload 已带 id） */
                                  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api';
                                  const url = data.kind === 'terminated'
                                    ? `${base}/project-management/${data.projectId}/attachment-file/${file.id}`
                                    : data.archiveDir
                                      ? `${base}/project-management/archive-file/${procurementRoundId}/${selectedStage.stageKey}/${i}${selectedStage.round != null ? `?round=${selectedStage.round}` : ''}`
                                      : null;
                                  if (!url) return null;
                                  return (
                                    <button
                                      onClick={() => setPreviewFile({ url, fileName: file.fileName, mimeType: file.mimeType })}
                                      className="neu-btn-xs"
                                      title="查看文件"
                                    >
                                      <Eye size={14} className="text-[var(--success)]" />
                                    </button>
                                  );
                                })()}
                              </div>
                              <div className="text-xs text-[color:var(--muted-foreground)] mt-1">
                                {formatFileSize(file.fileSize)}
                              </div>
                            </div>
                            {file.analysis ? (
                              <div className="px-3 py-2.5">
                                <div className="text-xs font-semibold uppercase tracking-wide text-[color-mix(in_oklch,var(--success)_70%,black)] mb-1.5">
                                  文件分析
                                </div>
                                <p className="text-xs leading-relaxed text-[color:var(--foreground)] whitespace-pre-wrap">
                                  {file.analysis}
                                </p>
                              </div>
                            ) : data.kind !== 'terminated' ? (
                              /* 暂无分析内容占位仅归档路径（TXT 逐文件分析缺省）；
                                 终止路径无逐文件分析链——改为下方阶段级「步骤分析」块（2026-11-19） */
                              <div className="px-3 py-2.5 text-xs text-[color:var(--muted-foreground)]">
                                暂无分析内容
                              </div>
                            ) : null}
                          </motion.div>
                        ))}
                      </div>
                      ) : (
                        <div className={`flex flex-col items-center justify-center px-4 ${selectedStage.stageAnalysis ? 'py-8' : 'py-16'}`}>
                          <FileText size={32} className="text-[color-mix(in_oklch,var(--muted-foreground)_50%,transparent)]" />
                          <div className="mt-3 text-[0.85rem] text-[color:var(--muted-foreground)]">该步骤暂无文件</div>
                        </div>
                      )}

                      {/* 终止详情专属·阶段级步骤分析：仅缓存直出（2026-11-20 用户裁定「台账不做
                          分析」）——与文件数无关：无附件但有分析缓存的阶段（如供应商邀请/专家选取）
                          同样直出；未生成不显示任何占位；分析生成归项目管理详情链路 */}
                      {data.kind === 'terminated' && selectedStage.stageAnalysis ? (
                        <div className="px-3 pb-3 pt-0">
                          <div className="rounded-[12px] bg-[color-mix(in_oklch,var(--background)_60%,transparent)] shadow-[inset_0_1px_0_oklch(1_0_0_/_0.5)] px-3 py-2.5">
                            <div className="text-xs font-semibold uppercase tracking-wide text-[color-mix(in_oklch,var(--accent)_70%,black)] mb-1.5">
                              步骤分析
                            </div>
                            <p className="text-xs leading-relaxed text-[color:var(--foreground)] whitespace-pre-wrap">
                              {selectedStage.stageAnalysis}
                            </p>
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 px-4">
                      <FileText size={32} className="text-[color-mix(in_oklch,var(--muted-foreground)_50%,transparent)]" />
                      <div className="mt-3 text-[0.85rem] text-[color:var(--muted-foreground)]">请选择项目步骤</div>
                    </div>
                  )}
                </div>
              </div>
          </div>
        ) : null}
      </Modal>

      {/* File Preview Modal */}
      {previewFile && (
        <FilePreviewModal
          fileUrl={previewFile.url}
          fileName={previewFile.fileName}
          mimeType={previewFile.mimeType}
          onClose={handleClosePreview}
        />
      )}
    </>
  );
}