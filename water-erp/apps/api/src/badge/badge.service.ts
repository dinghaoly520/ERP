import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  BADGE_DEFINITIONS,
  resolveLevel,
  LEVEL_ORDER,
  type BadgeLevel,
} from './badge.definitions';

@Injectable()
export class BadgeService {
  private readonly logger = new Logger(BadgeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 每日凌晨 3:30 重算所有用户的印记进度 */
  @Cron('30 3 * * *')
  async scheduledRecompute() {
    try {
      await this.recomputeAll();
    } catch (err) {
      this.logger.error(`Scheduled badge recompute failed: ${err}`);
    }
  }

  /** 全量重算（写入 BadgeDefinition + 所有 UserBadge） */
  async recomputeAll() {
    // 1. 确保 BadgeDefinition 全部入库
    for (const def of BADGE_DEFINITIONS) {
      await this.prisma.badgeDefinition.upsert({
        where: { code: def.code },
        update: {
          name: def.name,
          category: def.category,
          description: def.description,
          iconKey: def.iconKey,
          unit: def.unit,
          levelThresholds: def.levelThresholds as any,
        },
        create: {
          code: def.code,
          name: def.name,
          category: def.category,
          description: def.description,
          iconKey: def.iconKey,
          unit: def.unit,
          levelThresholds: def.levelThresholds as any,
        },
      });
    }

    // 2. 拉所有用户
    const users = await this.prisma.user.findMany({ select: { id: true, createdAt: true } });
    this.logger.log(`Recomputing badges for ${users.length} users...`);

    for (const user of users) {
      await this.recomputeUser(user.id, user.createdAt);
    }
  }

  /** 重算单个用户 */
  async recomputeUser(userId: string, userCreatedAt: Date) {
    for (const def of BADGE_DEFINITIONS) {
      const value = await this.computeValue(def.code, userId, userCreatedAt);
      const thresholds = def.levelThresholds as Record<string, number>;
      const newLevel = resolveLevel(value, thresholds);

      // 读已有记录（用于比对等级是否变化）
      const existing = await this.prisma.userBadge.findUnique({
        where: { userId_badgeCode: { userId, badgeCode: def.code } },
      });

      // 构造 awardedLevels
      const awarded: Record<string, string> = existing?.awardedLevels as any ?? {};
      if (newLevel) {
        // 如果新等级之前没记录过，盖上当前时间
        if (!awarded[newLevel]) {
          awarded[newLevel] = new Date().toISOString();
        }
        // 同时补全所有低于 newLevel 的等级（应该都已达成）
        const idx = LEVEL_ORDER.indexOf(newLevel);
        for (let i = 0; i < idx; i++) {
          const lower = LEVEL_ORDER[i];
          if (!awarded[lower]) awarded[lower] = new Date().toISOString();
        }
      }

      await this.prisma.userBadge.upsert({
        where: { userId_badgeCode: { userId, badgeCode: def.code } },
        update: {
          currentValue: value,
          currentLevel: newLevel,
          awardedLevels: awarded as any,
        },
        create: {
          userId,
          badgeCode: def.code,
          currentValue: value,
          currentLevel: newLevel,
          awardedLevels: awarded as any,
        },
      });
    }
  }

  /** 印记值计算路由 */
  private async computeValue(
    code: string,
    userId: string,
    userCreatedAt: Date,
  ): Promise<number> {
    switch (code) {
      case 'approval_master':
        return this.prisma.auditLog.count({
          where: {
            userId,
            action: { in: ['SUPPLIER_APPROVED', 'SUPPLIER_APPROVE', 'CATALOG_APPROVE'] },
          },
        });

      case 'publish_master':
        return this.prisma.auditLog.count({
          where: {
            userId,
            action: { in: ['ANNOUNCEMENT_CREATE', 'ANNOUNCEMENT_PUBLISH'] },
          },
        });

      case 'project_master':
        // 用户创建的项目数（ProjectManagementItem.createdById）
        return this.prisma.projectManagementItem.count({
          where: { createdById: userId },
        });

      case 'tenure': {
        const ms = Date.now() - userCreatedAt.getTime();
        return Math.max(0, Math.floor(ms / 86_400_000));
      }

      case 'no_return':
        // 从最近一次退回开始计数连续无退回审批
        return this.computeNoReturnStreak(userId);

      default:
        return 0;
    }
  }

  /** 连续审批无退回次数：从最后一次 SUPPLIER_RETURNED 之后的 SUPPLIER_APPROVED 次数 */
  private async computeNoReturnStreak(userId: string): Promise<number> {
    const lastReturn = await this.prisma.auditLog.findFirst({
      where: {
        userId,
        action: { in: ['SUPPLIER_RETURNED', 'SUPPLIER_RETURN'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    return this.prisma.auditLog.count({
      where: {
        userId,
        action: { in: ['SUPPLIER_APPROVED', 'SUPPLIER_APPROVE'] },
        ...(lastReturn ? { createdAt: { gt: lastReturn.createdAt } } : {}),
      },
    });
  }

  /** 获取用户的印记列表（含定义） */
  async getUserBadges(userId: string) {
    // 先确保定义存在
    await this.ensureDefinitions();

    const rows = await this.prisma.userBadge.findMany({
      where: { userId },
      include: { badge: true },
    });

    // 补齐未计算过的印记（返回 currentValue=0）
    const seen = new Set(rows.map(r => r.badgeCode));
    const missing = BADGE_DEFINITIONS.filter(d => !seen.has(d.code));

    return [
      ...rows.map(r => ({
        code: r.badgeCode,
        name: r.badge.name,
        category: r.badge.category,
        description: r.badge.description,
        iconKey: r.badge.iconKey,
        unit: r.badge.unit,
        currentValue: r.currentValue,
        currentLevel: r.currentLevel as BadgeLevel | null,
        awardedLevels: r.awardedLevels as Record<string, string>,
        thresholds: r.badge.levelThresholds as Record<string, number>,
      })),
      ...missing.map(d => ({
        code: d.code,
        name: d.name,
        category: d.category,
        description: d.description,
        iconKey: d.iconKey,
        unit: d.unit,
        currentValue: 0,
        currentLevel: null as BadgeLevel | null,
        awardedLevels: {} as Record<string, string>,
        thresholds: d.levelThresholds as Record<string, number>,
      })),
    ];
  }

  private async ensureDefinitions() {
    for (const def of BADGE_DEFINITIONS) {
      await this.prisma.badgeDefinition.upsert({
        where: { code: def.code },
        update: {},
        create: {
          code: def.code,
          name: def.name,
          category: def.category,
          description: def.description,
          iconKey: def.iconKey,
          unit: def.unit,
          levelThresholds: def.levelThresholds as any,
        },
      });
    }
  }
}
