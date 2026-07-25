import { IsIn } from 'class-validator';

export class ExchangeControlDto {
  @IsIn(['OPEN', 'MUTED', 'CLOSED'])
  control!: 'OPEN' | 'MUTED' | 'CLOSED';
}
