import { IsString, IsNotEmpty, IsOptional, IsEmail, MinLength } from 'class-validator';

export class CreateExpertDto {
  @IsOptional()
  @IsString() @IsNotEmpty()
  /** 登录账号；缺省=姓名（2026-11-09 用户裁定：专家默认以姓名+身份证号登录，
   *  录入界面与 CSV 模板已删账号/密码字段——显式传值仍兼容旧调用方/种子导入） */
  username?: string;

  @IsString() @IsNotEmpty()
  displayName!: string;

  @IsOptional()
  @IsString() @MinLength(6)
  /** 登录口令；缺省时依次回退：身份证号 → expert@2026（R2 2026-09-18 身份核验设计） */
  password?: string;

  @IsString() @IsNotEmpty()
  specialty!: string;

  @IsOptional() @IsString() title?: string;
  /** 执业资格（2026-11-04 与职称分列）：标准全称顿号分隔，service 层逐项校验 */
  @IsOptional() @IsString() qualifications?: string;
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
