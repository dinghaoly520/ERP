import { IsOptional, IsString, MaxLength } from 'class-validator';

/** A-114：开标记录确认/补签的 U盾 SM2 签名（对服务端重建 canonical 签名） */
export class OpeningConfirmDto {
  /** SCCA 全面适配（2026-10-14）：旧轨免签——空则跳过验签，证据标记 unsigned-legacy */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  signature?: string;
  // ── SCCA dual-v3（阶段2 Task7）──
  @IsOptional() @IsString() @MaxLength(128) operationId?: string;
  @IsOptional() @IsString() @MaxLength(64) signatureFormat?: string; // 'scca-pkcs7-base64'
  @IsOptional() @IsString() @MaxLength(262144) signP7?: string;
}
