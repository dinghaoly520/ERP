import { IsOptional, IsString, MaxLength } from 'class-validator';

/** A-152：专家数字证书绑定（平台自签 SM2 软证书，供应商侧范式复制） */
export class BindExpertCertDto {
  @IsString()
  @MaxLength(128)
  certSn!: string;

  @IsString()
  @MaxLength(512)
  certDn!: string;

  /** SM2 公钥（04 开头 130 位 hex） */
  @IsString()
  @MaxLength(256)
  publicKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  alg?: string;
}
