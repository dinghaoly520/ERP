import { IsIn } from 'class-validator';

export class ImportAutofillDto {
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
}
