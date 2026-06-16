import { Module } from '@nestjs/common';
import { ExpertController } from './expert.controller';
import { ExpertService } from './expert.service';
import { ExpertAdminController } from './expert-admin.controller';
import { ExpertAdminService } from './expert-admin.service';
import { ExpertExtractionAiService } from './expert-extraction-ai.service';
import { ExpertConflictService } from './expert-conflict.service';
import { AuthModule } from '../auth/auth.module';
import { AiModule } from '../ai';
import { NotificationModule } from '../notification/notification.module';
import { BidModule } from '../bid/bid.module';

@Module({
  imports: [AuthModule, AiModule, NotificationModule, BidModule],
  controllers: [ExpertController, ExpertAdminController],
  providers: [ExpertService, ExpertAdminService, ExpertExtractionAiService, ExpertConflictService],
  exports: [ExpertAdminService],
})
export class ExpertModule {}
