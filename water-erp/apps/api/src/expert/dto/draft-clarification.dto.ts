import { IsString, IsNotEmpty } from 'class-validator';

export class DraftClarificationDto {
  @IsString() @IsNotEmpty()
  supplierId: string;
}
