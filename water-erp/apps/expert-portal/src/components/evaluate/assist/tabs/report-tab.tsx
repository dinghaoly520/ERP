'use client';

import { useState, useEffect } from 'react';
import { FileText, Download, Medal, Trophy, Award } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { AssistKpiCard } from '../charts/assist-kpi-card';
import { PriceComparisonChart } from '../charts/price-comparison-chart';
import type { AssistData } from '@water-erp/shared';

interface CompareBidder {
  supplierId: string;
  supplierName: string;
  totalScore: number;
  qualificationStatus: string;
  riskLevel: string;
}

interface ReportTabProps {
  reportDocxUrl?: string | null;
  assistData: AssistData;
  activeSupplier: string;
  projectId: string;
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1)
    return <Trophy size={16} className="text-amber-500" />;
  if (rank === 2)
    return <Medal size={16} className="text-slate-400" />;
  if (rank === 3)
    return <Award size={16} className="text-amber-700" />;
  return (
    <span className="w-6 h-6 rounded-full bg-[oklch(0.94_0.004_264)] flex items-center justify-center text-xs font-bold text-[var(--color-text-tertiary)]">
      {rank}
    </span>
  );
}

export function ReportTab({
  reportDocxUrl,
  assistData,
  activeSupplier,
  projectId,
}: ReportTabProps) {
  const [compareData, setCompareData] = useState<CompareBidder[] | null>(null);
  const [compareLoading, setCompareLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setCompareLoading(true);
    api
      .get<{ bidders: CompareBidder[] }>(`/expert/projects/${projectId}/assist/compare`)
      .then((data) => {
        if (!cancelled) setCompareData(data.bidders ?? []);
      })
      .catch(() => {
        if (!cancelled) setCompareData([]);
      })
      .finally(() => {
        if (!cancelled) setCompareLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const hasCompare = compareData && compareData.length > 0;

  const handleDownload = () => {
    if (reportDocxUrl) {
      window.open(reportDocxUrl, '_blank');
    } else {
      toast.info('综合报告尚未生成，请等待所有供应商分析完成');
    }
  };

  return (
    <div className="space-y-4">
      {/* 排名表 */}
      <div className="glass-card rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FileText size={16} strokeWidth={1.5} className="text-[var(--color-primary)]" />
            <h3 className="font-bold text-[var(--color-text)]">评分排名</h3>
          </div>
          <button
            onClick={handleDownload}
            disabled={!reportDocxUrl}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              reportDocxUrl
                ? 'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)]'
                : 'bg-[oklch(0.94_0.004_264)] text-[var(--color-text-tertiary)] cursor-not-allowed'
            }`}
          >
            <Download size={13} />
            {reportDocxUrl ? '导出 DOCX' : '报告待生成'}
          </button>
        </div>

        {compareLoading ? (
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
            <p className="text-sm text-[var(--color-text-tertiary)]">加载排名数据...</p>
          </div>
        ) : hasCompare ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-[var(--color-text-tertiary)] border-b border-[oklch(0.91_0.006_264)]">
                    <th className="text-left pb-2 font-medium w-10">排名</th>
                    <th className="text-left pb-2 font-medium">投标单位</th>
                    <th className="text-right pb-2 font-medium">总分</th>
                    <th className="text-right pb-2 font-medium">资格审查</th>
                    <th className="text-right pb-2 font-medium">风险等级</th>
                  </tr>
                </thead>
                <tbody>
                  {[...compareData]
                    .sort((a, b) => b.totalScore - a.totalScore)
                    .map((b, i) => {
                      const rank = i + 1;
                      const isActive = b.supplierId === activeSupplier;
                      return (
                        <tr
                          key={b.supplierId}
                          className={`border-b border-[oklch(0.94_0.004_264)] last:border-0 transition-colors ${
                            isActive ? 'bg-[var(--color-primary-light)]' : 'hover:bg-[oklch(0.982_0.003_264)]'
                          }`}
                        >
                          <td className="py-2.5">
                            <RankBadge rank={rank} />
                          </td>
                          <td className={`py-2.5 ${isActive ? 'font-bold text-[var(--color-primary)]' : 'text-[var(--color-text)]'}`}>
                            {b.supplierName}
                            {isActive && (
                              <span className="ml-1.5 text-[10px] bg-[var(--color-primary)] text-white px-1.5 py-0.5 rounded">
                                当前
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 text-right font-semibold tabular-nums text-[var(--color-text)]">
                            {Number(b.totalScore).toFixed(1)}
                          </td>
                          <td className="py-2.5 text-right">
                            <span
                              className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                b.qualificationStatus === '通过'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : b.qualificationStatus === '不通过'
                                    ? 'bg-red-100 text-red-700'
                                    : 'bg-amber-100 text-amber-700'
                              }`}
                            >
                              {b.qualificationStatus ?? '待审查'}
                            </span>
                          </td>
                          <td className="py-2.5 text-right">
                            <span
                              className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
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

            {/* 报价对比图 */}
            {compareData.length >= 2 && (
              <div className="mt-5 pt-4 border-t border-[oklch(0.91_0.006_264)]">
                <h4 className="font-bold text-sm text-[var(--color-text)] mb-3">投标报价对比</h4>
                <PriceComparisonChart
                  data={compareData.map((b) => ({
                    name: b.supplierName,
                    price: b.totalScore, // 使用总分作为条形高度；实际价格数据需从 keyInfo 提取
                  }))}
                  highlightName={
                    compareData.find((b) => b.supplierId === activeSupplier)?.supplierName
                  }
                  unit="分"
                />
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-8">
            <FileText size={40} strokeWidth={1} className="text-[oklch(0.75_0.008_264)] mx-auto mb-3" />
            <p className="text-sm text-[var(--color-text-secondary)]">
              综合报告在所有供应商评标完成后生成
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
              含排名对比、关键信息汇总、AI 分析摘要与 DOCX 导出
            </p>
          </div>
        )}
      </div>

      {/* 当前供应商详情卡 */}
      <div className="glass-card rounded-xl p-4">
        <h4 className="font-bold text-sm text-[var(--color-text)] mb-3">当前供应商概况</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <AssistKpiCard
            label="AI 总分"
            value={Number(assistData.totalScore ?? 0).toFixed(1)}
            tone="blue"
          />
          <AssistKpiCard
            label="资格审查"
            value={assistData.qualificationStatus === '通过' ? '通过' : assistData.qualificationStatus === '不通过' ? '不通过' : '待审查'}
            tone={assistData.qualificationStatus === '通过' ? 'green' : assistData.qualificationStatus === '不通过' ? 'red' : 'amber'}
          />
          <AssistKpiCard
            label="风险等级"
            value={assistData.riskLevel === 'high' ? '高' : assistData.riskLevel === 'medium' ? '中' : '低'}
            tone={assistData.riskLevel === 'high' ? 'red' : assistData.riskLevel === 'medium' ? 'amber' : 'green'}
          />
          <AssistKpiCard
            label="一致性"
            value={assistData.concordanceStatus === 'consistent' ? '一致' : assistData.concordanceStatus === 'conflict' ? '冲突' : '差异'}
            tone={assistData.concordanceStatus === 'consistent' ? 'green' : assistData.concordanceStatus === 'conflict' ? 'red' : 'amber'}
          />
        </div>
      </div>

      {/* 免责声明 */}
      <div className="text-xs text-[var(--color-text-tertiary)] text-center">
        以上排名与数据由 AI 分析引擎生成，最终评审结果以专家人工评分为准。
      </div>
    </div>
  );
}
