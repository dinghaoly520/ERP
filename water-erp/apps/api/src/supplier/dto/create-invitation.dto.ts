import { IsInt, IsOptional, IsString, MaxLength, Matches } from 'class-validator';

export class CreateInvitationDto {
  @IsInt()
  validityDays: number; // 仅允许 30 / 180 / 360（service 层校验）

  @IsString() @IsOptional() @MaxLength(200)
  note?: string;

  @IsString() @IsOptional() @Matches(/^[0-9A-Z]{18}$/, { message: '绑定信用代码须为 18 位' })
  boundCreditCode?: string; // R-3：绑定统一社会信用代码（可选，仅该企业可用此码）
}
