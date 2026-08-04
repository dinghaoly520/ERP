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

  /** 追加模式：不清空已有记录，只追加新专家（补选使用）。默认 false 时清空再写入（正选初次使用）。 */
  @IsOptional() @IsBoolean()
  append?: boolean;
}
