import { IsString, IsBoolean, IsOptional, IsIn } from 'class-validator';

export class UpdateUserSettingsDto {
  @IsOptional()
  @IsString()
  @IsIn(['light', 'dark', 'system'])
  theme?: 'light' | 'dark' | 'system';

  @IsOptional()
  @IsString()
  @IsIn(['dashboard', 'procurements', 'projects', 'work-arrangements'])
  defaultHomePage?:
    | 'dashboard'
    | 'procurements'
    | 'projects'
    | 'work-arrangements';

  @IsOptional()
  @IsBoolean()
  compactMode?: boolean;
}
