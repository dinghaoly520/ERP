import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BidController } from './bid.controller';
import { BidService } from './bid.service';
import { BidGateway } from './bid.gateway';
import { ClarificationAiService } from './clarification-ai.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { QUEUE_NAMES } from '../ai-bid-analysis/queues/queue.module';

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    NotificationModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.TENDER_PROCESSING }),
  ],
  controllers: [BidController],
  providers: [BidService, BidGateway, ClarificationAiService],
  exports: [BidGateway, BidService, ClarificationAiService],
})
export class BidModule {}
