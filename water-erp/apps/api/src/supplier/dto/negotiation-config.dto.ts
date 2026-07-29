import { IsString, IsNotEmpty, IsOptional, IsArray, IsIn, ValidateIf } from 'class-validator';

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

  @IsString() @IsIn(['free', 'encrypted', 'paid'])
  downloadMode: string;

  @IsOptional() @ValidateIf(o => o.downloadMode === 'encrypted') @IsString()
  downloadPassword?: string;

  @IsOptional() @ValidateIf(o => o.downloadMode === 'paid') @IsString()
  paidAmount?: string;
}
