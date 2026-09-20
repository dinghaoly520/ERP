import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** R5 核验异常登记（2026-09-20 spec §4.4）：人证不符/照片异常/到场异常 */
export class RejectExpertVerificationDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['人证不符', '照片异常', '到场异常'])
  type!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

/** R5 撤销异常登记（2026-09-20 闭环修复）：误报更正——原因必填，追加更正日志不删原记录 */
export class RetractExpertVerificationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reason!: string;
}

/** P3 host 态核验登记（2026-09-20 spec §4.2）：主持人核对 人↔证件↔名单 后登记 */
export class VerifyExpertIdentityDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['身份证', '护照', '其他'])
  docType!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

/** P3 host 态撤销误登记（2026-09-20 spec §4.2）：原因必填，签到重锁 */
export class UnverifyExpertIdentityDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reason!: string;
}
