import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** 签字登记：SIGNED=已签；REFUSED_DISSENT=拒绝附书面不同意见；DEEMED_AGREED=拒绝且未陈述理由（视为同意） */
export class RegisterSignDto {
  @IsIn(['SIGNED', 'REFUSED_DISSENT', 'DEEMED_AGREED'])
  status: 'SIGNED' | 'REFUSED_DISSENT' | 'DEEMED_AGREED';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  dissentingOpinion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  dissentingReason?: string;
}

/** 重开已闭环签字包（数据修正流程）：闭环即锁死后唯一受控回退通道，仅 admin，理由必填入监督日志 */
export class ReopenSignPacketDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason: string;
}
