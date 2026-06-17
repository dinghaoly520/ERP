import { IsString, IsOptional } from 'class-validator';

export class CreateExpertClarificationDto {
  @IsString() @IsOptional()
  supplierId?: string;

  @IsString()
  question: string;

  @IsString()
  supplierName: string;
}
