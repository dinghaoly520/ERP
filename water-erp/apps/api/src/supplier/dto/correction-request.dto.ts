import { IsString, IsNotEmpty, Matches, Length, MaxLength, IsOptional, IsArray, ValidateNested, ArrayMinSize, ArrayMaxSize, IsEmail, IsDateString, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { RegisterContactDto } from './register-contact.dto';
import { CreateQualificationDto } from './create-qualification.dto';
import { RegisterBankAccountDto } from './register-bank-account.dto';
import { RegisterPerformanceDto } from './register-performance.dto';

export class CorrectionRequestDto {
  @IsString() @IsNotEmpty() @MaxLength(100) name: string;
  @IsString() @IsNotEmpty() @Matches(/^[0-9A-Z]{18}$/) creditCode: string;
}

export class CorrectionVerifyDto extends CorrectionRequestDto {
  @IsString() @IsNotEmpty() @Length(6, 6) code: string;
}

export class CorrectionSubmitDto {
  @IsString() @IsNotEmpty() @MaxLength(128) token: string;
  @IsString() @IsNotEmpty() @MaxLength(100) name: string;
  @IsString() @IsNotEmpty() @Matches(/^[0-9A-Z]{18}$/) creditCode: string; // 锁定不可改

  @IsString() @IsNotEmpty() enterpriseType: string;
  @IsString() @IsNotEmpty() @MaxLength(50) legalPerson: string;
  @IsString() @IsNotEmpty() @Matches(/^\d{17}[\dXx]$/) legalPersonIdCard: string;
  @IsString() @IsNotEmpty() registeredAddress: string;
  @IsString() @IsNotEmpty() businessScope: string;

  @IsString() @IsOptional() @MaxLength(255) logoUrl?: string;
  @IsString() @IsOptional() @MaxLength(50) country?: string;
  @IsString() @IsOptional() @MaxLength(100) region?: string;
  @IsString() @IsOptional() @MaxLength(200) detailedAddress?: string;
  @IsString() @IsOptional() @MaxLength(50) registeredCapital?: string;
  @IsString() @IsOptional() @MaxLength(100) industry?: string;
  @IsDateString() @IsOptional() establishedDate?: string;
  @IsString() @IsOptional() @MaxLength(1000) companyProfile?: string;
  @IsString() @IsOptional() @Matches(/^1[3-9]\d{9}$/, { message: '法人联系电话须为 11 位手机号' }) legalPersonPhone?: string;
  @IsEmail() @IsOptional() companyEmail?: string;
  @IsString() @IsOptional() @MaxLength(200) companyWebsite?: string;
  @IsString() @IsOptional() @MaxLength(128) companyName?: string;
  @IsOptional() @IsString() @MaxLength(64) companyId?: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => RegisterContactDto) contacts: RegisterContactDto[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => CreateQualificationDto) qualifications: CreateQualificationDto[];
  @IsArray() @IsOptional() @ValidateNested({ each: true }) @Type(() => RegisterBankAccountDto) bankAccounts?: RegisterBankAccountDto[];
  @IsArray() @IsOptional() @ValidateNested({ each: true }) @Type(() => RegisterPerformanceDto) performances?: RegisterPerformanceDto[];
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(20, { each: true }) tags: string[];
}
