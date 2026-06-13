import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { SupplierSelectionAiService } from './supplier-selection-ai.service';

@Module({
  imports: [PrismaModule],
  controllers: [AiController],
  providers: [AiService, SupplierSelectionAiService],
  exports: [AiService],
})
export class AiModule {}
