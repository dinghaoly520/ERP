import { IsString, MaxLength } from 'class-validator';

/** A-152：评标报告电子签名提交（对 GET esign-payload 下发的 canonical 串做 SM2 签名） */
export class ExpertEsignDto {
  /** SM2 签名值 hex（r||s，128 或 130 位） */
  @IsString()
  @MaxLength(512)
  signature!: string;
}
