import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

/** 变更登记入参（2026-11-11 变更体系）——fields 键必须在后端白名单
 *  （change-fields.ts），名单字段与白名单外键由服务层逐一校验并点名。 */
export class RegisterChangeDto {
  @IsIn(['CHANGE', 'ADDENDUM'])
  type!: 'CHANGE' | 'ADDENDUM';

  @IsString() @IsNotEmpty()
  reason!: string;

  @IsObject() @IsOptional()
  fields?: Record<string, string | number | null>;
}

export class BindChangeAnnouncementDto {
  @IsString() @IsNotEmpty()
  announcementId!: string;
}
