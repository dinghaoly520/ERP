// apps/api/src/ai-bid-analysis/services/tender-extractor.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../local-ai/llm.service';
import { TENDER_REQUIREMENTS_PROMPT } from '../prompts/tender-requirements.prompt';
import type { TenderRequirements } from '../types';
import { deterministicSeed } from '../utils';
import { stabilizeRequirements } from '../utils/requirement-id';

@Injectable()
export class TenderExtractorService {
  private readonly logger = new Logger(TenderExtractorService.name);

  constructor(private llmService: LlmService) {}

  async extract(text: string, taskId?: string): Promise<TenderRequirements> {
    this.logger.log('Extracting tender requirements...');

    const prompt = TENDER_REQUIREMENTS_PROMPT.replace('{{TENDER_TEXT}}', text);

    const result = await this.llmService.chatJson<TenderRequirements>(
      '你是一个专业的招标文件分析专家，负责从招标文件中提取关键信息。',
      prompt,
      0,
      undefined,
      taskId ? deterministicSeed(taskId + ':tender-extract') : undefined,
    );

    this.logger.log(`Extracted ${result.qualificationRequirements?.length || 0} qualification requirements`);
    this.logger.log(`Extracted ${result.technicalRequirements?.length || 0} technical requirements`);

    return stabilizeRequirements(result);
  }
}
