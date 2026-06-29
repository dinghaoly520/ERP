'use client';

import { useState, useEffect } from 'react';
import {
  BarChart3,
  FileText,
  Edit3,
  Sparkles,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  ClipboardCheck,
  TrendingUp,
  AlertCircle,
  Lightbulb,
  MessageSquare,
  Medal,
} from 'lucide-react';
import type { AssistData, BidScoreItem, AiScoreItem } from '@water-erp/shared';
import { api } from '@/lib/api';
import { RadarChart } from '../charts/radar-chart';
import type { RadarAxis } from '../charts/radar-chart';
import { ScoreBreakdownBars, CATEGORY_LABEL, CATEGORY_COLOR } from '../charts/score-breakdown-bars';
import { ScoreBarChart } from '../charts/score-bar-chart';
import type { ScoreBarChartData } from '../charts/score-bar-chart';

// ── 类型 ──

interface CompareBidder {
  supplierId: string;
  supplierName: string;
  totalScore: number;
  categoryTotals: Record<string, { score: number; max: number }>;
  qualificationStatus: string;
  riskLevel: string;
}

interface SwItem {
  dimension: string;
  title: string;
  detail: string;
  evidence?: string;
  impact?: string;
}

interface ScoringTabProps {
  scoreItems?: AssistData['scoreItems'];
  categoryTotals?: AssistData['categoryTotals'];
  overallComment?: string;
  expertScores: Record<string, { score: number; reason: string }>;
  activeSupplier: string;
  projectScoreItems: BidScoreItem[];
  projectId: string;
  strengths?: SwItem[] | null;
  weaknesses?: SwItem[] | null;
  keyObservations?: string[];
}

// 仅用于图表/排名的评分维度
const SCORE_CATEGORIES = ['BUSINESS', 'TECHNICAL', 'PRICE'];

// ── 维度徽章颜色 ──

const DIMENSION_LABEL: Record<string, string> = {
  qualification: '资质',
  technical: '技术',
  commercial: '商务',
  price: '价格',
  risk: '风险',
};

const DIMENSION_COLOR: Record<string, string> = {
  qualification: '#064ea2',
  technical: '#11a874',
  commercial: '#f5a623',
  price: '#e74c3c',
  risk: '#8b5cf6',
};

// ── 子组件：Pass/Fail 审查卡片 ──

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
          <span className="font-semibold text-sm text-[var(--color-text)]">{item.name}</span>
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
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">{item.reason}</p>
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

// ── 子组件：SW 卡片（正向依据/需关注事项）──

function SwCard({ item, type }: { item: SwItem; type: 'strength' | 'weakness' }) {
  const isStrength = type === 'strength';
  const color = DIMENSION_COLOR[item.dimension] ?? '#0b63ce';

  return (
    <div
      className={`glass-card glass-card-lighter rounded-lg p-3.5 border-l-2 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
        isStrength ? 'border-l-emerald-400' : 'border-l-amber-400'
      }`}
    >
      <div className="flex items-start gap-2 mb-1.5">
        {isStrength ? (
          <TrendingUp size={14} className="text-emerald-500 shrink-0 mt-0.5" />
        ) : (
          <AlertCircle size={14} className="text-amber-500 shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <span
            className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded mb-1"
            style={{ color, background: `${color}15` }}
          >
            {DIMENSION_LABEL[item.dimension] ?? item.dimension}
          </span>
          <div className="font-semibold text-sm text-[var(--color-text)]">{item.title}</div>
        </div>
      </div>
      <p className="text-xs text-[var(--color-text-secondary)] ml-6 leading-relaxed">{item.detail}</p>
      {(item.evidence || item.impact) && (
        <div className="mt-2 ml-6 space-y-1">
          {item.evidence && (
            <div className="text-[11px] text-[var(--color-text-tertiary)]">
              <span className="font-medium">证据：</span>
              {item.evidence}
            </div>
          )}
          {item.impact && (
            <div className={`text-[11px] font-medium ${isStrength ? 'text-emerald-600' : 'text-amber-600'}`}>
              <span>{isStrength ? '影响：' : '风险：'}</span>
              {item.impact}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 子组件：可折叠段落 ──

function CollapsibleSection({
  title,
  icon,
  accent,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  accent?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="glass-card glass-card-lighter rounded-xl overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/40 transition-colors"
      >
        {accent && (
          <span className="w-1 h-6 rounded-full shrink-0" style={{ background: accent }} />
        )}
        {icon && <span className="text-[var(--color-primary)] shrink-0">{icon}</span>}
        <span className="font-semibold text-sm text-[var(--color-text)] flex-1 truncate">{title}</span>
        <span className="text-[10px] text-[var(--color-text-tertiary)] px-2 py-0.5 rounded bg-white/50 shrink-0">
          {isOpen ? '收起' : '展开'}
        </span>
        {isOpen ? (
          <ChevronUp size={14} className="text-[var(--color-text-tertiary)] shrink-0" />
        ) : (
          <ChevronDown size={14} className="text-[var(--color-text-tertiary)] shrink-0" />
        )}
      </button>
      {isOpen && (
        <div className="px-4 pb-4 border-t border-[oklch(0.94_0.004_264)] pt-3">
          {children}
        </div>
      )}
    </div>
  );
}

// ── 主组件 ──

export function ScoringTab({
  scoreItems,
  categoryTotals,
  overallComment,
  expertScores,
  activeSupplier,
  projectScoreItems,
  projectId,
  strengths,
  weaknesses,
  keyObservations,
}: ScoringTabProps) {
  // 跨供应商对比数据
  const [compareBidders, setCompareBidders] = useState<CompareBidder[] | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  // UI 状态
  const [selectedBidderId, setSelectedBidderId] = useState<string>(activeSupplier);
  const [chartType, setChartType] = useState<'radar' | 'bar'>('radar');
  const [detailTab, setDetailTab] = useState<'score' | 'sw'>('score');

  // ── 获取跨供应商对比数据 ──
  useEffect(() => {
    let cancelled = false;
    setCompareLoading(true);
    setCompareError(null);

    api
      .get<{ bidders: CompareBidder[] }>(`/expert/projects/${projectId}/assist/compare`)
      .then((data) => {
        if (!cancelled) {
          setCompareBidders(data.bidders ?? []);
          setCompareLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setCompareError(e instanceof Error ? e.message : '加载对比数据失败');
          setCompareLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // ── 派生数据 ──

  const sortedBidders = (compareBidders ?? [])
    .slice()
    .sort((a, b) => b.totalScore - a.totalScore);

  const selectedBidder = sortedBidders.find((b) => b.supplierId === selectedBidderId);
  const selectedRank = sortedBidders.findIndex((b) => b.supplierId === selectedBidderId) + 1;

  // KPI 统计
  const bidderCount = sortedBidders.length;
  const maxScore = sortedBidders.length > 0 ? sortedBidders[0].totalScore : 0;
  const avgScore =
    sortedBidders.length > 0
      ? sortedBidders.reduce((a, b) => a + b.totalScore, 0) / sortedBidders.length
      : 0;
  const highRiskCount = sortedBidders.filter((b) => b.riskLevel === 'high').length;

  // 雷达图坐标轴（基于所有供应商的 categoryTotals，排除 pass/fail 或 max=0 的维度）
  const radarAxes: RadarAxis[] = (() => {
    if (sortedBidders.length === 0) return [];
    const maxByKey: Record<string, number> = {};
    for (const b of sortedBidders) {
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

  // 雷达图数据（前 5 名）
  const radarBidders = sortedBidders.slice(0, 5).map((b) => ({
    name: b.supplierName,
    scores: Object.fromEntries(radarAxes.map((a) => [a.key, b.categoryTotals?.[a.key]?.score ?? 0])),
  }));

  // 柱状图数据
  const barChartData: ScoreBarChartData[] = sortedBidders.map((b) => ({
    name: b.supplierName,
    categoryScores: Object.fromEntries(
      SCORE_CATEGORIES.map((cat) => [cat, b.categoryTotals?.[cat]?.score ?? 0]),
    ),
    totalScore: b.totalScore,
  }));

  const barCategoryMaxes: Record<string, number> = {};
  for (const b of sortedBidders) {
    for (const [cat, val] of Object.entries(b.categoryTotals ?? {})) {
      if (SCORE_CATEGORIES.includes(cat)) {
        barCategoryMaxes[cat] = Math.max(barCategoryMaxes[cat] ?? 0, val.max);
      }
    }
  }

  // AI vs 专家评分对比
  const myScoredItems = projectScoreItems.filter((si) => {
    const key = `${activeSupplier}:${si.id}`;
    return expertScores[key];
  });
  const hasComparison = !!(activeSupplier && scoreItems && scoreItems.length > 0 && myScoredItems.length > 0);
  const isViewingOwnSupplier = selectedBidderId === activeSupplier;

  // 当前选中供应商的单体数据
  const hasScoreItems = scoreItems && scoreItems.length > 0;
  const hasCategoryTotals = categoryTotals && Object.keys(categoryTotals).length > 0;

  // ── 空态（无评分数据）──
  if (!hasScoreItems && !hasCategoryTotals && !overallComment && sortedBidders.length === 0) {
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

  // ── 排名徽章 ──
  function rankBadge(rank: number) {
    if (rank === 1)
      return (
        <span className="w-6 h-6 rounded-full bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center text-white text-xs font-bold shadow-sm">
          <Medal size={12} />
        </span>
      );
    if (rank === 2)
      return (
        <span className="w-6 h-6 rounded-full bg-gradient-to-br from-slate-300 to-slate-400 flex items-center justify-center text-white text-xs font-bold shadow-sm">
          <Medal size={12} />
        </span>
      );
    if (rank === 3)
      return (
        <span className="w-6 h-6 rounded-full bg-gradient-to-br from-amber-600 to-amber-700 flex items-center justify-center text-white text-xs font-bold shadow-sm">
          <Medal size={12} />
        </span>
      );
    return (
      <span className="w-6 h-6 rounded-full bg-[oklch(0.92_0.008_264)] flex items-center justify-center text-[11px] font-bold text-[var(--color-text-tertiary)]">
        {rank}
      </span>
    );
  }

  // ── 渲染 ──
  return (
    <div className="space-y-4">
      {/* 主布局：左列（排名 + 图表） / 右列（详情面板） */}
      <div
        className={`grid gap-4 ${
          sortedBidders.length >= 2
            ? 'grid-cols-1 lg:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.5fr)]'
            : 'grid-cols-1'
        }`}
      >
        {/* 左列 */}
        {sortedBidders.length >= 2 && (
          <div className="flex flex-col gap-4 min-h-0">
            {/* 2a. 排名列表 */}
            <div className="glass-card rounded-xl p-4 flex-[1] min-h-0 flex flex-col">
              <h3 className="font-bold text-sm text-[var(--color-text)] mb-3 flex items-center gap-2">
                <Medal size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
                排名列表
                <span className="text-xs text-[var(--color-text-tertiary)] font-normal ml-auto">
                  共 {sortedBidders.length} 家
                </span>
              </h3>
              <div className="space-y-1.5 overflow-y-auto flex-1 pr-1">
                {compareLoading && (
                  <div className="text-center py-8">
                    <div className="flex justify-center gap-1.5">
                      {[0, 1, 2].map((i) => (
                        <div
                          key={i}
                          className="w-2 h-2 rounded-full bg-[var(--color-primary)]/50 animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {compareError && (
                  <div className="text-center py-4 text-xs text-[var(--color-danger)]">
                    {compareError}
                    <button
                      onClick={() => setCompareBidders(null)}
                      className="ml-2 underline text-[var(--color-primary)]"
                    >
                      重试
                    </button>
                  </div>
                )}
                {sortedBidders.map((b, i) => {
                  const rank = i + 1;
                  const isActive = b.supplierId === selectedBidderId;
                  return (
                    <button
                      key={b.supplierId}
                      onClick={() => setSelectedBidderId(b.supplierId)}
                      className={`w-full text-left p-3 rounded-lg border transition-all duration-200 hover:-translate-y-0.5 ${
                        isActive
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] shadow-md'
                          : 'border-[oklch(0.93_0.005_264)] bg-white/60 hover:shadow-sm'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {rankBadge(rank)}
                        <span className="font-semibold text-sm text-[var(--color-text)] truncate flex-1">
                          {b.supplierName}
                        </span>
                        <span className="text-sm font-bold text-[var(--color-primary)] tabular-nums shrink-0">
                          {b.totalScore.toFixed(1)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 ml-8">
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                            b.riskLevel === 'high'
                              ? 'bg-red-100 text-red-600'
                              : b.riskLevel === 'medium'
                                ? 'bg-amber-100 text-amber-600'
                                : 'bg-emerald-100 text-emerald-600'
                          }`}
                        >
                          {b.riskLevel === 'high' ? '高风险' : b.riskLevel === 'medium' ? '中风险' : '低风险'}
                        </span>
                        {SCORE_CATEGORIES.filter((cat) => b.categoryTotals?.[cat]).map((cat) => (
                          <span key={cat} className="text-[10px] text-[var(--color-text-tertiary)]">
                            {(CATEGORY_LABEL[cat] ?? cat).slice(0, 2)}
                            {(b.categoryTotals?.[cat]?.score ?? 0).toFixed(1)}
                          </span>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2b. 图表对比 */}
            <div className="glass-card rounded-xl p-4 flex-[1.2] min-h-0 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-bold text-sm text-[var(--color-text)] flex items-center gap-2">
                  <BarChart3 size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
                  维度对比分析
                </h4>
                {/* 图表切换 */}
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
              <div className="flex-1 overflow-hidden flex items-center justify-center">
                {chartType === 'radar' ? (
                  radarAxes.length >= 3 && radarBidders.length >= 2 ? (
                    <RadarChart axes={radarAxes} bidders={radarBidders} size={360} />
                  ) : (
                    <p className="text-xs text-[var(--color-text-tertiary)]">需要至少 3 个评分维度</p>
                  )
                ) : barChartData.length >= 1 ? (
                  <div className="w-full overflow-x-auto">
                    <ScoreBarChart data={barChartData} categoryMaxes={barCategoryMaxes} />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {/* 右列：详情面板 */}
        <div className="glass-card rounded-xl overflow-hidden flex flex-col min-h-0">
          {/* 选中供应商头部 */}
          {selectedBidder ? (
            <>
              <div className="p-4 border-b border-[oklch(0.91_0.006_264)] shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      {rankBadge(selectedRank)}
                      <h3 className="font-bold text-[var(--color-text)]">
                        {selectedBidder.supplierName}
                      </h3>
                    </div>
                    <span className="text-[10px] bg-[var(--color-primary-light)] text-[var(--color-primary)] px-2 py-0.5 rounded-full font-semibold">
                      {isViewingOwnSupplier ? '当前' : '对比'}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-xl font-extrabold text-[var(--color-primary)] tabular-nums">
                      {selectedBidder.totalScore.toFixed(1)}
                    </span>
                    <span className="text-xs text-[var(--color-text-tertiary)] ml-1">总分</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      selectedBidder.riskLevel === 'high'
                        ? 'bg-red-100 text-red-600'
                        : selectedBidder.riskLevel === 'medium'
                          ? 'bg-amber-100 text-amber-600'
                          : 'bg-emerald-100 text-emerald-600'
                    }`}
                  >
                    风险：{selectedBidder.riskLevel === 'high' ? '高' : selectedBidder.riskLevel === 'medium' ? '中' : '低'}
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      selectedBidder.qualificationStatus === '通过'
                        ? 'bg-emerald-100 text-emerald-600'
                        : 'bg-amber-100 text-amber-600'
                    }`}
                  >
                    资格：{selectedBidder.qualificationStatus ?? '未知'}
                  </span>
                </div>
              </div>

              {/* 子 Tab 切换 */}
              <div className="mx-4 mt-3 flex gap-1 bg-[oklch(0.94_0.004_264)] rounded-lg p-1 shrink-0">
                <button
                  onClick={() => setDetailTab('score')}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    detailTab === 'score'
                      ? 'bg-white text-[var(--color-primary)] shadow-sm'
                      : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                  }`}
                >
                  <FileText size={12} className="inline mr-1" />
                  评分详情
                </button>
                <button
                  onClick={() => setDetailTab('sw')}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    detailTab === 'sw'
                      ? 'bg-white text-[var(--color-primary)] shadow-sm'
                      : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                  }`}
                >
                  <Lightbulb size={12} className="inline mr-1" />
                  优势与不足
                </button>
              </div>

              {/* 子 Tab 内容（可滚动） */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {detailTab === 'score' ? (
                  <ScoreDetailSection
                    scoreItems={isViewingOwnSupplier ? scoreItems : undefined}
                    categoryTotals={isViewingOwnSupplier ? categoryTotals : selectedBidder.categoryTotals}
                    selectedBidder={selectedBidder}
                    expertScores={expertScores}
                    activeSupplier={activeSupplier}
                    projectScoreItems={projectScoreItems}
                    isViewingOwnSupplier={isViewingOwnSupplier}
                    hasComparison={hasComparison && isViewingOwnSupplier}
                    myScoredItems={myScoredItems}
                  />
                ) : (
                  <StrengthsWeaknessesSection
                    strengths={isViewingOwnSupplier ? strengths : undefined}
                    weaknesses={isViewingOwnSupplier ? weaknesses : undefined}
                    keyObservations={isViewingOwnSupplier ? keyObservations : undefined}
                    overallComment={isViewingOwnSupplier ? overallComment : undefined}
                    isViewingOwnSupplier={isViewingOwnSupplier}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8 text-center">
              <div>
                <BarChart3 size={32} strokeWidth={1} className="text-[oklch(0.75_0.008_264)] mx-auto mb-2" />
                <p className="text-sm text-[var(--color-text-secondary)]">请先选择投标单位</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 单供应商模式：仅显示详情面板 */}
      {sortedBidders.length < 2 && (
        <div className="space-y-4">
          {/* 雷达图 */}
          {hasCategoryTotals && (
            <div className="glass-card rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 size={16} strokeWidth={1.5} className="text-[var(--color-primary)]" />
                <h3 className="font-bold text-[var(--color-text)]">评分维度雷达图</h3>
              </div>
              <RadarChart
                axes={(() => {
                  if (!categoryTotals) return [];
                  return ['BUSINESS', 'TECHNICAL', 'PRICE']
                    .filter((k) => categoryTotals[k] && categoryTotals[k].max > 0)
                    .map((k) => ({ key: k, label: CATEGORY_LABEL[k] ?? k, max: categoryTotals[k].max }));
                })()}
                bidders={[
                  {
                    name: 'AI 评分',
                    scores: Object.fromEntries(
                      ['BUSINESS', 'TECHNICAL', 'PRICE'].map((k) => [
                        k,
                        categoryTotals?.[k]?.score ?? 0,
                      ]),
                    ),
                  },
                ]}
              />
            </div>
          )}

          {/* Per-item 评分明细 */}
          <ScoreDetailSection
            scoreItems={scoreItems}
            categoryTotals={categoryTotals}
            expertScores={expertScores}
            activeSupplier={activeSupplier}
            projectScoreItems={projectScoreItems}
            isViewingOwnSupplier={true}
            hasComparison={hasComparison}
            myScoredItems={myScoredItems}
          />

          {/* AI 评语 */}
          {overallComment && (
            <div className="glass-card glass-card-blue rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
                <span className="font-bold text-sm text-[var(--color-primary)]">AI 分析评语</span>
              </div>
              <p className="text-sm text-[var(--color-text)] leading-relaxed">{overallComment}</p>
            </div>
          )}

          {/* AI vs 专家对比 */}
          {hasComparison && <ExpertComparisonTable myScoredItems={myScoredItems} scoreItems={scoreItems ?? []} expertScores={expertScores} activeSupplier={activeSupplier} />}
        </div>
      )}
    </div>
  );
}

// ── 子组件：评分详情段落 ──

function ScoreDetailSection({
  scoreItems,
  categoryTotals,
  selectedBidder,
  expertScores,
  activeSupplier,
  projectScoreItems,
  isViewingOwnSupplier,
  hasComparison,
  myScoredItems,
}: {
  scoreItems?: AssistData['scoreItems'];
  categoryTotals?: AssistData['categoryTotals'] | Record<string, { score: number; max: number }>;
  selectedBidder?: CompareBidder;
  expertScores: Record<string, { score: number; reason: string }>;
  activeSupplier: string;
  projectScoreItems: BidScoreItem[];
  isViewingOwnSupplier: boolean;
  hasComparison: boolean;
  myScoredItems: BidScoreItem[];
}) {
  // 跨供应商模式：使用 selectedBidder 的 categoryTotals
  if (!isViewingOwnSupplier && selectedBidder) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <FileText size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
          <h4 className="font-bold text-sm text-[var(--color-text)]">维度得分概要</h4>
        </div>
        <p className="text-xs text-[var(--color-text-tertiary)]">
          仅显示当前供应商的维度聚合得分。切换到"当前"供应商可查看 per-item 评分明细。
        </p>
        {Object.entries(selectedBidder.categoryTotals ?? {}).map(([cat, val]) => {
          const score = val?.score ?? 0;
          const max = val?.max ?? 0;
          if (max === 0) return null;
          const pct = max > 0 ? (score / max) * 100 : 0;
          return (
            <div key={cat} className="flex items-center gap-3">
              <span
                className="w-1.5 h-5 rounded-full shrink-0"
                style={{ background: CATEGORY_COLOR[cat] ?? '#0b63ce' }}
              />
              <span className="text-sm text-[var(--color-text-secondary)] w-20 shrink-0">
                {CATEGORY_LABEL[cat] ?? cat}
              </span>
              <div className="flex-1 h-2 rounded-full bg-[oklch(0.93_0.005_264)] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${pct}%`,
                    background: CATEGORY_COLOR[cat] ?? '#0b63ce',
                  }}
                />
              </div>
              <span className="text-xs font-semibold tabular-nums text-[var(--color-text)] w-16 text-right">
                {score.toFixed(1)} / {max}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  // 自有供应商：per-item 明细
  if (!scoreItems || scoreItems.length === 0) {
    return (
      <div className="text-center py-8">
        <FileText size={24} strokeWidth={1} className="text-[oklch(0.75_0.008_264)] mx-auto mb-2" />
        <p className="text-sm text-[var(--color-text-secondary)]">暂无评分明细</p>
      </div>
    );
  }

  const allCategories = [...new Set(scoreItems.map((si) => si.category))];

  return (
    <div className="space-y-3">
      {/* 各分类可折叠段落 */}
      {allCategories.map((cat) => {
        const items = scoreItems.filter((si) => si.category === cat);
        if (items.length === 0) return null;

        const isPassFail = cat === 'QUALIFICATION' || cat === 'RESPONSIVE';
        const passCount = items.filter((si) => si.pass === true).length;
        const failCount = items.filter((si) => si.pass === false).length;
        const catColor = CATEGORY_COLOR[cat] ?? '#0b63ce';

        return (
          <CollapsibleSection
            key={cat}
            title={`${CATEGORY_LABEL[cat] ?? cat}${isPassFail ? `（通过 ${passCount} / 不通过 ${failCount}）` : ''}`}
            icon={
              cat === 'QUALIFICATION' ? <ShieldCheck size={14} strokeWidth={1.5} /> :
              cat === 'RESPONSIVE' ? <ClipboardCheck size={14} strokeWidth={1.5} /> :
              <FileText size={14} strokeWidth={1.5} />
            }
            accent={catColor}
            defaultOpen
          >
            {isPassFail ? (
              <div className="space-y-2">
                {items.map((item) => (
                  <PassFailReviewCard key={item.scoreItemId} item={item} />
                ))}
              </div>
            ) : (
              <ScoreBreakdownBars
                scoreItems={items.filter((si) => SCORE_CATEGORIES.includes(si.category))}
              />
            )}
          </CollapsibleSection>
        );
      })}

      {/* 置信度低警告 */}
      {scoreItems.filter((si) => si.confidence != null && si.confidence < 0.6).length > 0 && (
        <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-700">
          ⚠ 有{' '}
          {scoreItems.filter((si) => si.confidence != null && si.confidence < 0.6).length}{' '}
          项评分置信度较低（&lt;60%），建议人工重点复核。
        </div>
      )}

      {/* AI 评语（仅自有供应商） */}
      {/* overallComment is passed separately */}

      {/* AI vs 专家对比 */}
      {hasComparison && (
        <ExpertComparisonTable
          myScoredItems={myScoredItems}
          scoreItems={scoreItems}
          expertScores={expertScores}
          activeSupplier={activeSupplier}
        />
      )}
    </div>
  );
}

// ── 子组件：AI vs 专家对比表 ──

function ExpertComparisonTable({
  myScoredItems,
  scoreItems,
  expertScores,
  activeSupplier,
}: {
  myScoredItems: BidScoreItem[];
  scoreItems: AiScoreItem[];
  expertScores: Record<string, { score: number; reason: string }>;
  activeSupplier: string;
}) {
  return (
    <div className="glass-card rounded-xl p-4">
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
              const aiItem = scoreItems.find((a) => a.scoreItemId === si.id);
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
  );
}

// ── 子组件：优势与不足段落 ──

function StrengthsWeaknessesSection({
  strengths,
  weaknesses,
  keyObservations,
  overallComment,
  isViewingOwnSupplier,
}: {
  strengths?: SwItem[] | null;
  weaknesses?: SwItem[] | null;
  keyObservations?: string[];
  overallComment?: string;
  isViewingOwnSupplier: boolean;
}) {
  if (!isViewingOwnSupplier) {
    return (
      <div className="text-center py-8">
        <Lightbulb size={24} strokeWidth={1} className="text-[oklch(0.75_0.008_264)] mx-auto mb-2" />
        <p className="text-sm text-[var(--color-text-secondary)]">
          竞争分析仅对当前供应商可用
        </p>
        <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
          切换到"当前"供应商可查看正向依据与需关注事项
        </p>
      </div>
    );
  }

  const hasStrengths = strengths && strengths.length > 0;
  const hasWeaknesses = weaknesses && weaknesses.length > 0;
  const hasData = hasStrengths || hasWeaknesses || overallComment;

  if (!hasData) {
    return (
      <div className="text-center py-8">
        <Lightbulb size={24} strokeWidth={1} className="text-[oklch(0.75_0.008_264)] mx-auto mb-2" />
        <p className="text-sm text-[var(--color-text-secondary)]">暂无竞争分析数据</p>
        <p className="text-xs text-[var(--color-text-tertiary)] mt-1 max-w-md mx-auto">
          AI 竞争分析在所有供应商 per-item 评分完成后生成
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 关键观察 */}
      {keyObservations && keyObservations.length > 0 && (
        <div className="glass-card glass-card-blue rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
            <h3 className="font-bold text-sm text-[var(--color-primary)]">关键观察</h3>
          </div>
          <ul className="space-y-1.5">
            {keyObservations.map((obs, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-[var(--color-text)]">
                <span className="text-[var(--color-primary)] font-bold mt-0.5 shrink-0">{i + 1}.</span>
                {obs}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 双列：正向依据 + 需关注事项 */}
      <div className="grid grid-cols-1 gap-3">
        {hasStrengths && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp size={14} strokeWidth={1.5} className="text-emerald-500" />
              <h4 className="font-bold text-sm text-[var(--color-text)]">
                正向依据（{strengths!.length} 项）
              </h4>
            </div>
            <div className="space-y-2">
              {strengths!.map((s, i) => (
                <SwCard key={i} item={s} type="strength" />
              ))}
            </div>
          </div>
        )}
        {hasWeaknesses && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle size={14} strokeWidth={1.5} className="text-amber-500" />
              <h4 className="font-bold text-sm text-[var(--color-text)]">
                需关注事项（{weaknesses!.length} 项）
              </h4>
            </div>
            <div className="space-y-2">
              {weaknesses!.map((w, i) => (
                <SwCard key={i} item={w} type="weakness" />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 综合评语 */}
      {overallComment && (
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
            <h4 className="font-bold text-sm text-[var(--color-text)]">AI 分析评语</h4>
          </div>
          <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">{overallComment}</p>
        </div>
      )}
    </div>
  );
}
