import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  IsArray,
  IsIn,
  IsObject,
  IsEmail,
  IsDateString,
  ArrayMaxSize,
} from 'class-validator';

/**
 * 更新专家资料：逐字段带校验装饰器（全部可选）。
 * 不能用 TS 的 `Partial<CreateExpertDto>` —— 映射类型运行时 metatype 为 Object，
 * 会被 ValidationPipe 直接跳过（无校验、无 whitelist），非法 email 等可写入。
 * 不含 username/password（资料编辑不改登录凭证）。
 */
export class UpdateExpertProfileDto {
  @IsOptional() @IsString() displayName?: string;
  @IsOptional() @IsString() specialty?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() employer?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() idNumber?: string;
  @IsOptional() @IsString() ethnicity?: string;
  @IsOptional() @IsString() education?: string;
  @IsOptional() @IsString() licenseNo?: string;
  @IsOptional() @IsIn(['可用', '占用', '停用']) availability?: '可用' | '占用' | '停用';
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() notes?: string;
}

/** AI 生成单专家个性化通知内容 */
export class GenerateNotificationDto {
  @IsString() projectName!: string;
  @IsString() expertName!: string;
  @IsBoolean() isLead!: boolean;
  @IsInt() totalExperts!: number;
  @IsString() extractMode!: string;
  @IsString() openTime!: string;
  @IsOptional() @IsBoolean() isAlternate?: boolean;
  @IsOptional() @IsString() projectId?: string;
}

/** 批量启用/停用专家 */
export class BatchOperationDto {
  @IsIn(['enable', 'disable']) action!: 'enable' | 'disable';
  @IsArray() @IsString({ each: true }) ids!: string[];
  @IsOptional() @IsString() reason?: string;
}

/** CSV 批量导入专家 */
export class ImportCsvDto {
  @IsArray() @IsObject({ each: true }) rows!: Array<Record<string, string>>;
}

/** 记录专家违规 */
export class RecordViolationDto {
  @IsString() type!: string;
  @IsString() detail!: string;
  @IsIn(['warning', 'danger']) severity!: 'warning' | 'danger';
}

/** 更新专家通知偏好 */
export class NotifyPrefsDto {
  @IsOptional() @IsBoolean() inApp?: boolean;
  @IsOptional() @IsBoolean() sms?: boolean;
  @IsOptional() @IsBoolean() phone?: boolean;
}

/** 资质 OCR 自动录入 */
export class OcrIntakeDto {
  @IsString() imageBase64!: string;
  @IsOptional() @IsString() mimeType?: string;
  @IsOptional() @IsString() filename?: string;
}

/** AI 辅助评价建议 */
export class AiSuggestEvaluationDto {
  @IsString() @IsNotEmpty()
  expertUserId!: string;
}

/** 自定义抽取：分析已上传文件，AI 推断项目背景与所需专业/人数 */
export class AnalyzeExtractionFilesDto {
  @IsArray() @IsString({ each: true }) @ArrayMaxSize(10)
  fileIds!: string[];
}

/** 已有项目 AI 推断专业配额（不抽取，仅分析项目返回推荐专业） */
export class AnalyzeProjectDto {
  @IsString() @IsNotEmpty()
  projectId!: string;
}

/** 自定义抽取：创建影子项目（仅承载抽取/通知/确认，不进项目管理列表） */
export class CreateCustomProjectDto {
  @IsString() @IsNotEmpty()
  name!: string;
  @IsOptional() @IsString() procurementMethod?: string;
  @IsOptional() @IsString() background?: string;
  @IsOptional() @IsDateString() openTime?: string;
  @IsOptional() @IsDateString() deadline?: string;
}
