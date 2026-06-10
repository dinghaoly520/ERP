import { Module } from '@nestjs/common';
import { BidController } from './bid.controller';
import { BidService } from './bid.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [BidController],
  providers: [BidService],
})
export class BidModule {}
