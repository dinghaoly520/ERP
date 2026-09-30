import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

/** 供应商来访接待登记（:3002 /contact/visitor 匿名提交，@Public） */
export class CreateVisitorRegistrationDto {
  @IsString() @IsNotEmpty() @MaxLength(50)
  name: string;

  @IsString() @Matches(/^1\d{10}$/, { message: '联系电话格式不正确' })
  phone: string;

  @IsString() @IsOptional() @MaxLength(160)
  organization?: string;

  /** 访问单位（集团单位规范全称，与 Company.name 精确匹配） */
  @IsString() @IsNotEmpty() @MaxLength(160)
  visitUnit: string;

  @IsOptional() @IsInt() @Min(1) @Max(99)
  visitorCount?: number;

  @IsDateString()
  visitDate: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  purpose: string;

  @IsString() @IsOptional() @MaxLength(300)
  remark?: string;
}
