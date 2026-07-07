'use client';

import { Sparkles, AlertCircle } from 'lucide-react';
import type { AssistData, BidScoreItem } from '@water-erp/shared';
import { StatusBar } from './status-bar';
import { GateLayer } from './gate-layer';
import { EvidenceLayer } from './evidence-layer';
import { ScoringLayer } from './scoring-layer';
import { CrossBidderLayer } from './cross-bidder-layer';

// ── 类型 ──

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

      {/* ② 证据 */}
      <EvidenceLayer assistData={assistData} supplierName={supplierName} />

      {/* ③ 打分层（客观价格/主观商务技术/综合） */}
      <ScoringLayer
        assistData={assistData}
        expertScores={expertScores}
        activeSupplier={activeSupplier}
        projectScoreItems={projectScoreItems}
      />

      {/* ── 单供应商区 / 跨供应商区分隔线 ── */}
      <div className="relative pt-6">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="w-full border-t border-[oklch(0.91_0.006_264)]" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-[oklch(0.975_0.012_258)] px-4 text-xs font-medium text-[var(--color-text-tertiary)]">
            跨供应商对比
          </span>
        </div>
      </div>

      {/* ④ 横向对比 */}
      <CrossBidderLayer projectId={projectId} activeSupplier={activeSupplier} />

      {/* 页脚声明 */}
      <div className="text-xs text-[var(--color-text-tertiary)] text-center pt-2 border-t border-[oklch(0.91_0.006_264)]">
        以上结果由 AI（大模型 + 文档识别）辅助生成，仅供参考，以专家独立评分为准。
      </div>
    </div>
  );
}
