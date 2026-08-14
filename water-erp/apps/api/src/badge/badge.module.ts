import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BadgeController } from './badge.controller';
import { BadgeService } from './badge.service';

@Module({
  imports: [AuthModule],
  controllers: [BadgeController],
  providers: [BadgeService],
  exports: [BadgeService],
})
export class BadgeModule {}
