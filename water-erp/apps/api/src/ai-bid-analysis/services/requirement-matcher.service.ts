import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../local-ai/llm.service';
import { REQUIREMENT_MATCHING_PROMPT } from '../prompts/requirement-matching.prompt';
import { deterministicSeed } from '../utils';
import type { TenderRequirements } from '../types';
import type { RequirementResponse } from '@water-erp/shared';

interface PageInput { file: string; page: number; text: string }
interface FileIdMap { technical: string | null; business: string | null }

@Injectable()
export class RequirementMatcherService {
  private readonly logger = new Logger(RequirementMatcherService.name);
  constructor(private llmService: LlmService) {}

  async match(req: TenderRequirements, pages: PageInput[], fileIds: FileIdMap, taskId?: string): Promise<RequirementResponse[]> {
    const flat = this.flattenRequirements(req); // [{ seq, requirementId(stable), category, tenderContent, isStarred }]
    if (flat.length === 0 || pages.length === 0) return [];

    // prompt 只给 seq+content+isStarred（不暴露 hash id；LLM 回填小整数 seq 比 hash 可靠）
    const prompt = REQUIREMENT_MATCHING_PROMPT
      .replace('{{REQUIREMENTS}}', JSON.stringify(flat.map((f) => ({ seq: f.seq, content: f.tenderContent, isStarred: f.isStarred }))))
      .replace('{{PAGES}}', JSON.stringify(pages));

    const result = await this.llmService.chatJson<{ responses: Array<{ seq: number; status: any; excerpt: string; file: string | null; page: number | null; confidence: number }> }>(
      '你是招投标响应核查专家。',
      prompt, 0, undefined,
      taskId ? deterministicSeed(taskId + ':req-match') : undefined,
    );

    const bySeq = new Map(flat.map((f) => [f.seq, f]));
    const seenIds = new Set<string>(); // Fix 5: requirementId 去重
    return (result.responses ?? [])
      .map((r): RequirementResponse | null => {
        // Fix 4: 强制 seq 为整数；LLM 偶发返回字符串 seq（如 "3"），Map key 是 number 会导致静默丢失
        const seqNum = Number(r.seq);
        if (!Number.isInteger(seqNum)) {
          this.logger.warn(`matcher: dropped response, non-integer seq=${JSON.stringify(r.seq)}`);
          return null;
        }
        const meta = bySeq.get(seqNum);
        if (!meta) return null; // LLM 回填未知 seq → 丢弃
        const fileId = r.file ? (r.file === 'technical' ? fileIds.technical : r.file === 'business' ? fileIds.business : null) : null;
        const location = fileId && typeof r.page === 'number' ? { fileId, page: r.page } : null;
        return {
          requirementId: meta.requirementId,
          category: meta.category,
          tenderContent: meta.tenderContent,
          isStarred: meta.isStarred,
          status: r.status,
          excerpt: r.excerpt ?? '',
          location,
          confidence: r.confidence ?? 0,
        };
      })
      // Fix 5: 按 requirementId 去重（LLM 返回两条同 seq 会产生重复 requirementId 行）
      .filter((x): x is RequirementResponse => {
        if (!x || seenIds.has(x.requirementId)) return false;
        seenIds.add(x.requirementId);
        return true;
      });
  }

  private flattenRequirements(req: TenderRequirements): Array<{ seq: number; requirementId: string; category: any; tenderContent: string; isStarred: boolean }> {
    let seq = 0;
    const take = () => ++seq;
    return [
      ...(req.qualificationRequirements ?? []).map((r) => ({ seq: take(), requirementId: r.id, category: 'qualification' as const, tenderContent: r.content, isStarred: false })),
      ...(req.technicalRequirements ?? []).map((r) => ({ seq: take(), requirementId: r.id, category: 'technical' as const, tenderContent: r.content, isStarred: !!r.isStarred })),
      ...(req.commercialRequirements ?? []).map((r) => ({ seq: take(), requirementId: r.id, category: 'commercial' as const, tenderContent: r.content, isStarred: false })),
    ];
  }
}
