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
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';

export class InitiationAttachmentDto {
  @IsString()
  @IsNotEmpty({ message: '附件文件名不能为空' })
  fileName!: string;

  @IsString()
  @IsNotEmpty({ message: '附件存储键不能为空' })
  objectKey!: string;

  @IsString()
  @IsNotEmpty({ message: '附件类型不能为空' })
  mimeType!: string;

  @IsNumber({}, { message: '附件大小应为不小于 1 的数字' })
  @Min(1, { message: '附件大小应不小于 1' })
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

  @EmptyAsUndefined()
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
  @IsString({ message: '需求申请人应为文本' })
  @IsNotEmpty({ message: '需求申请人不能为空' })
  requesterName!: string;

  @IsString({ message: '需求部门应为文本' })
  @IsNotEmpty({ message: '需求部门不能为空' })
  requesterDepartment!: string;

  /** 部门编号：人工传入尊重人工；缺省按 部门编码-年度-顺序号 自动发号（16a8ac1c） */
  @IsString()
  @IsOptional()
  departmentNumber?: string;

  @IsString({ message: '采购事项名称应为文本' })
  @IsNotEmpty({ message: '采购事项名称不能为空' })
  procurementTitle!: string;

  @IsString({ message: '采购方式应为文本' })
  @IsNotEmpty({ message: '请选择采购方式' })
  procurementMethod!: string;

  @IsString()
  @IsOptional()
  procurementCategory!: string;

  @IsString()
  @IsOptional()
  procurementOrganizationForm!: string;

  @Type(() => Number)
  @IsNumber({}, { message: '预算金额应为数字' })
  @Min(0, { message: '预算金额应不小于 0' })
  budgetAmount!: number;

  @Type(() => Boolean)
  @IsBoolean({ message: '年度预算标识应为布尔值' })
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
