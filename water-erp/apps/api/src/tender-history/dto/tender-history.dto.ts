import { IsIn, IsOptional, IsString, IsObject } from 'class-validator';

export class CreateTenderHistoryDto {
  @IsString()
  @IsIn([
    'COMPETITIVE_NEGOTIATION',
    'INTERNAL_BIDDING',
    'INQUIRY_PURCHASE',
    'SINGLE_SOURCE',
    'INVITED_BIDDING',
  ])
  documentType: string;

  @IsString()
  title: string;

  @IsObject()
  draftData: Record<string, unknown>;
}

export class QueryTenderHistoryDto {
  @IsString()
  @IsIn([
    'COMPETITIVE_NEGOTIATION',
    'INTERNAL_BIDDING',
    'INQUIRY_PURCHASE',
    'SINGLE_SOURCE',
    'INVITED_BIDDING',
  ])
  documentType: string;

  @IsOptional()
  @IsString()
  limit?: string;
}
