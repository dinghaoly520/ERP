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
  | 'SETTINGS_UPDATE'
  | 'PROFILE_UPDATE'
  // ── 供应商（兼容已有 action 名）──
  | 'SUPPLIER_APPROVED'
  | 'SUPPLIER_REJECTED'
  | 'SUPPLIER_RETURNED'
  | 'SUPPLIER_APPROVE'
  | 'SUPPLIER_REJECT'
  | 'SUPPLIER_RETURN'
  | 'SUPPLIER_DISABLE'
  | 'SUPPLIER_ENABLE'
  | 'SUPPLIER_BLACKLIST'
  | 'SUPPLIER_UPDATE'
  // ── 项目 ──
  | 'PROJECT_CREATE'
  | 'PROJECT_UPDATE'
  | 'PROJECT_DELETE'
  | 'PROJECT_RECYCLE'
  | 'PROJECT_RESTORE'
  | 'PROJECT_STAGE_CHANGE'
  | 'PROJECT_ARCHIVE'
  // ── 公告 ──
  | 'ANNOUNCEMENT_CREATE'
  | 'ANNOUNCEMENT_PUBLISH'
  | 'ANNOUNCEMENT_UPDATE'
  | 'ANNOUNCEMENT_DELETE'
  // ── 招标文件 ──
  | 'TENDER_CREATE'
  | 'TENDER_UPDATE'
  | 'TENDER_EXPORT'
  | 'TENDER_REVIEW'
  // ── 专家 ──
  | 'EXPERT_CREATE'
  | 'EXPERT_EXTRACT'
  | 'EXPERT_EVALUATE'
  | 'EXPERT_DISABLE'
  | 'EXPERT_ENABLE'
  // ── 文件 ──
  | 'FILE_UPLOAD'
  | 'FILE_DELETE'
  // ── 其他 ──
  | 'CATALOG_IMPORT'
  | 'CATALOG_EXPORT'
  | 'CATALOG_APPROVE'
  | 'CATALOG_REJECT';

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

  private extractHeader(
    headers: Record<string, string | string[] | undefined> | undefined,
    key: string,
  ): string | undefined {
    const val = headers?.[key];
    if (Array.isArray(val)) return val[0];
    if (typeof val === 'string') return val;
    return undefined;
  }

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

  /**
   * Controller 端便捷方法：自动从请求中提取 IP/UA。
   */
  logFromRequest(
    req: { user?: { id: string }; ip?: string; headers?: Record<string, string | string[] | undefined> },
    input: Omit<CreateAuditLogInput, 'userId' | 'ipAddress' | 'userAgent'> & { userId?: string },
  ) {
    const ip = (req.ip || this.extractHeader(req.headers, 'x-forwarded-for') || this.extractHeader(req.headers, 'x-real-ip')) as string | undefined;
    const ua = this.extractHeader(req.headers, 'user-agent') as string | undefined;
    return this.log({
      userId: input.userId ?? req.user?.id ?? 'unknown',
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      details: input.details,
      ipAddress: ip ?? undefined,
      userAgent: ua ?? undefined,
    });
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
