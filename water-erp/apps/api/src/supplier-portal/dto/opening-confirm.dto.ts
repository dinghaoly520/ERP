import { IsOptional, IsString, MaxLength } from 'class-validator';

/** A-114：开标记录确认/补签的 U盾 SM2 签名（对服务端重建 canonical 签名） */
export class OpeningConfirmDto {
  /** SCCA 全面适配（2026-10-14）：旧轨免签——空则跳过验签，证据标记 unsigned-legacy */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  signature?: string;
}
