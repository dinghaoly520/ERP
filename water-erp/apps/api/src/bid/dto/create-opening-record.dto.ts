import { IsString, IsNotEmpty, IsBoolean, IsOptional } from 'class-validator';

/** 主持人录入唱标信息（报价/工期/质量目标/保证金），据此生成开标记录供供应商确认。 */
export class CreateOpeningRecordDto {
  @IsString()
  @IsNotEmpty()
  bidSupplierId: string;

  @IsString()
  @IsNotEmpty()
  amount: string;

  @IsString()
  @IsNotEmpty()
  period: string;

  @IsString()
  @IsNotEmpty()
  qualityTarget: string;

  @IsString()
  @IsNotEmpty()
  bondStatus: string;

  /** P1-4：录入价与投标文件密封报价不一致时，主持人显式确认按录入值唱标（前端经 409 确认后回传） */
  @IsBoolean()
  @IsOptional()
  confirmSealedPrice?: boolean;

  /** P1-4 同构：录入工期与投标投递工期不一致时，主持人显式确认按录入值唱标（前端经 409 确认后回传） */
  @IsBoolean()
  @IsOptional()
  confirmSealedPeriod?: boolean;
}
