import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserSettingsDto } from './dto/update-user-settings.dto';

@Injectable()
export class UserSettingsService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async getOrCreateSettings(userId: string) {
    return this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  async updateSettings(userId: string, dto: UpdateUserSettingsDto) {
    const settings = await this.getOrCreateSettings(userId);

    const result = await this.prisma.userSettings.update({
      where: { id: settings.id },
      data: {
        ...(dto.theme !== undefined && { theme: dto.theme }),
        ...(dto.defaultHomePage !== undefined && {
          defaultHomePage: dto.defaultHomePage,
        }),
        ...(dto.compactMode !== undefined && { compactMode: dto.compactMode }),
        ...(dto.notificationPrefs !== undefined && { notificationPrefs: dto.notificationPrefs }),
      },
    });

    return result;
  }
}
