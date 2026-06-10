import { Module } from '@nestjs/common';
import { BidController } from './bid.controller';
import { BidService } from './bid.service';

@Module({
  controllers: [BidController],
  providers: [BidService],
})
export class BidModule {}
