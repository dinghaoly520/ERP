import { Global, Module } from '@nestjs/common';
import { LlmOutputValidator } from './llm-output-validator';
import { LlmService } from './llm.service';
import { OcrService } from './ocr.service';
import { EmbeddingService } from './embedding.service';
import { VllmMonitorService } from './vllm-monitor.service';

/**
 * LocalAiModule — LLM + OCR + Embedding 服务
 *
 * v4.1+ 合并方案：从 procurement 项目迁入 EmbeddingService（知识库 RAG 需要）
 */
@Global()
@Module({
  providers: [LlmService, LlmOutputValidator, OcrService, EmbeddingService, VllmMonitorService],
  exports: [LlmService, LlmOutputValidator, OcrService, EmbeddingService, VllmMonitorService],
})
export class LocalAiModule {}
