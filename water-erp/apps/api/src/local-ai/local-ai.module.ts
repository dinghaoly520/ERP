import { Module } from '@nestjs/common';
import { LlmOutputValidator } from './llm-output-validator';
import { LlmService } from './llm.service';
import { OcrService } from './ocr.service';

/**
 * LocalAiModule（DeepSeek-only 精简版）
 *
 * 移植自 procurement local-ai.module.ts，按 v4.1 方案 8.1 精简：
 *  - 剥离 VllmMonitorService / EmbeddingService（ERP 无 vLLM 基建）
 *  - 剥离 ScheduleModule（原为 vllm-monitor 定时轮询用）
 */
@Module({
  providers: [LlmService, LlmOutputValidator, OcrService],
  exports: [LlmService, LlmOutputValidator, OcrService],
})
export class LocalAiModule {}
