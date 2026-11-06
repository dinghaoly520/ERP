import { IsString, IsOptional, IsNotEmpty, IsEmail, Matches } from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';

/**
 * 专家端自助资料修改（2026-11-06 扩面：除工作单位外全字段可改）——
 * 姓名/邮箱落 User；手机/身份证号落 ExpertProfile（PII 密封）；专业/职称落 ExpertProfile。
 * 修改直写同一份 User/ExpertProfile 记录，:3005 专家详情即时同步（无需额外链路）。
 */
export class UpdateExpertProfileDto {
  @IsString()
  @IsNotEmpty({ message: '姓名不能为空' })
  @IsOptional()
  displayName?: string;

  @EmptyAsUndefined()
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @Matches(/^1\d{10}$/, { message: '手机号须为 11 位有效号码' })
  @IsOptional()
  phone?: string;

  @IsString()
  @Matches(/^\d{17}[\dX]$/, { message: '身份证号须为 18 位有效号码' })
  @IsOptional()
  idNumber?: string;

  @IsString()
  @IsOptional()
  specialty?: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  major?: string;
}
