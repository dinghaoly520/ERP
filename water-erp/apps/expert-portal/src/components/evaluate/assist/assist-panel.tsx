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
  ShieldAlert,
  Search,
  Download,
  Trophy,
  Award,
  Clipboard,
  Building2,
  Phone,
  Mail,
  MapPin,
  Briefcase,
  Clock,
  Banknote,
  Minus,
} from 'lucide-react';
import type { AssistData, BidScoreItem, AiScoreItem } from '@water-erp/shared';
import { api } from '@/lib/api';
import { RadarChart } from './charts/radar-chart';
import type { RadarAxis } from './charts/radar-chart';
import { ScoreBreakdownBars, CATEGORY_LABEL, CATEGORY_COLOR } from './charts/score-breakdown-bars';
import { ScoreBarChart } from './charts/score-bar-chart';
import type { ScoreBarChartData } from './charts/score-bar-chart';
import { PriceComparisonChart } from './charts/price-comparison-chart';
import { AssistKpiCard } from './charts/assist-kpi-card';

// ── 类型 ──

interface ComparedBidder {
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

// 仅用于雷达/柱状图的评分维度
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

// ═══════════════════════════════════════════════════════════════
// 子组件
// ═══════════════════════════════════════════════════════════════

// ── Pass/Fail 审查卡片 ──

function PassFailReviewCard({ item }: { item: AiScoreItem }) {
  const isPass = item.pass === true;
  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border ${
        isPass ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'
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
              isPass ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
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

// ── SW 卡片（正向依据/需关注事项）──

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

// ── 可折叠段落 ──

function CollapsibleSection({
  title,
  icon,
  accent,
  defaultOpen = false,
  summary,
}: {
  title: string;
  icon?: React.ReactNode;
  accent?: string;
  defaultOpen?: boolean;
  /** 常驻内容（折叠+展开都显示）；可为函数 (isOpen) => ReactNode，按展开态切换 reason 截断/完整 */
  summary?: React.ReactNode | ((isOpen: boolean) => React.ReactNode);
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const summaryNode = typeof summary === 'function' ? summary(isOpen) : summary;

  return (
    <div className="glass-card glass-card-lighter rounded-xl overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/40 transition-colors"
      >
        {accent && <span className="w-1 h-6 rounded-full shrink-0" style={{ background: accent }} />}
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
      {summaryNode && <div className="px-4 pt-1 pb-4">{summaryNode}</div>}
    </div>
  );
}

// ── 字段卡片（关键信息用）──

function FieldCard({
  icon,
  label,
  value,
  suffix,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number | null | undefined;
  suffix?: string;
}) {
  return (
    <div className="glass-card glass-card-lighter rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[var(--color-text-tertiary)]">{icon}</span>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">{label}</span>
      </div>
      <div className="font-semibold text-sm text-[var(--color-text)]">
        {value != null ? String(value) + (suffix ?? '') : '—'}
      </div>
    </div>
  );
}

// ── 排名徽章 ──

function RankBadge({ rank }: { rank: number }) {
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

// ── AI vs 专家对比表 ──

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

// ═══════════════════════════════════════════════════════════════
// 区域组件
// ═══════════════════════════════════════════════════════════════

// ── 快速状态条 — 瑞士网格 · 字体排印驱动 ──
// 不对称布局：AI 评分独占左列（大字 hero），三个状态指标右列横排
// 模型来源标注于右上角，整体靠留白和字重层级传达信息

function StatusBar({ assistData }: { assistData: AssistData }) {
  const score = assistData.totalScore != null ? Number(assistData.totalScore).toFixed(1) : '—';

  const qualStatus = assistData.qualificationStatus;
  const qualLabel = qualStatus === '通过' ? '通过' : qualStatus === '不通过' ? '不通过' : '—';
  const qualColor =
    qualStatus === '通过' ? 'text-[#11a874]' : qualStatus === '不通过' ? 'text-[#e74c3c]' : 'text-[oklch(0.50_0.010_264)]';

  const riskLevel = assistData.riskLevel ?? 'low';
  const riskLabel = riskLevel === 'high' ? '高' : riskLevel === 'medium' ? '中' : '低';
  const riskColor =
    riskLevel === 'high' ? 'text-[#e74c3c]' : riskLevel === 'medium' ? 'text-[#f5a623]' : 'text-[#11a874]';

  const concordanceStatus = assistData.concordanceStatus;
  const concordLabel =
    concordanceStatus === 'consistent' ? '一致' : concordanceStatus === 'conflict' ? '冲突' : '差异';
  const concordColor =
    concordanceStatus === 'consistent' ? 'text-[#11a874]' : concordanceStatus === 'conflict' ? 'text-[#e74c3c]' : 'text-[#f5a623]';

  return (
    <div className="grid gap-x-14 gap-y-3 mb-3 px-6 py-4 bg-white/60 rounded-xl border border-[oklch(0.91_0.006_264)]" style={{ gridTemplateColumns: '1fr auto', gridTemplateRows: 'auto auto', alignItems: 'center' }}>
      {/* 左列：AI 评分 hero（跨两行） */}
      <div className="flex flex-col gap-1" style={{ gridRow: '1 / 3' }}>
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[oklch(0.48_0.01_264)] select-none">
          AI 评估分
        </span>
        <span className="text-[44px] font-bold leading-none text-[var(--color-primary)] tabular-nums">
          {score}
        </span>
      </div>

      {/* 右下：三个状态指标横排 */}
      <div className="flex gap-10">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-[oklch(0.50_0.010_264)] select-none">
            资格审查
          </span>
          <span className={`text-base font-bold tabular-nums ${qualColor}`}>{qualLabel}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-[oklch(0.50_0.010_264)] select-none">
            风险等级
          </span>
          <span className={`text-base font-bold tabular-nums ${riskColor}`}>{riskLabel}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-[oklch(0.50_0.010_264)] select-none">
            数据一致性
          </span>
          <span className={`text-base font-bold tabular-nums ${concordColor}`}>{concordLabel}</span>
        </div>
      </div>
    </div>
  );
}

// ── ① 评分分析 — 聚焦当前供应商 ──

function ScoringSection({
  scoreItems,
  categoryTotals,
  overallComment,
  expertScores,
  activeSupplier,
  projectScoreItems,
  strengths,
  weaknesses,
  keyObservations,
}: {
  scoreItems?: AssistData['scoreItems'];
  categoryTotals?: AssistData['categoryTotals'];
  overallComment?: string;
  expertScores: Record<string, { score: number; reason: string }>;
  activeSupplier: string;
  projectScoreItems: BidScoreItem[];
  strengths?: SwItem[] | null;
  weaknesses?: SwItem[] | null;
  keyObservations?: string[];
}) {
  const hasScoreItems = scoreItems && scoreItems.length > 0;
  const allCategories = hasScoreItems ? [...new Set(scoreItems.map((si) => si.category))] : [];

  const myScoredItems = projectScoreItems.filter((si) => {
    const key = `${activeSupplier}:${si.id}`;
    return expertScores[key] && !['QUALIFICATION', 'RESPONSIVE'].includes(si.category);
  });
  const hasComparison = !!(activeSupplier && hasScoreItems && myScoredItems.length > 0);

  const hasStrengths = strengths && strengths.length > 0;
  const hasWeaknesses = weaknesses && weaknesses.length > 0;
  const hasSwContent = hasStrengths || hasWeaknesses || !!overallComment || !!(keyObservations && keyObservations.length > 0);

  if (!hasScoreItems && !overallComment && !hasSwContent) {
    return (
      <div className="text-center py-8">
        <BarChart3 size={32} strokeWidth={1} className="text-[oklch(0.75_0.008_264)] mx-auto mb-3" />
        <p className="text-sm text-[var(--color-text-secondary)]">暂无评分数据</p>
        <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
          AI 评分分析完成后将在此展示 per-item 评分详情
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Per-item 评分明细（按分类折叠） */}
      {allCategories.map((cat) => {
        const items = scoreItems!.filter((si) => si.category === cat);
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
              cat === 'QUALIFICATION' ? (
                <ShieldCheck size={14} strokeWidth={1.5} />
              ) : cat === 'RESPONSIVE' ? (
                <ClipboardCheck size={14} strokeWidth={1.5} />
              ) : (
                <FileText size={14} strokeWidth={1.5} />
              )
            }
            accent={catColor}
            summary={(isOpen: boolean) =>
              isPassFail ? (
                <div className="space-y-2">
                  {items.map((item) => (
                    <PassFailReviewCard key={item.scoreItemId} item={item} />
                  ))}
                </div>
              ) : (
                <ScoreBreakdownBars
                  scoreItems={items.filter((si) => SCORE_CATEGORIES.includes(si.category))}
                  expanded={isOpen}
                  flat
                />
              )
            }
          />
        );
      })}

      {/* 置信度低警告 */}
      {hasScoreItems &&
        scoreItems.filter((si) => si.confidence != null && si.confidence < 0.6).length > 0 && (
          <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-700 flex items-start gap-1.5">
            <AlertCircle size={13} strokeWidth={1.5} className="mt-px shrink-0" />有 {scoreItems.filter((si) => si.confidence != null && si.confidence < 0.6).length}{' '}
            项评分置信度较低（&lt;60%），建议人工重点复核。
          </div>
        )}

      {/* AI vs 专家对比 */}
      {hasComparison && (
        <ExpertComparisonTable
          myScoredItems={myScoredItems}
          scoreItems={scoreItems!}
          expertScores={expertScores}
          activeSupplier={activeSupplier}
        />
      )}

      {/* 优势与不足 */}
      {hasSwContent && (
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

          {/* AI 综合评语 */}
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
      )}
    </div>
  );
}

// ── ② 关键信息 ──

function KeyInfoSection({
  keyInfo,
  supplierName,
}: {
  keyInfo: AssistData['keyInfo'];
  supplierName: string;
}) {
  if (!keyInfo) {
    return (
      <div className="text-center py-6">
        <Clipboard size={24} strokeWidth={1} className="text-[oklch(0.75_0.008_264)] mx-auto mb-2" />
        <p className="text-sm text-[var(--color-text-secondary)]">暂无关键信息</p>
      </div>
    );
  }

  const info = keyInfo as Record<string, any>;
  const contact = (info.contactInfo ?? {}) as Record<string, any>;
  const keyPerformances = Array.isArray(info.keyPerformances) ? info.keyPerformances : [];

  return (
    <div className="space-y-3">
      {/* 公司信息 + 投标信息 双列 */}
      <div className="grid grid-cols-2 gap-3">
        {/* 公司信息 */}
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Building2 size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
            <h4 className="font-bold text-sm text-[var(--color-text)]">公司信息</h4>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FieldCard icon={<Building2 size={12} />} label="法定代表人" value={info.legalPerson} />
            <FieldCard icon={<Clock size={12} />} label="注册资本" value={info.registeredCapital} />
            <FieldCard icon={<Clock size={12} />} label="成立日期" value={info.establishedDate} />
            <FieldCard icon={<ShieldCheck size={12} />} label="资质等级" value={info.qualificationLevel} />
            <FieldCard icon={<Award size={12} />} label="资质名称" value={info.qualificationName} />
            <FieldCard icon={<ClipboardCheck size={12} />} label="资格状态" value={info.qualificationStatus} />
          </div>
        </div>

        {/* 投标信息 */}
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Briefcase size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
            <h4 className="font-bold text-sm text-[var(--color-text)]">投标信息</h4>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FieldCard icon={<Banknote size={12} strokeWidth={1.5} />} label="投标报价" value={info.quotePriceYuan} />
            <FieldCard icon={<Clock size={12} />} label="工期" value={info.constructionPeriod} />
            <FieldCard icon={<Clock size={12} />} label="质保期" value={info.warrantyPeriod} />
            <FieldCard icon={<Clock size={12} />} label="报价有效期" value={info.priceValidity ? `${info.priceValidity}天` : undefined} />
          </div>
        </div>
      </div>

      {/* 联系方式 + 项目团队 双列 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Phone size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
            <h4 className="font-bold text-sm text-[var(--color-text)]">联系方式</h4>
          </div>
          <div className="grid grid-cols-1 gap-2">
            <FieldCard icon={<Phone size={12} />} label="电话" value={contact.phone} />
            <FieldCard icon={<Mail size={12} />} label="邮箱" value={contact.email} />
            <FieldCard icon={<MapPin size={12} />} label="地址" value={contact.address} />
          </div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Briefcase size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
            <h4 className="font-bold text-sm text-[var(--color-text)]">项目团队</h4>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FieldCard icon={<Briefcase size={12} />} label="项目经理" value={info.proposedProjectManager ?? info.projectManager} />
            <FieldCard icon={<Award size={12} />} label="职称" value={info.proposedProjectManagerTitle ?? info.projectManagerTitle} />
            <FieldCard icon={<ShieldCheck size={12} />} label="执业资格" value={info.proposedProjectManagerQualification} />
            <FieldCard icon={<span className="text-xs">👥</span>} label="团队人数" value={info.teamSize} />
          </div>
        </div>
      </div>

      {/* 关键业绩 */}
      {keyPerformances.length > 0 && (
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Award size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
            <h4 className="font-bold text-sm text-[var(--color-text)]">
              关键业绩（{info.performanceCount ?? keyPerformances.length} 项）
            </h4>
          </div>
          <div className="space-y-2">
            {keyPerformances.slice(0, 5).map((kp: any, i: number) => (
              <div key={i} className="glass-card glass-card-lighter rounded-lg p-3 flex items-center gap-3 text-sm">
                <span className="w-6 h-6 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary)] flex items-center justify-center text-xs font-bold shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[var(--color-text)] truncate">{kp.projectName}</div>
                  {kp.keyMetrics && (
                    <div className="text-xs text-[var(--color-text-tertiary)] mt-0.5">{kp.keyMetrics}</div>
                  )}
                </div>
                {kp.contractAmount && (
                  <span className="text-xs font-medium text-[var(--color-text-secondary)] shrink-0">
                    {kp.contractAmount}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── ③ 数据一致性 ──

interface ConcordanceItem {
  label?: string;
  field?: string;
  systemValue?: unknown;
  docValue?: unknown;
  status?: string;
  severity?: string;
  note?: string;
}

const CONCORDANCE_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string; border: string }> = {
  conflict: {
    label: '冲突',
    bg: 'bg-red-50',
    text: 'text-red-700',
    dot: 'bg-red-500',
    border: 'border-red-200',
  },
  minor_diff: {
    label: '轻微差异',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    dot: 'bg-amber-500',
    border: 'border-amber-200',
  },
  consistent: {
    label: '一致',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    dot: 'bg-emerald-500',
    border: 'border-emerald-200',
  },
};

function ConcordanceSection({ concordance, concordanceStatus }: { concordance: any; concordanceStatus?: string }) {
  if (!concordance || !Array.isArray(concordance as any[])) {
    return (
      <div className="text-center py-4">
        <AlertCircle size={20} strokeWidth={1} className="text-[oklch(0.75_0.008_264)] mx-auto mb-1.5" />
        <p className="text-xs text-[var(--color-text-tertiary)]">暂无一致性数据</p>
      </div>
    );
  }

  const checks = concordance as unknown as ConcordanceItem[];
  const conflicts = checks.filter((c) => c.status === 'conflict');
  const warnings = checks.filter((c) => c.status === 'minor_diff');
  const consistent = checks.filter((c) => c.status === 'consistent');
  const sorted = [...checks]
    .filter((c) => c.status !== 'insufficient_data')
    .sort((a, b) => {
      const order = { conflict: 0, minor_diff: 1, consistent: 2 };
      return (order[a.status as keyof typeof order] ?? 3) - (order[b.status as keyof typeof order] ?? 3);
    });

  return (
    <div>
      {/* 统计条 */}
      <div className="flex items-center gap-3 mb-2 text-xs">
        <span className="font-semibold text-red-600">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 mr-1" />
          {conflicts.length} 冲突
        </span>
        <span className="font-semibold text-amber-600">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 mr-1" />
          {warnings.length} 差异
        </span>
        <span className="font-semibold text-emerald-600">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1" />
          {consistent.length} 一致
        </span>
        {concordanceStatus && (
          <span className="text-[var(--color-text-tertiary)] ml-auto">
            {concordanceStatus === 'consistent' ? <span className="inline-flex items-center gap-1"><CheckCircle size={12} strokeWidth={1.5} />一致</span> : concordanceStatus === 'conflict' ? <span className="inline-flex items-center gap-1"><XCircle size={12} strokeWidth={1.5} />冲突</span> : <span className="inline-flex items-center gap-1"><Minus size={12} strokeWidth={1.5} />差异</span>}
          </span>
        )}
      </div>

      {/* 字段明细（仅显示非一致项，最多 4 条） */}
      <div className="space-y-1.5">
        {sorted.filter(c => c.status !== 'consistent').slice(0, 4).map((check, i) => {
          const cfg = CONCORDANCE_STATUS_CONFIG[check.status ?? ''] ?? CONCORDANCE_STATUS_CONFIG.consistent;
          return (
            <div key={i} className={`${cfg.bg} ${cfg.border} border rounded-lg p-2.5`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
                <span className="font-semibold text-xs text-[var(--color-text)]">
                  {check.label || check.field}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ml-auto font-medium ${cfg.bg} ${cfg.text}`}>
                  {cfg.label}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] ml-3.5">
                <div>
                  <span className="text-[var(--color-text-tertiary)]">系统：</span>
                  <span className="text-[var(--color-text)] font-medium">
                    {check.systemValue != null ? String(check.systemValue) : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--color-text-tertiary)]">OCR：</span>
                  <span className="text-[var(--color-text)] font-medium">
                    {check.docValue != null ? String(check.docValue) : '—'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

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

// ── 分区标题 ──

// ── 实心编号圆 ──

function SectionNumber({ n }: { n: number }) {
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" className="shrink-0">
      <circle cx={9} cy={9} r={9} fill="var(--color-primary)" />
      <text
        x={9}
        y={12}
        textAnchor="middle"
        fill="#fff"
        fontSize={10}
        fontWeight={700}
        fontFamily="system-ui, sans-serif"
      >
        {n}
      </text>
    </svg>
  );
}

function SectionHeader({ number, title, subtitle }: { number: number; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2.5 pt-2 pb-1">
      <SectionNumber n={number} />
      <h3 className="font-bold text-sm text-[var(--color-text)]">{title}</h3>
      {subtitle && <span className="text-[11px] text-[var(--color-text-tertiary)]">{subtitle}</span>}
      <span className="flex-1 h-px bg-[oklch(0.91_0.006_264)] ml-2" />
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
      <StatusBar assistData={assistData} />

      {/* ① 评分分析 */}
      <section>
        <SectionHeader number={1} title="评分分析" subtitle={`· ${supplierName}`} />
        <div className="mt-3">
          <ScoringSection
            scoreItems={assistData.scoreItems}
            categoryTotals={assistData.categoryTotals}
            overallComment={assistData.overallComment}
            expertScores={expertScores}
            activeSupplier={activeSupplier}
            projectScoreItems={projectScoreItems}
            strengths={Array.isArray(assistData.strengths) ? assistData.strengths : null}
            weaknesses={Array.isArray(assistData.weaknesses) ? assistData.weaknesses : null}
            keyObservations={
              Array.isArray((assistData as any).keyObservations)
                ? (assistData as any).keyObservations
                : undefined
            }
          />
        </div>
      </section>

      {/* ② 关键信息 */}
      <section>
        <SectionHeader number={2} title="关键信息" subtitle="· OCR 提取的结构化数据" />
        <div className="mt-3">
          <KeyInfoSection keyInfo={assistData.keyInfo} supplierName={supplierName} />
        </div>
      </section>

      {/* ③ + ④ 数据一致性 + 串通检测 双列 */}
      <section>
        <div className="grid grid-cols-2 gap-4">
          {/* ③ 数据一致性 */}
          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <SectionNumber n={3} />
              <h4 className="font-bold text-sm text-[var(--color-text)]">数据一致性</h4>
              <span className="text-[10px] text-[var(--color-text-tertiary)]">系统 vs OCR</span>
            </div>
            <ConcordanceSection
              concordance={assistData.concordance}
              concordanceStatus={assistData.concordanceStatus}
            />
          </div>

          {/* ④ 串通检测 */}
          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <SectionNumber n={4} />
              <h4 className="font-bold text-sm text-[var(--color-text)]">串通检测</h4>
            </div>
            <FraudSection
              fraudSummary={(assistData as any).fraudSummary ?? null}
              riskLevel={assistData.riskLevel}
            />
          </div>
        </div>
      </section>

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
