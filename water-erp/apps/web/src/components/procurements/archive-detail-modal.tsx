"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  X,
  FileText,
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

const accentMap = {
  blue: "rgba(96,139,239,1)",
  blueLight: "rgba(96,139,239,0.12)",
  teal: "rgba(92,181,150,1)",
  tealLight: "rgba(92,181,150,0.12)",
  gold: "rgba(234,188,110,1)",
  goldLight: "rgba(234,188,110,0.14)",
  coral: "rgba(230,129,102,1)",
  coralLight: "rgba(230,129,102,0.12)",
  indigo: "rgba(119,129,219,1)",
  indigoLight: "rgba(119,129,219,0.12)",
  purple: "rgba(147,112,219,1)",
  purpleLight: "rgba(147,112,219,0.12)",
};

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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-white/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          onClick={(e) => e.stopPropagation()}
          className="relative max-w-[900px] w-full max-h-[90vh] rounded-[20px] border border-white/55 bg-white/95 shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/30 bg-gradient-to-r from-[rgba(96,139,239,0.06)] to-transparent">
            <div className="flex items-center gap-3">
              <FileText size={18} style={{ color: accentMap.blue }} />
              <span className="text-[0.9rem] font-semibold truncate">{fileName}</span>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={fileUrl}
                download={fileName}
                className="p-2 rounded-[8px] hover:bg-[rgba(96,139,239,0.1)] transition-colors"
                title="下载文件"
              >
                <Download size={16} style={{ color: accentMap.blue }} />
              </a>
              <button
                onClick={onClose}
                className="p-2 rounded-[8px] hover:bg-white hover:rotate-90 transition-all"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="h-[calc(90vh-60px)] overflow-auto bg-[rgba(240,240,240,0.5)]">
            {loading && (
              <div className="flex items-center justify-center h-full">
                <Loader2 size={32} className="animate-spin text-[rgba(96,139,239,0.6)]" />
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
                  className="max-w-full max-h-[80vh] object-contain rounded-[8px]"
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
                  className="w-full h-[70vh] rounded-[8px] border border-white/50 bg-white"
                  title={fileName}
                  onLoad={() => setLoading(false)}
                />
              </div>
            )}

            {!isPdf && !isImage && !isText && (
              <div className="flex flex-col items-center justify-center h-full py-20">
                <FileText size={64} className="text-[rgba(140,140,140,0.4)]" />
                <div className="mt-4 text-[0.9rem] text-[color:var(--muted-foreground)]">
                  该文件类型暂不支持预览
                </div>
                <a
                  href={fileUrl}
                  download={fileName}
                  className="mt-4 inline-flex items-center gap-2 rounded-[10px] bg-[rgba(96,139,239,0.9)] px-4 py-2 text-[0.85rem] font-semibold text-white"
                >
                  <Download size={14} />
                  下载文件
                </a>
              </div>
            )}

            {error && (
              <div className="flex flex-col items-center justify-center h-full py-20">
                <div className="text-[0.9rem] text-[rgba(230,129,102,1)]">{error}</div>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
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
    if (status === '已完成') return <CheckCircle2 size={14} style={{ color: accentMap.teal }} />;
    if (status === '进行中') return <Clock size={14} style={{ color: accentMap.gold }} />;
    return <Clock size={14} style={{ color: 'rgba(140,140,140,1)' }} />;
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
    <AnimatePresence>
      <motion.div
        key="archive-detail-modal"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-white/40 backdrop-blur-sm py-4"
        onClick={onClose}
      >
        <motion.div
          key="archive-detail-content"
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="relative max-w-[1100px] w-[96vw] overflow-hidden rounded-[24px] border border-white/55 bg-white/92 shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/35 bg-gradient-to-r from-[rgba(96,139,239,0.06)] to-[rgba(92,181,150,0.04)]">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-[rgba(96,139,239,0.12)]">
                <Folder color="#A3B8F2" size={0.35} items={['📄', '📋', '📑']} />
              </div>
              <div>
                <h2 className="text-[1.15rem] font-bold text-[color:var(--foreground)]">
                  {loading ? '加载中...' : data?.projectTitle || '归档详情'}
                </h2>
                {data && (
                  <div className="flex items-center gap-4 mt-1 text-xs text-[color:var(--muted-foreground)]">
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
                      <span className="text-xs text-[rgba(140,140,140,0.7)] font-mono">
                        {data.archiveHook}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2.5 rounded-[12px] hover:bg-white hover:rotate-90 transition-all"
            >
              <X size={18} />
            </button>
          </div>

          {/* Content */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={32} className="animate-spin text-[rgba(96,139,239,0.6)]" />
              <span className="ml-4 text-[0.9rem] text-[color:var(--muted-foreground)]">正在加载归档信息...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-20">
              <FileText size={48} className="text-[rgba(230,129,102,0.4)]" />
              <div className="mt-4 text-[0.9rem] text-[rgba(230,129,102,1)]">{error}</div>
              <button
                onClick={onClose}
                className="mt-6 rounded-[10px] border border-white/55 bg-white/70 px-4 py-2 text-[0.85rem]"
              >
                关闭
              </button>
            </div>
          ) : data ? (
            <div className="flex h-[calc(90vh-73px)] min-h-0 flex-col">
              {/* Top - Stage Selector */}
              <div className="border-b border-white/30 bg-[rgba(96,139,239,0.03)]">
                <div className="px-5 py-3 flex items-center gap-2 overflow-x-auto">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[rgba(96,139,239,0.7)] shrink-0">
                    项目步骤
                  </span>
                  <div className="flex items-center gap-1">
                    {data.stages.map((stage, i) => (
                      <motion.button
                        key={stage.stageKey}
                        {...fadeIn(i, reducedMotion, 0.02)}
                        onClick={() => {
                          setSelectedStageKey(stage.stageKey);
                        }}
                        className={`flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-left transition-all shrink-0 ${
                          selectedStageKey === stage.stageKey
                            ? 'bg-[rgba(96,139,239,0.12)] border border-[rgba(96,139,239,0.25)]'
                            : 'hover:bg-white/60 border border-transparent'
                        }`}
                      >
                        {getStatusIcon(stage.status)}
                        <span className="text-[0.8rem] font-medium">{stage.stageName}</span>
                        {stage.attachments.length > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-[4px] bg-[rgba(96,139,239,0.1)] text-[rgba(96,139,239,0.8)]">
                            {stage.attachments.length}
                          </span>
                        )}
                      </motion.button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Main Content Area */}
              <div className="flex min-h-0 flex-1 overflow-hidden">
                {/* Left Panel - Basic Info & Summary */}
                <div className="flex-1 overflow-y-auto p-5 space-y-5">
                  {/* 中标单位 - 单独一行 */}
                  <motion.div
                    {...fadeIn(0, reducedMotion)}
                    className="rounded-[12px] bg-gradient-to-r from-[rgba(92,181,150,0.1)] to-[rgba(92,181,150,0.04)] border border-[rgba(92,181,150,0.25)] px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[rgba(92,181,150,0.15)]">
                        <Trophy size={16} style={{ color: accentMap.teal }} />
                      </div>
                      <div className="flex-1">
                        <div className="text-xs text-[rgba(92,181,150,0.7)]">中标单位</div>
                        <div className="text-[0.9rem] font-semibold text-[rgba(92,181,150,1)]">
                          {data.extractedInfo['中标单位'] || '-'}
                        </div>
                      </div>
                    </div>
                  </motion.div>

                  {/* 预算金额、合同金额、节约资金、节资率 - 四个指标一行 */}
                  <motion.div
                    {...fadeIn(1, reducedMotion)}
                    className="grid grid-cols-2 md:grid-cols-4 gap-2"
                  >
                    <div className="rounded-[10px] bg-[rgba(96,139,239,0.06)] border border-[rgba(96,139,239,0.15)] px-3 py-2 text-center">
                      <div className="text-xs text-[rgba(96,139,239,0.7)]">预算金额</div>
                      <div className="mt-0.5 text-[0.85rem] font-bold text-[rgba(96,139,239,1)]">
                        {data.basicInfo['预算金额'] || '-'}
                      </div>
                    </div>
                    <div className="rounded-[10px] bg-[rgba(234,188,110,0.06)] border border-[rgba(234,188,110,0.15)] px-3 py-2 text-center">
                      <div className="text-xs text-[rgba(234,188,110,0.7)]">合同金额</div>
                      <div className="mt-0.5 text-[0.85rem] font-bold text-[rgba(234,188,110,1)]">
                        {data.extractedInfo['合同金额'] || '-'}
                      </div>
                    </div>
                    <div className="rounded-[10px] bg-[rgba(119,129,219,0.06)] border border-[rgba(119,129,219,0.15)] px-3 py-2 text-center">
                      <div className="text-xs text-[rgba(119,129,219,0.7)]">节约资金</div>
                      <div className="mt-0.5 text-[0.85rem] font-bold text-[rgba(119,129,219,1)]">
                        {savingsLabel}
                      </div>
                    </div>
                    <div className="rounded-[10px] bg-[rgba(147,112,219,0.06)] border border-[rgba(147,112,219,0.15)] px-3 py-2 text-center">
                      <div className="text-xs text-[rgba(147,112,219,0.7)]">节资率</div>
                      <div className="mt-0.5 text-[0.85rem] font-bold text-[rgba(147,112,219,1)]">
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
                    className="rounded-[18px] border border-white/45 bg-white/75 p-5"
                  >
                    <div className="flex items-center gap-2 mb-4">
                      <Building2 size={16} style={{ color: accentMap.blue }} />
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
                      <div className="space-y-2 pt-3 border-t border-white/40">
                        <div className="text-xs text-[color:var(--muted-foreground)]">专家信息</div>
                        {experts.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {experts.map((expert, i) => {
                              const detail = [expert.department, expert.specialty, expert.title].filter(Boolean).join(' / ');
                              return (
                                <span
                                  key={i}
                                  className="group relative rounded-full bg-[rgba(119,129,219,0.08)] px-3 py-1 text-xs font-medium text-[rgba(119,129,219,1)] cursor-default hover:bg-[rgba(119,129,219,0.15)] transition-colors"
                                >
                                  {expert.name}
                                  {detail && (
                                    <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-2.5 py-1.5 rounded-[8px] bg-[rgba(60,60,80,0.95)] text-xs text-white whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 z-10 shadow-lg pointer-events-none">
                                      {detail}
                                    </span>
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-[0.85rem] text-[rgba(230,129,102,1)]">暂缺</span>
                        )}
                      </div>

                      {/* Row 5: 投标单位 */}
                      <div className="space-y-2 pt-2 border-t border-white/40">
                        <div className="text-xs text-[color:var(--muted-foreground)]">投标单位</div>
                        {biddingUnits.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {biddingUnits.map((unit, i) => (
                              <span key={i} className="rounded-[6px] bg-[rgba(96,139,239,0.08)] px-3 py-1 text-xs text-[color:var(--foreground)]">
                                {unit}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[0.85rem] text-[color:var(--muted-foreground)]">-</span>
                        )}
                      </div>

                      {/* Row 6: 申请立项事由 */}
                      <div className="space-y-2 pt-2 border-t border-white/40">
                        <div className="text-xs text-[color:var(--muted-foreground)]">申请立项事由</div>
                        <p className="text-[0.85rem] leading-relaxed text-[color:var(--foreground)] whitespace-pre-line">{data.basicInfo['申请立项事由'] || '-'}</p>
                      </div>

                      {/* Row 7: 对供方主要要求 */}
                      <div className="space-y-2 pt-2 border-t border-white/40">
                        <div className="text-xs text-[color:var(--muted-foreground)]">对供方主要要求</div>
                        <p className="text-[0.85rem] leading-relaxed text-[color:var(--foreground)] whitespace-pre-line">{data.basicInfo['对供方主要要求'] || '-'}</p>
                      </div>
                    </div>
                  </motion.div>

                  {/* Summary Card */}
                  <motion.div
                    {...fadeIn(1, reducedMotion)}
                    className="rounded-[18px] border border-[rgba(147,112,219,0.25)] bg-[rgba(147,112,219,0.04)] p-5"
                  >
                    <div className="flex items-center gap-2 mb-4">
                      <FileText size={16} style={{ color: accentMap.purple }} />
                      <h3 className="text-base font-semibold text-[rgba(147,112,219,1)]">项目简报</h3>
                    </div>
                    <div className="rounded-[12px] bg-white/60 px-4 py-3 max-h-[200px] overflow-y-auto">
                      <p className="text-[0.85rem] leading-relaxed text-[color:var(--foreground)]">
                        {data.summary || '暂无项目简报信息。'}
                      </p>
                    </div>
                  </motion.div>
                </div>

                {/* Right Panel - File Preview */}
                <div className="w-[240px] xl:w-[320px] shrink-0 overflow-y-auto border-l border-white/30 bg-[rgba(92,181,150,0.03)]">
                  {selectedStage && selectedStage.attachments.length > 0 ? (
                    <>
                      {/* Stage Header */}
                      <div className="sticky top-0 z-10 px-4 py-3 border-b border-white/25 bg-[rgba(247,252,249,0.96)] backdrop-blur">
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
                            className="rounded-[12px] border border-white/40 bg-white/60 overflow-hidden"
                          >
                            {/* File Header */}
                            <div className="px-3 py-2 bg-[rgba(92,181,150,0.06)] border-b border-white/30">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-[4px] bg-[rgba(92,181,150,0.15)] text-[rgba(92,181,150,1)]">
                                  文件{i + 1}
                                </span>
                                <span className="text-[0.8rem] font-medium truncate flex-1">{file.fileName}</span>
                                <button
                                  onClick={() => handlePreviewFile(selectedStage.stageKey, i, file.fileName, file.mimeType)}
                                  className="p-1 rounded-[6px] hover:bg-[rgba(92,181,150,0.15)] transition-colors"
                                  title="预览文件"
                                >
                                  <Eye size={14} style={{ color: accentMap.teal }} />
                                </button>
                              </div>
                              <div className="text-xs text-[color:var(--muted-foreground)] mt-1">
                                {formatFileSize(file.fileSize)}
                              </div>
                            </div>
                            {file.analysis ? (
                              <div className="px-3 py-2.5">
                                <div className="text-xs font-semibold uppercase tracking-wide text-[rgba(92,181,150,0.7)] mb-1.5">
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
                      <FileText size={32} className="text-[rgba(140,140,140,0.4)]" />
                      <div className="mt-3 text-[0.85rem] text-[color:var(--muted-foreground)]">
                        {selectedStage ? '该步骤暂无文件' : '请选择项目步骤'}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </motion.div>
      </motion.div>

      {/* File Preview Modal */}
      <AnimatePresence>
        {previewFile && (
          <FilePreviewModal
            key="file-preview"
            fileUrl={previewFile.url}
            fileName={previewFile.fileName}
            mimeType={previewFile.mimeType}
            onClose={handleClosePreview}
          />
        )}
      </AnimatePresence>
    </AnimatePresence>
  );
}