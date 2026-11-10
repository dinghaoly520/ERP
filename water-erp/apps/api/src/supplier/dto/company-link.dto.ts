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

/** 申请退库（2026-11-10）：companyId 必填（限本人已在库归属——service 校验）；
 *  「确认退库」文字确认为门户表单闸，后端不重复校验。
 *  注意 companyId 用 @IsString 而非 @IsUUID——Company 主键为 cuid/短_slug 形态（同 ApplyCompanyLinkDto 注）。 */
export class ApplyCompanyLinkLeaveDto {
  @IsString() @MaxLength(64)
  companyId!: string;

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
