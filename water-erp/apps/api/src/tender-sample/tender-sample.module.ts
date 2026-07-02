import { Module } from '@nestjs/common';
import { TenderSampleController } from './tender-sample.controller';
import { TenderSampleService } from './tender-sample.service';

@Module({
  controllers: [TenderSampleController],
  providers: [TenderSampleService],
  exports: [TenderSampleService],
})
export class TenderSampleModule {}
