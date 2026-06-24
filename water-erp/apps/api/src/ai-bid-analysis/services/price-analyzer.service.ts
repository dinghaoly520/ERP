// apps/api/src/ai-bid-analysis/services/price-analyzer.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../local-ai/llm.service';
import { PRICE_ANALYSIS_PROMPT } from '../prompts/price.prompt';
import type { PriceScore, TenderRequirements } from '../types';
import { deterministicSeed } from '../utils';

@Injectable()
export class PriceAnalyzerService {
  private readonly logger = new Logger(PriceAnalyzerService.name);

  constructor(private llmService: LlmService) {}

  async analyze(
    bidderInfo: any,
    requirements: TenderRequirements | null,
    taskId?: string,
    bidderId?: string,
  ): Promise<PriceScore> {
    this.logger.log('Analyzing price...');

    // 构建包含招标要求的 prompt
    let prompt = PRICE_ANALYSIS_PROMPT
      .replace('{{BIDDER_INFO}}', JSON.stringify(bidderInfo, null, 2));

    // 如果有招标要求，添加价格评审规则
    if (requirements) {
      const priceRules = {
        priceEvaluationMethod: requirements.priceEvaluationMethod,
        scoringRules: requirements.scoringRules,
        estimatedCost: requirements.estimatedCost,
        maxPrice: requirements.maxPrice,
      };
      prompt = prompt.replace(
        '{{PRICE_RULES}}',
        JSON.stringify(priceRules, null, 2)
      );
    } else {
      prompt = prompt.replace('{{PRICE_RULES}}', '无招标文件价格评审规则');
    }

    return this.llmService.chatJson<PriceScore>(
      '你是一个专业的价格分析专家，负责根据招标文件的价格评审规则对投标报价进行分析和评分。',
      prompt,
      0,
      undefined,
      taskId && bidderId ? deterministicSeed(taskId + ':' + bidderId + ':price') : undefined,
    );
  }
}