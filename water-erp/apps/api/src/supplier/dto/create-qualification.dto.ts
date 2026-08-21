import { IsString, IsNotEmpty, IsOptional, IsDateString } from 'class-validator';

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

  @IsDateString() @IsOptional()
  validFrom?: string;

  @IsDateString() @IsOptional()
  validTo?: string;
}