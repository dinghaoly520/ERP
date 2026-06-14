import { Module } from '@nestjs/common';
import { ExpertController } from './expert.controller';
import { ExpertService } from './expert.service';
import { ExpertAdminController } from './expert-admin.controller';
import { ExpertAdminService } from './expert-admin.service';
import { ExpertExtractionAiService } from './expert-extraction-ai.service';
import { ExpertConflictService } from './expert-conflict.service';
import { AuthModule } from '../auth/auth.module';
import { AiModule } from '../ai';

@Module({
  imports: [AuthModule, AiModule],
  controllers: [ExpertController, ExpertAdminController],
  providers: [ExpertService, ExpertAdminService, ExpertExtractionAiService, ExpertConflictService],
})
export class ExpertModule {}
