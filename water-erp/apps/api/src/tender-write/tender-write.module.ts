import { Module } from '@nestjs/common';
import { TenderWriteController } from './tender-write.controller';
import { TenderWriteService } from './tender-write.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  controllers: [TenderWriteController],
  providers: [TenderWriteService],
  exports: [TenderWriteService],
})
export class TenderWriteModule {}
