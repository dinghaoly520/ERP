import { IsString, IsNotEmpty, IsEmail, IsOptional, IsBoolean, Matches, MaxLength, IsIn } from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';

export class CreateContactDto {
  @IsString() @IsNotEmpty() @MaxLength(50)
  name: string;

  @IsString() @IsNotEmpty() @Matches(/^1[3-9]\d{9}$/)
  phone: string;

  @EmptyAsUndefined()
  @IsEmail() @IsOptional()
  email?: string;

  @IsBoolean({ message: '主要联系人标记须为布尔值' })
  isPrimary: boolean;

  @IsString() @IsOptional() @MaxLength(50)
  position?: string;

  /** B4-2（2026-09-30）：注册口径要求联系人含性别+身份证号（完整度各占 2 分），此前仅注册
   *  通道可写、维护端 ContactPanel 无入口——经维护端新增的联系人永久拉低完整度且无补救 */
  @EmptyAsUndefined()
  @IsString() @IsIn(['男', '女'])
  @IsOptional()
  gender?: string;

  @EmptyAsUndefined()
  @IsString() @IsOptional() @Matches(/^\d{17}[\dXx]$/, { message: '联系人身份证号须为 18 位' })
  idCard?: string;
}