import { IsString, IsIn, IsNotEmpty, IsArray, ValidateNested, IsOptional, IsBoolean } from 'class-validator';
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

  /** P1-7：采购人代表标识（部门限定配额抽取的需求方代表；不得担任组长，不计入技术/经济专家 2/3 占比） */
  @IsOptional() @IsBoolean()
  isPurchaserRepresentative?: boolean;
}

export class ConfirmExtractionDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsOptional()
  @IsArray() @ValidateNested({ each: true })
  @Type(() => ExtractionExpertDto)
  experts?: ExtractionExpertDto[];

  /** 候补专家列表（也会创建 BidExpert 记录，expertRole=候补） */
  @IsOptional() @IsArray() @ValidateNested({ each: true })
  @Type(() => ExtractionExpertDto)
  candidates?: ExtractionExpertDto[];

  /** 追加模式：不清空已有记录，只追加新专家（补选使用）。默认 false 时清空再写入（正选初次使用）。 */
  @IsOptional() @IsBoolean()
  append?: boolean;

  /** P1-9：抽取模式快照（specialty_match/random/merit_best）——确认时载明，供抽取审计留痕 */
  @IsOptional() @IsIn(['specialty_match', 'random', 'merit_best'])
  extractMode?: string;
}
