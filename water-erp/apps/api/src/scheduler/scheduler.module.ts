import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { OutboxDispatchService } from './outbox-dispatch.service';
import { StagingCleanupService } from './staging-cleanup.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { ExpertModule } from '../expert/expert.module';
import { SupplierModule } from '../supplier/supplier.module';
import { AnnouncementModule } from '../announcement/announcement.module';
import { BidModule } from '../bid/bid.module';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, NotificationModule, ExpertModule, SupplierModule, AnnouncementModule, BidModule],
  providers: [
    OutboxDispatchService,
    StagingCleanupService,SchedulerService],
})
export class SchedulerModule {}
