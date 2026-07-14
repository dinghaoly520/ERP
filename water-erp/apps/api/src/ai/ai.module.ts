import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { SupplierSelectionAiService } from './supplier-selection-ai.service';

@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [AiController],
  providers: [AiService, SupplierSelectionAiService],
  exports: [AiService],
})
export class AiModule {}
