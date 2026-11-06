// apps/api/src/knowledge/queues/knowledge-queue.module.ts
// 知识库解析异步化（2026-11-06）：BullMQ 队列注册。
// 生产者：KnowledgeService（API 进程，经 AppModule 的 BullModule.forRoot）；
// 消费者：KnowledgeParseProcessor（ai-bid worker 进程，见 ai-bid-analysis-worker.module.ts）。
// payload 仅 { fileId }——大文件 buffer 禁止入队，worker 自行从 MinIO 取。
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

export const KNOWLEDGE_PARSE_QUEUE = 'knowledge-parse';

/** 入队方（KnowledgeService）统一使用的 job 选项：
 *  - jobId=fileId：BullMQ 同 id 在队/运行中时 add 被忽略——并发重复上传双保险之一（另一层=同库 sha256 去重）
 *  - attempts=3 + 指数退避：OCR 服务抖动自愈；末次失败由 processor 落 FAILED（死信可见性走 DB，不依赖 failed 集）
 *  - removeOnComplete/removeOnFail=true：完成/失败即清——jobId 可被 retry 端点复用 */
export function parseJobOptions(fileId: string) {
  return {
    jobId: fileId,
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 30_000 },
    removeOnComplete: true,
    removeOnFail: true,
  };
}

@Module({
  imports: [BullModule.registerQueue({ name: KNOWLEDGE_PARSE_QUEUE })],
  exports: [BullModule],
})
export class KnowledgeQueueModule {}
