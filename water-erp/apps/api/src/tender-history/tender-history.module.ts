import { Module } from '@nestjs/common';
import { TenderHistoryController } from './tender-history.controller';
import { TenderHistoryService } from './tender-history.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TenderHistoryController],
  providers: [TenderHistoryService],
  exports: [TenderHistoryService],
})
export class TenderHistoryModule {}
