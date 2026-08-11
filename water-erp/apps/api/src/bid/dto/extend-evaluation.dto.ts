import { IsNumber, IsString, IsNotEmpty, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ExtendEvaluationDto {
  @ApiProperty({ description: '延期小时数', example: 24 })
  @IsNumber()
  @Min(1)
  extendHours: number;

  @ApiProperty({ description: '延期原因' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
