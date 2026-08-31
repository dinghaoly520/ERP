import { IsString, MaxLength } from 'class-validator';

/** A-114：开标记录确认/补签的 U盾 SM2 签名（对服务端重建 canonical 签名） */
export class OpeningConfirmDto {
  @IsString()
  @MaxLength(512)
  signature!: string;
}
