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
import { AiBidAnalysisModule } from '../ai-bid-analysis/ai-bid-analysis.module';
import { ScorePointExtractorService } from './score-point-extractor.service';
import { ScoreStandardValidator } from './score-standard-validator.service';
import { BidBackupModule } from '../bid-backup/bid-backup.module';

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    NotificationModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.TENDER_PROCESSING }),
    AiBidAnalysisModule, // ← 为了注入 PlaintextFetcherService（Task 1: AI 提取得分点）
    BidBackupModule,
  ],
  controllers: [BidController],
  providers: [BidService, BidGateway, ClarificationAiService, ScorePointExtractorService, ScoreStandardValidator],
  exports: [BidGateway, BidService, ClarificationAiService],
})
export class BidModule {}
