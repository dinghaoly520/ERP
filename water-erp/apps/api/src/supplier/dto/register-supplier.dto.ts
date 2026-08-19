import { IsString, IsNotEmpty, IsEmail, IsOptional, ValidateNested, IsArray, ArrayMinSize, ArrayMaxSize, Matches, MaxLength, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { RegisterContactDto } from './register-contact.dto';
import { CreateQualificationDto } from './create-qualification.dto';

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

  @IsArray() @ValidateNested({ each: true }) @Type(() => CreateQualificationDto)
  qualifications: CreateQualificationDto[];

  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(20, { each: true })
  tags: string[];
}