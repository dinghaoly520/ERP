import { Module } from '@nestjs/common';
import { SupplierController } from './supplier.controller';
import { SupplierService } from './supplier.service';
import { OwnerGuard } from './owner.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule, PrismaModule, NotificationModule],
  controllers: [SupplierController],
  providers: [SupplierService, OwnerGuard],
  exports: [SupplierService],
})
export class SupplierModule {}