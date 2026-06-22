import { IsISO8601, IsOptional } from 'class-validator';

export class CreateBidDto {
  @IsISO8601()
  @IsOptional()
  openTime?: string; // 开标时间

  @IsISO8601()
  @IsOptional()
  deadline?: string; // 投标截止时间（须早于 openTime）
}
