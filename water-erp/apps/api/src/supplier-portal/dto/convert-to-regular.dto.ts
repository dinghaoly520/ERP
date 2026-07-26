import { IsString, IsNotEmpty, MaxLength, IsArray, ValidateNested, IsOptional, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

class ConvertContactDto {
  @IsString() @IsNotEmpty()
  name: string;

  @IsString() @IsNotEmpty()
  phone: string;

  @IsString() @IsOptional()
  email?: string;

  @IsBoolean() @IsOptional()
  isPrimary?: boolean;
}

class ConvertQualificationDto {
  @IsString() @IsNotEmpty()
  type: string;   // 资质类型

  @IsString() @IsNotEmpty()
  name: string;   // 资质名称

  @IsString() @IsOptional()
  fileUrl?: string;

  @IsString() @IsOptional()
  validFrom?: string;

  @IsString() @IsOptional()
  validTo?: string;
}

export class ConvertToRegularDto {
  @IsString() @IsNotEmpty()
  enterpriseType: string;

  @IsString() @IsNotEmpty() @MaxLength(50)
  legalPerson: string;

  @IsString() @IsNotEmpty()
  registeredAddress: string;

  @IsString() @IsNotEmpty()
  businessScope: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => ConvertContactDto)
  contacts: ConvertContactDto[];

  @IsArray() @ValidateNested({ each: true }) @Type(() => ConvertQualificationDto)
  qualifications: ConvertQualificationDto[];
}
