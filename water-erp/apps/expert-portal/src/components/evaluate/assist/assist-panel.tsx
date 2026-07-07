'use client';

import { useState, useEffect } from 'react';
import {
  BarChart3,
  Sparkles,
  AlertCircle,
  ShieldAlert,
} from 'lucide-react';
import type { AssistData, BidScoreItem } from '@water-erp/shared';
import { api } from '@/lib/api';
import { RadarChart } from './charts/radar-chart';
import type { RadarAxis } from './charts/radar-chart';
import { CATEGORY_LABEL } from './charts/score-breakdown-bars';
import { ScoreBarChart } from './charts/score-bar-chart';
import type { ScoreBarChartData } from './charts/score-bar-chart';
import { PriceComparisonChart } from './charts/price-comparison-chart';
import { SectionHeader } from './shared/section-header';
import { RankBadge } from './shared/rank-badge';
import { StatusBar } from './status-bar';
import { GateLayer } from './gate-layer';
import { EvidenceLayer } from './evidence-layer';
import { ScoringLayer } from './scoring-layer';

// ── 类型 ──

interface ComparedBidder {
  supplierId: string;
  supplierName: string;
  totalScore: number;
  categoryTotals: Record<string, { score: number; max: number }>;
  qualificationStatus: string;
  riskLevel: string;
}

interface AssistPanelProps {
  assistData: AssistData | null;
  assistLoading: boolean;
  activeSupplier: string;
  supplierName: string;
  decryptStatus: string;
  expertScores: Record<string, { score: number; reason: string }>;
  projectScoreItems: BidScoreItem[];
  projectId: string;
  onRetry: () => void;
}

// 仅用于雷达/柱状图的评分维度
const SCORE_CATEGORIES = ['BUSINESS', 'TECHNICAL', 'PRICE'];

// ═══════════════════════════════════════════════════════════════
// 区域组件
// ═══════════════════════════════════════════════════════════════

// ── ④ 串通检测 ──

const RISK_DIMENSIONS = [
  '报价离散度分析',
  '报价模式检测',
  '联系方式重叠',
  '文档相似度',
  '元数据一致性',
  '价格结构相似度',
];

function FraudSection({ fraudSummary, riskLevel: fallbackRisk }: { fraudSummary?: any; riskLevel?: string }) {
  const summary = fraudSummary;
  const hasData = summary != null;
  const level = summary?.riskLevel ?? fallbackRisk ?? 'low';
  const levelLabel = level === 'high' ? '高风险' : level === 'medium' ? '中风险' : '低风险';
  const levelColor =
    level === 'high' ? 'text-red-600' : level === 'medium' ? 'text-amber-600' : 'text-emerald-600';

  return (
    <div>
      {hasData ? (
        <>
          <div className="flex items-center gap-3 mb-2">
            <span className={`text-lg font-extrabold tabular-nums ${levelColor}`}>{levelLabel}</span>
            <span className="text-xs text-[var(--color-text-tertiary)]">
              {summary.indicatorCount} 项风险指标
            </span>
          </div>
          <div className="flex flex-wrap gap-1 mb-2">
            {RISK_DIMENSIONS.map((dim) => (
              <span
                key={dim}
                className="text-[10px] px-2 py-0.5 rounded-full border border-[oklch(0.91_0.006_264)] text-[var(--color-text-secondary)] bg-[oklch(0.982_0.003_264)]"
              >
                {dim}
              </span>
            ))}
          </div>
          <div className="p-2.5 rounded-lg border border-amber-200 bg-amber-50 text-[11px] text-amber-700 leading-relaxed">
            详细检测结果仅对管理端可见，此处展示风险摘要供参考。
          </div>
        </>
      ) : (
        <div className="text-center py-4">
          <ShieldAlert size={20} strokeWidth={1} className="text-[oklch(0.75_0.008_264)] mx-auto mb-1.5" />
          <p className="text-xs text-[var(--color-text-tertiary)]">暂无串通检测数据</p>
        </div>
      )}
    </div>
  );
}

// ── ⑤ 综合排名 ──

function RankingSection({
  projectId,
  activeSupplier,
}: {
  projectId: string;
  activeSupplier: string;
}) {
  const [bidders, setBidders] = useState<ComparedBidder[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<'radar' | 'bar'>('radar');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<{ bidders: ComparedBidder[] }>(`/expert/projects/${projectId}/assist/compare`)
      .then((data) => {
        if (!cancelled) {
          setBidders(data.bidders ?? []);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '加载对比数据失败');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="flex justify-center gap-1 mb-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-2 h-2 rounded-full bg-[var(--color-primary)]/50 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
        <p className="text-sm text-[var(--color-text-tertiary)]">加载排名数据…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-6 text-xs text-[var(--color-danger)]">
        {error}
        <button onClick={() => setBidders(null)} className="ml-2 underline text-[var(--color-primary)]">
          重试
        </button>
      </div>
    );
  }

  if (!bidders || bidders.length === 0) {
    return (
      <div className="text-center py-6">
        <BarChart3 size={24} strokeWidth={1} className="text-[oklch(0.75_0.008_264)] mx-auto mb-2" />
        <p className="text-sm text-[var(--color-text-secondary)]">排名数据在所有供应商分析完成后生成</p>
      </div>
    );
  }

  const sorted = [...bidders].sort((a, b) => b.totalScore - a.totalScore);

  // 雷达图数据
  const radarAxes: RadarAxis[] = (() => {
    const maxByKey: Record<string, number> = {};
    for (const b of sorted) {
      for (const [k, v] of Object.entries(b.categoryTotals ?? {})) {
        if (SCORE_CATEGORIES.includes(k)) {
          maxByKey[k] = Math.max(maxByKey[k] ?? 0, v.max);
        }
      }
    }
    return SCORE_CATEGORIES.filter((k) => maxByKey[k] != null && maxByKey[k] > 0).map((k) => ({
      key: k,
      label: CATEGORY_LABEL[k] ?? k,
      max: maxByKey[k],
    }));
  })();

  const radarBidders = sorted.slice(0, 5).map((b) => ({
    name: b.supplierName,
    scores: Object.fromEntries(radarAxes.map((a) => [a.key, b.categoryTotals?.[a.key]?.score ?? 0])),
  }));

  // 柱状图数据
  const barChartData: ScoreBarChartData[] = sorted.map((b) => ({
    name: b.supplierName,
    categoryScores: Object.fromEntries(
      SCORE_CATEGORIES.map((cat) => [cat, b.categoryTotals?.[cat]?.score ?? 0]),
    ),
    totalScore: b.totalScore,
  }));

  const barCategoryMaxes: Record<string, number> = {};
  for (const b of sorted) {
    for (const [cat, val] of Object.entries(b.categoryTotals ?? {})) {
      if (SCORE_CATEGORIES.includes(cat)) {
        barCategoryMaxes[cat] = Math.max(barCategoryMaxes[cat] ?? 0, val.max);
      }
    }
  }

  return (
    <div className="space-y-4">
      {/* 排名表 */}
      <div className="glass-card rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-[var(--color-text-tertiary)] border-b border-[oklch(0.91_0.006_264)] bg-[oklch(0.985_0.002_264)]">
              <th className="text-left py-2.5 px-4 font-medium w-12">排名</th>
              <th className="text-left py-2.5 px-0 font-medium">投标单位</th>
              <th className="text-right py-2.5 px-4 font-medium w-20">总分</th>
              <th className="text-right py-2.5 px-4 font-medium w-20">资格</th>
              <th className="text-right py-2.5 px-4 font-medium w-20">风险</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((b, i) => {
              const rank = i + 1;
              const isActive = b.supplierId === activeSupplier;
              return (
                <tr
                  key={b.supplierId}
                  className={`border-b border-[oklch(0.94_0.004_264)] last:border-0 transition-colors ${
                    isActive ? 'bg-[var(--color-primary-light)]' : 'hover:bg-[oklch(0.982_0.003_264)]'
                  }`}
                >
                  <td className="py-2.5 px-4">
                    <RankBadge rank={rank} />
                  </td>
                  <td className={`py-2.5 font-medium ${isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-text)]'}`}>
                    {b.supplierName}
                    {isActive && (
                      <span className="ml-1.5 text-[10px] bg-[var(--color-primary)] text-white px-1.5 py-0.5 rounded">当前</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-right font-bold tabular-nums text-[var(--color-text)]">
                    {Number(b.totalScore).toFixed(1)}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        b.qualificationStatus === '通过'
                          ? 'bg-emerald-100 text-emerald-700'
                          : b.qualificationStatus === '不通过'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {b.qualificationStatus ?? '—'}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        b.riskLevel === 'high'
                          ? 'bg-red-100 text-red-700'
                          : b.riskLevel === 'medium'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {b.riskLevel === 'high' ? '高' : b.riskLevel === 'medium' ? '中' : '低'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 维度对比 + 投标报价对比（合并卡片）*/}
      {sorted.length >= 2 && (
        <div className="glass-card rounded-xl p-4 space-y-4">
          {/* 上半：雷达/柱状图 + 切换 */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-bold text-sm text-[var(--color-text)] flex items-center gap-2">
                <BarChart3 size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
                维度对比
              </h4>
              <div className="flex gap-0.5 bg-[oklch(0.93_0.005_264)] rounded-lg p-0.5">
                <button
                  onClick={() => setChartType('radar')}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                    chartType === 'radar'
                      ? 'bg-white text-[var(--color-primary)] shadow-sm'
                      : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                  }`}
                >
                  雷达图
                </button>
                <button
                  onClick={() => setChartType('bar')}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                    chartType === 'bar'
                      ? 'bg-white text-[var(--color-primary)] shadow-sm'
                      : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                  }`}
                >
                  柱状图
                </button>
              </div>
            </div>
            <div className="flex items-center justify-center min-h-[200px]">
              {chartType === 'radar' ? (
                radarAxes.length >= 3 && radarBidders.length >= 2 ? (
                  <RadarChart axes={radarAxes} bidders={radarBidders} size={320} />
                ) : (
                  <p className="text-xs text-[var(--color-text-tertiary)]">需要至少 3 个评分维度</p>
                )
              ) : barChartData.length >= 1 ? (
                <div className="w-full overflow-x-auto flex justify-center">
                  <ScoreBarChart data={barChartData} categoryMaxes={barCategoryMaxes} />
                </div>
              ) : null}
            </div>
          </div>

          {/* 分隔线 */}
          <div className="border-t border-[oklch(0.91_0.006_264)]" />

          {/* 下半：投标报价对比 */}
          <div>
            <h4 className="font-bold text-sm text-[var(--color-text)] mb-3">投标报价对比</h4>
            <PriceComparisonChart
              data={sorted.map((b) => ({
                name: b.supplierName,
                price: b.totalScore,
              }))}
              highlightName={sorted.find((b) => b.supplierId === activeSupplier)?.supplierName}
              unit="分"
            />
          </div>
        </div>
      )}

      {/* 免责 */}
      <p className="text-xs text-[var(--color-text-tertiary)] text-center">
        以上排名与数据由 AI 分析引擎生成，最终评审结果以专家人工评分为准。
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════════════════

export function AssistPanel({
  assistData,
  assistLoading,
  activeSupplier,
  supplierName,
  decryptStatus,
  expertScores,
  projectScoreItems,
  projectId,
  onRetry,
}: AssistPanelProps) {
  // ── 加载态 ──
  if (assistLoading) {
    return (
      <div className="p-6">
        <div className="text-center py-16">
          <div className="mb-5">
            <Sparkles size={48} strokeWidth={1} className="text-[var(--color-primary)] animate-pulse mx-auto" />
          </div>
          <p className="font-semibold text-[var(--color-text)] text-lg">AI 正在分析投标文件…</p>
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
            <Sparkles size={48} strokeWidth={1} className="text-[oklch(0.75_0.008_264)] mx-auto" />
          </div>
          <p className="text-[var(--color-text-secondary)]">请先在上方选择一个投标单位</p>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
            AI 引擎将分析投标文件并生成辅助评估报告
          </p>
        </div>
      </div>
    );
  }

  // ── 规则降级模式 ──
  if (assistData.source !== 'ai_bidder_result') {
    return (
      <div className="p-5">
        <div className="glass-card rounded-xl p-8 text-center">
          <AlertCircle size={32} strokeWidth={1} className="text-[var(--color-warning)] mx-auto mb-3" />
          <p className="text-sm text-[var(--color-text-secondary)]">AI 深度分析尚未完成，当前使用规则引擎降级结果</p>
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
        <div className="text-xs text-[var(--color-text-tertiary)] text-center mt-4 pt-3 border-t border-[oklch(0.91_0.006_264)]">
          以上结果由 AI（大模型 + 文档识别）辅助生成，仅供参考，以专家独立评分为准。
        </div>
      </div>
    );
  }

  // ── 正常态：垂直分区滚动页 ──
  return (
    <div className="p-5 space-y-6">
      {/* 快速状态条 */}
      <StatusBar assistData={assistData} supplierName={supplierName} decryptStatus={decryptStatus} />

      {/* ① 合规门 */}
      <GateLayer assistData={assistData} />

      {/* ③ 打分层（含客观价格/主观商务技术/综合） */}
      <ScoringLayer
        assistData={assistData}
        expertScores={expertScores}
        activeSupplier={activeSupplier}
        projectScoreItems={projectScoreItems}
      />

      {/* ② 证据 */}
      <EvidenceLayer assistData={assistData} supplierName={supplierName} />

      {/* ⑤ 综合排名 */}
      <section>
        <SectionHeader number={5} title="综合排名" subtitle="· 跨供应商对比" />
        <div className="mt-3">
          <RankingSection projectId={projectId} activeSupplier={activeSupplier} />
        </div>
      </section>

      {/* 页脚声明 */}
      <div className="text-xs text-[var(--color-text-tertiary)] text-center pt-2 border-t border-[oklch(0.91_0.006_264)]">
        以上结果由 AI（大模型 + 文档识别）辅助生成，仅供参考，以专家独立评分为准。
      </div>
    </div>
  );
}
