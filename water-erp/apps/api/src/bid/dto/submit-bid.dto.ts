import { IsString, IsNotEmpty } from 'class-validator';

export class SubmitBidDto {
  @IsString() @IsNotEmpty() supplierName: string;
}
