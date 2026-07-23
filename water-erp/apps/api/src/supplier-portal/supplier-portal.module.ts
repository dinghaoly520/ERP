import { Module } from '@nestjs/common';
import { SupplierPortalController } from './supplier-portal.controller';
import { SupplierPortalService } from './supplier-portal.service';
import { SignatureService } from '../common/crypto/signature.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AnnouncementModule } from '../announcement/announcement.module';
import { BidBackupModule } from '../bid-backup/bid-backup.module';

@Module({
  imports: [AuthModule, PrismaModule, AnnouncementModule, BidBackupModule],
  controllers: [SupplierPortalController],
  providers: [SupplierPortalService, SignatureService],
  exports: [SupplierPortalService],
})
export class SupplierPortalModule {}
