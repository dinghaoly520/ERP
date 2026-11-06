// apps/api/src/knowledge/queues/knowledge-parse.processor.ts
// 知识库解析后台 processor（2026-11-06 异步化）：由 ai-bid worker 进程承载（2026-11-06 裁定并入，不另起进程）。
// 流程：查行（无/非 PARSING→no-op）→ MinIO 取件 → 解析（onProgress 按 OCR 批次回写页进度）
// → 分块 → 嵌入（失败=降级 indexed:false，非 FAILED——2026-11-03 §4.2 语义）
// → 行置 READY → 向量入库（失败仅 log，reindex 可补）。
// 末次尝试失败 → 行置 FAILED + error（前端可一键重试，重试吃 OCR 批次缓存秒级完成）。
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { DocumentParserService } from '../services/document-parser.service';
import { TextSplitterService } from '../services/text-splitter.service';
import { EmbeddingService } from '../../local-ai/embedding.service';
import { VectorSearchService } from '../services/vector-search.service';
import { KNOWLEDGE_PARSE_QUEUE } from './knowledge-queue.module';

// 478 页扫描件实测 ~12min；lockDuration 15min 容忍长解析（BullMQ 处理期间自动续锁，
// 该值防事件循环被大 buffer 同步操作长阻塞时误判 stalled）。并发默认 1：OCR 服务容量有限。
@Processor(KNOWLEDGE_PARSE_QUEUE, {
  concurrency: Math.max(1, Number(process.env.KNOWLEDGE_PARSE_CONCURRENCY) || 1),
  lockDuration: 900_000,
})
export class KnowledgeParseProcessor extends WorkerHost {
  private readonly logger = new Logger(KnowledgeParseProcessor.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private parser: DocumentParserService,
    private splitter: TextSplitterService,
    private embedding: EmbeddingService,
    private vectorSearch: VectorSearchService,
  ) {
    super();
  }

  async process(job: Job<{ fileId: string }>): Promise<void> {
    const { fileId } = job.data;
    const file = await this.prisma.knowledgeFile.findUnique({ where: { id: fileId } });
    // 行已删（解析中删除）或已非 PARSING（重复 job 重放）→ no-op
    if (!file || file.status !== 'PARSING') {
      this.logger.log(`Skip knowledge-parse job: file ${fileId} ${file ? `status=${file.status}` : 'not found'}`);
      return;
    }

    try {
      const buffer = await this.storage.download(file.objectKey);
      const content = await this.parser.parse(buffer, file.mimeType, file.fileName, (processed, total) => {
        // 进度回写失败不得中断解析（fire-and-forget）；processedPages 仅展示用，乱序无害
        void this.prisma.knowledgeFile
          .update({
            where: { id: fileId },
            data: { processedPages: processed, ...(total > 0 ? { totalPages: total } : {}) },
          })
          .catch(() => undefined);
      });

      const textChunks = this.splitter.split(content);
      let embeddings: number[][] = [];
      let indexed = true;
      if (textChunks.length > 0) {
        try {
          embeddings = await this.embedding.embed(textChunks.map((c) => c.content));
        } catch (err) {
          // 2026-11-03 §4.2 降级：嵌入不可用不翻 FAILED——文件已解析成功，恢复后 reindex 补建
          this.logger.warn(`Embedding degraded for ${file.fileName}: ${err}`);
          embeddings = [];
          indexed = false;
        }
      }

      await this.prisma.knowledgeFile.update({
        where: { id: fileId },
        data: { status: 'READY', content, chunkCount: textChunks.length, indexed, error: null },
      });

      // guard：validateVector(undefined) 会抛 TypeError（旧同步链降级时 insertChunks 实际静默失败）——
      // 嵌入缺失时显式跳过向量入库，reindex 可补
      if (textChunks.length > 0 && embeddings.length === textChunks.length) {
        try {
          await this.vectorSearch.insertChunks(
            textChunks.map((chunk, i) => ({
              collectionName: file.knowledgeBaseId,
              fileId,
              content: chunk.content,
              embedding: embeddings[i],
              metadata: { fileName: file.fileName, startOffset: chunk.startOffset },
            })),
          );
        } catch (err) {
          // 向量失败不翻 FAILED：行已 READY、content 在库，重建索引可补
          this.logger.error(`Vector insert error for ${file.fileName} (reindex 可补): ${err}`);
        }
      } else if (textChunks.length > 0) {
        this.logger.log(`嵌入降级：${file.fileName} 分块未写向量，嵌入恢复后请重建索引`);
      }

      this.logger.log(`Knowledge file ready: ${file.fileName} (${textChunks.length} chunks, indexed=${indexed})`);
    } catch (err) {
      const message = String((err as Error)?.message ?? err).slice(0, 500);
      const attempts = (job.opts?.attempts as number | undefined) ?? 1;
      const isFinal = job.attemptsMade >= attempts;
      if (isFinal) {
        this.logger.error(`Knowledge parse FAILED (attempts ${job.attemptsMade}/${attempts}): ${message}`);
        await this.prisma.knowledgeFile
          .update({ where: { id: fileId }, data: { status: 'FAILED', error: message } })
          .catch((e) => this.logger.error(`FAILED 状态回写亦失败: ${e}`));
        return; // 终局：不 rethrow（removeOnFail 已清 job，死信在 DB）
      }
      this.logger.warn(`Knowledge parse attempt ${job.attemptsMade}/${attempts} failed, will retry: ${message}`);
      throw err; // BullMQ 指数退避重试
    }
  }
}
