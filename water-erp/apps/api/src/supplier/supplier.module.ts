import { Module } from '@nestjs/common';
import { SupplierController } from './supplier.controller';
import { SupplierService } from './supplier.service';
import { RsvpController } from './rsvp.controller';
import { RsvpService } from './rsvp.service';
import { OwnerGuard } from './owner.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { AuthModule } from '../auth/auth.module';
import { VerificationModule } from '../verification/verification.module';
import { ProjectManagementModule } from '../project-management/project-management.module';

@Module({
  imports: [AuthModule, PrismaModule, NotificationModule, VerificationModule, ProjectManagementModule],
  controllers: [SupplierController, RsvpController],
  providers: [SupplierService, RsvpService, OwnerGuard],
  exports: [SupplierService, RsvpService],
})
export class SupplierModule {}