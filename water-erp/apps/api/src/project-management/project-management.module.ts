import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { ArchiveModule } from '../archive/archive.module';
import { PrismaModule } from '../prisma/prisma.module';
import { LocalAiModule } from '../local-ai/local-ai.module';
import { StorageModule } from '../storage/storage.module';
import { ProjectManagementController } from './project-management.controller';
import { StageComplianceConfigService } from './stage-compliance-config.service';
import { StageComplianceController } from './stage-compliance.controller';
import { TimelineService } from './timeline.service';
import { ProjectManagementService } from './project-management.service';
import { TenderDraftService } from './tender-draft.service';
import { GbCodeService } from '../common/gb-code.service';
import { NotificationModule } from '../notification/notification.module';
import { BidModule } from '../bid/bid.module'; // ScoreStandardValidator（评分标准闸，2026-09-24）——已核无反向依赖，无环

@Module({
  imports: [AiModule, AuthModule, KnowledgeModule, LocalAiModule, PrismaModule, StorageModule, ArchiveModule, NotificationModule, BidModule],
  controllers: [StageComplianceController, ProjectManagementController],
  providers: [
    TimelineService,
    GbCodeService, StageComplianceConfigService, ProjectManagementService, TenderDraftService],
  exports: [ProjectManagementService],
})
export class ProjectManagementModule {}
