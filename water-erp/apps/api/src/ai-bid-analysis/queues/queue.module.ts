// apps/api/src/ai-bid-analysis/queues/queue.module.ts
// BullMQ 队列注册（复用 procurement，3 队列）
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

export const QUEUE_NAMES = {
  TENDER_PROCESSING: 'ai-tender-processing',
  BIDDER_PROCESSING: 'ai-bidder-processing',
  ANALYSIS_PROCESSING: 'ai-analysis-processing',
} as const;

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_NAMES.TENDER_PROCESSING },
      { name: QUEUE_NAMES.BIDDER_PROCESSING },
      { name: QUEUE_NAMES.ANALYSIS_PROCESSING },
    ),
  ],
  exports: [BullModule],
})
export class AiBidQueueModule {}
