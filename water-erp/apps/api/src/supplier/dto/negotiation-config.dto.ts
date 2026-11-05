import { IsString, IsNotEmpty, IsArray, IsIn, ValidateIf, MaxLength } from 'class-validator';

export class NegotiationConfigDto {
  @IsString() @IsNotEmpty()
  projectId: string;

  @IsArray() @IsString({ each: true })
  supplierIds: string[];

  @IsString()
  acquireStartTime: string;

  @IsString()
  acquireEndTime: string;

  @IsString()
  bidOpeningTime: string;

  @IsArray() @IsString({ each: true })
  refFileKeys: string[];

  @IsArray() @IsString({ each: true })
  attachFileIds: string[];

  /** 付费下载暂不支持（2026-11-05 用户裁定）：只收免费/解密两种，'paid' 直接 400 */
  @IsString() @IsIn(['free', 'encrypted'])
  downloadMode: string;

  /** encrypted 时必填（勿加 IsOptional——会让缺属性短路成静默通过，配置无密码后下载端恒 403） */
  @ValidateIf(o => o.downloadMode === 'encrypted') @IsString() @IsNotEmpty() @MaxLength(16)
  downloadPassword?: string;
}
