import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';

/** 公告导入识别（2026-11-03）：按（公告类别 × 采购方式）取字段表识别回填 */
export class AnnouncementImportAutofillDto {
  @ApiProperty({ description: '公告类别', enum: ['procurement_document', 'failed_bid', 'winning_bid'] })
  @IsIn(['procurement_document', 'failed_bid', 'winning_bid'])
  category!: string;

  @ApiProperty({ description: '采购方式（决定采购文件公告的字段变体）' })
  @IsString()
  @IsNotEmpty()
  tenderType!: string;
}
