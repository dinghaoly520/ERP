// apps/api/src/ai-bid-analysis-worker.module.ts
// AI 投标分析 worker 独立进程（Phase 5）
// 注册 BullMQ（Redis 连接）+ processors（TenderProcessor/BidderProcessor）+ 复用 AiBidAnalysisModule 的 services
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma/prisma.module';
import { LocalAiModule } from './local-ai/local-ai.module';
import { StorageModule } from './storage/storage.module';
import { AiBidAnalysisModule } from './ai-bid-analysis/ai-bid-analysis.module';
import { AiBidQueueModule } from './ai-bid-analysis/queues/queue.module';
import { TenderProcessor } from './ai-bid-analysis/queues/tender.processor';
import { BidderProcessor } from './ai-bid-analysis/queues/bidder.processor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL || 'redis://localhost:6380',
      },
    }),
    PrismaModule,
    LocalAiModule,
    StorageModule,
    AiBidAnalysisModule,
    AiBidQueueModule,
  ],
  providers: [TenderProcessor, BidderProcessor],
})
export class AiBidAnalysisWorkerModule {}
