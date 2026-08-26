import { Module } from '@nestjs/common';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { WorkflowModule } from './workflow/workflow.module';
import { RedisModule } from './redis/redis.module';
import { VerificationModule } from './verification/verification.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CompanyScopeModule } from './company/company-scope';
import { BidModule } from './bid/bid.module';
import { SupplierModule } from './supplier/supplier.module';
import { NotificationModule } from './notification/notification.module';
import { UploadModule } from './upload/upload.module';
import { AnnouncementModule } from './announcement/announcement.module';
import { SupplierPortalModule } from './supplier-portal/supplier-portal.module';
import { ContractModule } from './contract/contract.module';
import { PrequalModule } from './prequal/prequal.module';
import { FrameworkModule } from './framework/framework.module';
import { PerformanceModule } from './performance/performance.module';
import { ExpertModule } from './expert/expert.module';
import { AiModule } from './ai';
import { ProcurementModule } from './procurement/procurement.module';
import { ProcurementsModule } from './procurements/procurements.module';
import { CatalogModule } from './catalog/catalog.module';
import { BudgetModule } from './budget/budget.module';
import { AuditModule } from './audit/audit.module';
import { OperationLogModule } from './operation-log/operation-log.module';
import { AssistantModule } from './assistant/assistant.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { AlertsModule } from './alerts/alerts.module';
import { LocalAiModule } from './local-ai/local-ai.module';
import { StorageModule } from './storage/storage.module';
import { AiBidAnalysisModule } from './ai-bid-analysis/ai-bid-analysis.module';
import { BullModule } from '@nestjs/bullmq';
import { AuthGuard } from './auth/auth.guard';
import { PortRouteGuard } from './auth/port-route.guard';
import { RolesGuard } from './common/guards/roles.guard';
// ── 采购中心迁入模块 ──
import { ContactsModule } from './contacts/contacts.module';
import { UserSettingsModule } from './user-settings/user-settings.module';
import { TenderSampleModule } from './tender-sample/tender-sample.module';
import { TenderHistoryModule } from './tender-history/tender-history.module';
import { ProgressModule } from './progress/progress.module';
import { ImportsModule } from './imports/imports.module';
import { WorkArrangementsModule } from './work-arrangements/work-arrangements.module';
import { ProjectManagementModule } from './project-management/project-management.module';
import { ProjectPlanModule } from './project-plan/project-plan.module';
import { ArchiveModule } from './archive/archive.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { TenderReviewModule } from './tender-review/tender-review.module';
import { TenderWriteModule } from './tender-write/tender-write.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SearchModule } from './search/search.module';
import { ChatModule } from './chat/chat.module';
import { OpeningHallModule } from './opening-hall/opening-hall.module';
import { SystemConfigModule } from './system-config/system-config.module';
import { BadgeModule } from './badge/badge.module';
import { AppController } from './app.controller';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL || 'redis://localhost:6380',
      },
    }),
    // 全局限流（CTS 4.8）；压测/性能验证可经 THROTTLE_LIMIT 临时调高
    ThrottlerModule.forRoot([
      { ttl: Number(process.env.THROTTLE_TTL_MS ?? 60000), limit: Number(process.env.THROTTLE_LIMIT ?? 120) },
    ]),
    PrismaModule,
    CompanyScopeModule,
    RedisModule,
    VerificationModule,
    AuthModule,
    BidModule,
    SupplierModule,
    NotificationModule,
    UploadModule,
    AnnouncementModule,
    SupplierPortalModule,
    ContractModule,
    PrequalModule,
    FrameworkModule,
    PerformanceModule,
    ExpertModule,
    AiModule,
    ProcurementModule,
    ProcurementsModule,
    CatalogModule,
    BudgetModule,
    AuditModule,
    OperationLogModule,
    AssistantModule,
    SchedulerModule,
    AlertsModule,
    LocalAiModule,
    StorageModule,
    AiBidAnalysisModule,
    // ── 采购中心迁入模块 ──
    ContactsModule,
    UserSettingsModule,
    TenderSampleModule,
    TenderHistoryModule,
    ProgressModule,
    ImportsModule,
    WorkArrangementsModule,
    ProjectManagementModule,
    ProjectPlanModule,
    ArchiveModule,
    KnowledgeModule,
    TenderReviewModule,
    TenderWriteModule,
    DashboardModule,
    SearchModule,
    ChatModule,
    OpeningHallModule,
    SystemConfigModule,
    BadgeModule,
    WorkflowModule,
  ],
    controllers: [AppController],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PortRouteGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
