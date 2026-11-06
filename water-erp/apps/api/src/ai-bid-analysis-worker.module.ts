// apps/api/src/ai-bid-analysis-worker.module.ts
// AI 投标分析 worker 独立进程（Phase 5）
// 注册 BullMQ（Redis 连接）+ processors（TenderProcessor/BidderProcessor）+ 复用 AiBidAnalysisModule 的 services
// 2026-11-06 起：并载知识库解析队列 knowledge-parse（异步化裁定并入本进程，不另起 worker）
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { RedisModule } from './redis/redis.module';
import { PrismaModule } from './prisma/prisma.module';
import { PrismaService } from './prisma/prisma.service';
import { LocalAiModule } from './local-ai/local-ai.module';
import { StorageModule } from './storage/storage.module';
import { AiBidAnalysisModule } from './ai-bid-analysis/ai-bid-analysis.module';
import { AiBidQueueModule } from './ai-bid-analysis/queues/queue.module';
import { TenderProcessor } from './ai-bid-analysis/queues/tender.processor';
import { BidderProcessor } from './ai-bid-analysis/queues/bidder.processor';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { KnowledgeQueueModule } from './knowledge/queues/knowledge-queue.module';
import { KnowledgeParseProcessor } from './knowledge/queues/knowledge-parse.processor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL || 'redis://localhost:6380',
      },
    }),
    PrismaModule,
    RedisModule,
    LocalAiModule,
    StorageModule,
    AiBidAnalysisModule,
    AiBidQueueModule,
    KnowledgeModule,
    KnowledgeQueueModule,
  ],
  providers: [PrismaService, TenderProcessor, BidderProcessor, KnowledgeParseProcessor],
})
export class AiBidAnalysisWorkerModule {}
