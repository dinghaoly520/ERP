import { IsString, IsNotEmpty, IsOptional, IsEnum, IsBoolean, IsDateString, IsObject } from 'class-validator';

export class CreateAnnouncementDto {
  @IsString() @IsNotEmpty()
  title: string;

  @IsString() @IsNotEmpty()
  content: string;

  @IsString() @IsNotEmpty()
  type: string; // BID_NOTICE, WIN_NOTICE, POLICY, PLATFORM

  @IsString() @IsOptional()
  summary?: string;

  @IsString() @IsOptional()
  aiSummary?: string;

  @IsDateString() @IsOptional()
  publishDate?: string;

  @IsBoolean() @IsOptional()
  isTop?: boolean;

  @IsString() @IsOptional()
  relatedProjectCode?: string;

  @IsObject() @IsOptional()
  metadata?: Record<string, any>;

  @IsString() @IsOptional()
  status?: string; // DRAFT | PUBLISHED | ARCHIVED，缺省按 DRAFT（起草后发布）
}

export class UpdateAnnouncementDto {
  @IsString() @IsOptional()
  title?: string;

  @IsString() @IsOptional()
  content?: string;

  @IsString() @IsOptional()
  type?: string;

  @IsString() @IsOptional()
  summary?: string;

  @IsString() @IsOptional()
  aiSummary?: string;

  @IsString() @IsOptional()
  status?: string;

  @IsDateString() @IsOptional()
  publishDate?: string;

  @IsBoolean() @IsOptional()
  isTop?: boolean;

  @IsString() @IsOptional()
  relatedProjectCode?: string;

  @IsObject() @IsOptional()
  metadata?: Record<string, any>;
}
