import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { LocalAiModule } from '../local-ai/local-ai.module';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { SupplierSelectionAiService } from './supplier-selection-ai.service';
import { SupplierEvaluationAnalysisService } from './supplier-evaluation-analysis.service';
import { SupplierPortraitAnalysisService } from './supplier-portrait-analysis.service';
import { InvitationLetterService } from './invitation-letter.service';
import { SupplierQualificationMatchService } from './supplier-qualification-match.service';

@Module({
  imports: [PrismaModule, NotificationModule, LocalAiModule],
  controllers: [AiController],
  providers: [AiService, SupplierSelectionAiService, SupplierEvaluationAnalysisService, SupplierPortraitAnalysisService, InvitationLetterService, SupplierQualificationMatchService],
  exports: [AiService],
})
export class AiModule {}
