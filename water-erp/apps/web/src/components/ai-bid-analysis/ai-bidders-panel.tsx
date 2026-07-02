'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Upload, FileText, Loader2, Users, Play, RotateCcw, Pencil } from 'lucide-react';
import { aiBidAnalysisApi } from '@/lib/api/ai-bid-analysis';
import {
  isAiBidTaskStartableStatus,
  isAiBidderProcessingStatus,
  isAiBidderReadyStatus,
} from '@/lib/ai-bid-analysis/status';
import type { AiBidAnalysisTask, AiBidder, HealthStatus } from '@/lib/types/ai-bid-analysis';
import { AI_BIDDER_STATUS_LABELS } from '@/lib/types/ai-bid-analysis';
import AiStagePanel from './ai-stage-panel';
import AiStatusBadge, { type AiStatusBadgeTone } from './ai-status-badge';

interface AiBiddersPanelProps {
  taskId: string;
  task: AiBidAnalysisTask;
  onChanged: () => void;
}

function isNameExtracting(bidder: AiBidder): boolean {
  if (!bidder.fileName) return false;
  if (bidder.status !== 'PENDING') return false;
  const filenameName = bidder.fileName.replace(/\.[^.]+$/, '');
  return bidder.name === filenameName;
}

function getBidderBadge(bidder: AiBidder, taskStatus: AiBidAnalysisTask['status']): { tone: AiStatusBadgeTone; label: string; pulse?: boolean } {
  if (!bidder.fileName) return { tone: 'warning', label: '缺少文件' };
  if (isAiBidTaskStartableStatus(taskStatus) && isNameExtracting(bidder)) {
    return { tone: 'processing', label: '单位名称解析…', pulse: true };
  }
  if (isAiBidTaskStartableStatus(taskStatus)) return { tone: 'info', label: '已上传' };
  if (bidder.status === 'FAILED') return { tone: 'danger', label: AI_BIDDER_STATUS_LABELS[bidder.status] };
  if (isAiBidderProcessingStatus(bidder.status)) return { tone: 'processing', label: AI_BIDDER_STATUS_LABELS[bidder.status], pulse: true };
  if (isAiBidderReadyStatus(bidder.status)) return { tone: 'ready', label: AI_BIDDER_STATUS_LABELS[bidder.status] };
  return { tone: 'info', label: AI_BIDDER_STATUS_LABELS[bidder.status] };
}

function getBidderRowClasses(tone: AiStatusBadgeTone) {
  if (tone === 'danger') return 'border-rose-200 bg-rose-50/80';
  if (tone === 'warning') return 'border-amber-200 bg-amber-50/80';
  if (tone === 'ready') return 'border-emerald-200 bg-emerald-50/70';
  if (tone === 'processing') return 'border-sky-200 bg-sky-50/70';
  return 'border-slate-200/80 bg-white/80';
}

export default function AiBiddersPanel({ taskId, task, onChanged }: AiBiddersPanelProps) {
  const [editingBidderId, setEditingBidderId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [savingBidderId, setSavingBidderId] = useState<string | null>(null);
  const [uploadingBidderId, setUploadingBidderId] = useState<string | null>(null);
  const [retryingBidderId, setRetryingBidderId] = useState<string | null>(null);
  const [startingAnalysis, setStartingAnalysis] = useState(false);
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const importInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    aiBidAnalysisApi.checkHealth()
      .then(setHealthStatus)
      .catch((err) => {
        console.error('Failed to check health:', err);
        setHealthStatus(null);
      });
  }, []);

  useEffect(() => {
    if (editingBidderId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingBidderId]);

  // Poll after import while name extraction runs in background (~2-3s)
  const pollRef = useRef(onChanged);
  pollRef.current = onChanged;

  useEffect(() => {
    if (pollCount <= 0) return;
    const timer = setInterval(() => {
      pollRef.current();
      setPollCount((c) => c - 1);
    }, 1500);
    return () => clearInterval(timer);
  }, [pollCount]);

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await aiBidAnalysisApi.importBidder(taskId, file);
      if (result.success) {
        setPollCount(6); // 6 × 1.5s = 9s, enough for ~2s AI call
        onChanged();
      }
    } catch (err) {
      alert('导入失败: ' + (err instanceof Error ? err.message : String(err)));
    }
    if (importInputRef.current) importInputRef.current.value = '';
  };

  const handleStartEdit = (bidder: AiBidder) => {
    setEditingBidderId(bidder.id);
    setEditName(bidder.name);
  };

  const handleSaveEdit = async (bidderId: string) => {
    const newName = editName.trim();
    if (!newName) return;
    setSavingBidderId(bidderId);
    try {
      await aiBidAnalysisApi.updateBidderName(taskId, bidderId, newName);
      setEditingBidderId(null);
      onChanged();
    } catch (err) {
      alert('保存失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSavingBidderId(null);
    }
  };

  const handleCancelEdit = () => {
    setEditingBidderId(null);
  };

  const handleDeleteBidder = async (bidderId: string) => {
    if (!confirm('确定要删除此投标单位吗？')) return;
    try {
      await aiBidAnalysisApi.deleteBidder(taskId, bidderId);
      onChanged();
    } catch (err) {
      alert('删除失败: ' + String(err));
    }
  };

  const handleUploadBidderFile = async (bidderId: string, file: File) => {
    setUploadingBidderId(bidderId);
    try {
      await aiBidAnalysisApi.uploadBidderFile(taskId, bidderId, file);
      onChanged();
    } catch (err) {
      alert('上传失败: ' + String(err));
    } finally {
      setUploadingBidderId(null);
    }
  };

  const handleRetryBidder = async (bidderId: string) => {
    setRetryingBidderId(bidderId);
    try {
      await aiBidAnalysisApi.retryBidder(taskId, bidderId);
      onChanged();
    } catch (err) {
      alert('重试失败: ' + String(err));
    } finally {
      setRetryingBidderId(null);
    }
  };

  const handleStartAnalysis = async () => {
    if (startingAnalysis) return;

    const failedServices = [];
    if (healthStatus && !healthStatus.ready) {
      if (!healthStatus.ocr) failedServices.push('OCR 服务');
      if (!healthStatus.redis) failedServices.push('Redis 连接');
    }
    const warning = failedServices.length > 0
      ? `\n\n⚠️ 以下服务未就绪：${failedServices.join('、')}，分析可能失败。`
      : '';

    if (!confirm(`确定要启动分析吗？分析过程可能需要几分钟时间。${warning}`)) return;
    setStartingAnalysis(true);
    try {
      const result = await aiBidAnalysisApi.startAnalysis(taskId);
      alert(result.message);
      onChanged();
    } catch (err) {
      alert('启动失败: ' + String(err));
    } finally {
      setStartingAnalysis(false);
    }
  };

  const bidders = task.bidders || [];
  const taskIsStartable = isAiBidTaskStartableStatus(task.status);

  const canStartAnalysis =
    bidders.length > 0 &&
    bidders.every((bidder) => bidder.fileName) &&
    taskIsStartable;

  return (
    <AiStagePanel
      title="参评单位"
      description="选择投标响应文件上传，AI 将自动识别单位名称并提取关键信息。"
      tone="purple"
      action={
        <div className="flex items-center gap-2">
          {canStartAnalysis && (
            <button onClick={handleStartAnalysis} disabled={startingAnalysis} className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60" style={{ background: 'linear-gradient(to right, #2563eb, #7c3aed)' }}>
              {startingAnalysis ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {startingAnalysis ? '启动中...' : '启动分析'}
            </button>
          )}
          {taskIsStartable && (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-violet-100 bg-white/85 px-3 py-2 text-sm font-medium text-violet-700 shadow-sm transition-colors hover:bg-violet-50">
              <Plus className="h-4 w-4" />
              添加
              <input
                ref={importInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={handleImportFile}
              />
            </label>
          )}
        </div>
      }
    >
      {bidders.length === 0 ? (
        <div className="rounded-[18px] border-2 border-dashed border-violet-200 bg-violet-50/60 p-8 text-center">
          <div className="mx-auto mb-3 w-fit rounded-2xl bg-white p-4 text-violet-600 shadow-sm">
            <Users className="h-9 w-9" />
          </div>
          <div className="text-base font-semibold text-slate-900">暂无参评单位</div>
          <p className="mt-1 text-sm text-slate-600">上传投标文件即可自动识别单位名称，资料齐备后启动分析。</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bidders.map((bidder, index) => {
            const badge = getBidderBadge(bidder, task.status);
            const isEditing = editingBidderId === bidder.id;

            return (
              <div key={bidder.id} className={`rounded-2xl border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_35px_rgba(15,23,42,0.08)] ${getBidderRowClasses(badge.tone)}`}>
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white text-sm font-semibold text-violet-700 shadow-sm">{index + 1}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {isEditing ? (
                        <div className="flex flex-1 items-center gap-2">
                          <input
                            ref={editInputRef}
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit(bidder.id);
                              if (e.key === 'Escape') handleCancelEdit();
                            }}
                            className="min-h-9 min-w-0 flex-1 rounded-xl border border-violet-300 bg-white px-3 text-sm font-medium outline-none transition-colors focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                            disabled={savingBidderId === bidder.id}
                          />
                          <button
                            onClick={() => handleSaveEdit(bidder.id)}
                            disabled={savingBidderId === bidder.id || !editName.trim()}
                            className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
                          >
                            {savingBidderId === bidder.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '保存'}
                          </button>
                          <button onClick={handleCancelEdit} className="shrink-0 rounded-lg px-2 py-1.5 text-xs text-slate-500 transition-colors hover:bg-white/80">
                            取消
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="font-medium text-slate-900">{bidder.name}</span>
                          {taskIsStartable && (
                            <button onClick={() => handleStartEdit(bidder)} className="rounded-md p-0.5 text-slate-400 transition-colors hover:text-violet-600" title="编辑名称">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <AiStatusBadge tone={badge.tone} pulse={badge.pulse}>{badge.label}</AiStatusBadge>
                        </>
                      )}
                    </div>
                    <div className="mt-2 space-y-1 text-xs text-slate-500">
                      {bidder.fileName ? (
                        <div className="flex items-center gap-1.5">
                          <FileText className="h-3.5 w-3.5" />
                          <span className="truncate">{bidder.fileName}</span>
                        </div>
                      ) : (
                        <div>请上传该单位的投标响应文件。</div>
                      )}
                      {bidder.totalScore !== null && <div>总分：{Number(bidder.totalScore).toFixed(1)}</div>}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {!bidder.fileName && (
                      <label className="cursor-pointer rounded-xl bg-white p-2 text-violet-600 shadow-sm transition-colors hover:bg-violet-50">
                        {uploadingBidderId === bidder.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        <input type="file" accept=".pdf" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleUploadBidderFile(bidder.id, file); }} />
                      </label>
                    )}
                    {bidder.status === 'FAILED' && (
                      <button onClick={() => handleRetryBidder(bidder.id)} disabled={retryingBidderId === bidder.id} className="rounded-xl p-2 text-amber-500 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50" title="重试">
                        {retryingBidderId === bidder.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                      </button>
                    )}
                    {taskIsStartable && (
                      <button onClick={() => handleDeleteBidder(bidder.id)} className="rounded-xl p-2 text-rose-500 transition-colors hover:bg-rose-100" title="删除投标单位">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AiStagePanel>
  );
}
