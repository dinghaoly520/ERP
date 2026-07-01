import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

export type AuditAction =
  | 'LOGIN'
  | 'LOGOUT'
  | 'PASSWORD_CHANGE_REQUEST'
  | 'PASSWORD_CHANGE_APPROVED'
  | 'PASSWORD_CHANGE_REJECTED'
  | 'PASSWORD_RESET_REQUEST'
  | 'PASSWORD_RESET_APPROVED'
  | 'PASSWORD_RESET_REJECTED'
  | 'SETTINGS_UPDATE';

export type CreateAuditLogInput = {
  userId: string;
  action: AuditAction | string;
  resourceType: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
};

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Daily cleanup at 3:00 AM — removes audit logs older than 90 days */
  @Cron('0 3 * * *')
  async scheduledCleanup() {
    try {
      const count = await this.cleanupOldLogs(90);
      if (count > 0) {
        this.logger.log(`Scheduled audit log cleanup: removed ${count} old entries`);
      }
    } catch (err) {
      this.logger.warn(`Scheduled audit log cleanup failed: ${err}`);
    }
  }

  async log(input: CreateAuditLogInput) {
    return this.prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        details: input.details as any,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  }

  async getUserActivities(
    userId: string,
    options?: {
      limit?: number;
      offset?: number;
      actions?: string[];
    },
  ) {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const where = {
      userId,
      ...(options?.actions && options.actions.length > 0
        ? { action: { in: options.actions } }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total };
  }

  async cleanupOldLogs(daysToKeep: number = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await this.prisma.auditLog.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
    });

    return result.count;
  }

  async getAllActivities(
    options?: {
      limit?: number;
      offset?: number;
      userId?: string;
      actions?: string[];
    },
  ) {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const where: Record<string, unknown> = {};
    if (options?.userId) {
      where.userId = options.userId;
    }
    if (options?.actions && options.actions.length > 0) {
      where.action = { in: options.actions };
    }

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          user: {
            select: { id: true, displayName: true, username: true },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total };
  }
}
