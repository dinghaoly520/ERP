// apps/api/src/supervision-push/dto/supervision-push.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUrl, Length, Max, Min } from 'class-validator';
import { SUPERVISION_PAYLOAD_TYPES, SupervisionPayloadType } from '../supervision-push-payload';

export class SaveSupervisionConfigDto {
  @ApiProperty({ description: '是否启用推送' })
  enabled!: boolean;

  @ApiProperty({ description: '推送端点（公共服务平台监督通道 URL）', required: false })
  @IsOptional()
  @IsUrl({ require_tld: false })
  endpoint?: string;

  @ApiProperty({ description: 'Bearer Token（可选）', required: false })
  @IsOptional()
  @IsString()
  @Length(0, 512)
  authToken?: string;

  @ApiProperty({ description: '超时毫秒（1000~60000，默认 8000）', required: false })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(60000)
  timeoutMs?: number;

  @ApiProperty({ description: '平台代码（缺省联动 gb_code_config）', required: false })
  @IsOptional()
  @IsString()
  @Length(0, 64)
  platformCode?: string;
}

export class SupervisionPushDto {
  @ApiProperty({ description: '载荷类型（默认 EVALUATION_REPORT；其余待接入）', required: false, enum: SUPERVISION_PAYLOAD_TYPES })
  @IsOptional()
  @IsIn(SUPERVISION_PAYLOAD_TYPES as unknown as string[])
  payloadType?: SupervisionPayloadType;
}
