import { Module } from '@nestjs/common';
import { SupplierPortalController } from './supplier-portal.controller';
import { SupplierPortalService } from './supplier-portal.service';
import { ObjectionController } from './objection.controller';
import { ObjectionService } from './objection.service';
import { SignatureService } from '../common/crypto/signature.service';
import { DualEnvelopeService } from '../common/crypto/dual-envelope.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AnnouncementModule } from '../announcement/announcement.module';
import { BidBackupModule } from '../bid-backup/bid-backup.module';
import { BidModule } from '../bid/bid.module';
import { NotificationModule } from '../notification/notification.module';
import { PrequalModule } from '../prequal/prequal.module';
import { FrameworkModule } from '../framework/framework.module';
import { PerformanceModule } from '../performance/performance.module';

@Module({
  imports: [AuthModule, PrismaModule, AnnouncementModule, BidBackupModule, BidModule, NotificationModule, PrequalModule, FrameworkModule, PerformanceModule],
  controllers: [SupplierPortalController, ObjectionController],
  providers: [SupplierPortalService, ObjectionService, SignatureService, DualEnvelopeService],
  exports: [SupplierPortalService, ObjectionService, DualEnvelopeService],
})
export class SupplierPortalModule {}
