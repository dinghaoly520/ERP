import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
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
import { AuthGuard } from './auth/auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
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
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
