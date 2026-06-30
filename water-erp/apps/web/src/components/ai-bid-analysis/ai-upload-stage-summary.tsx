'use client';

import { AlertTriangle, CheckCircle2, FileText, Users } from 'lucide-react';
import type { AiBidAnalysisTask, AiWorkspaceSummaryStats } from '@/lib/types/ai-bid-analysis';

interface AiUploadStageSummaryProps {
  task: AiBidAnalysisTask;
  summary: AiWorkspaceSummaryStats;
}

export default function AiUploadStageSummary({ task, summary }: AiUploadStageSummaryProps) {
  const bidders = task.bidders ?? [];

  const attentionItems: string[] = [];
  if (summary.missingTenderFile) {
    attentionItems.push('缺少招标文件，请先上传招标文件');
  }
  if (bidders.length === 0) {
    attentionItems.push('暂无投标单位，请添加投标单位');
  } else if (summary.uploadedBidderCount < summary.bidderCount) {
    const missingBidders = bidders.filter((b) => !b.fileName).map((b) => b.name);
    attentionItems.push(`${missingBidders.length} 家投标单位未上传文件：${missingBidders.slice(0, 3).join('、')}${missingBidders.length > 3 ? '等' : ''}`);
  }
  if (summary.failedBidderCount > 0) {
    const failedBidders = bidders.filter((b) => b.status === 'FAILED').map((b) => b.name);
    attentionItems.push(`${failedBidders.length} 家处理失败：${failedBidders.slice(0, 2).join('、')}`);
  }

  const isComplete = !summary.missingTenderFile && summary.bidderCount > 0 && summary.uploadedBidderCount === summary.bidderCount && summary.failedBidderCount === 0;

  return (
    <div className="space-y-3">
      {/* 状态概览 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--muted)' }}>
          <FileText className="w-4 h-4 opacity-60" />
          <div>
            <div className="text-xs opacity-60">招标文件</div>
            <div className={`text-sm font-medium ${summary.missingTenderFile ? 'text-rose-600' : 'text-emerald-600'}`}>
              {summary.missingTenderFile ? '缺失' : '已上传'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--muted)' }}>
          <Users className="w-4 h-4 opacity-60" />
          <div>
            <div className="text-xs opacity-60">投标单位</div>
            <div className="text-sm font-medium">{summary.bidderCount} 家</div>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--muted)' }}>
          <CheckCircle2 className="w-4 h-4 opacity-60" />
          <div>
            <div className="text-xs opacity-60">已上传</div>
            <div className="text-sm font-medium">{summary.uploadedBidderCount} 家</div>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--muted)' }}>
          <AlertTriangle className="w-4 h-4 opacity-60" />
          <div>
            <div className="text-xs opacity-60">处理失败</div>
            <div className={`text-sm font-medium ${summary.failedBidderCount > 0 ? 'text-rose-600' : ''}`}>
              {summary.failedBidderCount} 家
            </div>
          </div>
        </div>
      </div>

      {/* 关注项 */}
      {isComplete ? (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm text-emerald-700" style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
          <CheckCircle2 className="w-4 h-4" />
          <span>文件准备完成，可启动分析</span>
        </div>
      ) : attentionItems.length > 0 && (
        <div className="space-y-1.5 px-4 py-3 rounded-xl" style={{ background: 'rgba(251, 191, 36, 0.08)', border: '1px solid rgba(251, 191, 36, 0.2)' }}>
          <div className="flex items-center gap-2 text-sm font-medium text-amber-700">
            <AlertTriangle className="w-4 h-4" />
            关注项
          </div>
          <ul className="space-y-1 text-sm text-amber-700">
            {attentionItems.map((item, i) => (
              <li key={i} className="ml-6 list-disc">{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
