import { IsString, IsNotEmpty, IsOptional, IsEnum, IsBoolean, IsDateString, IsObject } from 'class-validator';
import { Transform } from 'class-transformer';
import { sanitizeHtmlContent } from '../../common/html-sanitize.util';

export class CreateAnnouncementDto {
  @IsString() @IsNotEmpty()
  title: string;

  // 写时消毒 HTML，剥离 script/事件处理器/危险协议，防存储型 XSS
  @Transform(({ value }) => (value ? sanitizeHtmlContent(value) : value))
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

  @Transform(({ value }) => (value ? sanitizeHtmlContent(value) : value))
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
