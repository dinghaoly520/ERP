import { IsString, IsOptional, IsEmail, IsBoolean, Matches, MaxLength, IsIn } from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';

/** B4：供应商门户更新联系人入参——此前用 `Partial<CreateContactDto>`，ValidationPipe 对其校验不可靠。
 *  B4-2 补录（2026-10-22 修复）：position/gender/idCard 此前漏声明——whitelist 剥离致
 *  「编辑保存成功但字段全丢」（CreateContactDto 与 service 写入面早已支持，唯独 Update 漏同步）。 */
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

  @IsString() @IsOptional() @MaxLength(50)
  position?: string;

  @IsString() @IsOptional() @IsIn(['男', '女'])
  gender?: string;

  @IsString() @IsOptional() @Matches(/^\d{17}[\dXx]$/, { message: '联系人身份证号须为 18 位' })
  idCard?: string;
}
