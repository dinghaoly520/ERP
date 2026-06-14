import { Module } from '@nestjs/common';
import { BidController } from './bid.controller';
import { BidService } from './bid.service';
import { BidGateway } from './bid.gateway';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [AuthModule, PrismaModule, NotificationModule],
  controllers: [BidController],
  providers: [BidService, BidGateway],
})
export class BidModule {}
