// apps/api/src/ai-bid-analysis/prompts/index.ts
export * from './tender-requirements.prompt';
export * from './bidder-info.prompt';
export * from './competitive-analysis.prompt';
export * from './comparative-scoring.prompt';

/**
 * P0-D：各 prompt 的版本号快照（写进 task.aiProvenance）。
 * 改 prompt 时 bump 对应 key，归档报告据此披露所用 prompt 版本。
 */
export const PROMPT_VERSIONS = {
  tenderRequirements: 'v1',
  bidderInfo: 'v1',
  competitiveAnalysis: 'v1',
  comparativeScoring: 'v1',
  itemScoring: 'v1',
  priceAnalysis: 'v1',
  requirementMatching: 'v1',
  scoreCriteria: 'v1',
} as const;
