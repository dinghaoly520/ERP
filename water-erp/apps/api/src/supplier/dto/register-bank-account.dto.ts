import { IsString, IsNotEmpty, IsOptional, IsBoolean, MaxLength } from 'class-validator';

/** 供应商注册/变更时的银行账户入参 */
export class RegisterBankAccountDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  accountName: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  bankName: string;

  @IsString() @IsOptional() @MaxLength(100)
  bankBranch?: string;

  @IsString() @IsNotEmpty() @MaxLength(40)
  accountNo: string;

  @IsBoolean() @IsOptional()
  isDefault?: boolean;
}
