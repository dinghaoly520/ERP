import { Module } from '@nestjs/common';
import { AnnouncementModule } from '../announcement/announcement.module';
import { NotificationModule } from '../notification/notification.module';
import { TenderClarificationService } from './tender-clarification.service';

@Module({
  imports: [AnnouncementModule, NotificationModule],
  providers: [TenderClarificationService],
  exports: [TenderClarificationService],
})
export class TenderClarificationModule {}
