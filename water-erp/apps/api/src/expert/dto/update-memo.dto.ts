import { IsOptional, IsString } from 'class-validator';

export class UpdateMemoDto {
  @IsOptional()
  @IsString()
  contentText?: string;
}
