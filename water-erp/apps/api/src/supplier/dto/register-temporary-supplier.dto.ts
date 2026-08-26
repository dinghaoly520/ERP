import { IsString, IsNotEmpty, IsOptional, MinLength, MaxLength, Matches } from 'class-validator';
import { PASSWORD_PATTERN, PASSWORD_POLICY_MESSAGE } from '../../common/validators/password-strength';

// 临时供应商注册：凭邀请码 + 极简字段。登录用户名强制为机构代码。
export class RegisterTemporarySupplierDto {
  @IsString() @IsNotEmpty() @MaxLength(20)
  invitationCode: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string; // 企业名称

  /** 机构代码 = 统一社会信用代码（同义字段，冗余存储；登录用户名强制取 creditCode） */
  @IsString() @IsOptional() @MaxLength(20)
  organizationCode?: string;

  @IsString() @IsNotEmpty() @Matches(/^[0-9A-Z]{18}$/, { message: '统一社会信用代码须为 18 位数字与大写字母' })
  creditCode: string;

  @IsString() @IsNotEmpty() @MaxLength(50)
  displayName: string; // 联系人姓名

  @IsString() @IsNotEmpty() @Matches(PASSWORD_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  password: string;

  @IsString() @IsNotEmpty() @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  phone: string;
}
