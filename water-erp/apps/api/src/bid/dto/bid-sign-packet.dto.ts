import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

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
