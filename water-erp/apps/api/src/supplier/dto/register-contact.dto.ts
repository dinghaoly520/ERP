import { IsString, IsNotEmpty, IsEmail, IsOptional, IsBoolean, Matches, MaxLength } from 'class-validator';

/** 供应商注册时的联系人入参：比通用 CreateContactDto 多一个「联系人身份证号」必填项。 */
export class RegisterContactDto {
  @IsString() @IsNotEmpty() @MaxLength(50)
  name: string;

  @IsString() @IsNotEmpty() @Matches(/^1[3-9]\d{9}$/)
  phone: string;

  @IsString() @IsNotEmpty() @Matches(/^\d{17}[\dXx]$/, { message: '联系人身份证号须为 18 位' })
  idCard: string;

  @IsEmail() @IsOptional()
  email?: string;

  @IsBoolean()
  isPrimary: boolean;

  @IsString() @IsOptional() @MaxLength(50)
  position?: string;
}
