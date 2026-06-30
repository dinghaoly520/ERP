import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ExtractInitiationPdfDto {
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsString()
  @IsNotEmpty()
  objectKey!: string;

  @IsString()
  @IsNotEmpty()
  mimeType!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  fileSize!: number;

  @IsString()
  @IsOptional()
  uploadedById?: string;

  @IsString()
  @IsNotEmpty()
  extractedText!: string;
}
