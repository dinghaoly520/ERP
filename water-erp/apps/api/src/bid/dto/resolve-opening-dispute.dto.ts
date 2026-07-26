import { IsString, IsNotEmpty, IsBoolean } from 'class-validator';

/** 主持人处理开标异议：confirm=true 确认受理（供应商 CONFIRMED），false 退回异议（EXCEPTION）。 */
export class ResolveOpeningDisputeDto {
  @IsString()
  @IsNotEmpty()
  result: string;

  @IsBoolean()
  confirm: boolean;
}
