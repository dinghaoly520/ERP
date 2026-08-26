import { Module } from '@nestjs/common';
import { AnnouncementModule } from '../announcement/announcement.module';
import { NotificationModule } from '../notification/notification.module';
import { TenderClarificationController } from './tender-clarification.controller';
import { TenderClarificationService } from './tender-clarification.service';

@Module({
  imports: [AnnouncementModule, NotificationModule],
  controllers: [TenderClarificationController],
  providers: [TenderClarificationService],
  exports: [TenderClarificationService],
})
export class TenderClarificationModule {}
