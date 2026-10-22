import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { LocalAiModule } from '../local-ai/local-ai.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { ProgressModule } from '../progress/progress.module';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { SupplierSelectionAiService } from './supplier-selection-ai.service';
import { SupplierEvaluationAnalysisService } from './supplier-evaluation-analysis.service';
import { SupplierPortraitAnalysisService } from './supplier-portrait-analysis.service';
import { InvitationLetterService } from './invitation-letter.service';
import { SupplierQualificationMatchService } from './supplier-qualification-match.service';
import { MobileGreetingService } from './mobile-greeting.service';
import { MobileBriefService } from './mobile-brief.service';

@Module({
  // CompanyScopeService 来自 @Global 的 CompanyScopeModule（app.module 注册），无需在此 import。
  // ProgressModule 亦 import 本模块（ProgressService 依赖 AiService）——环引用两侧 forwardRef。
  imports: [PrismaModule, NotificationModule, LocalAiModule, DashboardModule, forwardRef(() => ProgressModule)],
  controllers: [AiController],
  providers: [AiService, SupplierSelectionAiService, SupplierEvaluationAnalysisService, SupplierPortraitAnalysisService, InvitationLetterService, SupplierQualificationMatchService, MobileGreetingService, MobileBriefService],
  exports: [AiService],
})
export class AiModule {}
