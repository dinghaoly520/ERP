import { IsString, IsOptional, IsEmail, IsBoolean, Matches, MaxLength } from 'class-validator';

/** B4：供应商门户更新联系人入参——此前用 `Partial<CreateContactDto>`，ValidationPipe 对其校验不可靠。 */
export class UpdateContactDto {
  @IsString() @IsOptional() @MaxLength(50)
  name?: string;

  @IsString() @IsOptional() @Matches(/^1[3-9]\d{9}$/)
  phone?: string;

  @IsEmail() @IsOptional()
  email?: string;

  @IsBoolean() @IsOptional()
  isPrimary?: boolean;
}
