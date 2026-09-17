import { IsDateString, IsString, IsNotEmpty, IsEmail, IsOptional, ValidateNested, IsArray, ArrayMinSize, ArrayMaxSize, Matches, MaxLength, MinLength, Length, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { PASSWORD_PATTERN, PASSWORD_POLICY_MESSAGE } from '../../common/validators/password-strength';
import { RegisterContactDto } from './register-contact.dto';
import { CreateQualificationDto } from './create-qualification.dto';
import { RegisterBankAccountDto } from './register-bank-account.dto';
import { RegisterPerformanceDto } from './register-performance.dto';

export class RegisterSupplierDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @IsString() @IsNotEmpty() @Matches(/^[0-9A-Z]{18}$/)
  creditCode: string;

  @IsString() @IsNotEmpty()
  enterpriseType: string;

  @IsString() @IsNotEmpty() @MaxLength(50)
  legalPerson: string;

  @IsString() @IsNotEmpty() @Matches(/^\d{17}[\dXx]$/, { message: '法定代表人身份证号须为 18 位' })
  legalPersonIdCard: string;

  @IsString() @IsNotEmpty()
  registeredAddress: string;

  @IsString() @IsNotEmpty()
  businessScope: string;

  // ── 注册 2.0：基本信息扩展 ──
  @IsString() @IsOptional() @MaxLength(255)
  logoUrl?: string;

  /** 机构代码 = 统一社会信用代码（同义字段，冗余存储）。登录用户名强制取 creditCode，此字段可不传 */
  @IsString() @IsOptional() @MaxLength(20)
  organizationCode?: string;

  @IsString() @IsOptional() @MaxLength(50)
  country?: string;

  @IsString() @IsOptional() @MaxLength(100)
  region?: string;

  @IsString() @IsOptional() @MaxLength(200)
  detailedAddress?: string;

  @IsString() @IsOptional() @MaxLength(50)
  registeredCapital?: string;

  @IsString() @IsOptional() @MaxLength(100)
  industry?: string;

  /** 企业注册成立日期（营业执照登记日期，ISO 日期字符串） */
  @IsDateString() @IsOptional()
  establishedDate?: string;

  /** 企业简介（≤1000 字） */
  @IsString() @IsOptional() @MaxLength(1000)
  companyProfile?: string;

  @IsString() @IsOptional() @Matches(/^1[3-9]\d{9}$/, { message: '法人联系电话须为 11 位手机号' })
  legalPersonPhone?: string;

  @IsEmail() @IsOptional()
  companyEmail?: string;

  @IsString() @IsOptional() @MaxLength(200)
  companyWebsite?: string;

  @IsString() @IsOptional() @MaxLength(50)
  username?: string; // 已废弃：登录用户名强制取 organizationCode，此字段仅向后兼容保留

  @IsString() @IsNotEmpty() @MaxLength(50)
  displayName: string;

  @IsString() @IsNotEmpty() @Matches(PASSWORD_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  password: string;

  @IsEmail() @IsOptional()
  email?: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => RegisterContactDto)
  contacts: RegisterContactDto[];

  /** P1-13：注册手机验证——主联系人手机号（须与短信验证码目标一致） */
  @IsString() @IsNotEmpty() @Matches(/^1\d{10}$/)
  registrationPhone: string;

  /** 归属公司（Company 主数据 id，自定义短 id 非 UUID；必选——影响投标归属，账号管理按公司分组，admin 可改） */
  /** 归属公司名称（62 家名单选择；companyId 未命中主数据时按此名称自动建档） */
  @IsOptional() @IsString() @MaxLength(128)
  companyName?: string;
  @IsString() @IsNotEmpty({ message: '归属公司为必选项，须正确选择，否则将影响投标' })
  companyId: string;

  @IsString() @IsNotEmpty() @Length(6, 6)
  registrationCode: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => CreateQualificationDto)
  qualifications: CreateQualificationDto[];

  /** 银行账户（选填，可多项） */
  @IsArray() @IsOptional() @ValidateNested({ each: true }) @Type(() => RegisterBankAccountDto)
  bankAccounts?: RegisterBankAccountDto[];

  /** 主体业绩（选填，可多项，每项须含证明材料） */
  @IsArray() @IsOptional() @ValidateNested({ each: true }) @Type(() => RegisterPerformanceDto)
  performances?: RegisterPerformanceDto[];

  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(20, { each: true })
  tags: string[];
}