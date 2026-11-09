import { IsString, IsNotEmpty, IsOptional, IsEmail, IsIn, Matches, MinLength } from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';
import { PASSWORD_PATTERN, PASSWORD_POLICY_MESSAGE } from '../../common/validators/password-strength';

/**
 * 管理端注册用户名规则（2026-11-09）：仅字母与数字、且须同时包含两者
 * —— 与前端注册弹窗输入过滤/校验同口径。
 */
export const USERNAME_PATTERN = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]+$/;
export const USERNAME_POLICY_MESSAGE = '用户名须为字母与数字的组合';

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @Matches(USERNAME_PATTERN, { message: USERNAME_POLICY_MESSAGE })
  username: string;

  @IsString()
  @IsNotEmpty()
  displayName: string; // 姓名

  @IsString()
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  password: string;

  @IsString()
  @IsNotEmpty()
  company: string; // 公司

  @IsString()
  @IsNotEmpty()
  department: string; // 部门

  @EmptyAsUndefined()
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @Matches(/^1\d{10}$/, { message: '请输入有效的手机号' })
  phone: string;

  @IsString()
  @IsOptional()
  officeLocation?: string;

  @IsString()
  @IsNotEmpty()
  verificationCode: string; // 手机验证码

  @IsIn(['management', 'office'])
  requestedRole: 'management' | 'office'; // 申请权限：management=管理权限 | office=办公权限
}
