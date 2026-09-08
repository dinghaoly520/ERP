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
  FolderOpen,
  Loader2,
  Eye,
  Download,
} from "lucide-react";
import Folder from "@/components/Folder";
import { Modal } from "@/components/workbench";

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
  basicInfo: Record<string, string>;
  extractedInfo: Record<string, string>;
  stages: Array<{
    stageKey: string;
    stageName: string;
    stageDirName: string;
    status: string;
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

export function ArchiveDetailModal({ procurementRoundId, onClose }: ArchiveDetailModalProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const [data, setData] = useState<ArchiveDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStageKey, setSelectedStageKey] = useState<string | null>(null);

  // File preview state
  const [previewFile, setPreviewFile] = useState<{
    url: string;
    fileName: string;
    mimeType: string;
  } | null>(null);

  const handlePreviewFile = (stageKey: string, fileIndex: number, fileName: string, mimeType: string) => {
    const url = `${process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api'}/project-management/archive-file/${procurementRoundId}/${stageKey}/${fileIndex}`;
    setPreviewFile({ url, fileName, mimeType });
  };

  const handleClosePreview = () => {
    setPreviewFile(null);
  };

  useEffect(() => {
    const fetchArchiveDetail = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
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
          setSelectedStageKey(firstStageWithFiles.stageKey);
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

  const selectedStage = data?.stages.find((s) => s.stageKey === selectedStageKey);
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
  const completedStages = data?.stages.filter((stage) => stage.status === '已完成').length ?? 0;
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
                <span className="flex items-center gap-1.5">
                  <FolderOpen size={12} />
                  归档：{data.archivedAt}
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
                      key={stage.stageKey}
                      type="button"
                      onClick={() => {
                        setSelectedStageKey(stage.stageKey);
                      }}
                      className={`neu-tab ${selectedStageKey === stage.stageKey ? 'is-active' : ''}`}
                    >
                      {getStatusIcon(stage.status)}
                      <span>{stage.stageName}</span>
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
                      {/* Row 1: 申请人、申请部门、采购方式、采购类别、所属项目、合同编号、部门编号 */}
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
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
                          <div className="text-xs text-[color:var(--muted-foreground)]">合同编号</div>
                          <div className="text-[0.85rem] font-mono">{data.basicInfo['合同编号'] || '-'}</div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs text-[color:var(--muted-foreground)]">部门编号</div>
                          <div className="text-[0.85rem] font-mono">{data.basicInfo['部门编号'] || '-'}</div>
                        </div>
                      </div>
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
                      <p className="text-[0.85rem] leading-relaxed text-[color:var(--foreground)]">
                        {data.summary || '暂无项目简报信息。'}
                      </p>
                    </div>
                  </motion.div>
                </div>

                {/* Right Panel - File Preview */}
                <div className="w-[240px] xl:w-[320px] shrink-0 overflow-y-auto border-l border-[oklch(0.6_0.04_258_/_0.16)] bg-[color-mix(in_oklch,var(--success)_4%,transparent)]">
                  {selectedStage && selectedStage.attachments.length > 0 ? (
                    <>
                      {/* Stage Header */}
                      <div className="sticky top-0 z-10 px-4 py-3 border-b border-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)] bg-[color-mix(in_oklch,var(--background)_96%,transparent)] backdrop-blur">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(selectedStage.status)}
                          <span className="text-[0.85rem] font-semibold">{selectedStage.stageName}</span>
                        </div>
                        <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                          {selectedStage.status}
                        </div>
                      </div>

                      {/* Files with Analysis */}
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
                                <button
                                  onClick={() => handlePreviewFile(selectedStage.stageKey, i, file.fileName, file.mimeType)}
                                  className="neu-btn-xs"
                                  title="预览文件"
                                >
                                  <Eye size={14} className="text-[var(--success)]" />
                                </button>
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
                            ) : (
                              <div className="px-3 py-2.5 text-xs text-[color:var(--muted-foreground)]">
                                暂无分析内容
                              </div>
                            )}
                          </motion.div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 px-4">
                      <FileText size={32} className="text-[color-mix(in_oklch,var(--muted-foreground)_50%,transparent)]" />
                      <div className="mt-3 text-[0.85rem] text-[color:var(--muted-foreground)]">
                        {selectedStage ? '该步骤暂无文件' : '请选择项目步骤'}
                      </div>
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