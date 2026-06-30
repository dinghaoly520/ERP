import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

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
  procurementCategory?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  budgetAmount?: number;

  @IsString()
  @IsOptional()
  projectReason?: string;

  @IsString()
  @IsOptional()
  supplierRequirements?: string;

  // 需求表独有字段
  @IsString()
  @IsOptional()
  demandProject?: string;

  @IsString()
  @IsOptional()
  demandContractNumber?: string;
}

export class DemandAttachmentDto {
  @IsString()
  fileName!: string;

  @IsString()
  objectKey!: string;

  @IsString()
  mimeType!: string;

  @IsNumber()
  @Min(1)
  fileSize!: number;

  @IsString()
  @IsOptional()
  uploadedById?: string;
}
