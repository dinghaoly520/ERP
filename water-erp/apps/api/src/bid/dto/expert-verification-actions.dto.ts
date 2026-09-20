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

/** R5 评标中替换（2026-09-20 spec §4.4，仅 :3007）：正选→候补 */
export class ReplaceExpertDuringEvaluationDto {
  /** 递补转正的候补专家 id（同项目） */
  @IsString()
  @IsNotEmpty()
  toExpertId!: string;

  /** 替换理由，必填——防无脑换人 */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reason!: string;
}
