import { IsString, IsOptional } from 'class-validator';

export class ApproveChangeDto {
  @IsString() @IsOptional()
  rejectReason?: string;
}