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

const DOT_DELAYS = ['[animation-delay:0s]', '[animation-delay:0.15s]', '[animation-delay:0.3s]'];

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
        <div className="py-16 text-center">
          <div className="mb-5">
            <Sparkles size={48} strokeWidth={1} className="mx-auto animate-pulse text-[var(--accent-strong)]" />
          </div>
          <p className="text-lg font-semibold text-[var(--foreground)]">AI 正在分析投标文件…</p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            正在生成 compliance 检查、风险分析与评分建议，请耐心等待
          </p>
          <div className="mt-5 flex justify-center gap-1.5">
            {DOT_DELAYS.map((delay, i) => (
              <div
                key={i}
                className={`h-2.5 w-2.5 animate-bounce rounded-full bg-[var(--accent-strong)]/50 ${delay}`}
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
        <div className="py-16 text-center">
          <div className="mb-4">
            <Sparkles size={48} strokeWidth={1} className="mx-auto opacity-50" />
          </div>
          <p className="text-[var(--muted-foreground)]">请先在上方选择一个投标单位</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
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
        <div className="neu-card-static p-8 text-center">
          <AlertCircle size={32} strokeWidth={1} className="mx-auto mb-3 text-[var(--warning)]" />
          <p className="text-sm text-[var(--muted-foreground)]">AI 深度分析尚未完成，当前使用规则引擎降级结果</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            请等待 AI 分析完成或联系管理员触发分析任务
          </p>
          <button
            onClick={onRetry}
            className="mt-3 text-xs font-semibold text-[var(--accent-strong)] hover:underline"
          >
            重新加载
          </button>
        </div>
        <div className="mt-4 pt-3 text-center text-xs text-[var(--muted-foreground)]">
          <hr className="wb-section-rule mb-3" />
          以上结果由 AI（大模型 + 文档识别）辅助生成，仅供参考，以专家独立评分为准。
        </div>
      </div>
    );
  }

  // ── 正常态：垂直分区滚动页 ──
  return (
    <div className="space-y-6 p-5">
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
      <div className="flex items-center gap-4 pt-2">
        <span className="wb-section-rule flex-1" />
        <span className="text-xs font-medium text-[var(--muted-foreground)]">跨供应商对比</span>
        <span className="wb-section-rule flex-1" />
      </div>

      {/* ④ 横向对比 */}
      <CrossBidderLayer projectId={projectId} activeSupplier={activeSupplier} />

      {/* 页脚声明 */}
      <div className="pt-2 text-center text-xs text-[var(--muted-foreground)]">
        <hr className="wb-section-rule mb-3" />
        以上结果由 AI（大模型 + 文档识别）辅助生成，仅供参考，以专家独立评分为准。
      </div>
    </div>
  );
}
