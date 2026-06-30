'use client';

import { ArrowLeft, RefreshCw, AlertTriangle } from 'lucide-react';
import type { AiBidAnalysisTask, AiWorkspaceSummaryStats } from '@/lib/types/ai-bid-analysis';
import { AI_BID_TASK_STATUS_LABELS, AI_BID_TASK_STATUS_COLORS } from '@/lib/types/ai-bid-analysis';

interface AiWorkspaceHeaderProps {
  task: AiBidAnalysisTask;
  summary: AiWorkspaceSummaryStats;
  onBack: () => void;
  onRefresh: () => void;
}

export function AiWorkspaceHeader({ task, summary, onBack, onRefresh }: AiWorkspaceHeaderProps) {
  const statusLabel = AI_BID_TASK_STATUS_LABELS[task.status] || task.status;
  const statusColor = AI_BID_TASK_STATUS_COLORS[task.status] || 'bg-gray-100 text-gray-700';

  const attentionItems: string[] = [];
  if (summary.missingTenderFile) {
    attentionItems.push('缺少招标文件');
  }
  if (summary.bidderCount > 0 && summary.uploadedBidderCount < summary.bidderCount) {
    attentionItems.push(`${summary.bidderCount - summary.uploadedBidderCount} 家投标单位未上传文件`);
  }
  if (summary.failedBidderCount > 0) {
    attentionItems.push(`${summary.failedBidderCount} 家处理失败`);
  }

  return (
    <header className="space-y-4">
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-2 rounded-lg hover:opacity-70 transition-opacity"
          style={{ background: 'var(--muted)' }}
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold truncate">{task.name}</h1>
            <span className={`shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColor}`}>
              {statusLabel}
            </span>
          </div>
          {task.projectName && (
            <p className="text-sm opacity-50 mt-0.5 truncate">{task.projectName}</p>
          )}
        </div>
        <button
          onClick={onRefresh}
          className="p-2 rounded-lg hover:opacity-70 transition-opacity"
          style={{ background: 'var(--muted)' }}
          title="刷新"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* 关注项提示条 */}
      {attentionItems.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm text-amber-700" style={{ background: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251, 191, 36, 0.3)' }}>
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{attentionItems.join('，')}</span>
        </div>
      )}
    </header>
  );
}
