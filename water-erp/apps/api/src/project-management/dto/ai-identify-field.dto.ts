import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  Max,
} from 'class-validator';

export class AiIdentifyFieldDto {
  @IsString()
  @IsNotEmpty()
  fieldName!: string;

  @IsString()
  @IsNotEmpty()
  documentText!: string;

  @IsNumber()
  @Min(1)
  @Max(10)
  @IsOptional()
  topK?: number;
}

export class FieldCandidateDto {
  value!: string;
  confidence!: number;
  location!: string;
}

export class AiIdentifyFieldResponseDto {
  candidates!: FieldCandidateDto[];
}
