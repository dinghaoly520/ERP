import { IsNumber, IsOptional, Min, Max } from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';
import { ApiProperty } from '@nestjs/swagger';

export class StartEvaluationDto {
  @EmptyAsUndefined()
  @ApiProperty({ description: '评标时长（小时；缺省 72，范围 1–720）', example: 72 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(720)
  evaluationHours?: number;
}
