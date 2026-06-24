import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { RedisModule } from './redis/redis.module';
import { VerificationModule } from './verification/verification.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { BidModule } from './bid/bid.module';
import { SupplierModule } from './supplier/supplier.module';
import { NotificationModule } from './notification/notification.module';
import { UploadModule } from './upload/upload.module';
import { AnnouncementModule } from './announcement/announcement.module';
import { SupplierPortalModule } from './supplier-portal/supplier-portal.module';
import { ExpertModule } from './expert/expert.module';
import { AiModule } from './ai';
import { ProcurementModule } from './procurement/procurement.module';
import { CatalogModule } from './catalog/catalog.module';
import { BudgetModule } from './budget/budget.module';
import { AuditModule } from './audit/audit.module';
import { AssistantModule } from './assistant/assistant.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { AlertsModule } from './alerts/alerts.module';
import { LocalAiModule } from './local-ai/local-ai.module';
import { StorageModule } from './storage/storage.module';
import { AiBidAnalysisModule } from './ai-bid-analysis/ai-bid-analysis.module';
import { AuthGuard } from './auth/auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
    PrismaModule,
    RedisModule,
    VerificationModule,
    AuthModule,
    BidModule,
    SupplierModule,
    NotificationModule,
    UploadModule,
    AnnouncementModule,
    SupplierPortalModule,
    ExpertModule,
    AiModule,
    ProcurementModule,
    CatalogModule,
    BudgetModule,
    AuditModule,
    AssistantModule,
    SchedulerModule,
    AlertsModule,
    LocalAiModule,
    StorageModule,
    AiBidAnalysisModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
