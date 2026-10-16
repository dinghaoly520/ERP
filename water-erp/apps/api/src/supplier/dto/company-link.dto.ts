import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ApplyCompanyLinkDto {
  /** companyId/companyName 二选一（与注册/查重的名称解析口径一致——供应商门户公司选择器按名称选择） */
  @IsOptional() @IsUUID()
  companyId?: string;

  @IsOptional() @IsString() @MaxLength(100)
  companyName?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(200)
  note?: string;
}

export class ApproveLinkDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}

export class RejectLinkDto {
  @IsString() @MaxLength(500)
  reason!: string;
}
