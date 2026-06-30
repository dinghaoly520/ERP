'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Loader2, CheckCircle, XCircle, Clock, FileSearch, Brain, BarChart3, AlertTriangle } from 'lucide-react';
import { aiBidAnalysisApi } from '@/lib/api/ai-bid-analysis';
import type { TaskProgress, AiBidderStatus } from '@/lib/types/ai-bid-analysis';
import {
  AI_BIDDER_STATUS_LABELS,
  BIDDER_PROGRESS_MAP,
} from '@/lib/types/ai-bid-analysis';

interface AiAnalysisProgressPanelProps {
  taskId: string;
  taskStatus: string;
  onChanged: () => void;
}

const STATUS_ICON: Record<AiBidderStatus, typeof Loader2> = {
  PENDING: Clock,
  OCR_PROCESSING: FileSearch,
  OCR_COMPLETED: FileSearch,
  EXTRACTING: Brain,
  EXTRACTED: Brain,
  SCORING: BarChart3,
  SCORED: BarChart3,
  DEVIATION_ANALYZING: AlertTriangle,
  COMPLETED: CheckCircle,
  FAILED: XCircle,
};

const STATUS_COLOR: Record<AiBidderStatus, string> = {
  PENDING: 'text-gray-400',
  OCR_PROCESSING: 'text-blue-500',
  OCR_COMPLETED: 'text-blue-400',
  EXTRACTING: 'text-indigo-500',
  EXTRACTED: 'text-indigo-400',
  SCORING: 'text-yellow-500',
  SCORED: 'text-yellow-400',
  DEVIATION_ANALYZING: 'text-pink-500',
  COMPLETED: 'text-green-500',
  FAILED: 'text-red-500',
};

const PIPELINE_STEPS = [
  { key: 'ocr', label: 'OCR识别', statusRange: ['OCR_PROCESSING', 'OCR_COMPLETED'] },
  { key: 'extract', label: '信息提取', statusRange: ['EXTRACTING', 'EXTRACTED'] },
  { key: 'score', label: '智能评分', statusRange: ['SCORING', 'SCORED'] },
  { key: 'deviation', label: '偏差分析', statusRange: ['DEVIATION_ANALYZING'] },
];

function getStepStatus(bidderStatus: AiBidderStatus): { stepIndex: number; stepState: 'pending' | 'active' | 'done' | 'error' } {
  if (bidderStatus === 'FAILED') return { stepIndex: -1, stepState: 'error' };
  if (bidderStatus === 'PENDING') return { stepIndex: -1, stepState: 'pending' };
  if (bidderStatus === 'COMPLETED') return { stepIndex: PIPELINE_STEPS.length - 1, stepState: 'done' };

  for (let i = 0; i < PIPELINE_STEPS.length; i++) {
    if (PIPELINE_STEPS[i].statusRange.includes(bidderStatus)) {
      return { stepIndex: i, stepState: 'active' };
    }
  }
  return { stepIndex: -1, stepState: 'pending' };
}

export default function AiAnalysisProgressPanel({ taskId, taskStatus, onChanged }: AiAnalysisProgressPanelProps) {
  const [progress, setProgress] = useState<TaskProgress | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);

  const loadProgress = useCallback(async () => {
    try {
      const data = await aiBidAnalysisApi.getProgress(taskId);
      setProgress(data);

      if (data.taskStatus === 'COMPLETED' || data.taskStatus === 'FAILED') {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        onChanged();
      }
    } catch {}
  }, [taskId, onChanged]);

  useEffect(() => {
    const activeStates = ['ANALYZING', 'TENDER_PROCESSING', 'BIDDERS_PROCESSING', 'BIDDERS_UPLOADING'];
    if (!activeStates.includes(taskStatus)) return;

    if (startTimeRef.current === 0) {
      startTimeRef.current = Date.now();
    }
    void loadProgress();
    intervalRef.current = setInterval(() => void loadProgress(), 3000);

    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [taskStatus, loadProgress]);

  if (!progress) return null;

  const completedCount = progress.completedBidders;
  const totalCount = progress.totalBidders;
  const failedBidders = progress.bidderProgress.filter(b => b.status === 'FAILED');
  const overallPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}分${sec}秒` : `${sec}秒`;
  };

  return (
    <div className="rounded-xl p-6" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
      {/* 标题和整体进度 */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
          分析进行中
        </h3>
        <div className="text-sm opacity-60">
          已用时 {formatTime(elapsed)}
        </div>
      </div>

      {/* 招标文件处理状态 */}
      {taskStatus === 'TENDER_PROCESSING' && (
        <div className="mb-4 p-4 rounded-lg flex items-center gap-3" style={{ background: 'var(--muted)' }}>
          <Loader2 className="w-5 h-5 animate-spin text-blue-500 flex-shrink-0" />
          <div>
            <div className="text-sm font-medium">正在处理招标文件</div>
            <div className="text-xs opacity-60 mt-0.5">OCR 识别 + 需求提取中，请稍候...</div>
          </div>
        </div>
      )}

      {/* 整体进度条 */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-sm mb-1">
          <span>整体进度</span>
          <span className="font-medium">{completedCount}/{totalCount} 家完成 ({overallPercent}%)</span>
        </div>
        <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--muted)' }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${overallPercent}%`,
              background: failedBidders.length > 0
                ? 'linear-gradient(to right, #3b82f6 0%, #3b82f6 60%, #ef4444 60%)'
                : 'var(--accent)',
            }}
          />
        </div>
      </div>

      {/* 各投标单位进度 */}
      <div className="space-y-3">
        {progress.bidderProgress.map((bidder) => {
          const { stepIndex, stepState } = getStepStatus(bidder.status);
          const isDone = bidder.status === 'COMPLETED';
          const isFailed = bidder.status === 'FAILED';
          const isPending = bidder.status === 'PENDING';
          const statusLabel = AI_BIDDER_STATUS_LABELS[bidder.status];
          const StatusIcon = STATUS_ICON[bidder.status];
          const color = STATUS_COLOR[bidder.status];

          return (
            <div
              key={bidder.id}
              className="p-3 rounded-lg"
              style={{ background: 'var(--muted)' }}
            >
              {/* 投标单位名称和当前状态 */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <StatusIcon className={`w-4 h-4 ${color} ${!isDone && !isFailed && !isPending ? 'animate-pulse' : ''}`} />
                  <span className="font-medium text-sm">{bidder.name}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${
                  isDone ? 'bg-green-100 text-green-700' :
                  isFailed ? 'bg-red-100 text-red-700' :
                  isPending ? 'bg-gray-100 text-gray-500' :
                  'bg-blue-100 text-blue-700'
                }`}>
                  {statusLabel}
                </span>
              </div>

              {/* 流水线步骤 */}
              <div className="flex items-center gap-1">
                {PIPELINE_STEPS.map((step, i) => {
                  const stepDone = isDone || (stepState === 'done' && i <= stepIndex) || (stepState === 'active' && i < stepIndex);
                  const stepActive = stepState === 'active' && i === stepIndex;
                  const stepPending = !stepDone && !stepActive;

                  return (
                    <div key={step.key} className="flex-1 flex items-center gap-1">
                      <div className="flex-1">
                        <div
                          className={`h-1.5 rounded-full transition-all duration-500 ${
                            stepDone ? 'bg-green-500' :
                            stepActive ? 'bg-blue-500 animate-pulse' :
                            'opacity-30'
                          }`}
                          style={!stepDone && !stepActive ? { background: 'var(--border)' } : undefined}
                        />
                        <div className={`text-[10px] mt-0.5 text-center ${
                          stepDone ? 'text-green-600' :
                          stepActive ? 'text-blue-600 font-medium' :
                          'opacity-40'
                        }`}>
                          {step.label}
                        </div>
                      </div>
                      {i < PIPELINE_STEPS.length - 1 && (
                        <div className={`w-3 h-px ${stepDone ? 'bg-green-500' : 'opacity-20'}`} />
                      )}
                    </div>
                  );
                })}
                {isFailed && (
                  <div className="flex items-center gap-1 ml-2">
                    <XCircle className="w-4 h-4 text-red-500" />
                    <span className="text-xs text-red-500">失败</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 错误提示 */}
      {failedBidders.length > 0 && (
        <div className="mt-3 p-3 rounded-lg bg-red-50 text-sm">
          <div className="font-medium text-red-700 mb-1">以下投标单位分析失败：</div>
          <div className="text-red-600">
            {failedBidders.map(b => b.name).join('、')}
          </div>
          <div className="text-xs text-red-500 mt-1">可在投标单位列表中点击重试，或重新上传文件后再次分析</div>
        </div>
      )}
    </div>
  );
}
