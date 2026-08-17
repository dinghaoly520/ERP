import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class DecryptSupplierDto {
  @IsString() @IsOptional()
  amount?: string;

  @IsString() @IsOptional()
  period?: string;

  @IsString() @IsOptional()
  qualityTarget?: string;

  @IsString() @IsOptional()
  bondStatus?: string;

  @IsBoolean() @IsOptional()
  simulateDanger?: boolean;

  /** P1-4：唱标金额与密封报价不一致时的主持人显式确认（同 CreateOpeningRecordDto） */
  @IsBoolean() @IsOptional()
  confirmSealedPrice?: boolean;

  /** P1-4 同构：唱标工期与投递工期不一致时的主持人显式确认（同 CreateOpeningRecordDto） */
  @IsBoolean() @IsOptional()
  confirmSealedPeriod?: boolean;
}
