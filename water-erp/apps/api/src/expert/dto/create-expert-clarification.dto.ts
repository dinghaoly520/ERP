import { IsString } from 'class-validator';

export class CreateExpertClarificationDto {
  @IsString()
  question: string;

  @IsString()
  supplierName: string;
}
