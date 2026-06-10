import { IsString, IsNotEmpty, IsOptional, IsDateString } from 'class-validator';

export class CreateQualificationDto {
  @IsString() @IsNotEmpty()
  type: string;

  @IsString() @IsNotEmpty()
  name: string;

  @IsString() @IsNotEmpty()
  fileUrl: string;

  @IsDateString() @IsOptional()
  validFrom?: string;

  @IsDateString() @IsOptional()
  validTo?: string;
}