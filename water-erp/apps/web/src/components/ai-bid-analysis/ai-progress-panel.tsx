'use client';

import { useEffect, useState } from 'react';
import { Loader2, CheckCircle, XCircle, Clock } from 'lucide-react';
import { aiBidAnalysisApi } from '@/lib/api/ai-bid-analysis';
import type { TaskProgress } from '@/lib/types/ai-bid-analysis';

const STATUS_LABELS: Record<string, string> = {
  PENDING: '待处理',
  OCR_PROCESSING: 'OCR识别中',
  OCR_COMPLETED: 'OCR完成',
  EXTRACTING: '信息提取中',
  EXTRACTED: '提取完成',
  SCORING: '评分中',
  SCORED: '评分完成',
  DEVIATION_ANALYZING: '偏差分析中',
  COMPLETED: '已完成',
  FAILED: '失败',
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-700',
  OCR_PROCESSING: 'bg-blue-100 text-blue-700',
  OCR_COMPLETED: 'bg-cyan-100 text-cyan-700',
  EXTRACTING: 'bg-indigo-100 text-indigo-700',
  EXTRACTED: 'bg-purple-100 text-purple-700',
  SCORING: 'bg-yellow-100 text-yellow-700',
  SCORED: 'bg-orange-100 text-orange-700',
  DEVIATION_ANALYZING: 'bg-pink-100 text-pink-700',
  COMPLETED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
};

interface AiProgressPanelProps {
  taskId: string;
  onComplete?: () => void;
}

export default function AiProgressPanel({ taskId, onComplete }: AiProgressPanelProps) {
  const [progress, setProgress] = useState<TaskProgress | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProgress = async () => {
    try {
      const data = await aiBidAnalysisApi.getProgress(taskId);
      setProgress(data);

      // 检查是否完成
      if (data.taskStatus === 'COMPLETED' || data.completedBidders === data.totalBidders) {
        onComplete?.();
      }
    } catch (err) {
      console.error('加载进度失败:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProgress();
    // 每3秒轮询一次
    const interval = setInterval(loadProgress, 3000);
    return () => clearInterval(interval);
  }, [taskId, onComplete]);

  if (loading) {
    return (
      <div className="rounded-xl p-6 text-center" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <Loader2 className="w-6 h-6 mx-auto animate-spin opacity-50" />
        <p className="mt-2 text-sm opacity-60">加载进度...</p>
      </div>
    );
  }

  if (!progress) {
    return null;
  }

  const overallProgress = progress.totalBidders > 0
    ? Math.round((progress.completedBidders / progress.totalBidders) * 100)
    : 0;

  return (
    <div className="rounded-xl p-6" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
      <h3 className="text-lg font-semibold mb-4">分析进度</h3>

      {/* 整体进度 */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm">整体进度</span>
          <span className="text-sm font-medium">{progress.completedBidders}/{progress.totalBidders} 完成 ({overallProgress}%)</span>
        </div>
        <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--muted)' }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${overallProgress}%`,
              background: overallProgress === 100 ? '#22c55e' : 'var(--accent)',
            }}
          />
        </div>
      </div>

      {/* 各投标单位进度 */}
      <div className="space-y-2">
        {progress.bidderProgress.map((bp) => (
          <div
            key={bp.id}
            className="flex items-center gap-3 p-2 rounded-lg"
            style={{ background: 'var(--muted)' }}
          >
            <div className="flex-shrink-0">
              {bp.status === 'COMPLETED' ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : bp.status === 'FAILED' ? (
                <XCircle className="w-4 h-4 text-red-500" />
              ) : bp.status === 'PENDING' ? (
                <Clock className="w-4 h-4 text-gray-400" />
              ) : (
                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{bp.name}</span>
                <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[bp.status]}`}>
                  {STATUS_LABELS[bp.status]}
                </span>
              </div>
            </div>
            <div className="text-xs opacity-60">{bp.progress}%</div>
          </div>
        ))}
      </div>

      {/* 刷新按钮 */}
      <div className="mt-4 text-center">
        <button
          onClick={loadProgress}
          className="text-sm opacity-60 hover:opacity-100 underline"
        >
          刷新进度
        </button>
      </div>
    </div>
  );
}