import { IsIn, IsOptional, IsString, Length, MaxLength, ArrayMaxSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** P3-6（2026-11-20 全链路审查）：供应商异议提交 DTO——原内联类型使 ValidationPipe whitelist
 *  失效（attachments 任意 ~10MB JSON 裸落库）。结构白名单：附件仅 name+fileId 两键、≤9 项。 */
class ObjectionAttachmentDto {
  @IsString() @MaxLength(200)
  name!: string;

  @IsString() @MaxLength(64)
  fileId!: string;
}

export class CreateObjectionDto {
  @ApiPropertyOptional({ description: '异议对象公告' })
  @IsOptional() @IsString()
  announcementId?: string;

  @ApiPropertyOptional({ description: '业务编号（与公告至少其一）' })
  @IsOptional() @IsString() @MaxLength(64)
  projectCode?: string;

  @IsIn(['document', 'prequalification', 'result', 'procedure', 'evaluation', 'contract', 'service', 'other'])
  phase!: string;

  @IsString() @Length(2, 200)
  title!: string;

  @IsString() @Length(2, 5000)
  content!: string;

  @ApiPropertyOptional({ type: [ObjectionAttachmentDto] })
  @IsOptional() @ArrayMaxSize(9) @ValidateNested({ each: true })
  @Type(() => ObjectionAttachmentDto)
  attachments?: ObjectionAttachmentDto[];

  @ApiPropertyOptional({ description: '归属公司（多归属时显式选择）' })
  @IsOptional() @IsString()
  companyId?: string;
}
