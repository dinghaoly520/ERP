import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { RedisModule } from '../redis/redis.module';
import { StorageModule } from '../storage/storage.module';
import { LocalAiModule } from '../local-ai/local-ai.module';
import { QUEUE_NAMES } from '../ai-bid-analysis/queues/queue.module';
import { SystemConfigController } from './system-config.controller';
import { SystemConfigService } from './system-config.service';

@Module({
  imports: [
    RedisModule,
    StorageModule,
    LocalAiModule,
    BullModule.registerQueue(
      { name: QUEUE_NAMES.TENDER_PROCESSING },
      { name: QUEUE_NAMES.BIDDER_PROCESSING },
    ),
  ],
  controllers: [SystemConfigController],
  providers: [SystemConfigService],
  exports: [SystemConfigService],
})
export class SystemConfigModule {}
