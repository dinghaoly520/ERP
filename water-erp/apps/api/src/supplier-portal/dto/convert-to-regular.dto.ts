import { IsString, IsNotEmpty, MaxLength, IsArray, ValidateNested, IsOptional, IsBoolean, ArrayMinSize, ArrayMaxSize, Matches } from 'class-validator';
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

  @IsString() @IsOptional()
  position?: string;
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

  /** B2-4（2026-09-30）：与正式注册同口径——法定代表人身份证号（18 位）+ 扫描件；
   *  此前转正链路不采集，临时转正供应商永久缺这份「注册必传」材料。 */
  @IsString() @IsNotEmpty() @Matches(/^\d{17}[\dXx]$/, { message: '法定代表人身份证号须为 18 位' })
  legalPersonIdCard: string;

  @IsString() @IsNotEmpty()
  legalIdFileUrl: string; // 法定代表人身份证扫描件（上传后落资质行 type=法定代表人身份证）

  @IsString() @IsNotEmpty()
  registeredAddress: string;

  @IsString() @IsNotEmpty()
  businessScope: string;

  @IsString() @IsNotEmpty()
  creditCode: string; // 统一社会信用代码（转正时可修正临时注册时的错填）

  @IsArray() @ValidateNested({ each: true }) @Type(() => ConvertContactDto)
  contacts: ConvertContactDto[];

  @IsArray() @ValidateNested({ each: true }) @Type(() => ConvertQualificationDto)
  qualifications: ConvertQualificationDto[];

  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(20, { each: true })
  tags: string[];
}
