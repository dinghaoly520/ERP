import { IsOptional, IsString, IsNumber } from 'class-validator';

export class UpdateExtractedInfoDto {
  @IsOptional()
  @IsString()
  title?: string;

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

  // B1（GB/T 43711 7.2.1.2 采购方案要素）
  @IsOptional()
  @IsString()
  implementerName?: string;

  @IsOptional()
  @IsString()
  contractPricingType?: string;

  @IsOptional()
  @IsString()
  sectionPlan?: string;

  @IsOptional()
  @IsString()
  activitySchedule?: string;

  @IsOptional()
  @IsString()
  riskMeasures?: string;

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

  // ── 新增：分步骤展示字段 ──
  @IsOptional()
  @IsString()
  projectOverview?: string;

  @IsOptional()
  @IsString()
  bidOpeningTime?: string;

  @IsOptional()
  @IsString()
  documentAcquireTime?: string;

  @IsOptional()
  @IsString()
  invitedSuppliers?: string;

  @IsOptional()
  @IsString()
  paymentPerformance?: string;

  // ── 新增：项目基本信息可编辑字段 ──
  @IsOptional()
  @IsString()
  requesterName?: string;

  @IsOptional()
  @IsString()
  requesterDepartment?: string;

  @IsOptional()
  @IsString()
  procurementMethod?: string;

  @IsOptional()
  @IsString()
  procurementCategory?: string;

  @IsOptional()
  @IsNumber()
  budgetAmount?: number;

  // ── 新增：申请立项事由 / 对供方的主要要求（可手动编辑）──
  @IsOptional()
  @IsString()
  projectReason?: string;

  @IsOptional()
  @IsString()
  supplierRequirements?: string;
}
