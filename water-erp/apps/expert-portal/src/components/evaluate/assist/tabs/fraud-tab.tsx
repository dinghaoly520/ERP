'use client';

import { AlertTriangle, ShieldAlert, Search } from 'lucide-react';
import { AssistKpiCard } from '../charts/assist-kpi-card';

interface FraudTabProps {
  fraudSummary?: {
    riskLevel: string;
    indicatorCount: number;
  } | null;
  riskLevel?: string;
}

const RISK_DIMENSIONS = [
  '报价离散度分析',
  '报价模式检测',
  '联系方式重叠',
  '文档相似度',
  '元数据一致性',
  '价格结构相似度',
];

export function FraudTab({ fraudSummary, riskLevel }: FraudTabProps) {
  const summary = fraudSummary;
  const hasData = summary != null;

  const level = summary?.riskLevel ?? riskLevel ?? 'low';
  const levelLabel = level === 'high' ? '高风险' : level === 'medium' ? '中风险' : '低风险';

  const kpiTone =
    level === 'high' ? 'red' : level === 'medium' ? 'amber' : 'green';

  return (
    <div className="space-y-4">
      {/* 风险等级概览 */}
      <div className="glass-card rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <ShieldAlert size={16} strokeWidth={1.5} className="text-[var(--color-primary)]" />
          <h3 className="font-bold text-[var(--color-text)]">串通检测摘要</h3>
        </div>

        {hasData ? (
          <>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <AssistKpiCard
                label="风险等级"
                value={levelLabel}
                icon={<ShieldAlert size={18} />}
                tone={kpiTone}
              />
              <AssistKpiCard
                label="风险指标"
                value={`${summary.indicatorCount} 项`}
                icon={<AlertTriangle size={18} />}
                tone={summary.indicatorCount > 0 ? 'amber' : 'slate'}
              />
              <AssistKpiCard
                label="检测维度"
                value={`${RISK_DIMENSIONS.length} 维`}
                icon={<Search size={18} />}
                tone="blue"
              />
            </div>

            {/* 检测维度标签 */}
            <div className="mb-4">
              <div className="text-xs text-[var(--color-text-tertiary)] mb-2">检测维度覆盖：</div>
              <div className="flex flex-wrap gap-1.5">
                {RISK_DIMENSIONS.map((dim) => (
                  <span
                    key={dim}
                    className="text-[11px] px-2 py-1 rounded-full border border-[oklch(0.91_0.006_264)] text-[var(--color-text-secondary)] bg-[oklch(0.982_0.003_264)]"
                  >
                    {dim}
                  </span>
                ))}
              </div>
            </div>

            {/* 法律免责声明 */}
            <div className="p-3 rounded-lg border border-amber-200 bg-amber-50">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-700">
                  <p className="font-semibold mb-1">专家端权限说明</p>
                  <p>
                    详细检测结果仅对管理端/监督端可见。专家端仅展示风险摘要与指标计数，不影响您的独立专业判断。如对特定检测结果有疑问，请联系监督人员。
                  </p>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-8">
            <ShieldAlert size={40} strokeWidth={1} className="text-[oklch(0.75_0.008_264)] mx-auto mb-3" />
            <p className="text-sm text-[var(--color-text-secondary)]">
              暂无串通检测数据
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
              串通检测需所有供应商 AI 分析完成后自动生成，基于多维数据交叉比对。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
