import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

/* ══ :3011 移动驾驶舱手机号登录（2026-11-23 用户裁定）══ */

export class MobileSendCodeDto {
  @IsString()
  @IsNotEmpty({ message: '请输入手机号' })
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  phone: string;
}

export class MobileLoginDto {
  @IsString()
  @IsNotEmpty({ message: '请输入手机号' })
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  phone: string;

  @IsString()
  @IsNotEmpty({ message: '请输入短信验证码' })
  code: string;
}

export class MobilePasswordLoginDto {
  @IsString()
  @IsNotEmpty({ message: '请输入手机号' })
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  phone: string;

  @IsString()
  @IsNotEmpty({ message: '请输入密码' })
  password: string;
}
