// apps/api/src/platform-push/dto/platform-push.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsHexadecimal, IsIn, IsNotEmpty,
  IsOptional, IsString, Length, ValidateNested,
} from 'class-validator';
import { PUSH_CHANNELS, PushChannelCode } from '../platform-push-payload';

/** 脱敏选项（doc §七-3：限价/合同金额——预览与推送同源同规则） */
export class PushMaskDto {
  @ApiProperty({ description: '脱敏最高限价（置 null）', required: false })
  @IsOptional()
  @IsBoolean()
  ceilingPrice?: boolean;

  @ApiProperty({ description: '脱敏合同金额（置 null）', required: false })
  @IsOptional()
  @IsBoolean()
  contractAmount?: boolean;
}

/** 待推清单行 id 格式：announcement:<id> / contract:<id> / penalty:<id>（两组捕获：类别与 id） */
export const ITEM_ID_PATTERN = /^(announcement|contract|penalty):([A-Za-z0-9_-]+)$/;

export class PreviewPushDto {
  @ApiProperty({ description: '待预览数据项 id 列表', type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 128, { each: true })
  itemIds!: string[];

  @ApiProperty({ description: '脱敏选项（预览即生效，hash 含脱敏效果）', required: false, type: PushMaskDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PushMaskDto)
  mask?: PushMaskDto;
}

/** 人工确认制铁律：dispatch/export 必带 preview 返回的逐项 payloadHash，服务端重算比对 */
export class ItemHashPairDto {
  @ApiProperty({ description: '数据项 id', example: 'announcement:clxxx' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 128)
  itemId!: string;

  @ApiProperty({ description: 'preview 返回的 payloadHash（sha256 hex）', example: '6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b' })
  @IsString()
  @IsHexadecimal()
  @Length(64, 64)
  payloadHash!: string;
}

export class DispatchPushDto extends PreviewPushDto {
  @ApiProperty({ description: '推送通道', enum: PUSH_CHANNELS })
  @IsIn(PUSH_CHANNELS as unknown as string[])
  channel!: PushChannelCode;

  @ApiProperty({ description: 'preview 阶段返回的逐项载荷指纹（防预览后数据漂移）', type: [ItemHashPairDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ItemHashPairDto)
  payloadHashes!: ItemHashPairDto[];
}

export class ExportPushDto extends PreviewPushDto {
  @ApiProperty({ description: 'preview 阶段返回的逐项载荷指纹（导出同为确认动作，校验一致）', type: [ItemHashPairDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ItemHashPairDto)
  payloadHashes!: ItemHashPairDto[];
}

export class PendingQueryDto {
  @ApiProperty({ description: 'BidProject id（清单按项目聚合；处罚信息为全局行）' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 64)
  projectId!: string;
}
