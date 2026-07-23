import { Module } from '@nestjs/common';
import { OpeningHallController } from './opening-hall.controller';
import { OpeningHallService } from './opening-hall.service';
import { NotificationModule } from '../notification/notification.module';
import { BidModule } from '../bid/bid.module';

@Module({
  imports: [NotificationModule, BidModule],
  controllers: [OpeningHallController],
  providers: [OpeningHallService],
  exports: [OpeningHallService],
})
export class OpeningHallModule {}
