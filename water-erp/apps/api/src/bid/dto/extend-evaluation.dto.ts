import { IsNumber, IsString, IsNotEmpty, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ExtendEvaluationDto {
  @ApiProperty({ description: '延期小时数（单次上限 720，对齐启动评标时 evaluationHours 封顶）', example: 24 })
  @IsNumber()
  @Min(1)
  @Max(720)
  extendHours: number;

  @ApiProperty({ description: '延期原因' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
