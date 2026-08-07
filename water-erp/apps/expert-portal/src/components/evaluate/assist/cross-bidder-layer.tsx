'use client';

import { useEffect, useState } from 'react';
import { BarChart3, Download, ShieldAlert } from 'lucide-react';
import type { AssistCompareResponse } from '@water-erp/shared';
import { api } from '@/lib/api';
import { RankBadge } from './shared/rank-badge';
import { RadarChart } from './charts/radar-chart';
import type { RadarAxis } from './charts/radar-chart';
import { CATEGORY_LABEL } from './charts/score-breakdown-bars';
import { QuoteHistoryPanel } from '../quote-history-panel';
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
      <div className="py-8 text-center text-xs text-[var(--muted-foreground)]">加载排名数据…</div>
    );
  }

  if (error) {
    return (
      <div className="py-8 text-center">
        <p className="mb-3 text-sm text-[var(--danger)]">{error}</p>
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
          className="neu-btn-xs is-info"
        >
          重试
        </button>
      </div>
    );
  }

  const bidders = data?.bidders ?? [];
  if (bidders.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-[var(--muted-foreground)]">
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
      <div className="neu-table-card overflow-hidden">
        <table className="neu-table">
          <thead>
            <tr>
              <th className="w-14 !text-left">排名</th>
              <th className="!text-left">投标单位</th>
              <th className="w-20 !text-right">总分</th>
              <th className="w-20 !text-right">资格</th>
              <th className="w-20 !text-right">风险</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((b, i) => {
              const rank = i + 1;
              const isActive = b.supplierId === activeSupplier;
              return (
                <tr key={b.supplierId} data-selected={isActive ? 'true' : undefined}>
                  <td className="!text-left">
                    <RankBadge rank={rank} />
                  </td>
                  <td className={`!text-left font-medium ${isActive ? 'text-[var(--accent-strong)]' : ''}`}>
                    {b.supplierName}
                    {isActive && (
                      <span className="exp-pill ml-1.5" style={{ '--c': 'var(--accent-strong)' } as React.CSSProperties}>
                        当前
                      </span>
                    )}
                  </td>
                  <td className="!text-right font-bold tabular-nums">
                    {Number(b.totalScore).toFixed(1)}
                  </td>
                  <td className="!text-right">
                    <span
                      className="exp-pill"
                      style={{
                        '--c':
                          b.qualificationStatus === '通过' ? 'var(--success)'
                          : b.qualificationStatus === '不通过' ? 'var(--danger)'
                          : 'var(--warning)',
                      } as React.CSSProperties}
                    >
                      {b.qualificationStatus ?? '—'}
                    </span>
                  </td>
                  <td className="!text-right">
                    <span
                      className="exp-pill"
                      style={{
                        '--c':
                          b.riskLevel === 'high' ? 'var(--danger)'
                          : b.riskLevel === 'medium' ? 'var(--warning)'
                          : 'var(--success)',
                      } as React.CSSProperties}
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
        <div className="neu-card-static space-y-4 p-4">
          {/* 上半：雷达/柱状图 + 切换 */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="flex items-center gap-2 text-sm font-bold text-[var(--foreground)]">
                <BarChart3 size={14} strokeWidth={1.5} className="text-[var(--accent-strong)]" />
                维度对比
              </h4>
              <div className="neu-tab-bar !p-1">
                <button
                  onClick={() => setChartType('radar')}
                  className={`neu-tab !px-2.5 !py-1 !text-[11px] ${chartType === 'radar' ? 'is-active' : ''}`}
                >
                  雷达图
                </button>
                <button
                  onClick={() => setChartType('bar')}
                  className={`neu-tab !px-2.5 !py-1 !text-[11px] ${chartType === 'bar' ? 'is-active' : ''}`}
                >
                  柱状图
                </button>
              </div>
            </div>
            <div className="flex min-h-[200px] items-center justify-center">
              {chartType === 'radar' ? (
                radarAxes.length >= 3 && radarBidders.length >= 2 ? (
                  <RadarChart axes={radarAxes} bidders={radarBidders} size={320} />
                ) : (
                  <p className="text-xs text-[var(--muted-foreground)]">需要至少 3 个评分维度</p>
                )
              ) : barChartData.length >= 1 ? (
                <div className="flex w-full justify-center overflow-x-auto">
                  <ScoreBarChart data={barChartData} categoryMaxes={barCategoryMaxes} />
                </div>
              ) : null}
            </div>
          </div>

          {/* 分隔线 */}
          <hr className="wb-section-rule" />

          {/* 下半：投标报价对比 */}
          <div>
            <h4 className="mb-3 text-sm font-bold text-[var(--foreground)]">投标报价对比</h4>
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
        <div className="neu-card-static p-4">
          <div className="mb-1 flex items-center gap-2">
            <ShieldAlert size={14} className="text-[var(--warning)]" />
            <span className="text-sm font-bold">本项目围标风险</span>
            <span
              className="exp-pill"
              style={{
                '--c':
                  data.projectFraudSummary.riskLevel === 'high' ? 'var(--danger)'
                  : data.projectFraudSummary.riskLevel === 'medium' ? 'var(--warning)'
                  : 'var(--success)',
              } as React.CSSProperties}
            >
              {data.projectFraudSummary.riskLevel === 'high'
                ? '高'
                : data.projectFraudSummary.riskLevel === 'medium'
                  ? '中'
                  : '低'}
            </span>
            <span className="text-[11px] text-[var(--muted-foreground)]">
              · {data.projectFraudSummary.indicatorCount} 项指标
            </span>
          </div>
          <p className="text-[11px] text-[var(--muted-foreground)]">
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
            className="neu-btn-soft"
          >
            <Download size={13} /> 导出 AI 分析报告（DOCX）
          </a>
        </div>
      )}

      {/* 免责 */}
      <p className="text-center text-[10px] text-[var(--muted-foreground)]">
        以上排名与数据由 AI 分析引擎生成，最终评审结果以专家人工评分为准。
      </p>

      {/* 多轮报价历史（谈判/竞价采购项目） */}
      <QuoteHistoryPanel projectId={projectId} defaultCollapsed />
    </div>
  );
}
