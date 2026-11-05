import { IsString, IsNotEmpty, IsOptional, IsEnum, IsBoolean, IsDateString, IsObject } from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';
import { Transform } from 'class-transformer';
import { sanitizeHtmlContent, sanitizeAnnouncementMetadata } from '../../common/html-sanitize.util';

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

  @EmptyAsUndefined()
  @IsDateString() @IsOptional()
  publishDate?: string;

  @EmptyAsUndefined()
  @IsBoolean() @IsOptional()
  isTop?: boolean;

  @IsString() @IsOptional()
  relatedProjectCode?: string;

  // objectionContact 等富文本键写时消毒（2026-11-05）——:3002/:3004 详情页直接 innerHTML 渲染
  @Transform(({ value }) => sanitizeAnnouncementMetadata(value))
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

  @EmptyAsUndefined()
  @IsDateString() @IsOptional()
  publishDate?: string;

  @EmptyAsUndefined()
  @IsBoolean() @IsOptional()
  isTop?: boolean;

  @IsString() @IsOptional()
  relatedProjectCode?: string;

  @Transform(({ value }) => sanitizeAnnouncementMetadata(value))
  @IsObject() @IsOptional()
  metadata?: Record<string, any>;
}
