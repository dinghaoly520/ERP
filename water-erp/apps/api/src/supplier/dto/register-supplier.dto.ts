import { IsString, IsNotEmpty, IsEmail, IsOptional, ValidateNested, IsArray, Matches, MaxLength, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateContactDto } from './create-contact.dto';
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

  @IsArray() @ValidateNested({ each: true }) @Type(() => CreateContactDto)
  contacts: CreateContactDto[];

  @IsArray() @ValidateNested({ each: true }) @Type(() => CreateQualificationDto)
  qualifications: CreateQualificationDto[];
}