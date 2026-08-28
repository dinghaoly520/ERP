import { Module } from '@nestjs/common';
import { ExpertController } from './expert.controller';
import { ExpertService } from './expert.service';
import { ExpertAdminController } from './expert-admin.controller';
import { ExpertAdminService } from './expert-admin.service';
import { ExpertExtractionAiService } from './expert-extraction-ai.service';
import { ExpertConflictService } from './expert-conflict.service';
import { ExpertCrossConflictService } from './expert-cross-conflict.service';
import { ExpertMemoService } from './expert-memo.service';
import { AuthModule } from '../auth/auth.module';
import { AiModule } from '../ai';
import { NotificationModule } from '../notification/notification.module';
import { BidModule } from '../bid/bid.module';
import { AiBidAnalysisModule } from '../ai-bid-analysis/ai-bid-analysis.module';
import { TenderClarificationModule } from '../tender-clarification/tender-clarification.module';

@Module({
  imports: [AuthModule, AiModule, NotificationModule, BidModule, AiBidAnalysisModule, TenderClarificationModule],
  controllers: [ExpertController, ExpertAdminController],
  providers: [ExpertService, ExpertAdminService, ExpertExtractionAiService, ExpertConflictService, ExpertCrossConflictService, ExpertMemoService],
  exports: [ExpertAdminService, ExpertMemoService],
})
export class ExpertModule {}
