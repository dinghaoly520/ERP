import { IsDateString, IsIn, IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** CTS A-213 奖惩记录录入（复用 SupplierPerformance 表） */
export class AddSupplierRecordDto {
  @IsIn(['reward', 'punishment'])
  recordType!: 'reward' | 'punishment';

  /** 关联项目/事项名称 */
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  projectName!: string;

  /** 奖惩事由/文号 */
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  recordNote!: string;

  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientName?: string;

  @IsOptional()
  @IsNumber()
  contractAmount?: number;
}
