import { IsOptional, IsString } from 'class-validator';

/** 指派/改派开标主持人；userId=null（或省略）清除指派 */
export class AssignHostDto {
  /** 目标 bid_host 用户 id；传 null/省略 = 清除指派（项目回到公开池，:3007 不可见） */
  @IsOptional()
  @IsString()
  userId?: string | null;
}
