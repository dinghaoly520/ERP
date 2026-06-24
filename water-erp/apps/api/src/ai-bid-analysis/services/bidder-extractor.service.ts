// apps/api/src/ai-bid-analysis/services/bidder-extractor.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../local-ai/llm.service';
import { BIDDER_INFO_PROMPT } from '../prompts/bidder-info.prompt';
import type { BidderKeyInfo, TenderRequirements } from '../types';
import { deterministicSeed } from '../utils';

@Injectable()
export class BidderExtractorService {
  private readonly logger = new Logger(BidderExtractorService.name);

  constructor(private llmService: LlmService) {}

  async extract(
    text: string,
    bidderName: string,
    requirements: TenderRequirements | null,
    taskId?: string,
  ): Promise<{ keyInfo: BidderKeyInfo; extractedInfo: any }> {
    this.logger.log(`Extracting info for ${bidderName}...`);

    const prompt = BIDDER_INFO_PROMPT
      .replace('{{BIDDER_NAME}}', bidderName)
      .replace('{{BIDDER_TEXT}}', text);

    const result = await this.llmService.chatJson<{
      keyInfo: BidderKeyInfo;
      [key: string]: any;
    }>(
      '你是一个专业的投标文件分析专家，负责从投标文件中提取关键信息。',
      prompt,
      0,
      undefined,
      taskId ? deterministicSeed(taskId + ':' + bidderName + ':extract') : undefined,
    );

    return {
      keyInfo: result.keyInfo,
      extractedInfo: result,
    };
  }
}