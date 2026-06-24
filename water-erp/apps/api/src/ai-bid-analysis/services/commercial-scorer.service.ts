// apps/api/src/ai-bid-analysis/services/commercial-scorer.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../local-ai/llm.service';
import { COMMERCIAL_SCORING_PROMPT } from '../prompts/commercial.prompt';
import type { CommercialScore, TenderRequirements } from '../types';
import { deterministicSeed } from '../utils';

@Injectable()
export class CommercialScorerService {
  private readonly logger = new Logger(CommercialScorerService.name);

  constructor(private llmService: LlmService) {}

  async score(
    bidderInfo: any,
    requirements: TenderRequirements | null,
    taskId?: string,
    bidderId?: string,
  ): Promise<CommercialScore> {
    this.logger.log('Scoring commercial...');

    const prompt = COMMERCIAL_SCORING_PROMPT
      .replace('{{REQUIREMENTS}}', JSON.stringify(requirements?.commercialRequirements || [], null, 2))
      .replace('{{BIDDER_INFO}}', JSON.stringify(bidderInfo, null, 2));

    return this.llmService.chatJson<CommercialScore>(
      '你是一个专业的商务评分专家，负责根据招标文件的商务要求对投标单位进行评分。',
      prompt,
      0,
      undefined,
      taskId && bidderId ? deterministicSeed(taskId + ':' + bidderId + ':commercial') : undefined,
    );
  }
}