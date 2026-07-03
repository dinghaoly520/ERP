// apps/api/src/ai-bid-analysis/utils/archive-ai-usage.ts
// P0-D：归档导出「AI 辅助说明」节 —— 模型/prompt 版本快照 + 每家供应商 AI 评分摘要。
// 纯函数：从 task.aiProvenance + AiBidderResult[] 组装可序列化的 AI 使用说明，
// 无 provenance 且无 bidders 时返回 null（项目未跑 AI 分析，归档节略）。
export interface AiProvenance {
  model?: string;
  modelVersion?: string;
  ranAt?: string;
  promptVersions?: Record<string, string>;
}

export interface ArchiveAiSupplier {
  name: string;
  aiScoredItemsCount: number;
  aiSuggestedTotal: number | null;
}

export interface ArchiveAiUsage {
  model: string | null;
  modelVersion: string | null;
  ranAt: string | null;
  promptVersions: Record<string, string>;
  suppliers: ArchiveAiSupplier[];
}

interface BidderInput {
  totalScore?: number | string | null;
  scoreItems?: unknown[] | null;
  bidSupplier: { supplierName: string };
}

export function buildArchiveAiUsage(
  provenance: AiProvenance | null | undefined,
  bidders: BidderInput[],
): ArchiveAiUsage | null {
  const hasProvenance = !!provenance && Object.keys(provenance).length > 0;
  if (!hasProvenance && (!bidders || bidders.length === 0)) return null;

  return {
    model: provenance?.model ?? null,
    modelVersion: provenance?.modelVersion ?? null,
    ranAt: provenance?.ranAt ?? null,
    promptVersions: provenance?.promptVersions ?? {},
    suppliers: (bidders ?? []).map((b) => {
      const total = b.totalScore != null ? Number(b.totalScore) : NaN;
      return {
        name: b.bidSupplier?.supplierName ?? '',
        aiScoredItemsCount: Array.isArray(b.scoreItems) ? b.scoreItems.length : 0,
        aiSuggestedTotal: !Number.isNaN(total) ? Math.round(total * 10) / 10 : null,
      };
    }),
  };
}
