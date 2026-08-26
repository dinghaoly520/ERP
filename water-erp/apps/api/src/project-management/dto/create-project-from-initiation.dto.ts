import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class InitiationAttachmentDto {
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsString()
  @IsNotEmpty()
  objectKey!: string;

  @IsString()
  @IsNotEmpty()
  mimeType!: string;

  @IsNumber()
  @Min(1)
  fileSize!: number;

  @IsString()
  @IsOptional()
  uploadedById?: string;
}

export class DemandAttachmentDto {
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsString()
  @IsNotEmpty()
  objectKey!: string;

  @IsString()
  @IsNotEmpty()
  mimeType!: string;

  @IsNumber()
  @Min(1)
  fileSize!: number;

  @IsString()
  @IsOptional()
  uploadedById?: string;
}

export class DemandFieldsDto {
  @IsString()
  @IsOptional()
  requesterName?: string;

  @IsString()
  @IsOptional()
  requesterDepartment?: string;

  @IsString()
  @IsOptional()
  procurementTitle?: string;

  @IsString()
  @IsOptional()
  projectReason?: string;

  @IsString()
  @IsOptional()
  supplierRequirements?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  budgetAmount?: number;

  @IsString()
  @IsOptional()
  procurementCategory?: string;

  @IsString()
  @IsOptional()
  procurementMethod?: string;

  @IsString()
  @IsOptional()
  demandProject?: string;

  @IsString()
  @IsOptional()
  demandContractNumber?: string;

  @IsString()
  @IsOptional()
  departmentNumber?: string;
}

export class CreateProjectFromInitiationDto {
  @IsString()
  @IsNotEmpty()
  requesterName!: string;

  @IsString()
  @IsNotEmpty()
  requesterDepartment!: string;

  @IsString()
  @IsNotEmpty()
  procurementTitle!: string;

  @IsString()
  @IsNotEmpty()
  procurementMethod!: string;

  @IsString()
  @IsOptional()
  procurementCategory!: string;

  @IsString()
  @IsOptional()
  procurementOrganizationForm!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  budgetAmount!: number;

  @Type(() => Boolean)
  @IsBoolean()
  isAnnualBudget!: boolean;

  @IsString()
  @IsOptional()
  projectReason!: string;

  @IsString()
  @IsOptional()
  supplierRequirements!: string;

  // B1（GB/T 43711 7.2.1.2）：采购方案其余要素
  @IsString()
  @IsOptional()
  implementerName?: string;

  @IsString()
  @IsOptional()
  contractPricingType?: string;

  @IsString()
  @IsOptional()
  sectionPlan?: string;

  @IsString()
  @IsOptional()
  activitySchedule?: string;

  @IsString()
  @IsOptional()
  riskMeasures?: string;

  @IsString()
  @IsOptional()
  initiationDate?: string;

  @ValidateNested()
  @Type(() => InitiationAttachmentDto)
  @IsOptional()
  initiationAttachment?: InitiationAttachmentDto;

  @IsString()
  @IsOptional()
  createdById?: string;

  // 采购需求表相关
  @Type(() => Boolean)
  @IsBoolean()
  hasProcurementDemand!: boolean;

  @ValidateNested()
  @Type(() => DemandFieldsDto)
  @IsOptional()
  demandFields?: DemandFieldsDto;

  @ValidateNested()
  @Type(() => DemandAttachmentDto)
  @IsOptional()
  demandAttachment?: DemandAttachmentDto;
}
