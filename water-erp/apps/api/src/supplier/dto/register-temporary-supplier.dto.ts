import { IsString, IsNotEmpty, MinLength, MaxLength, Matches } from 'class-validator';

// 临时供应商注册：凭邀请码 + 极简字段。企业名称同时作为登录用户名。
export class RegisterTemporarySupplierDto {
  @IsString() @IsNotEmpty() @MaxLength(20)
  invitationCode: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string; // 企业名称（同时作为登录用户名）

  @IsString() @IsNotEmpty() @Matches(/^[0-9A-Z]{18}$/, { message: '统一社会信用代码须为 18 位数字与大写字母' })
  creditCode: string;

  @IsString() @IsNotEmpty() @MaxLength(50)
  displayName: string; // 联系人姓名

  @IsString() @IsNotEmpty() @MinLength(6)
  password: string;

  @IsString() @IsNotEmpty() @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  phone: string;
}
