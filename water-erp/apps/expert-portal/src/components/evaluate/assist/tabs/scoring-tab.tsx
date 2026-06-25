'use client';

import { BarChart3, FileText, Edit3, Sparkles } from 'lucide-react';
import type { AssistData, BidScoreItem } from '@water-erp/shared';
import { RadarChart } from '../charts/radar-chart';
import type { RadarAxis } from '../charts/radar-chart';
import { ScoreBreakdownBars, CATEGORY_LABEL, CATEGORY_COLOR } from '../charts/score-breakdown-bars';

interface ScoringTabProps {
  scoreItems?: AssistData['scoreItems'];
  categoryTotals?: AssistData['categoryTotals'];
  overallComment?: string;
  /** 专家已保存的评分，key = "supplierId:scoreItemId" */
  expertScores: Record<string, { score: number; reason: string }>;
  activeSupplier: string;
  projectScoreItems: BidScoreItem[];
}

/**
 * 从 categoryTotals 构建雷达图坐标轴。
 * 复用 RadarChart 组件，自动适配 per-item 的 5 维分类。
 */
function buildRadarAxes(
  categoryTotals?: Record<string, { score: number; max: number }>,
): RadarAxis[] {
  if (!categoryTotals) return [];
  const order = ['QUALIFICATION', 'RESPONSIVE', 'BUSINESS', 'TECHNICAL', 'PRICE'];
  return order
    .filter((k) => categoryTotals[k])
    .map((k) => ({
      key: k,
      label: CATEGORY_LABEL[k] ?? k,
      max: categoryTotals[k].max,
    }));
}

export function ScoringTab({
  scoreItems,
  categoryTotals,
  overallComment,
  expertScores,
  activeSupplier,
  projectScoreItems,
}: ScoringTabProps) {
  const axes = buildRadarAxes(categoryTotals);
  const hasScoreItems = scoreItems && scoreItems.length > 0;
  const hasCategoryTotals = categoryTotals && Object.keys(categoryTotals).length > 0;

  // AI vs 专家评分对比
  const myScoredItems = projectScoreItems.filter((si) => {
    const key = `${activeSupplier}:${si.id}`;
    return expertScores[key];
  });
  const hasComparison = activeSupplier && hasScoreItems && myScoredItems.length > 0;

  if (!hasScoreItems && !hasCategoryTotals && !overallComment) {
    return (
      <div className="glass-card rounded-xl p-8 text-center">
        <BarChart3 size={32} strokeWidth={1} className="text-[oklch(0.75_0.008_264)] mx-auto mb-3" />
        <p className="text-sm text-[var(--color-text-secondary)]">暂无评分数据</p>
        <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
          AI 评分分析完成后将在此展示 per-item 评分详情与维度雷达图
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 雷达图 */}
      {hasCategoryTotals && axes.length >= 3 && (
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={16} strokeWidth={1.5} className="text-[var(--color-primary)]" />
            <h3 className="font-bold text-[var(--color-text)]">评分维度雷达图</h3>
          </div>
          <RadarChart
            axes={axes}
            bidders={[
              {
                name: 'AI 评分',
                scores: Object.fromEntries(
                  axes.map((a) => [a.key, categoryTotals![a.key]?.score ?? 0]),
                ),
              },
            ]}
          />
        </div>
      )}

      {/* Per-item 评分明细 */}
      {hasScoreItems && (
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <FileText size={16} strokeWidth={1.5} className="text-[var(--color-primary)]" />
            <h3 className="font-bold text-[var(--color-text)]">Per-Item 评分明细</h3>
            <span className="text-xs text-[var(--color-text-tertiary)] ml-auto">
              共 {scoreItems!.length} 项
            </span>
          </div>
          <ScoreBreakdownBars scoreItems={scoreItems!} />

          {/* 置信度低的项目提醒 */}
          {scoreItems!.filter((si) => si.confidence != null && si.confidence < 0.6).length > 0 && (
            <div className="mt-4 p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-700">
              ⚠ 有 {scoreItems!.filter((si) => si.confidence != null && si.confidence < 0.6).length} 项评分置信度较低（&lt;60%），建议人工重点复核。
            </div>
          )}
        </div>
      )}

      {/* AI 分析评语 */}
      {overallComment && (
        <div className="glass-card glass-card-blue rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
            <span className="font-bold text-sm text-[var(--color-primary)]">AI 分析评语</span>
          </div>
          <p className="text-sm text-[var(--color-text)] leading-relaxed">{overallComment}</p>
        </div>
      )}

      {/* AI vs 专家评分对比 */}
      {hasComparison && (
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Edit3 size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
            <h4 className="font-bold text-sm text-[var(--color-text)]">AI 建议 vs 您的评分</h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-[var(--color-text-tertiary)] border-b border-[oklch(0.91_0.006_264)]">
                  <th className="text-left pb-2 font-medium">评分项</th>
                  <th className="text-right pb-2 font-medium">AI 建议</th>
                  <th className="text-right pb-2 font-medium">您的评分</th>
                  <th className="text-right pb-2 font-medium">偏差</th>
                </tr>
              </thead>
              <tbody>
                {myScoredItems.map((si) => {
                  const aiItem = scoreItems?.find((a) => a.scoreItemId === si.id);
                  const myScore = expertScores[`${activeSupplier}:${si.id}`];
                  const aiScore = aiItem ? Number(aiItem.score) : null;
                  const diff = aiScore != null ? Number(myScore.score) - aiScore : null;
                  return (
                    <tr key={si.id} className="border-b border-[oklch(0.94_0.004_264)] last:border-0">
                      <td className="py-2 text-[var(--color-text-secondary)]">{si.name}</td>
                      <td className="py-2 text-right text-[var(--color-primary)] font-semibold">
                        {aiScore != null ? aiScore.toFixed(1) : '—'}
                      </td>
                      <td className="py-2 text-right font-bold text-[var(--color-text)]">
                        {Number(myScore.score).toFixed(1)}
                      </td>
                      <td
                        className={`py-2 text-right text-xs font-semibold ${
                          diff != null && Math.abs(diff) >= 2
                            ? 'text-[var(--color-danger)]'
                            : diff != null && Math.abs(diff) >= 1
                              ? 'text-[var(--color-warning)]'
                              : 'text-[var(--color-success)]'
                        }`}
                      >
                        {diff != null
                          ? diff > 0
                            ? `+${diff.toFixed(1)}`
                            : diff.toFixed(1)
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-2">
            偏差 ≥2 分标红，≥1 分标黄，建议复核相应评分依据。
          </p>
        </div>
      )}
    </div>
  );
}
