import { IsString, IsOptional, IsEmail, IsBoolean, Matches, MaxLength } from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';

/** B4：供应商门户更新联系人入参——此前用 `Partial<CreateContactDto>`，ValidationPipe 对其校验不可靠。 */
export class UpdateContactDto {
  @IsString() @IsOptional() @MaxLength(50)
  name?: string;

  @EmptyAsUndefined()
  @IsString() @IsOptional() @Matches(/^1[3-9]\d{9}$/)
  phone?: string;

  @EmptyAsUndefined()
  @IsEmail() @IsOptional()
  email?: string;

  @EmptyAsUndefined()
  @IsBoolean() @IsOptional()
  isPrimary?: boolean;
}
