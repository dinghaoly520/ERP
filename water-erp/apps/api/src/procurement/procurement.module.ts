import { Module } from '@nestjs/common';
import { ProcurementController } from './procurement.controller';
import { ProcurementService } from './procurement.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ProcurementController],
  providers: [ProcurementService],
})
export class ProcurementModule {}
