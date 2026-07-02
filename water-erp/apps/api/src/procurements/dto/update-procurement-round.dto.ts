import { PartialType } from '@nestjs/swagger';
import { CreateProcurementRoundDto } from './create-procurement-round.dto';

export class UpdateProcurementRoundDto extends PartialType(
  CreateProcurementRoundDto,
) {}
