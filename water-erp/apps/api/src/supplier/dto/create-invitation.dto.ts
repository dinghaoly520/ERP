import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateInvitationDto {
  @IsInt()
  validityDays: number; // 仅允许 30 / 180 / 360（service 层校验）

  @IsString() @IsOptional() @MaxLength(200)
  note?: string;
}
