import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

export class ExportTenderWriteDto {
  @IsIn([
    'COMPETITIVE_NEGOTIATION',
    'SINGLE_SOURCE',
    'INQUIRY_PURCHASE',
    'INTERNAL_BIDDING',
    'INVITED_BIDDING',
  ])
  documentType:
    | 'COMPETITIVE_NEGOTIATION'
    | 'SINGLE_SOURCE'
    | 'INQUIRY_PURCHASE'
    | 'INTERNAL_BIDDING'
    | 'INVITED_BIDDING';

  @IsObject()
  answers: Record<string, unknown>;

  /** 项目编号（统一命名用，项目绑定场景由前端传入） */
  @IsString()
  @IsOptional()
  projectCode?: string;
}

export class ExportAnnouncementDto {
  @IsIn([
    'COMPETITIVE_NEGOTIATION',
    'SINGLE_SOURCE',
    'INQUIRY_PURCHASE',
    'INTERNAL_BIDDING',
    'INVITED_BIDDING',
  ])
  tenderType:
    | 'COMPETITIVE_NEGOTIATION'
    | 'SINGLE_SOURCE'
    | 'INQUIRY_PURCHASE'
    | 'INTERNAL_BIDDING'
    | 'INVITED_BIDDING';

  @IsIn(['procurement_document', 'failed_bid', 'winning_bid'])
  category: 'procurement_document' | 'failed_bid' | 'winning_bid';

  @IsObject()
  draft: Record<string, unknown>;

  /** 项目编号（统一命名用，项目绑定场景由前端传入） */
  @IsString()
  @IsOptional()
  projectCode?: string;
}

export class ExportNotificationLetterDto {
  @IsString()
  @IsOptional()
  projectName?: string;

  /** 项目编号（统一命名用） */
  @IsString()
  @IsOptional()
  projectCode?: string;

  @IsString()
  @IsOptional()
  winnerName?: string;

  @IsString()
  @IsOptional()
  winnerPrice?: string;

  @IsString()
  @IsOptional()
  winnerPriceChinese?: string;

  @IsString()
  @IsOptional()
  contactName?: string;

  @IsString()
  @IsOptional()
  contactPhone?: string;

  @IsString()
  @IsOptional()
  contactEmail?: string;

  @IsString()
  @IsOptional()
  signatureDate?: string;

  @IsString()
  @IsOptional()
  department?: string;

  @IsString()
  @IsOptional()
  controlPrice?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  project?: string;

  @IsString()
  @IsOptional()
  procurementMethod?: string;

  @IsString()
  @IsOptional()
  remark?: string;
}
