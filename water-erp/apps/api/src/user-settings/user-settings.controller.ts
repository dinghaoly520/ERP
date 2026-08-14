import { Controller, Get, Patch, Body, Req } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AUTHENTICATED_ROLES } from '../auth/auth-scope';
import { Roles } from '../common/decorators/roles.decorator';
import { UserSettingsService } from './user-settings.service';
import { UpdateUserSettingsDto } from './dto/update-user-settings.dto';
import { AuditService } from '../audit/audit.service';

@Controller('user-settings')
@Roles(...AUTHENTICATED_ROLES)
export class UserSettingsController {
  constructor(
    private readonly userSettings: UserSettingsService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async getSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.userSettings.getOrCreateSettings(user.sub);
  }

  @Patch()
  async updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateUserSettingsDto,
    @Req() req: any,
  ) {
    const result = await this.userSettings.updateSettings(user.sub, dto);
    // 审计：偏好设置修改
    this.auditService.logFromRequest(req, {
      action: 'SETTINGS_UPDATE',
      resourceType: 'user-settings',
      resourceId: user.sub,
      details: { updatedFields: Object.keys(dto).filter(k => dto[k as keyof typeof dto] !== undefined) },
    }).catch(() => { /* 审计静默失败 */ });
    return result;
  }
}
