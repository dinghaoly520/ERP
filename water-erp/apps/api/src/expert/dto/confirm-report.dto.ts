import { IsString, IsOptional } from 'class-validator';

export class ConfirmReportDto {
  @IsString()
  @IsOptional()
  comment?: string;
}
