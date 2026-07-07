'use client';

import { useEffect, useState } from 'react';
import { BarChart3, Download, ShieldAlert } from 'lucide-react';
import type { AssistCompareResponse } from '@water-erp/shared';
import { api } from '@/lib/api';
import { RankBadge } from './shared/rank-badge';
import { RadarChart } from './charts/radar-chart';
import type { RadarAxis } from './charts/radar-chart';
import { CATEGORY_LABEL } from './charts/score-breakdown-bars';
import { ScoreBarChart } from './charts/score-bar-chart';
import type { ScoreBarChartData } from './charts/score-bar-chart';
import { PriceComparisonChart } from './charts/price-comparison-chart';

const SCORE_CATEGORIES = ['BUSINESS', 'TECHNICAL', 'PRICE'];

export function CrossBidderLayer({
  projectId,
  activeSupplier,
}: {
  projectId: string;
  activeSupplier: string;
}) {
  const [data, setData] = useState<AssistCompareResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<'radar' | 'bar'>('radar');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<AssistCompareResponse>(`/expert/projects/${projectId}/assist/compare`)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setLoading(false);
          setError(e?.message || '加载失败');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (loading) {
    return (
      <div className="text-center py-8 text-xs text-[oklch(0.55_0.01_264)]">加载排名数据…</div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-[var(--color-danger)] mb-3">{error}</p>
        <button
          onClick={() => {
            setError(null);
            setLoading(true);
            api
              .get<AssistCompareResponse>(`/expert/projects/${projectId}/assist/compare`)
              .then((d) => {
                setData(d);
                setLoading(false);
              })
              .catch((e) => {
                setLoading(false);
                setError(e?.message || '加载失败');
              });
          }}
          className="px-4 py-2 rounded-lg border border-[oklch(0.91_0.006_264)] text-xs font-bold text-[var(--color-primary)] hover:bg-[var(--color-primary-light)] transition"
        >
          重试
        </button>
      </div>
    );
  }

  const bidders = data?.bidders ?? [];
  if (bidders.length === 0) {
    return (
      <div className="text-center py-6 text-sm text-[oklch(0.55_0.01_264)]">
        排名数据在所有供应商分析完成后生成
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
                  <td
                    className={`py-2.5 font-medium ${
                      isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-text)]'
                    }`}
                  >
                    {b.supplierName}
                    {isActive && (
                      <span className="ml-1.5 text-[10px] bg-[var(--color-primary)] text-white px-1.5 py-0.5 rounded">
                        当前
                      </span>
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

      {/* 项目级围标风险摘要 */}
      {data?.projectFraudSummary && (
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <ShieldAlert size={14} className="text-amber-500" />
            <span className="text-sm font-bold">本项目围标风险</span>
            <span
              className={`text-xs font-bold ${
                data.projectFraudSummary.riskLevel === 'high'
                  ? 'text-red-600'
                  : data.projectFraudSummary.riskLevel === 'medium'
                    ? 'text-amber-600'
                    : 'text-emerald-600'
              }`}
            >
              {data.projectFraudSummary.riskLevel === 'high'
                ? '高'
                : data.projectFraudSummary.riskLevel === 'medium'
                  ? '中'
                  : '低'}
            </span>
            <span className="text-[11px] text-[oklch(0.55_0.01_264)]">
              · {data.projectFraudSummary.indicatorCount} 项指标
            </span>
          </div>
          <p className="text-[11px] text-[oklch(0.55_0.01_264)]">
            详情仅管理端可见，此处展示风险摘要供参考。
          </p>
        </div>
      )}

      {/* 导出 AI 分析报告 */}
      {data?.reportDocxUrl && (
        <div className="text-center">
          <a
            href={data.reportDocxUrl}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[oklch(0.91_0.006_264)] text-xs font-bold text-[oklch(0.45_0.01_264)] hover:text-[var(--color-primary)] hover:border-[var(--color-primary)] transition"
          >
            <Download size={13} /> 导出 AI 分析报告（DOCX）
          </a>
        </div>
      )}

      {/* 免责 */}
      <p className="text-[10px] text-[oklch(0.55_0.01_264)] text-center">
        以上排名与数据由 AI 分析引擎生成，最终评审结果以专家人工评分为准。
      </p>
    </div>
  );
}
