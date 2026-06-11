import { Module } from '@nestjs/common';
import { ExpertController } from './expert.controller';
import { ExpertService } from './expert.service';
import { AuthModule } from '../auth/auth.module';
import { AiModule } from '../ai';

@Module({
  imports: [AuthModule, AiModule],
  controllers: [ExpertController],
  providers: [ExpertService],
})
export class ExpertModule {}
