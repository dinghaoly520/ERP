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
  @IsIn(['dashboard', 'procurements', 'projects', 'work-arrangements'])
  defaultHomePage?:
    | 'dashboard'
    | 'procurements'
    | 'projects'
    | 'work-arrangements';

  @EmptyAsUndefined()
  @IsOptional()
  @IsBoolean()
  compactMode?: boolean;

  @IsOptional()
  @IsObject()
  notificationPrefs?: Record<string, boolean>;
}
