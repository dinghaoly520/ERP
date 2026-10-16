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
      // 主题默认浅色（2026-10-16 用户裁定）；schema @default("system") 未动——并行会话占用共享 schema.prisma，勿在 create 之外依赖该默认
      create: { userId, theme: 'light' },
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
