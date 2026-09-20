import { IsString, IsNotEmpty, IsOptional, IsEmail, MinLength } from 'class-validator';

export class CreateExpertDto {
  @IsString() @IsNotEmpty()
  username!: string;

  @IsString() @IsNotEmpty()
  displayName!: string;

  @IsOptional()
  @IsString() @MinLength(6)
  /** 登录口令；缺省时依次回退：身份证号 → expert@2026（R2 2026-09-18 身份核验设计） */
  password?: string;

  @IsString() @IsNotEmpty()
  specialty!: string;

  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() employer?: string;
  @IsOptional() @IsString() departmentName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() idNumber?: string;
  @IsOptional() @IsString() ethnicity?: string;
  @IsOptional() @IsString() education?: string;
  @IsOptional() @IsString() licenseNo?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() notes?: string;
}
