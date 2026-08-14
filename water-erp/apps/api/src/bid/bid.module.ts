import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BidController } from './bid.controller';
import { BidService } from './bid.service';
import { BidScoreStandardService } from './bid-score-standard.service';
import { BidSignPacketController } from './bid-sign-packet.controller';
import { BidSignPacketService } from './bid-sign-packet.service';
import { BidSignPacketDocxService } from './bid-sign-packet-docx.service';
import { BidGateway } from './bid.gateway';
import { ClarificationAiService } from './clarification-ai.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { QUEUE_NAMES } from '../ai-bid-analysis/queues/queue.module';
import { AiBidAnalysisModule } from '../ai-bid-analysis/ai-bid-analysis.module';
import { ScorePointExtractorService } from './score-point-extractor.service';
import { ScoreStandardValidator } from './score-standard-validator.service';
import { PriceFormulaService } from './price-formula.service';
import { BidBackupModule } from '../bid-backup/bid-backup.module';

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    NotificationModule,
    BullModule.registerQueue(
      { name: QUEUE_NAMES.TENDER_PROCESSING },
      { name: QUEUE_NAMES.BIDDER_PROCESSING }, // 单家重试 AI 分析（retryAiBidders）
    ),
    AiBidAnalysisModule, // ← 为了注入 PlaintextFetcherService（Task 1: AI 提取得分点）
    BidBackupModule,
  ],
  controllers: [BidController, BidSignPacketController],
  providers: [BidService, BidScoreStandardService, BidGateway, ClarificationAiService, ScorePointExtractorService, ScoreStandardValidator, PriceFormulaService, BidSignPacketService, BidSignPacketDocxService],
  exports: [BidGateway, BidService, ClarificationAiService],
})
export class BidModule {}
