import { IsString, IsNotEmpty, IsOptional, IsDateString, IsArray, MaxLength } from 'class-validator';

/** 供应商注册/变更时的主体业绩入参（证明材料必传） */
export class RegisterPerformanceDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  projectName: string;

  @IsString() @IsOptional() @MaxLength(200)
  clientName?: string;

  @IsString() @IsOptional() @MaxLength(50)
  contractAmount?: string;

  @IsDateString() @IsOptional()
  signDate?: string;

  @IsString() @IsOptional()
  description?: string;

  /** 证明材料 [{name,url}] —— 至少 1 项 */
  @IsArray() @IsNotEmpty({ message: '业绩须上传证明材料' })
  proofFiles: { name: string; url: string }[];
}
