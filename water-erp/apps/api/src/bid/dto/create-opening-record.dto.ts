import { IsString, IsNotEmpty } from 'class-validator';

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
}
