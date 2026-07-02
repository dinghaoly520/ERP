import { IsOptional, IsString, IsNumber } from 'class-validator';

export class UpdateExtractedInfoDto {
  @IsOptional()
  @IsString()
  initiationDate?: string;

  @IsOptional()
  @IsString()
  evaluationMethod?: string;

  @IsOptional()
  @IsString()
  expertInfo?: string;

  @IsOptional()
  @IsString()
  biddingUnits?: string;

  @IsOptional()
  @IsString()
  awardedSupplier?: string;

  @IsOptional()
  @IsNumber()
  contractAmount?: number;

  @IsOptional()
  @IsString()
  demandProject?: string;

  @IsOptional()
  @IsString()
  demandContractNumber?: string;

  @IsOptional()
  @IsString()
  contractNumber?: string;

  @IsOptional()
  @IsString()
  departmentNumber?: string;
}
