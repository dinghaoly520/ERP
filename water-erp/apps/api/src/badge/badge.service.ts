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

    // 1.5 清理已下线的印记（如 2026-11-03 退役的 no_return）——残留行会继续出现在个人中心
    const liveCodes = BADGE_DEFINITIONS.map(d => d.code);
    await this.prisma.userBadge.deleteMany({ where: { badgeCode: { notIn: liveCodes } } });
    await this.prisma.badgeDefinition.deleteMany({ where: { code: { notIn: liveCodes } } });

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
            action: { in: ['SUPPLIER_APPROVED', 'SUPPLIER_APPROVE'] },
          },
        });

      case 'publish_master':
        // 2026-11-03 修正：原口径统计 AuditLog.ANNOUNCEMENT_CREATE/PUBLISH——公告域从不写这两个动作
        // （发布留痕在 Notification，AuditLog 零条），恒为 0 的死口径。真数据=本人署名已发布公告数。
        return this.prisma.announcement.count({
          where: { authorId: userId, status: 'PUBLISHED' },
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

      case 'evaluation_master':
        // 本人完成的供应商履约评价次数（2026-11-03 替换「零退回」）
        return this.prisma.supplierEvaluation.count({
          where: { evaluatorId: userId },
        });

      default:
        return 0;
    }
  }

  /** 获取用户的印记列表（含定义） */
  async getUserBadges(userId: string) {
    // 先确保定义存在
    await this.ensureDefinitions();

    const rows = await this.prisma.userBadge.findMany({
      // 仅返回现行印记（已下线 code 的存量行不外露，清理见 recomputeAll）
      where: { userId, badgeCode: { in: BADGE_DEFINITIONS.map(d => d.code) } },
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

  /** 手动重算当前用户（2026-11-03：原控制器「已请求后台重算」是空操作假反馈） */
  async recomputeCurrentUser(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, createdAt: true },
    });
    if (!u) return { ok: false as const, badges: [] };
    // 新定义先行入库（UserBadge.badgeCode 有 FK——首次引入 evaluation_master 时旧库无此行即撞约束）
    await this.ensureDefinitions();
    // 顺带清理本人已下线印记行；BadgeDefinition 层面的清理只在全量路径（recomputeAll）做——
    // 其他用户的 UserBadge 仍引用旧定义行，单用户路径删定义必撞 FK
    const liveCodes = BADGE_DEFINITIONS.map(d => d.code);
    await this.prisma.userBadge.deleteMany({ where: { userId, badgeCode: { notIn: liveCodes } } });
    await this.recomputeUser(u.id, u.createdAt);
    return { ok: true as const, badges: await this.getUserBadges(userId) };
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
