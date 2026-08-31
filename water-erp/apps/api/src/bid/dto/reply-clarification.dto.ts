import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class ReplyClarificationDto {
  @ApiProperty({ description: '回复内容' })
  @IsString()
  @Length(1, 5000)
  reply!: string;

  @ApiProperty({ description: '状态（默认已回复）', required: false })
  @IsOptional()
  @IsString()
  status?: string;

  /** A-143（2026-08-28）：type='clarification' 在线答复已迁移供应商门户签名提交；
   *  主持端仅保留离线答复登记降级通道（channel='offline' + offlineReason 必填）。
   *  type='question'（答疑：供应商提问评委答）不受影响。 */
  @ApiProperty({ description: "答复通道：type='clarification' 时必传 'offline'", required: false })
  @IsOptional()
  @IsIn(['offline'])
  channel?: 'offline';

  @ApiProperty({ description: '离线答复缘由（channel=offline 时必填，2~200 字）', required: false })
  @IsOptional()
  @IsString()
  @Length(2, 200)
  offlineReason?: string;
}
