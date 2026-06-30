import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { UserSettingsService } from './user-settings.service';
import { UpdateUserSettingsDto } from './dto/update-user-settings.dto';

@Controller('user-settings')
@UseGuards(AuthGuard)
export class UserSettingsController {
  constructor(private readonly userSettings: UserSettingsService) {}

  @Get()
  async getSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.userSettings.getOrCreateSettings(user.sub);
  }

  @Patch()
  async updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateUserSettingsDto,
  ) {
    return this.userSettings.updateSettings(user.sub, dto);
  }
}
