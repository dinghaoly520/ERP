import { IsString, IsNotEmpty, IsISO8601 } from 'class-validator';

export class StartOpeningDto {
  @IsString() @IsNotEmpty()
  host: string;

  @IsString() @IsNotEmpty()
  supervisor: string;

  @IsISO8601()
  decryptWindowStart: string;

  @IsISO8601()
  decryptWindowEnd: string;
}
