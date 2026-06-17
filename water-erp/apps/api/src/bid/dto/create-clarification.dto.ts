import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateClarificationDto {
  @IsString() @IsOptional() type?: string;
  @IsString() @IsOptional() supplierId?: string;
  @IsString() @IsNotEmpty() question: string;
  @IsString() @IsNotEmpty() issuer: string;
  @IsString() @IsNotEmpty() supplierName: string;
}
