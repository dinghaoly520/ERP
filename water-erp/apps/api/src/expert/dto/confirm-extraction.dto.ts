import { IsString, IsNotEmpty, IsArray, ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class ExtractionExpertDto {
  @IsString() @IsNotEmpty()
  userId!: string;

  @IsString() @IsNotEmpty()
  expertName!: string;

  @IsString() @IsNotEmpty()
  major!: string;
}

export class ConfirmExtractionDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsArray() @ValidateNested({ each: true })
  @Type(() => ExtractionExpertDto)
  experts!: ExtractionExpertDto[];
}
