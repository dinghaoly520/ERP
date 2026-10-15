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
  /** 归属公司（2026-10-15 录入收窄 admin 后的工作单位选择器）：给定则以该公司为归属与工作单位，未给定回退操作人公司快照 */
  @IsOptional() @IsString() companyId?: string;
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
