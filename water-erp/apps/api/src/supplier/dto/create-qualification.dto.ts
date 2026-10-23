import { IsString, IsNotEmpty, IsOptional, IsDateString } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateQualificationDto {
  @IsString() @IsNotEmpty()
  type: string;

  @IsString() @IsNotEmpty()
  name: string;

  @IsString() @IsNotEmpty()
  fileUrl: string;

  /** 附加材料 [{name,url}]（支持多项上传） */
  @IsOptional()
  attachments?: { name: string; url: string }[];

  /** 空串归一 undefined（2026-10-22）：@IsOptional 只跳过 null/undefined，表单未填的空串
      会被 IsDateString 误伤成「该项应为有效日期 string」——有效期本选填，空=未填不报错 */
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsDateString({}, { message: '有效期起须为有效日期' })
  @IsOptional()
  validFrom?: string;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsDateString({}, { message: '有效期止须为有效日期' })
  @IsOptional()
  validTo?: string;
}