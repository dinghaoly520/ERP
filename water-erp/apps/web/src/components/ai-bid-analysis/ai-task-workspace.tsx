'use client';

import { useCallback, useState } from 'react';
import { useAiBidWorkspace } from './use-ai-bid-workspace';
import { AiWorkspaceHeader } from './ai-workspace-header';
import { AiWorkspaceStageNav } from './ai-workspace-stage-nav';
import AiUploadStage from './ai-upload-stage';
import AiKeyInfoPanel from './ai-key-info-panel';
import AiKeyInfoSectionCard from './ai-key-info-section-card';
import AiAnalysisPanelV3 from './ai-analysis-panel-v3';
import AiFraudPanel from './ai-fraud-panel';
import AiReportPanel from './ai-report-panel';
import { resolveWorkspaceStage } from './ai-workspace-stage-sync';
import type { AiWorkspaceStageKey, AiBidder } from '@/lib/types/ai-bid-analysis';

interface AiTaskWorkspaceProps {
  taskId: string;
  onBack: () => void;
}

function getKeyInfoGroupStats(bidders: AiBidder[]) {
  const biddersWithInfo = bidders.filter((b) => b.keyInfo);

  const qualificationWarnings: string[] = [];
  const performanceWarnings: string[] = [];
  const priceWarnings: string[] = [];
  const contactWarnings: string[] = [];

  biddersWithInfo.forEach((bidder) => {
    const ki = bidder.keyInfo!;
    if (ki.missingItems && ki.missingItems.length > 0) {
      qualificationWarnings.push(`${bidder.name} 缺失 ${ki.missingItems.join('、')}`);
    }
    if (!ki.performanceCount || ki.performanceCount === 0) {
      performanceWarnings.push(`${bidder.name} 无业绩信息`);
    }
    if (!ki.quotePrice) {
      priceWarnings.push(`${bidder.name} 报价信息缺失`);
    }
    if (!ki.contactInfo?.phone && !ki.contactInfo?.email) {
      contactWarnings.push(`${bidder.name} 联系信息不完整`);
    }
  });

  return {
    qualification: {
      count: biddersWithInfo.length,
      warnings: qualificationWarnings,
    },
    performance: {
      count: biddersWithInfo.filter((b) => b.keyInfo!.performanceCount > 0).length,
      warnings: performanceWarnings,
    },
    price: {
      count: biddersWithInfo.filter((b) => b.keyInfo!.quotePrice).length,
      warnings: priceWarnings,
    },
    contact: {
      count: biddersWithInfo.filter((b) => b.keyInfo!.contactInfo?.phone || b.keyInfo!.contactInfo?.email).length,
      warnings: contactWarnings,
    },
  };
}

export default function AiTaskWorkspace({ taskId, onBack }: AiTaskWorkspaceProps) {
  const { task, error, loading, reload, viewModel } = useAiBidWorkspace(taskId);
  const [selectedTab, setSelectedTab] = useState<AiWorkspaceStageKey>('upload');

  const handleTabChange = useCallback(
    (stage: AiWorkspaceStageKey) => {
      setSelectedTab(stage);
    },
    [],
  );

  if (loading) {
    return <div className="py-12 text-center opacity-50">加载中...</div>;
  }

  if (!task || !viewModel) {
    return (
      <div className="py-12 text-center text-sm text-rose-600">
        {error ?? '加载任务详情失败'}
        <button onClick={reload} className="mt-4 px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}>
          重试
        </button>
      </div>
    );
  }

  const keyInfoStats = getKeyInfoGroupStats(task.bidders ?? []);
  const resolvedActiveTab = resolveWorkspaceStage(selectedTab, viewModel.activeStage, viewModel.stages);

  return (
    <div className="space-y-6">
      {/* 顶部总览区 */}
      <AiWorkspaceHeader task={task} summary={viewModel.summary} onBack={onBack} onRefresh={reload} />

      {/* 阶段导航区 */}
      <AiWorkspaceStageNav stages={viewModel.stages} activeTab={resolvedActiveTab} onTabChange={handleTabChange} />

      {/* Tab 内容区 */}
      <div className="rounded-2xl border border-[var(--border)] bg-white p-3">
        {/* 文件上传阶段 */}
        {resolvedActiveTab === 'upload' && viewModel.showUploadStage && <AiUploadStage taskId={taskId} task={task} viewModel={viewModel} onChanged={reload} />}

        {/* 关键信息阶段 */}
        {resolvedActiveTab === 'key-info' && viewModel.showKeyInfoStage && (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold">关键信息</h3>
              <p className="text-sm opacity-60">查看各投标单位的资质、业绩、报价与联系信息对比表</p>
            </div>
            <AiKeyInfoSectionCard
              title="资质信息"
              summary={
                <p>
                  已识别 <strong>{keyInfoStats.qualification.count}</strong> 家投标单位资质信息
                  {keyInfoStats.qualification.warnings.length > 0 && (
                    <span className="text-amber-600">存在 {keyInfoStats.qualification.warnings.length} 项关注点。</span>
                  )}
                </p>
              }
              warnings={keyInfoStats.qualification.warnings}
            >
              <AiKeyInfoPanel taskId={taskId} task={task} section="qualification" />
            </AiKeyInfoSectionCard>
            <AiKeyInfoSectionCard
              title="业绩信息"
              summary={
                <p>
                  已识别 <strong>{keyInfoStats.performance.count}</strong> 家业绩信息
                  {keyInfoStats.performance.warnings.length > 0 && (
                    <span className="text-amber-600">{keyInfoStats.performance.warnings.length} 家无业绩。</span>
                  )}
                </p>
              }
              warnings={keyInfoStats.performance.warnings}
            >
              <AiKeyInfoPanel taskId={taskId} task={task} section="performance" />
            </AiKeyInfoSectionCard>
            <AiKeyInfoSectionCard
              title="报价信息"
              summary={
                <p>
                  已识别 <strong>{keyInfoStats.price.count}</strong> 家报价信息
                  {keyInfoStats.price.warnings.length > 0 && (
                    <span className="text-amber-600">{keyInfoStats.price.warnings.length} 家报价缺失。</span>
                  )}
                </p>
              }
              warnings={keyInfoStats.price.warnings}
            >
              <AiKeyInfoPanel taskId={taskId} task={task} section="price" />
            </AiKeyInfoSectionCard>
            <AiKeyInfoSectionCard
              title="联系信息"
              summary={
                <p>
                  联系信息完整 <strong>{keyInfoStats.contact.count}</strong> 家
                  {keyInfoStats.contact.warnings.length > 0 && (
                    <span className="text-amber-600">{keyInfoStats.contact.warnings.length} 家不完整。</span>
                  )}
                </p>
              }
              warnings={keyInfoStats.contact.warnings}
            >
              <AiKeyInfoPanel taskId={taskId} task={task} section="contact" />
            </AiKeyInfoSectionCard>
          </div>
        )}

        {/* 评分分析阶段 */}
        {resolvedActiveTab === 'analysis' && viewModel.showAnalysisStage && (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold">评分分析</h3>
              <p className="text-sm opacity-60">查看各投标单位评分结果与维度分析。</p>
            </div>
            <AiAnalysisPanelV3 task={task} />
          </div>
        )}

        {/* 合规性审查阶段 */}
        {resolvedActiveTab === 'fraud' && viewModel.showFraudStage && (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold">合规性审查</h3>
              <p className="text-sm opacity-60">查看串通投标风险检测与异常指标。</p>
            </div>
            <AiFraudPanel taskId={taskId} task={task} onRefresh={reload} />
          </div>
        )}

        {/* 分析报告阶段 */}
        {resolvedActiveTab === 'report' && viewModel.showReportStage && (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold">分析报告</h3>
              <p className="text-sm opacity-60">查看完整分析报告并导出文档。</p>
            </div>
            <AiReportPanel taskId={taskId} task={task} />
          </div>
        )}

        {/* 未启用的 Tab 提示 */}
        {!viewModel.stages.find((s) => s.key === resolvedActiveTab)?.enabled && (
          <div className="py-12 text-center opacity-50">
            <p className="text-sm">该阶段尚未启用</p>
          </div>
        )}
      </div>
    </div>
  );
}