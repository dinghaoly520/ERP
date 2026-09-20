import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** R9 主持人手动确认签到（2026-09-20 spec §4.6）：摄像头故障等现场降级 */
export class ManualConfirmDto {
  /** 降级理由，必填（如「摄像头故障」）——防无脑放行 */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reason!: string;

  /** 现场核验证件类型（不存号码） */
  @IsOptional()
  @IsIn(['身份证', '护照', '其他'])
  docType?: string;
}
