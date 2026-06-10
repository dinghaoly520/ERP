import { IsString, IsNotEmpty } from 'class-validator';

export class CreateClarificationDto {
  @IsString() @IsNotEmpty() question: string;
  @IsString() @IsNotEmpty() issuer: string;
  @IsString() @IsNotEmpty() supplierName: string;
}
