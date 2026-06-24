// apps/api/src/ai-bid-analysis/services/technical-scorer.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../local-ai/llm.service';
import { TECHNICAL_SCORING_PROMPT } from '../prompts/technical.prompt';
import type { TechnicalScore, TenderRequirements } from '../types';
import { deterministicSeed } from '../utils';

@Injectable()
export class TechnicalScorerService {
  private readonly logger = new Logger(TechnicalScorerService.name);

  constructor(private llmService: LlmService) {}

  async score(
    bidderInfo: any,
    requirements: TenderRequirements | null,
    taskId?: string,
    bidderId?: string,
  ): Promise<TechnicalScore> {
    this.logger.log('Scoring technical...');

    const prompt = TECHNICAL_SCORING_PROMPT
      .replace('{{REQUIREMENTS}}', JSON.stringify(requirements?.technicalRequirements || [], null, 2))
      .replace('{{BIDDER_INFO}}', JSON.stringify(bidderInfo, null, 2));

    return this.llmService.chatJson<TechnicalScore>(
      '你是一个专业的技术评分专家，负责根据招标文件的技术要求对投标单位进行评分。',
      prompt,
      0,
      undefined,
      taskId && bidderId ? deterministicSeed(taskId + ':' + bidderId + ':tech') : undefined,
    );
  }
}