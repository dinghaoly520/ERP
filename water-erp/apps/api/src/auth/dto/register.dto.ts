import { IsString, IsNotEmpty, IsOptional, IsEmail, IsIn, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsNotEmpty()
  displayName: string; // 姓名

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  @IsNotEmpty()
  company: string; // 公司

  @IsString()
  @IsNotEmpty()
  department: string; // 部门

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
