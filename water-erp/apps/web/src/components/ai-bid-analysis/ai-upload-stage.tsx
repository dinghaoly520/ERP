'use client';

import { AlertTriangle, FileText, Users } from 'lucide-react';
import {
  isAiBidTaskProcessingStatus,
  isAiBidTaskStartableStatus,
} from '@/lib/ai-bid-analysis/status';
import AiAnalysisProgressPanel from './ai-analysis-progress-panel';
import AiBiddersPanel from './ai-bidders-panel';
import AiReadinessChecklist, { type AiReadinessItem } from './ai-readiness-checklist';
import AiStageKpiCard from './ai-stage-kpi-card';
import AiStagePanel from './ai-stage-panel';
import AiTenderUploadPanel from './ai-tender-upload-panel';
import type { AiBidAnalysisTask, AiWorkspaceViewModel } from '@/lib/types/ai-bid-analysis';

interface AiUploadStageProps {
  taskId: string;
  task: AiBidAnalysisTask;
  viewModel: AiWorkspaceViewModel;
  onChanged: () => void;
}

export type UploadMetrics = ReturnType<typeof getUploadMetrics>;

export function getUploadMetrics(task: AiBidAnalysisTask) {
  const tenderFiles = task.tenderFiles ?? [];
  const bidders = task.bidders ?? [];
  const mainTenderFile = tenderFiles.find((file) => file.isMain) ?? null;
  const bidderFileCount = bidders.filter((bidder) => bidder.fileName).length;
  const totalFileCount = tenderFiles.length + bidderFileCount;
  const missingBidderFiles = Math.max(bidders.length - bidderFileCount, 0);
  const missingMainTenderFile = !mainTenderFile;
  const noBidders = bidders.length === 0;
  const hasMissingFiles = missingBidderFiles > 0;
  const allBidderFilesUploaded = bidders.length > 0 && !hasMissingFiles;

  // 分析是否已脱离"可启动"阶段（正在处理 / 已完成 / 失败 / 已取消）
  const isAnalysisActive = !isAiBidTaskStartableStatus(task.status);

  // 仅在可启动状态下检查前置条件是否齐备
  const canStartAnalysisFromUploadState =
    !missingMainTenderFile &&
    bidders.length > 0 &&
    bidders.every((bidder) => bidder.fileName) &&
    isAiBidTaskStartableStatus(task.status);

  const analysisReadyOrActive = canStartAnalysisFromUploadState || isAnalysisActive;

  const readinessChecks: AiReadinessItem[] = [
    {
      label: '主招标文件已上传',
      description: missingMainTenderFile
        ? '先上传主招标文件，系统才能提取要求与评分规则。'
        : `主文件为 ${mainTenderFile?.fileName ?? '已识别'}`,
      passed: !missingMainTenderFile,
      severity: 'danger',
    },
    {
      label: '投标单位已建档',
      description: noBidders ? '至少添加 1 家投标单位后，才能上传对应投标文件。' : `已建档 ${bidders.length} 家投标单位。`,
      passed: !noBidders,
      severity: 'danger',
    },
    {
      label: '投标文件已补齐',
      description: noBidders
        ? '先添加投标单位后，再补齐对应投标文件。'
        : hasMissingFiles
          ? `还有 ${missingBidderFiles} 家投标单位缺少文件。`
          : '所有投标单位都已关联文件。',
      passed: allBidderFilesUploaded,
      severity: 'warning',
    },
    {
      label: '可以启动分析',
      description: isAnalysisActive
        ? '分析已启动。'
        : canStartAnalysisFromUploadState
          ? '文件已上传，可以点击"启动分析"开始解析与评分。'
          : '当前仍有阻塞项，完成后即可启动分析。',
      passed: analysisReadyOrActive,
      severity: analysisReadyOrActive ? 'normal' : 'danger',
    },
  ];

  const readinessPercent = Math.round((readinessChecks.filter((item) => item.passed).length / readinessChecks.length) * 100);

  const pendingIssueCount =
    (missingMainTenderFile ? 1 : 0) +
    (noBidders ? 1 : 0) +
    (!allBidderFilesUploaded ? 1 : 0) +
    (!analysisReadyOrActive ? 1 : 0);

  let recommendation;
  if (isAnalysisActive) {
    recommendation = '分析进行中或已完成。';
  } else if (missingMainTenderFile || noBidders) {
    recommendation = '先补齐主招标文件和投标单位信息，再继续上传。';
  } else if (hasMissingFiles) {
    recommendation = '先补齐缺失的投标文件，确保每家投标单位都有对应文件。';
  } else if (!canStartAnalysisFromUploadState) {
    recommendation = '先完成当前阻塞项，再启动分析。';
  } else {
    recommendation = '资料已就绪，可启动分析。';
  }

  return {
    tenderFiles,
    bidders,
    mainTenderFile,
    bidderFileCount,
    totalFileCount,
    missingBidderFiles,
    pendingIssueCount,
    readinessChecks,
    readinessPercent,
    recommendation,
  };
}

export default function AiUploadStage({ taskId, task, onChanged }: AiUploadStageProps) {
  const metrics = getUploadMetrics(task);
  const isProcessing = isAiBidTaskProcessingStatus(task.status);

  return (
    <section className="space-y-5">
      <div className="space-y-1.5">
        <h3 className="text-lg font-semibold">准备工作区</h3>
        <p className="text-sm opacity-60">先完成资料准备与完整性核对，再启动后续解析与分析阶段。</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <AiStageKpiCard
          label="文件总数"
          value={metrics.totalFileCount}
          hint={`主文件 ${metrics.mainTenderFile ? '已识别' : '待上传'} · 投标文件 ${metrics.bidderFileCount} 份`}
          tone="blue"
          icon={<FileText className="h-5 w-5" />}
        />
        <AiStageKpiCard
          label="待处理项"
          value={metrics.pendingIssueCount}
          hint={`缺失文件 ${metrics.missingBidderFiles}`}
          tone={metrics.pendingIssueCount > 0 ? 'amber' : 'green'}
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <AiStageKpiCard
          label="就绪度"
          value={`${metrics.readinessPercent}%`}
          hint={metrics.recommendation}
          tone={metrics.readinessPercent === 100 ? 'green' : metrics.readinessPercent >= 60 ? 'amber' : 'red'}
          icon={<Users className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <AiTenderUploadPanel taskId={taskId} task={task} onChanged={onChanged} />
          <AiBiddersPanel taskId={taskId} task={task} onChanged={onChanged} />
        </div>

        <AiStagePanel
          title="启动前检查"
          description="根据当前上传情况，判断是否可以启动分析。"
          tone={metrics.readinessPercent === 100 ? 'green' : metrics.readinessPercent >= 60 ? 'amber' : 'blue'}
          action={<span className="text-sm font-medium text-slate-700">{metrics.readinessPercent}%</span>}
        >
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between text-sm text-slate-600">
                <span>准备度</span>
                <span>{metrics.readinessPercent}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-200">
                <div
                  className="h-2 rounded-full transition-all"
                  style={{ width: `${metrics.readinessPercent}%`, background: 'linear-gradient(to right, #0ea5e9, #3b82f6, #10b981)' }}
                />
              </div>
            </div>

            <AiReadinessChecklist items={metrics.readinessChecks} />

            <div className="rounded-2xl border border-slate-200/70 bg-white/80 p-4 text-sm leading-6 text-slate-600">
              <span className="font-medium text-slate-800">建议：</span>
              {metrics.recommendation}
            </div>
          </div>
        </AiStagePanel>
      </div>

      {isProcessing && (
        <AiAnalysisProgressPanel taskId={taskId} taskStatus={task.status} onChanged={onChanged} />
      )}
    </section>
  );
}
