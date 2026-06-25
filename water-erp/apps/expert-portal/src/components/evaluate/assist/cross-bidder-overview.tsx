'use client';

import { useState, useEffect } from 'react';
import { BarChart3, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';
import { RadarChart } from './charts/radar-chart';
import { PriceComparisonChart } from './charts/price-comparison-chart';
import { CATEGORY_LABEL } from './charts/score-breakdown-bars';
import type { RadarAxis } from './charts/radar-chart';

interface CompareBidder {
  supplierId: string;
  supplierName: string;
  totalScore: number;
  categoryTotals: Record<string, { score: number; max: number }>;
  qualificationStatus: string;
  riskLevel: string;
}

interface CrossBidderOverviewProps {
  projectId: string;
  activeSupplier: string;
}

export function CrossBidderOverview({
  projectId,
  activeSupplier,
}: CrossBidderOverviewProps) {
  const [expanded, setExpanded] = useState(false);
  const [bidders, setBidders] = useState<CompareBidder[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded || bidders !== null) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .get<{ bidders: CompareBidder[] }>(`/expert/projects/${projectId}/assist/compare`)
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
  }, [expanded, bidders, projectId]);

  // 基于所有供应商的 categoryTotals 构建雷达图坐标轴
  const radarAxes: RadarAxis[] = (() => {
    if (!bidders || bidders.length === 0) return [];
    const order = ['QUALIFICATION', 'RESPONSIVE', 'BUSINESS', 'TECHNICAL', 'PRICE'];
    const maxByKey: Record<string, number> = {};
    for (const b of bidders) {
      for (const [k, v] of Object.entries(b.categoryTotals ?? {})) {
        maxByKey[k] = Math.max(maxByKey[k] ?? 0, v.max);
      }
    }
    return order
      .filter((k) => maxByKey[k] != null)
      .map((k) => ({
        key: k,
        label: CATEGORY_LABEL[k] ?? k,
        max: maxByKey[k],
      }));
  })();

  // 雷达图数据（限前 5 名）
  const radarBidders = (bidders ?? [])
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 5)
    .map((b) => ({
      name: b.supplierName,
      scores: Object.fromEntries(
        radarAxes.map((axis) => [axis.key, b.categoryTotals?.[axis.key]?.score ?? 0]),
      ),
    }));

  return (
    <div className="mb-4">
      {/* 切换按钮 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm font-semibold text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] transition-colors mb-3"
      >
        <BarChart3 size={16} strokeWidth={1.5} />
        跨供应商对比概览
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {expanded && (
        <div className="glass-card rounded-xl p-5 space-y-5">
          {loading && (
            <div className="text-center py-8">
              <div className="flex justify-center gap-1.5 mb-3">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-2 h-2 rounded-full bg-[var(--color-primary)]/50 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
              <p className="text-sm text-[var(--color-text-tertiary)]">加载对比数据...</p>
            </div>
          )}

          {error && (
            <div className="text-center py-4 text-sm text-[var(--color-danger)]">
              {error}
              <button
                onClick={() => setBidders(null)}
                className="ml-2 underline text-[var(--color-primary)]"
              >
                重试
              </button>
            </div>
          )}

          {!loading && !error && bidders && bidders.length >= 2 && (
            <>
              {/* 总分排名柱状图 */}
              <div>
                <h4 className="font-bold text-sm text-[var(--color-text)] mb-3">总分排名</h4>
                <PriceComparisonChart
                  data={[...bidders]
                    .sort((a, b) => b.totalScore - a.totalScore)
                    .map((b) => ({ name: b.supplierName, price: b.totalScore }))}
                  highlightName={
                    bidders.find((b) => b.supplierId === activeSupplier)?.supplierName
                  }
                  unit="分"
                />
              </div>

              {/* 雷达图叠加 */}
              {radarAxes.length >= 3 && radarBidders.length >= 2 && (
                <div>
                  <h4 className="font-bold text-sm text-[var(--color-text)] mb-3">
                    多维能力对比
                  </h4>
                  <RadarChart axes={radarAxes} bidders={radarBidders} size={420} />
                </div>
              )}
            </>
          )}

          {!loading && !error && (!bidders || bidders.length < 2) && (
            <p className="text-sm text-[var(--color-text-tertiary)] text-center py-4">
              需要至少 2 家供应商完成 AI 分析后才能显示对比视图
            </p>
          )}
        </div>
      )}
    </div>
  );
}
