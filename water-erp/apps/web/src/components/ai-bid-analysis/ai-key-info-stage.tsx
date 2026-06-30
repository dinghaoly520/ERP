'use client';

import { AlertTriangle, CheckCircle2, ClipboardCheck, FileSearch } from 'lucide-react';
import type { AiBidAnalysisTask, AiBidder, AiWorkspaceViewModel } from '@/lib/types/ai-bid-analysis';
import AiKeyInfoPanel from './ai-key-info-panel';
import AiKeyInfoSectionCard from './ai-key-info-section-card';
import AiReadinessChecklist, { type AiReadinessItem } from './ai-readiness-checklist';
import AiStageKpiCard from './ai-stage-kpi-card';
import AiStagePanel from './ai-stage-panel';

interface AiKeyInfoStageProps {
  taskId: string;
  task: AiBidAnalysisTask;
  viewModel: AiWorkspaceViewModel;
}

function getKeyInfoGroupStats(bidders: AiBidder[]) {
  const biddersWithInfo = bidders.filter((b) => b.keyInfo);

  const qualificationWarnings: string[] = [];
  const performanceWarnings: string[] = [];
  const priceWarnings: string[] = [];
  const contactWarnings: string[] = [];

  biddersWithInfo.forEach((bidder) => {
    const ki = bidder.keyInfo!;
    if (ki.missingItems && ki.missingItems.length > 0) qualificationWarnings.push(`${bidder.name} 缺失 ${ki.missingItems.join('、')}`);
    if (!ki.performanceCount || ki.performanceCount === 0) performanceWarnings.push(`${bidder.name} 无业绩信息`);
    if (!ki.quotePrice) priceWarnings.push(`${bidder.name} 报价信息缺失`);
    if (!ki.contactInfo?.phone && !ki.contactInfo?.email) contactWarnings.push(`${bidder.name} 联系信息不完整`);
  });

  const stats = {
    qualification: { count: biddersWithInfo.length, warnings: qualificationWarnings },
    performance: { count: biddersWithInfo.filter((b) => b.keyInfo!.performanceCount > 0).length, warnings: performanceWarnings },
    price: { count: biddersWithInfo.filter((b) => b.keyInfo!.quotePrice).length, warnings: priceWarnings },
    contact: { count: biddersWithInfo.filter((b) => b.keyInfo!.contactInfo?.phone || b.keyInfo!.contactInfo?.email).length, warnings: contactWarnings },
  };

  const allWarnings = [...qualificationWarnings, ...performanceWarnings, ...priceWarnings, ...contactWarnings];
  const recognizedCount = stats.qualification.count + stats.performance.count + stats.price.count + stats.contact.count;
  const possibleCount = Math.max(bidders.length * 4, 1);
  const missingCount = Math.max(possibleCount - recognizedCount, 0);
  const completenessPercent = Math.round((recognizedCount / possibleCount) * 100);

  return { ...stats, allWarnings, recognizedCount, missingCount, completenessPercent };
}

export default function AiKeyInfoStage({ taskId, task, viewModel }: AiKeyInfoStageProps) {
  const bidders = task.bidders ?? [];
  const stats = getKeyInfoGroupStats(bidders);

  const checks: AiReadinessItem[] = [
    { label: '招标文件已解析', passed: Boolean(task.requirements), description: task.requirements ? '已获得招标要求结构化结果。' : '等待招标文件解析完成。', severity: 'warning' },
    { label: '资格信息已提取', passed: stats.qualification.count > 0, description: `${stats.qualification.count} 家已有资质信息。`, severity: 'warning' },
    { label: '报价信息已提取', passed: stats.price.count > 0, description: `${stats.price.count} 家已有报价信息。`, severity: 'warning' },
    { label: '关注事项已识别', passed: stats.allWarnings.length === 0, description: stats.allWarnings.length === 0 ? '暂无需要人工核对的关注项。' : `${stats.allWarnings.length} 项建议核对。`, severity: stats.allWarnings.length > 0 ? 'warning' : 'normal' },
    { label: '评分阶段可用', passed: viewModel.showAnalysisStage, description: viewModel.showAnalysisStage ? '可切换至评分分析查看结果。' : '评分结果生成后自动启用。', severity: 'normal' },
  ];

  return (
    <section className="space-y-5">
      <div className="space-y-1.5">
        <h3 className="text-lg font-semibold">关键信息</h3>
        <p className="text-sm opacity-60">查看各投标单位的资质、业绩、报价与联系信息对比表</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AiStageKpiCard label="已识别字段" value={stats.recognizedCount} hint="覆盖资格、业绩、报价、联系" tone="blue" icon={<FileSearch className="h-5 w-5" />} />
        <AiStageKpiCard label="缺失字段" value={stats.missingCount} hint={stats.missingCount === 0 ? '关键字段完整' : '建议人工核对'} tone={stats.missingCount === 0 ? 'green' : 'amber'} icon={<AlertTriangle className="h-5 w-5" />} />
        <AiStageKpiCard label="关注事项" value={stats.allWarnings.length} hint={stats.allWarnings.length === 0 ? '暂无风险提示' : '需要确认后再评分'} tone={stats.allWarnings.length === 0 ? 'green' : 'amber'} icon={<ClipboardCheck className="h-5 w-5" />} />
        <AiStageKpiCard label="信息完整度" value={`${stats.completenessPercent}%`} hint="基于当前提取结果" tone="green" icon={<CheckCircle2 className="h-5 w-5" />} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.85fr)]">
        <div className="space-y-4">
          <AiKeyInfoSectionCard
            title="资质信息"
            summary={`已识别 ${stats.qualification.count} 家投标单位资质信息`}
            warnings={stats.qualification.warnings}
            tone="blue"
            fieldCount={stats.qualification.count}
          >
            <AiKeyInfoPanel taskId={taskId} task={task} section="qualification" />
          </AiKeyInfoSectionCard>
          <AiKeyInfoSectionCard
            title="业绩信息"
            summary={`已识别 ${stats.performance.count} 家业绩信息`}
            warnings={stats.performance.warnings}
            tone="purple"
            fieldCount={stats.performance.count}
          >
            <AiKeyInfoPanel taskId={taskId} task={task} section="performance" />
          </AiKeyInfoSectionCard>
          <AiKeyInfoSectionCard
            title="报价信息"
            summary={`已识别 ${stats.price.count} 家报价信息`}
            warnings={stats.price.warnings}
            tone="green"
            fieldCount={stats.price.count}
          >
            <AiKeyInfoPanel taskId={taskId} task={task} section="price" />
          </AiKeyInfoSectionCard>
          <AiKeyInfoSectionCard
            title="联系信息"
            summary={`联系信息完整 ${stats.contact.count} 家`}
            warnings={stats.contact.warnings}
            tone="amber"
            fieldCount={stats.contact.count}
          >
            <AiKeyInfoPanel taskId={taskId} task={task} section="contact" />
          </AiKeyInfoSectionCard>
        </div>

        <AiStagePanel
          title="评分前检查"
          description="聚合关键字段完整度与人工关注事项。"
          tone={stats.allWarnings.length > 0 ? 'amber' : 'green'}
        >
          <div className="space-y-5">
            <AiReadinessChecklist items={checks} />
            <div className="rounded-2xl border border-slate-200/80 bg-white/75 p-4">
              <div className="text-sm font-semibold text-slate-900">关注事项</div>
              {stats.allWarnings.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">暂无需要人工核对的关注项。</p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm text-amber-700">
                  {stats.allWarnings.slice(0, 6).map((warning) => <li key={warning} className="rounded-xl bg-amber-50 px-3 py-2">{warning}</li>)}
                </ul>
              )}
            </div>
          </div>
        </AiStagePanel>
      </div>
    </section>
  );
}
