import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { OperationLogEntry, OperationLogQuery } from './operation-log.types';

@Injectable()
export class OperationLogService {
  private readonly logger = new Logger(OperationLogService.name);
  private readonly retentionDays: number;

  constructor(private readonly prisma: PrismaService) {
    const raw = Number(process.env.OPERATION_LOG_RETENTION_DAYS);
    this.retentionDays = Number.isFinite(raw) && raw > 0 ? raw : 180;
  }

  /** fire-and-forget 落库；失败只 warn，绝不影响业务 */
  async create(entry: OperationLogEntry): Promise<void> {
    try {
      await this.prisma.operationLog.create({
        data: {
          userId: entry.userId,
          username: entry.username,
          role: entry.role,
          portal: entry.portal,
          method: entry.method,
          path: entry.path,
          query: entry.query,
          body: entry.body as Prisma.InputJsonValue,
          statusCode: entry.statusCode,
          durationMs: entry.durationMs,
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
          referer: entry.referer,
          error: entry.error,
        },
      });
    } catch (err) {
      this.logger.warn(`OperationLog 写入失败: ${err}`);
    }
  }

  /** 每日 04:00 清理超期记录（错开 AuditLog 的 03:00） */
  @Cron('0 4 * * *')
  async scheduledCleanup(): Promise<void> {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - this.retentionDays);
      const r = await this.prisma.operationLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
      if (r.count > 0) this.logger.log(`OperationLog 清理：删除 ${r.count} 条超过 ${this.retentionDays} 天的记录`);
    } catch (err) {
      this.logger.warn(`OperationLog 清理失败: ${err}`);
    }
  }

  async findAll(q: OperationLogQuery) {
    const limit = Math.min(q.limit ?? 50, 100);
    const offset = q.offset ?? 0;
    const where = this.buildWhere(q);
    const [items, total] = await Promise.all([
      this.prisma.operationLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      this.prisma.operationLog.count({ where }),
    ]);
    return { items, total };
  }

  async findMine(userId: string, q: OperationLogQuery) {
    const limit = Math.min(q.limit ?? 50, 100);
    const offset = q.offset ?? 0;
    const where: Prisma.OperationLogWhereInput = { ...this.buildWhere(q), userId };
    const [items, total] = await Promise.all([
      this.prisma.operationLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      this.prisma.operationLog.count({ where }),
    ]);
    return { items, total };
  }

  private buildWhere(q: OperationLogQuery): Prisma.OperationLogWhereInput {
    const where: Prisma.OperationLogWhereInput = {};
    if (q.userId) where.userId = q.userId;
    if (q.username) where.username = q.username;
    if (q.role) where.role = q.role;
    if (q.portal) where.portal = q.portal;
    if (q.method) where.method = q.method.toUpperCase();
    if (q.path) where.path = { contains: q.path };
    if (q.statusCode) where.statusCode = q.statusCode;
    else if (q.statusClass === 'success') where.statusCode = { gte: 200, lt: 400 };
    else if (q.statusClass === 'client') where.statusCode = { gte: 400, lt: 500 };
    else if (q.statusClass === 'server') where.statusCode = { gte: 500, lt: 600 };

    if (q.startTime || q.endTime) {
      where.createdAt = {};
      if (q.startTime) (where.createdAt as any).gte = new Date(q.startTime);
      if (q.endTime) (where.createdAt as any).lte = new Date(q.endTime);
    }
    if (q.keyword) {
      where.OR = [{ path: { contains: q.keyword } }, { query: { contains: q.keyword } }];
    }
    return where;
  }
}
