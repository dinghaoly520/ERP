import { Module } from '@nestjs/common';
import { AnnouncementController } from './announcement.controller';
import { AnnouncementService } from './announcement.service';
import { AnnouncementAiService } from './announcement-ai.service';
import { BidDocumentService } from './bid-document.service';
import { AnnouncementAttachmentService } from './announcement-attachment.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BidModule } from '../bid/bid.module';

@Module({
  imports: [AuthModule, PrismaModule, BidModule],
  controllers: [AnnouncementController],
  providers: [AnnouncementService, AnnouncementAiService, BidDocumentService, AnnouncementAttachmentService],
  exports: [AnnouncementService, BidDocumentService, AnnouncementAttachmentService],
})
export class AnnouncementModule {}
