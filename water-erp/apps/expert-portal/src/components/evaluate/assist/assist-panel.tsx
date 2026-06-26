'use client';

import { useState } from 'react';
import { Sparkles, AlertCircle } from 'lucide-react';
import type { AssistData, BidScoreItem } from '@water-erp/shared';
import { ConcordanceTab } from './tabs/concordance-tab';
import { KeyInfoTab } from './tabs/key-info-tab';
import { ScoringTab } from './tabs/scoring-tab';
import { FraudTab } from './tabs/fraud-tab';
import { ReportTab } from './tabs/report-tab';

// ── Tab 定义 ──

type AssistTabKey =
  | 'concordance'
  | 'keyInfo'
  | 'scoring'
  | 'fraud'
  | 'report';

interface AssistTab {
  key: AssistTabKey;
  label: string;
}

const TABS: AssistTab[] = [
  { key: 'concordance', label: '数据一致性' },
  { key: 'keyInfo', label: '关键信息' },
  { key: 'scoring', label: '评分分析' },
  { key: 'fraud', label: '串通检测' },
  { key: 'report', label: '综合报告' },
];

// ── Props ──

interface AssistPanelProps {
  assistData: AssistData | null;
  assistLoading: boolean;
  activeSupplier: string;
  supplierName: string;
  expertScores: Record<string, { score: number; reason: string }>;
  projectScoreItems: BidScoreItem[];
  projectId: string;
  onRetry: () => void;
}

// ── 子组件：摘要头卡 ──

function SummaryHeader({ assistData }: { assistData: AssistData }) {
  const isAiResult = assistData.source === 'ai_bidder_result';

  return (
    <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-[#054280] to-[#064ea2] p-5 text-white">
      {/* 装饰性背景 */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white" />
        <div className="absolute -bottom-6 -left-4 w-24 h-24 rounded-full bg-white" />
      </div>

      <div className="relative z-[1]">
        {/* 第一行：总分 + 状态徽章 */}
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-extrabold tabular-nums">
              {Number(assistData.totalScore ?? 0).toFixed(1)}
            </span>
            <span className="text-white/60 text-sm">总分</span>
          </div>

          {/* 资格状态 */}
          <span
            className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
              assistData.qualificationStatus === '通过'
                ? 'bg-emerald-400/30 text-emerald-100'
                : assistData.qualificationStatus === '不通过'
                  ? 'bg-red-400/30 text-red-100'
                  : 'bg-amber-400/30 text-amber-100'
            }`}
          >
            资格：{assistData.qualificationStatus ?? '待审查'}
          </span>

          {/* 风险等级 */}
          <span
            className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
              assistData.riskLevel === 'low'
                ? 'bg-emerald-400/30 text-emerald-100'
                : assistData.riskLevel === 'medium'
                  ? 'bg-amber-400/30 text-amber-100'
                  : 'bg-red-400/30 text-red-100'
            }`}
          >
            风险：{assistData.riskLevel === 'low' ? '低' : assistData.riskLevel === 'medium' ? '中' : '高'}
          </span>

          {/* AI 来源标识 */}
          <span className="text-[10px] bg-white/20 text-white/80 px-2 py-0.5 rounded-full font-medium">
            {isAiResult ? 'LLM+OCR 深度分析' : '规则降级模式'}
          </span>
        </div>

        {/* 第二行：辅助信息 */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-white/60">
          {assistData.concordanceStatus && (
            <span
              className={`font-semibold ${
                assistData.concordanceStatus === 'consistent'
                  ? 'text-emerald-300'
                  : assistData.concordanceStatus === 'conflict'
                    ? 'text-red-300'
                    : 'text-amber-300'
              }`}
            >
              一致性：
              {assistData.concordanceStatus === 'consistent'
                ? '✓ 一致'
                : assistData.concordanceStatus === 'conflict'
                  ? '⚠ 冲突'
                  : assistData.concordanceStatus === 'minor_diff'
                    ? '⚠ 轻微差异'
                    : '数据不足'}
            </span>
          )}
          {assistData.model && <span>模型：{assistData.model}</span>}
          {assistData.generatedAt && (
            <span>
              生成时间：{new Date(assistData.generatedAt).toLocaleString('zh-CN')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 子组件：Tab 导航 ──

function TabNav({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: readonly AssistTab[];
  activeTab: AssistTabKey;
  onTabChange: (key: AssistTabKey) => void;
}) {
  return (
    <div className="flex gap-1 border-b border-[oklch(0.91_0.006_264)] overflow-x-auto">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onTabChange(tab.key)}
          className={`shrink-0 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
            activeTab === tab.key
              ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
              : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ── 主组件 ──

export function AssistPanel({
  assistData,
  assistLoading,
  activeSupplier,
  supplierName,
  expertScores,
  projectScoreItems,
  projectId,
  onRetry,
}: AssistPanelProps) {
  const [activeTab, setActiveTab] = useState<AssistTabKey>('scoring');

  // ── 加载态 ──
  if (assistLoading) {
    return (
      <div className="p-6">
        <div className="text-center py-16">
          <div className="mb-5">
            <Sparkles
              size={48}
              strokeWidth={1}
              className="text-[var(--color-primary)] animate-pulse mx-auto"
            />
          </div>
          <p className="font-semibold text-[var(--color-text)] text-lg">
            AI 正在分析投标文件…
          </p>
          <p className="text-sm text-[var(--color-text-secondary)] mt-2">
            正在生成 compliance 检查、风险分析与评分建议，请耐心等待
          </p>
          <div className="mt-5 flex justify-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-2.5 h-2.5 rounded-full bg-[var(--color-primary)]/50 animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── 空态（未选择供应商）──
  if (!assistData) {
    return (
      <div className="p-6">
        <div className="text-center py-16">
          <div className="mb-4">
            <Sparkles
              size={48}
              strokeWidth={1}
              className="text-[oklch(0.75_0.008_264)] mx-auto"
            />
          </div>
          <p className="text-[var(--color-text-secondary)]">请先在左侧选择一个投标单位</p>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
            AI 引擎将分析投标文件并生成辅助评估报告
          </p>
        </div>
      </div>
    );
  }

  // ── 正常态 ──
  return (
    <div className="p-6">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-[var(--color-text)] flex items-center gap-2">
            <Sparkles size={18} strokeWidth={1.5} className="text-[var(--color-primary)]" />
            AI 辅助评标
          </h2>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            {assistData.source === 'ai_bidder_result'
              ? 'LLM+OCR 深度分析投标文件，双源一致性校验，per-item 评分'
              : '规则+统计引擎（降级模式），结果仅供参考'}
          </p>
        </div>
        <span className="text-xs bg-[var(--color-primary-light)] text-[var(--color-primary)] px-3 py-1.5 rounded-lg font-semibold">
          当前：{supplierName}
        </span>
      </div>

      {/* 摘要头卡 */}
      <div className="mb-4">
        <SummaryHeader assistData={assistData} />
      </div>

      {/* Tab 导航 */}
      <TabNav tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Tab 内容 */}
      <div className="mt-4">
        {assistData.source === 'ai_bidder_result' ? (
          <>
            {activeTab === 'concordance' && (
              <ConcordanceTab
                concordance={assistData.concordance}
                concordanceStatus={assistData.concordanceStatus}
              />
            )}
            {activeTab === 'keyInfo' && (
              <KeyInfoTab
                keyInfo={assistData.keyInfo}
                supplierName={supplierName}
              />
            )}
            {activeTab === 'scoring' && (
              <ScoringTab
                scoreItems={assistData.scoreItems}
                categoryTotals={assistData.categoryTotals}
                overallComment={assistData.overallComment}
                expertScores={expertScores}
                activeSupplier={activeSupplier}
                projectScoreItems={projectScoreItems}
                projectId={projectId}
                strengths={Array.isArray(assistData.strengths) ? assistData.strengths : null}
                weaknesses={Array.isArray(assistData.weaknesses) ? assistData.weaknesses : null}
                keyObservations={
                  Array.isArray((assistData as any).keyObservations)
                    ? (assistData as any).keyObservations
                    : undefined
                }
              />
            )}
            {activeTab === 'fraud' && (
              <FraudTab
                fraudSummary={(assistData as any).fraudSummary ?? null}
                riskLevel={assistData.riskLevel}
              />
            )}
            {activeTab === 'report' && (
              <ReportTab
                reportDocxUrl={(assistData as any).reportDocxUrl ?? null}
                assistData={assistData}
                activeSupplier={activeSupplier}
                projectId={projectId}
              />
            )}
          </>
        ) : (
          /* ── 规则降级模式 ── */
          <div className="glass-card rounded-xl p-8 text-center">
            <AlertCircle
              size={32}
              strokeWidth={1}
              className="text-[var(--color-warning)] mx-auto mb-3"
            />
            <p className="text-sm text-[var(--color-text-secondary)]">
              AI 深度分析尚未完成，当前使用规则引擎降级结果
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
              请等待 AI 分析完成或联系管理员触发分析任务
            </p>
            <button
              onClick={onRetry}
              className="mt-3 text-xs text-[var(--color-primary)] hover:underline font-semibold"
            >
              重新加载
            </button>
          </div>
        )}
      </div>

      {/* 定位声明 */}
      <div className="text-xs text-[var(--color-text-tertiary)] text-center mt-4 pt-3 border-t border-[oklch(0.91_0.006_264)]">
        以上结果由 AI（LLM + OCR）辅助生成，仅供参考，以专家独立评分为准。
      </div>
    </div>
  );
}
