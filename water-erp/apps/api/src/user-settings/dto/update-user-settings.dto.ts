import { IsString, IsBoolean, IsOptional, IsIn, IsObject } from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';

export class UpdateUserSettingsDto {
  @EmptyAsUndefined()
  @IsOptional()
  @IsString()
  @IsIn(['light', 'dark', 'system'])
  theme?: 'light' | 'dark' | 'system';

  @EmptyAsUndefined()
  @IsOptional()
  @IsString()
  // 落地页候选=工作台全部一级业务页（2026-11-09 用户裁定扩全；与前端 HOME_PAGE_OPTIONS、
  // login-routing HOME_PAGE_ROUTES 三处同口径维护）；DB 列为 String，扩值零迁移
  @IsIn([
    'dashboard', 'procurements', 'progress', 'projects', 'work-arrangements',
    'tender-write', 'tender-review', 'notice', 'clar-notice', 'notifications',
    'supplier', 'expert',
  ])
  defaultHomePage?:
    | 'dashboard' | 'procurements' | 'progress' | 'projects' | 'work-arrangements'
    | 'tender-write' | 'tender-review' | 'notice' | 'clar-notice' | 'notifications'
    | 'supplier' | 'expert';

  @EmptyAsUndefined()
  @IsOptional()
  @IsBoolean()
  compactMode?: boolean;

  @IsOptional()
  @IsObject()
  notificationPrefs?: Record<string, boolean>;

  @EmptyAsUndefined()
  @IsOptional()
  @IsString()
  defaultReviewKbId?: string;
}
