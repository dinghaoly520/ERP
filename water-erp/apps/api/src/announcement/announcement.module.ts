import { Module } from '@nestjs/common';
import { AnnouncementController } from './announcement.controller';
import { AnnouncementService } from './announcement.service';
import { AnnouncementAiService } from './announcement-ai.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [AnnouncementController],
  providers: [AnnouncementService, AnnouncementAiService],
  exports: [AnnouncementService],
})
export class AnnouncementModule {}
