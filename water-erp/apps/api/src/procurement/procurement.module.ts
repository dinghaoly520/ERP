import { Module } from '@nestjs/common';
import { ProcurementController } from './procurement.controller';
import { ProcurementService } from './procurement.service';
import { AuthModule } from '../auth/auth.module';
import { GbCodeService } from '../common/gb-code.service';

@Module({
  imports: [AuthModule],
  controllers: [ProcurementController],
  // GbCodeService：createBid 建项赋码（2026-10-20 缺码事故：全创建路径赋码）
  providers: [ProcurementService, GbCodeService],
})
export class ProcurementModule {}
