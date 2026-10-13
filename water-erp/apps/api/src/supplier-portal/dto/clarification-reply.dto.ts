import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Length } from 'class-validator';

export class ClarificationReplyDraftDto {
  @ApiProperty({ description: '澄清答复文本' })
  @IsString()
  @Length(5, 5000)
  reply!: string;

  @ApiProperty({ description: '附件 FileAsset id 列表（≤5，category=clarification_reply）', required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  attachmentIds?: string[];

  @ApiProperty({ description: '将用于签名的绑定证书序列号（SupplierCert.certSn，进入 canonical）；旧轨免签可空' })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  certSn?: string;
}

export class SubmitClarificationReplyDto extends ClarificationReplyDraftDto {
  @ApiProperty({ description: 'SM2/SM3 签名值（hex）；旧轨免签可空——空则跳过验签（unsigned-legacy）' })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  signature?: string;
}
