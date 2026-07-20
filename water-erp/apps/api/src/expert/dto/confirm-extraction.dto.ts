import { IsString, IsNotEmpty, IsArray, ValidateNested, IsOptional, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export class ExtractionExpertDto {
  @IsString() @IsNotEmpty()
  userId!: string;

  @IsString() @IsNotEmpty()
  expertName!: string;

  @IsString() @IsNotEmpty()
  major!: string;

  @IsOptional() @IsBoolean()
  isLead?: boolean;
}

export class ConfirmExtractionDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsArray() @ValidateNested({ each: true })
  @Type(() => ExtractionExpertDto)
  experts!: ExtractionExpertDto[];

  /** 候补专家列表（也会创建 BidExpert 记录，expertRole=候补） */
  @IsOptional() @IsArray() @ValidateNested({ each: true })
  @Type(() => ExtractionExpertDto)
  candidates?: ExtractionExpertDto[];
}
