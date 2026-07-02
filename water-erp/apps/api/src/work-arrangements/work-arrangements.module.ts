import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkArrangementsController } from './work-arrangements.controller';
import { WorkArrangementsService } from './work-arrangements.service';

@Module({
  imports: [AiModule, AuthModule, PrismaModule],
  controllers: [WorkArrangementsController],
  providers: [WorkArrangementsService],
  exports: [WorkArrangementsService],
})
export class WorkArrangementsModule {}
