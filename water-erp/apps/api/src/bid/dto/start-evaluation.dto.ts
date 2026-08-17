import { IsNumber, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class StartEvaluationDto {
  @ApiProperty({ description: '评标时长（小时；缺省 72，范围 1–720）', example: 72 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(720)
  evaluationHours?: number;
}
