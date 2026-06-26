'use client';

import { BarChart3, FileText, Edit3, Sparkles, CheckCircle, XCircle, AlertTriangle, ShieldCheck, ClipboardCheck } from 'lucide-react';
import type { AssistData, BidScoreItem, AiScoreItem } from '@water-erp/shared';
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
 * 仅包含评分维度（排除资格审查和响应性评审）
 */
function buildRadarAxes(
  categoryTotals?: Record<string, { score: number; max: number }>,
): RadarAxis[] {
  if (!categoryTotals) return [];
  // 仅保留有分数的评分维度，排除 pass/fail 类型
  const scoreKeys = ['BUSINESS', 'TECHNICAL', 'PRICE'];
  return scoreKeys
    .filter((k) => categoryTotals[k] && categoryTotals[k].max > 0)
    .map((k) => ({
      key: k,
      label: CATEGORY_LABEL[k] ?? k,
      max: categoryTotals[k].max,
    }));
}

/** Pass/Fail 审查项卡片 */
function PassFailReviewCard({ item }: { item: AiScoreItem }) {
  const isPass = item.pass === true;
  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border ${
        isPass
          ? 'bg-emerald-50 border-emerald-200'
          : 'bg-red-50 border-red-200'
      }`}
    >
      <span
        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
          isPass ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
        }`}
      >
        {isPass ? <CheckCircle size={14} /> : <XCircle size={14} />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-sm text-[var(--color-text)]">
            {item.name}
          </span>
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              isPass
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-red-100 text-red-700'
            }`}
          >
            {isPass ? '通过' : '不通过'}
          </span>
        </div>
        {item.reason && (
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
            {item.reason}
          </p>
        )}
        {item.evidence && (
          <div className="mt-1.5 text-[11px] text-[var(--color-text-tertiary)]">
            <span className="font-medium">证据：</span>
            {item.evidence}
          </div>
        )}
      </div>
    </div>
  );
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
            <h3 className="font-bold text-[var(--color-text)]">评分明细</h3>
            <span className="text-xs text-[var(--color-text-tertiary)] ml-auto">
              共 {scoreItems!.length} 项
            </span>
          </div>

          {/* 资格审查 & 响应性评审：pass/fail 审查卡片 */}
          {['QUALIFICATION', 'RESPONSIVE'].map((cat) => {
            const items = scoreItems!.filter((si) => si.category === cat);
            if (items.length === 0) return null;
            const passCount = items.filter((si) => si.pass === true).length;
            const failCount = items.filter((si) => si.pass === false).length;
            const Icon = cat === 'QUALIFICATION' ? ShieldCheck : ClipboardCheck;
            return (
              <div key={cat} className="mb-5">
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className="w-1.5 h-5 rounded-full"
                    style={{ background: CATEGORY_COLOR[cat] ?? '#0b63ce' }}
                  />
                  <Icon size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
                  <span className="font-bold text-sm text-[var(--color-text)]">
                    {CATEGORY_LABEL[cat] ?? cat}
                  </span>
                  <span className="text-xs text-[var(--color-text-tertiary)] ml-auto">
                    通过 {passCount} / 不通过 {failCount} / 共 {items.length} 项
                  </span>
                </div>
                <div className="space-y-2 pl-4">
                  {items.map((item) => (
                    <PassFailReviewCard key={item.scoreItemId} item={item} />
                  ))}
                </div>
              </div>
            );
          })}

          {/* 商务/技术/价格：横向柱状图 */}
          {['BUSINESS', 'TECHNICAL', 'PRICE'].some((cat) =>
            scoreItems!.some((si) => si.category === cat),
          ) && (
            <div className={scoreItems!.some((si) => ['QUALIFICATION', 'RESPONSIVE'].includes(si.category)) ? 'mt-4 pt-4 border-t border-[oklch(0.91_0.006_264)]' : ''}>
              <ScoreBreakdownBars
                scoreItems={scoreItems!.filter((si) =>
                  ['BUSINESS', 'TECHNICAL', 'PRICE'].includes(si.category),
                )}
              />
            </div>
          )}

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
