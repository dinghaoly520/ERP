'use client';

// ── 合规性审查卡（围标串标风险检测）──
// 移植自已删除的 :3005 /bid-analysis「合规性审查」tab（AiFraudPanel，ed05c322），
// 数据 = /expert/projects/:id/assist/compare 的 projectFraud（AiBidReport.fraudIndicators
// 完整直通，2026-09-28 起本卡为唯一查看入口）。样式按 :3006 exp-*/neu-* 体系重制。

import { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ShieldAlert,
  Users,
} from 'lucide-react';
import type { FraudIndicatorDetail, ProjectFraudDetail } from '@water-erp/shared';
import { PriceComparisonChart } from './charts/price-comparison-chart';
import { FieldCard } from './shared/field-card';

// ── 指标类型/复核动作/证据类型 中文映射（与 fraud-detector.service 对齐）──

const TYPE_LABELS: Record<string, string> = {
  price_concentration: '报价离散度',
  price_pattern: '报价规律性',
  document_similarity: '文件相似度',
  contact_overlap: '联系信息交叉',
  format_consistency: '格式一致性',
  metadata_consistency: '文件元数据一致性',
  price_structure_similarity: '报价结构一致性',
};

const REVIEW_ACTION_LABELS: Record<string, string> = {
  verify_pricing_basis: '核实报价依据',
  verify_independence: '核实投标单位独立性',
  compare_source_files: '比对原始投标文件',
  manual_review: '人工复核',
};

const EVIDENCE_TYPE_LABELS: Record<string, string> = {
  price: '报价证据',
  contact: '联系信息证据',
  text: '文本相似证据',
  format: '格式证据',
  metadata: '文件元数据证据',
};

const SEVERITY_CONFIG: Record<string, { pill: string; alert: string; label: string }> = {
  low: {
    pill: 'var(--success)',
    alert: 'exp-alert exp-alert--success',
    label: '低风险',
  },
  medium: {
    pill: 'var(--warning)',
    alert: 'exp-alert exp-alert--warn',
    label: '中风险',
  },
  high: {
    pill: 'var(--danger)',
    alert: 'exp-alert',
    label: '高风险',
  },
};

const riskLevelPillColor = (riskLevel: string) =>
  riskLevel === 'high' ? 'var(--danger)' : riskLevel === 'medium' ? 'var(--warning)' : 'var(--success)';

const riskLevelLabel = (riskLevel: string) =>
  riskLevel === 'high' ? '高' : riskLevel === 'medium' ? '中' : '低';

export function FraudReviewCard({
  fraud,
  priceData,
  ceilingPriceWan,
  highlightName,
  bidderCount,
}: {
  fraud: ProjectFraudDetail;
  /** 开标唱标价（万元，权威源）——无开标记录/不可解析的家不进图 */
  priceData: Array<{ name: string; price: number }>;
  ceilingPriceWan: number | null;
  highlightName?: string;
  bidderCount: number;
}) {
  const indicators = fraud.indicators ?? [];
  const highCount = fraud.summary?.highCount ?? indicators.filter((i) => i.severity === 'high').length;
  const mediumCount = fraud.summary?.mediumCount ?? indicators.filter((i) => i.severity === 'medium').length;
  const hasHigh = indicators.some((i) => i.severity === 'high');

  return (
    <div className="neu-card-static space-y-4 p-4">
      {/* 头部：标题 + 风险等级 pill + 指标数 */}
      <div className="flex flex-wrap items-center gap-2">
        <ShieldAlert size={14} strokeWidth={1.5} className="text-[var(--warning)]" />
        <span className="text-sm font-bold text-[var(--foreground)]">合规性审查 · 围标串标风险检测</span>
        <span
          className="exp-pill"
          style={{ '--c': riskLevelPillColor(fraud.riskLevel) } as React.CSSProperties}
        >
          {riskLevelLabel(fraud.riskLevel)}
        </span>
        <span className="ml-auto text-[11px] text-[var(--muted-foreground)]">
          {indicators.length > 0 ? `共 ${indicators.length} 项指标` : '无风险指标'}
        </span>
      </div>

      {/* KPI 行 ×4 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <FieldCard
          icon={<ShieldAlert size={12} />}
          label="风险等级"
          value={riskLevelLabel(fraud.riskLevel)}
        />
        <FieldCard icon={<AlertTriangle size={12} />} label="高风险" value={highCount} />
        <FieldCard icon={<AlertCircle size={12} />} label="中风险" value={mediumCount} />
        <FieldCard icon={<Users size={12} />} label="参评单位" value={bidderCount} />
      </div>

      {/* 综合评估 */}
      {fraud.overallAssessment && (
        <div className="exp-alert exp-alert--info !font-normal">
          <span className="font-semibold">综合评估：</span>
          {fraud.overallAssessment}
        </div>
      )}

      {/* 免责提示 */}
      <div className="exp-alert exp-alert--warn !font-normal">
        检测结果仅作为评审参考线索，不构成违规行为的最终认定。请结合原始投标文件、评审记录和必要的人工复核处理。
      </div>

      {/* 报价分布对比（开标唱标价，万元） */}
      {priceData.length > 0 && (
        <div>
          <hr className="wb-section-rule mb-3" />
          <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-[var(--foreground)]">
            <BarChart3 size={14} strokeWidth={1.5} className="text-[var(--accent-strong)]" />
            报价分布对比（开标唱标价）
          </h4>
          <PriceComparisonChart
            data={priceData}
            maxPrice={ceilingPriceWan}
            highlightName={highlightName}
            unit="万元"
          />
        </div>
      )}

      {/* 风险指标详情 */}
      {indicators.length > 0 && (
        <div>
          <hr className="wb-section-rule mb-3" />
          <h4 className="mb-3 text-sm font-bold text-[var(--foreground)]">风险指标详情</h4>
          <div className="space-y-2.5">
            {indicators.map((indicator, index) => (
              <IndicatorCard
                key={indicator.ruleCode ?? index}
                indicator={indicator}
                defaultOpen={indicator.severity === 'high'}
              />
            ))}
          </div>
        </div>
      )}

      {/* 评审建议（存在高风险时） */}
      {hasHigh && (
        <div>
          <hr className="wb-section-rule mb-3" />
          <h4 className="mb-2 text-sm font-bold text-[var(--foreground)]">评审建议</h4>
          <div className="exp-alert exp-alert--warn !font-normal">
            <p className="mb-1.5">本次检测发现高风险指标，建议：</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>重点核查高风险指标涉及的投标单位</li>
              <li>对比相关投标文件的关键内容，确认是否存在串通行为</li>
              <li>如确认存在串通行为，按相关规定处理</li>
              <li>保留本次检测结果作为评审记录</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 可展开指标卡（高危默认展开；容器 = exp-alert 语义底，同 ConcordanceList 先例）──

function IndicatorCard({
  indicator,
  defaultOpen = false,
}: {
  indicator: FraudIndicatorDetail;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const sev = SEVERITY_CONFIG[indicator.severity] ?? SEVERITY_CONFIG.low;

  const involvedNames = indicator.involvedBidders?.length
    ? indicator.involvedBidders.map((b) => b.name)
    : indicator.affectedBidders;

  const evidenceRows = indicator.evidenceItems?.length
    ? indicator.evidenceItems
    : [
        {
          type: 'format',
          label: '证据',
          value: indicator.evidence,
          bidders: indicator.affectedBidders,
          explanation: indicator.evidence,
        },
      ];

  return (
    <div className={`${sev.alert} !p-3 !font-normal`}>
      {/* 头部（点击展开/收起） */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-full text-left"
        aria-expanded={isOpen}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="exp-pill" style={{ '--c': sev.pill } as React.CSSProperties}>
            {sev.label}
          </span>
          <span className="text-xs font-semibold text-[var(--foreground)]">
            {TYPE_LABELS[indicator.type] ?? indicator.type}
          </span>
          {indicator.ruleCode && (
            <code className="font-mono text-[10px] text-[var(--muted-foreground)]">{indicator.ruleCode}</code>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            {indicator.confidence !== undefined && (
              <span className="text-[11px] text-[var(--muted-foreground)]">
                置信度 {Math.round((indicator.confidence ?? 0) * 100)}%
              </span>
            )}
            <ChevronDown
              size={14}
              className={`text-[var(--muted-foreground)] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
            />
          </span>
        </div>
        <p className="mt-1.5 text-xs text-[var(--foreground)]">{indicator.description}</p>
      </button>

      {/* 展开内容 */}
      {isOpen && (
        <div className="mt-2.5 space-y-2.5">
          {/* 涉及单位 + 复核动作 */}
          <div className="grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2">
            <div className="rounded-[10px] bg-[oklch(1_0_0_/_0.55)] p-2.5">
              <div className="mb-0.5 text-[var(--muted-foreground)]">涉及投标单位</div>
              <div className="font-medium text-[var(--foreground)]">{involvedNames.join('、') || '—'}</div>
            </div>
            <div className="rounded-[10px] bg-[oklch(1_0_0_/_0.55)] p-2.5">
              <div className="mb-0.5 text-[var(--muted-foreground)]">复核动作</div>
              <div className="font-medium text-[var(--accent-strong)]">
                {REVIEW_ACTION_LABELS[indicator.reviewAction ?? ''] ?? indicator.recommendation}
              </div>
            </div>
          </div>

          {/* 证据明细 */}
          {evidenceRows.map((evidence, evidenceIndex) => (
            <div key={evidenceIndex} className="rounded-[10px] bg-[oklch(1_0_0_/_0.55)] p-2.5 text-[11px]">
              <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                <span className="exp-pill" style={{ '--c': 'var(--accent)' } as React.CSSProperties}>
                  {EVIDENCE_TYPE_LABELS[evidence.type] ?? evidence.type}
                </span>
                <span className="font-semibold text-[var(--foreground)]">{evidence.label}</span>
                <span className="text-[var(--foreground)]">{evidence.value}</span>
              </div>
              <div className="text-[var(--muted-foreground)]">{evidence.explanation}</div>
              {evidence.bidders?.length > 0 && (
                <div className="mt-0.5 text-[var(--muted-foreground)]">涉及：{evidence.bidders.join('、')}</div>
              )}
            </div>
          ))}

          {/* 建议 */}
          <div className="text-[11px] text-[var(--accent-strong)]">建议：{indicator.recommendation}</div>
        </div>
      )}
    </div>
  );
}
