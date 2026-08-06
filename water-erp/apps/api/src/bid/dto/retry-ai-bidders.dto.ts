import { IsArray, IsOptional, IsString } from 'class-validator';

export class RetryAiBiddersDto {
  /** 要重试的 AiBidderResult id 列表；不传 = 重试全部 FAILED + 卡住家 */
  @IsArray() @IsOptional()
  @IsString({ each: true })
  bidderResultIds?: string[];
}
