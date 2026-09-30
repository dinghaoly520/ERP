import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { VisitorController } from './visitor.controller';
import { VisitorService } from './visitor.service';

@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [VisitorController],
  providers: [VisitorService],
})
export class VisitorModule {}
