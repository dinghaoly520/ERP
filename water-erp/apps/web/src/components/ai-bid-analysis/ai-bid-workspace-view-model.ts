import {
  isAiBidTaskScoringVisibleStatus,
  isAiBidTaskStartableStatus,
} from '@/lib/ai-bid-analysis/status';
import type {
  AiBidAnalysisTask,
  AiWorkspaceStageItem,
  AiWorkspaceStageKey,
  AiWorkspaceSummaryStats,
  AiWorkspaceViewModel,
} from '@/lib/types/ai-bid-analysis';

function hasBidderKeyInfo(bidder: AiBidAnalysisTask['bidders'][number]) {
  return bidder.keyInfo !== null && Object.keys(bidder.keyInfo).length > 0;
}

function hasTenderFile(task: AiBidAnalysisTask) {
  return Boolean(task.tenderFileId || task.tenderFiles?.some((file) => file.isMain || file.fileId));
}

export function buildViewModel(task: AiBidAnalysisTask): AiWorkspaceViewModel {
  const bidders = task.bidders ?? [];
  const uploadedBidderCount = bidders.filter((b) => b.fileName).length;
  const completedBidderCount = bidders.filter((b) => b.status === 'COMPLETED').length;
  const failedBidderCount = bidders.filter((b) => b.status === 'FAILED').length;
  const biddersWithKeyInfoCount = bidders.filter(hasBidderKeyInfo).length;
  const missingTenderFile = !hasTenderFile(task);

  const canStartAnalysis =
    bidders.length > 0 &&
    bidders.every((bidder) => bidder.fileName) &&
    isAiBidTaskStartableStatus(task.status);

  const canViewScoring = isAiBidTaskScoringVisibleStatus(task.status);

  const activeStage: AiWorkspaceStageKey = canViewScoring
    ? 'report'
    : task.status === 'ANALYZING'
      ? 'analysis'
      : task.status === 'COMPLETED' && biddersWithKeyInfoCount > 0
        ? 'fraud'
        : biddersWithKeyInfoCount > 0
          ? 'key-info'
          : 'upload';

  const stages: AiWorkspaceStageItem[] = [
    {
      key: 'upload',
      label: '文件上传',
      enabled: true,
      completed: !missingTenderFile && uploadedBidderCount > 0,
      active: activeStage === 'upload',
    },
    {
      key: 'key-info',
      label: '关键信息',
      enabled: !missingTenderFile && uploadedBidderCount > 0,
      completed: biddersWithKeyInfoCount > 0,
      active: activeStage === 'key-info',
    },
    {
      key: 'analysis',
      label: '评分分析',
      enabled: canViewScoring,
      completed: canViewScoring,
      active: activeStage === 'analysis',
    },
    {
      key: 'fraud',
      label: '合规性审查',
      enabled: canViewScoring,
      completed: canViewScoring,
      active: activeStage === 'fraud',
    },
    {
      key: 'report',
      label: '分析报告',
      enabled: canViewScoring,
      completed: canViewScoring,
      active: activeStage === 'report',
    },
  ];

  const summary: AiWorkspaceSummaryStats = {
    bidderCount: bidders.length,
    uploadedBidderCount,
    completedBidderCount,
    failedBidderCount,
    biddersWithKeyInfoCount,
    missingTenderFile,
    canStartAnalysis,
    canViewScoring,
  };

  return {
    activeStage,
    stages,
    summary,
    showUploadStage: true,
    showKeyInfoStage: !missingTenderFile && uploadedBidderCount > 0,
    showAnalysisStage: canViewScoring,
    showFraudStage: canViewScoring,
    showReportStage: canViewScoring,
  };
}
