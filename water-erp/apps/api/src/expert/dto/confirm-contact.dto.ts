import { IsString, IsOptional, IsEmail, Matches } from 'class-validator';

export class ConfirmContactDto {
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '请输入正确的11位手机号' })
  phone!: string;

  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string;
}
