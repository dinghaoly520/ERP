import { Module } from '@nestjs/common';
import { SupplierPortalController } from './supplier-portal.controller';
import { SupplierPortalService } from './supplier-portal.service';
import { SignatureService } from '../common/crypto/signature.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AnnouncementModule } from '../announcement/announcement.module';

@Module({
  imports: [AuthModule, PrismaModule, AnnouncementModule],
  controllers: [SupplierPortalController],
  providers: [SupplierPortalService, SignatureService],
  exports: [SupplierPortalService],
})
export class SupplierPortalModule {}
