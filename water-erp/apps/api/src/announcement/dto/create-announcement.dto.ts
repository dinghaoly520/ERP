import { IsString, IsNotEmpty, IsOptional, IsEnum, IsBoolean, IsDateString, IsObject, IsArray } from 'class-validator';
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

  // 公示截止（2026-11-06 用户裁定）：流标/中标公告公示期限改为起止选择（与采购公告同款），
  // 所选止点直供公开端显示窗口（期满标题壳）；仅这两类生效，其余类型忽略（维持自动顺延）
  @EmptyAsUndefined()
  @IsDateString() @IsOptional()
  publicityEnd?: string;

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

  /** 经办人确认被本次发布替换的待发定时公告（2026-11-24 用户裁定）：同项目同类型已有定时待发
   *  草稿时发布默认被拒；发布向导弹窗确认后携这些 id 放行——旧草稿移入回收站并拆定时。
   *  须覆盖全部同键待发草稿，否则整体 409（不做部分替换）。 */
  @IsArray() @IsString({ each: true }) @IsOptional()
  supersedePendingScheduledIds?: string[];
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

  // 同 Create（2026-11-06）：流标/中标公告编辑/定时发布路径直供公示截止
  @EmptyAsUndefined()
  @IsDateString() @IsOptional()
  publicityEnd?: string;

  @EmptyAsUndefined()
  @IsBoolean() @IsOptional()
  isTop?: boolean;

  @IsString() @IsOptional()
  relatedProjectCode?: string;

  @Transform(({ value }) => sanitizeAnnouncementMetadata(value))
  @IsObject() @IsOptional()
  metadata?: Record<string, any>;
}
