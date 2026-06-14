import { Module } from '@nestjs/common';
import { SupplierPortalController } from './supplier-portal.controller';
import { SupplierPortalService } from './supplier-portal.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AnnouncementModule } from '../announcement/announcement.module';

@Module({
  imports: [AuthModule, PrismaModule, AnnouncementModule],
  controllers: [SupplierPortalController],
  providers: [SupplierPortalService],
  exports: [SupplierPortalService],
})
export class SupplierPortalModule {}
