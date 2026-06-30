// apps/api/src/ai-bid-analysis/utils/requirement-id.ts
import { createHash } from 'crypto';
import type { TenderRequirements } from '../types';

/** 规范化：去 ★号/空白/标点/小写 → sha256 前 10 位 */
export function stableReqId(category: string, content: string): string {
  const norm = `${category}|${content ?? ''}`.replace(/[★\s\p{P}]/gu, '').toLowerCase();
  return createHash('sha256').update(norm).digest('hex').slice(0, 10);
}

/** 覆盖 requirements 三类条目的 id 为稳定派生值（保留其余字段） */
export function stabilizeRequirements(req: TenderRequirements): TenderRequirements {
  const map = <T extends { content: string }>(arr: T[], category: string): T[] =>
    arr.map((r) => ({ ...r, id: stableReqId(category, r.content) } as T));
  return {
    ...req,
    qualificationRequirements: map(req.qualificationRequirements, 'qualification'),
    technicalRequirements: map(req.technicalRequirements, 'technical'),
    commercialRequirements: map(req.commercialRequirements, 'commercial'),
  };
}
