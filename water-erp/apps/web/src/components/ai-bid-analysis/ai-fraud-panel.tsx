'use client';

import { useEffect, useState } from 'react';
import {
  Shield,
  AlertCircle,
  RefreshCw,
  ChevronDown,
  AlertTriangle,
  Users,
  BarChart3,
  FileText,
  CheckCircle,
  ListChecks,
} from 'lucide-react';
import { aiBidAnalysisApi } from '@/lib/api/ai-bid-analysis';
import type { AiBidAnalysisTask, FraudIndicators } from '@/lib/types/ai-bid-analysis';
import { PriceComparisonChart } from './ai-bid-analysis-charts';
import { buildPriceComparisonData } from './ai-fraud-panel-price-data';
import AiStagePanel from './ai-stage-panel';
import AiStageKpiCard, { type AiStageKpiTone } from './ai-stage-kpi-card';
import AiStatusBadge, { type AiStatusBadgeTone } from './ai-status-badge';

// ── Types ──

const typeLabels: Record<string, string> = {
  price_concentration: '报价离散度',
  price_pattern: '报价规律性',
  document_similarity: '文件相似度',
  contact_overlap: '联系信息交叉',
  format_consistency: '格式一致性',
  metadata_consistency: '文件元数据一致性',
  price_structure_similarity: '报价结构一致性',
};

const reviewActionLabels: Record<string, string> = {
  verify_pricing_basis: '核实报价依据',
  verify_independence: '核实投标单位独立性',
  compare_source_files: '比对原始投标文件',
  manual_review: '人工复核',
};

const evidenceTypeLabels: Record<string, string> = {
  price: '报价证据',
  contact: '联系信息证据',
  text: '文本相似证据',
  format: '格式证据',
  metadata: '文件元数据证据',
};

const severityConfig = {
  low: { tone: 'blue' as const, badgeTone: 'blue' as AiStatusBadgeTone, accent: '#94a3b8', label: '低风险', iconBg: 'bg-slate-100 text-slate-600' },
  medium: { tone: 'amber' as const, badgeTone: 'amber' as AiStatusBadgeTone, accent: '#f59e0b', label: '中风险', iconBg: 'bg-amber-100 text-amber-700' },
  high: { tone: 'red' as const, badgeTone: 'red' as AiStatusBadgeTone, accent: '#ef4444', label: '高风险', iconBg: 'bg-red-100 text-red-700' },
};

// ── Main Component ──

interface AiFraudPanelProps {
  taskId: string;
  task: AiBidAnalysisTask;
  onRefresh?: () => void;
}

export default function AiFraudPanel({ taskId, task, onRefresh }: AiFraudPanelProps) {
  const [loading, setLoading] = useState(true);
  const [fraudData, setFraudData] = useState<FraudIndicators | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadFraudDetection = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await aiBidAnalysisApi.getFraudDetection(taskId);
      setFraudData(data);
      onRefresh?.();
    } catch {
      setError('加载串通检测数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadFraudDetection(); }, [taskId]);

  // ── Loading State ──
  if (loading) {
    return (
      <GlassContainer>
        <div className="flex flex-col items-center justify-center py-16">
          <RefreshCw className="h-8 w-8 animate-spin text-[color:var(--accent)]" />
          <p className="mt-3 text-sm text-[color:var(--muted-foreground)]">正在加载合规性审查数据…</p>
        </div>
      </GlassContainer>
    );
  }

  // ── Error State ──
  if (error) {
    return (
      <GlassContainer>
        <div className="flex flex-col items-center justify-center py-16">
          <AlertCircle className="h-10 w-10 text-red-400" />
          <p className="mt-3 text-sm text-red-500">{error}</p>
          <button
            onClick={loadFraudDetection}
            className="mt-4 rounded-xl px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ background: 'var(--accent)' }}
          >
            重试
          </button>
        </div>
      </GlassContainer>
    );
  }

  // ── Empty State ──
  if (!fraudData) {
    return (
      <GlassContainer>
        <div className="flex flex-col items-center justify-center py-16">
          <Shield className="h-12 w-12 opacity-20" />
          <p className="mt-3 text-sm text-[color:var(--muted-foreground)]">暂无串通检测数据</p>
        </div>
      </GlassContainer>
    );
  }

  const priceData = buildPriceComparisonData(task.bidders || []);
  const summary = fraudData.summary;
  const highCount = summary?.highCount ?? fraudData.indicators.filter(i => i.severity === 'high').length;
  const mediumCount = summary?.mediumCount ?? fraudData.indicators.filter(i => i.severity === 'medium').length;
  const lowCount = summary?.lowCount ?? fraudData.indicators.filter(i => i.severity === 'low').length;
  const riskCfg = severityConfig[fraudData.riskLevel] || severityConfig.low;

  return (
    <div className="space-y-6">

      {/* ─── Section 1: 风险等级概览 ─── */}
      <AiStagePanel
        tone={riskCfg.tone}
        eyebrow="投标合规性审查"
        title="风险等级概览"
        action={
          <button
            onClick={loadFraudDetection}
            className="rounded-xl border border-slate-200 bg-white/80 p-2 text-[color:var(--muted-foreground)] shadow-sm transition-colors hover:bg-white hover:text-[color:var(--foreground)]"
            title="刷新"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        }
      >
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <AiStageKpiCard
            label="风险等级"
            value={riskCfg.label}
            icon={<Shield className="h-5 w-5" />}
            tone={riskCfg.tone}
            hint={fraudData.indicators.length > 0 ? `共 ${fraudData.indicators.length} 个指标` : '无风险指标'}
          />
          <AiStageKpiCard
            label="高风险"
            value={String(highCount)}
            icon={<AlertTriangle className="h-5 w-5" />}
            tone="red"
            hint={highCount > 0 ? '需重点关注' : '无高风险'}
          />
          <AiStageKpiCard
            label="中风险"
            value={String(mediumCount)}
            icon={<AlertCircle className="h-5 w-5" />}
            tone="amber"
            hint={mediumCount > 0 ? '需进一步核实' : '无中风险'}
          />
          <AiStageKpiCard
            label="参评单位"
            value={String(task.bidders?.length ?? 0)}
            icon={<Users className="h-5 w-5" />}
            tone="blue"
            hint={`已完成 ${(task.bidders || []).filter(b => b.status === 'COMPLETED').length} 家`}
          />
        </div>

        {/* 综合评估 */}
        <div className="mt-4 rounded-2xl border border-[rgba(200,215,235,0.4)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,252,255,0.93))] px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
            <ListChecks className="h-3.5 w-3.5" />
            综合评估
          </div>
          <p className="text-sm leading-6 text-[color:var(--foreground)]">{fraudData.overallAssessment}</p>
        </div>

        {/* 免责提示 */}
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm leading-6 text-amber-800">
          检测结果仅作为评审参考线索，不构成违规行为的最终认定。请结合原始投标文件、评审记录和必要的人工复核处理。
        </div>
      </AiStagePanel>

      {/* ─── Section 2: 报价分布对比 ─── */}
      {priceData.length > 0 && (
        <AiStagePanel tone="blue" title="报价分布对比">
          <div className="rounded-[16px] border border-[rgba(214,225,242,0.65)] bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(246,250,255,0.96))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.95)]">
            <PriceComparisonChart
              data={priceData}
              maxPrice={task.requirements?.maxPrice || undefined}
            />
          </div>
        </AiStagePanel>
      )}

      {/* ─── Section 3: 风险指标详情 ─── */}
      {fraudData.indicators.length > 0 && (
        <AiStagePanel tone="default" title="风险指标详情">
          <div className="space-y-3">
            {fraudData.indicators.map((indicator, index) => (
              <IndicatorCard
                key={indicator.ruleCode || index}
                indicator={indicator}
                defaultOpen={indicator.severity === 'high'}
              />
            ))}
          </div>
        </AiStagePanel>
      )}

      {/* ─── Section 4: 评审建议 ─── */}
      {fraudData.indicators.some(ind => ind.severity === 'high') && (
        <AiStagePanel
          tone="amber"
          title="评审建议"
          action={
            <AiStatusBadge tone="danger">高风险</AiStatusBadge>
          }
        >
          <div className="space-y-3 text-sm leading-6 text-[color:var(--foreground)]">
            <p>本次检测发现高风险指标，建议：</p>
            <ol className="list-decimal pl-5 space-y-1.5">
              <li className="text-[color:var(--muted-foreground)]">重点核查高风险指标涉及的投标单位</li>
              <li className="text-[color:var(--muted-foreground)]">对比相关投标文件的关键内容，确认是否存在串通行为</li>
              <li className="text-[color:var(--muted-foreground)]">如确认存在串通行为，按相关规定处理</li>
              <li className="text-[color:var(--muted-foreground)]">保留本次检测结果作为评审记录</li>
            </ol>
          </div>
        </AiStagePanel>
      )}
    </div>
  );
}

// ── Glass Container (for loading/error/empty states) ──

function GlassContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[20px] border border-[rgba(200,215,235,0.4)] bg-[linear-gradient(165deg,rgba(255,255,255,0.98),rgba(248,252,255,0.94))] p-6 shadow-[0_4px_20px_rgba(79,108,161,0.08)]">
      {children}
    </div>
  );
}

// ── Collapsible Indicator Card (inline, adapted from analysis-panel CollapsibleSection) ──

interface IndicatorCardProps {
  indicator: FraudIndicators['indicators'][number];
  defaultOpen?: boolean;
}

function IndicatorCard({ indicator, defaultOpen = false }: IndicatorCardProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const sev = severityConfig[indicator.severity] || severityConfig.low;

  const involvedBidderNames = indicator.involvedBidders?.length
    ? indicator.involvedBidders.map(b => b.name)
    : indicator.affectedBidders;

  const evidenceRows = indicator.evidenceItems?.length
    ? indicator.evidenceItems
    : [{
        type: 'format' as const,
        label: '证据',
        value: indicator.evidence,
        bidders: indicator.affectedBidders,
        explanation: indicator.evidence,
      }];

  return (
    <div className="overflow-hidden rounded-[16px] border border-[rgba(205,218,238,0.45)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(246,250,255,0.95))] shadow-[0_4px_14px_rgba(79,108,161,0.06),inset_0_1px_0_rgba(255,255,255,0.96)]">
      {/* Top accent line */}
      <div
        className="h-[2px] opacity-80"
        style={{ background: `linear-gradient(90deg, ${sev.accent}, transparent)` }}
      />

      {/* Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative w-full overflow-hidden px-4 py-3 text-left transition-colors hover:bg-[rgba(96,139,239,0.04)]"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <AiStatusBadge tone={sev.badgeTone}>
              {sev.label}
            </AiStatusBadge>
            <span className="font-medium text-[color:var(--foreground)]">
              {typeLabels[indicator.type] || indicator.type}
            </span>
            {indicator.ruleCode && (
              <span className="rounded-md bg-[rgba(96,139,239,0.08)] px-2 py-0.5 text-[10px] font-mono text-[rgba(96,139,239,0.7)]">
                {indicator.ruleCode}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {indicator.confidence !== undefined && (
              <span className="text-[11px] text-[color:var(--muted-foreground)]">
                置信度 {Math.round((indicator.confidence ?? 0) * 100)}%
              </span>
            )}
            <span className="rounded-full bg-[rgba(96,139,239,0.08)] px-2 py-0.5 text-[10px] font-semibold text-[rgba(96,139,239,0.82)]">
              {isOpen ? '收起' : '展开'}
            </span>
            <ChevronDown className={`h-4 w-4 text-[color:var(--muted-foreground)] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
          </div>
        </div>

        {/* Description (always visible) */}
        <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">{indicator.description}</p>
      </button>

      {/* Expandable Content */}
      {isOpen && (
        <div className="border-t border-[rgba(205,218,238,0.4)] bg-[linear-gradient(180deg,rgba(251,253,255,0.86),rgba(246,249,255,0.96))] px-4 py-4 space-y-3">
          {/* Involved bidders + Review action */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl border border-[rgba(200,215,235,0.4)] bg-white/70 p-3">
              <div className="mb-1 font-medium text-[color:var(--muted-foreground)]">涉及投标单位</div>
              <div className="text-[color:var(--foreground)]">{involvedBidderNames.join('、')}</div>
            </div>
            <div className="rounded-xl border border-[rgba(200,215,235,0.4)] bg-white/70 p-3">
              <div className="mb-1 font-medium text-[color:var(--muted-foreground)]">复核动作</div>
              <div className="text-[rgba(96,139,239,1)]">{reviewActionLabels[indicator.reviewAction] || indicator.recommendation}</div>
            </div>
          </div>

          {/* Evidence Items */}
          {evidenceRows.map((evidence, evidenceIndex) => (
            <div
              key={`evidence-${indicator.ruleCode || 'unknown'}-${evidenceIndex}`}
              className="rounded-xl border border-[rgba(200,215,235,0.4)] bg-white/60 p-3 text-xs"
            >
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                  {evidenceTypeLabels[evidence.type] || evidence.type}
                </span>
                <span className="font-medium text-[color:var(--foreground)]">{evidence.label}</span>
                <span className="text-[color:var(--muted-foreground)]">{evidence.value}</span>
              </div>
              <div className="text-[color:var(--muted-foreground)]">{evidence.explanation}</div>
              <div className="mt-1 text-[color:var(--muted-foreground)] opacity-60">涉及：{evidence.bidders.join('、')}</div>
            </div>
          ))}

          {/* Recommendation */}
          <div className="text-xs text-[rgba(96,139,239,1)] pt-1">
            建议：{indicator.recommendation}
          </div>
        </div>
      )}
    </div>
  );
}
