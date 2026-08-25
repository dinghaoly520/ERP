import { IsString, IsNotEmpty, IsEmail, IsOptional, ValidateNested, IsArray, ArrayMinSize, ArrayMaxSize, Matches, MaxLength, MinLength, Length } from 'class-validator';
import { Type } from 'class-transformer';
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

  // ── 注册 2.0：基本信息扩展（选填）──
  @IsString() @IsOptional() @MaxLength(255)
  logoUrl?: string;

  @IsString() @IsOptional() @MaxLength(50)
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

  @IsString() @IsOptional() @Matches(/^1[3-9]\d{9}$/, { message: '法人联系电话须为 11 位手机号' })
  legalPersonPhone?: string;

  @IsEmail() @IsOptional()
  companyEmail?: string;

  @IsString() @IsOptional() @MaxLength(200)
  companyWebsite?: string;

  @IsString() @IsNotEmpty() @MaxLength(50)
  username: string;

  @IsString() @IsNotEmpty() @MaxLength(50)
  displayName: string;

  @IsString() @IsNotEmpty() @MinLength(6)
  password: string;

  @IsEmail() @IsOptional()
  email?: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => RegisterContactDto)
  contacts: RegisterContactDto[];

  /** P1-13：注册手机验证——主联系人手机号（须与短信验证码目标一致） */
  @IsString() @IsNotEmpty() @Matches(/^1\d{10}$/)
  registrationPhone: string;

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