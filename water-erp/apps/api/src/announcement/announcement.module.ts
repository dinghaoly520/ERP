import { Module, forwardRef } from '@nestjs/common';
import { AnnouncementController } from './announcement.controller';
import { AnnouncementService } from './announcement.service';
import { AnnouncementAiService } from './announcement-ai.service';
import { BidDocumentService } from './bid-document.service';
import { AnnouncementAttachmentService } from './announcement-attachment.service';
import { AnnouncementHistoryService } from './announcement-history.service';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BidModule } from '../bid/bid.module';
import { ProjectManagementModule } from '../project-management/project-management.module';
import { GbCodeService } from '../common/gb-code.service';

@Module({
  imports: [
    forwardRef(() => NotificationModule),AuthModule, PrismaModule, BidModule, ProjectManagementModule],
  controllers: [AnnouncementController],
  // GbCodeService：发布赋码闸自愈（2026-10-20 缺码事故——旁路创建的缺码项目现场补码）
  providers: [AnnouncementService, AnnouncementAiService, BidDocumentService, AnnouncementAttachmentService, AnnouncementHistoryService, GbCodeService],
  exports: [AnnouncementService, BidDocumentService, AnnouncementAttachmentService],
})
export class AnnouncementModule {}
