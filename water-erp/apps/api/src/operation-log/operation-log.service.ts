import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import * as zlib from 'zlib';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';
import type { OperationLogEntry, OperationLogQuery } from './operation-log.types';

/** 月分区名后缀校验（YYYY_MM）——拼进 DDL 前防御性校验，值全部由代码生成 */
const PARTITION_NAME_RE = /^\d{4}_\d{2}$/;

/** UTC 时间戳 → SQL 字符串字面量 'YYYY-MM-DD HH:MM:SS.mmm'（代码生成，无用户输入） */
function tsLiteral(ms: number): string {
  return new Date(ms).toISOString().slice(0, 23).replace('T', ' ');
}

@Injectable()
export class OperationLogService {
  private readonly logger = new Logger(OperationLogService.name);
  private readonly retentionDays: number;
  private readonly monthsAhead: number;
  private readonly archiveEnabled: boolean;

  constructor(private readonly prisma: PrismaService) {
    const raw = Number(process.env.OPERATION_LOG_RETENTION_DAYS);
    this.retentionDays = Number.isFinite(raw) && raw > 0 ? raw : 180;
    const ahead = Number(process.env.OPERATION_LOG_PARTITION_MONTHS_AHEAD);
    this.monthsAhead = Number.isInteger(ahead) && ahead >= 1 ? ahead : 2;
    this.archiveEnabled = process.env.OPERATION_LOG_ARCHIVE_ENABLED !== 'false';
    if (!this.archiveEnabled) {
      this.logger.warn('OPERATION_LOG_ARCHIVE_ENABLED=false：过期分区将直接 DROP——不满足《电子招标投标办法》第42条≥15年法定留存要求');
    }
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

  /**
   * 每日 04:00 分区维护（错开 AuditLog 的 03:00）：
   * 1) ensurePartitions —— 预建当前 + 未来 N 个月分区；
   * 2) dropExpiredPartitions —— 整月过期的分区直接 DROP（O(1)，不扫表）；
   * 3) purgeDefaultStragglers —— 分批清 DEFAULT 兜底分区里的过期行（正常为 0）。
   */
  @Cron('0 4 * * *')
  async scheduledCleanup(): Promise<void> {
    try {
      await this.ensurePartitions();
      await this.dropExpiredPartitions();
      await this.purgeDefaultStragglers();
    } catch (err) {
      this.logger.warn(`OperationLog 分区清理失败: ${err}`);
    }
  }

  /** 预建当前月 + 未来 monthsAhead 个月的分区（UTC 月界）。建分区前先把 DEFAULT 里该区间的越界行搬回父表——否则 CREATE PARTITION 会因 DEFAULT 持有区间内行而失败 */
  async ensurePartitions(): Promise<void> {
    const now = new Date();
    const baseY = now.getUTCFullYear();
    const baseM = now.getUTCMonth();
    for (let k = 0; k <= this.monthsAhead; k++) {
      const startMs = Date.UTC(baseY, baseM + k, 1);
      const d = new Date(startMs);
      const name = `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      if (!PARTITION_NAME_RE.test(name)) continue; // 防御：只接受 YYYY_MM
      const start = tsLiteral(startMs);
      const end = tsLiteral(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
      // 1) DEFAULT 越界行搬回父表（自动路由到正确分区）
      await this.prisma.$executeRawUnsafe(
        `WITH moved AS (DELETE FROM "OperationLog_default" WHERE "createdAt" >= '${start}' AND "createdAt" < '${end}' RETURNING *) INSERT INTO "OperationLog" SELECT * FROM moved`,
      );
      // 2) 幂等建分区
      await this.prisma.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS "OperationLog_${name}" PARTITION OF "OperationLog" FOR VALUES FROM ('${start}') TO ('${end}')`,
      );
    }
  }

  /** 整月超出保留期的分区直接 DROP（分区上界 <= cutoff 时才 DROP，保证保留期内数据不受影响） */
  async dropExpiredPartitions(): Promise<void> {
    const cutoffMs = Date.now() - this.retentionDays * 86_400_000;
    const children = await this.prisma.$queryRaw<{ relname: string }[]>`
      SELECT c.relname::text AS relname
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_class p ON p.oid = i.inhparent
      JOIN pg_namespace n ON n.oid = p.relnamespace
      WHERE n.nspname = 'public'
        AND p.relname = 'OperationLog'
        AND c.relname ~ ${'^OperationLog_\\d{4}_\\d{2}$'}`;
    for (const { relname } of children) {
      const m = relname.match(/^OperationLog_(\d{4})_(\d{2})$/);
      if (!m) continue;
      const monthEndMs = Date.UTC(Number(m[1]), Number(m[2]), 1); // 该分区上界（下月 1 日）
      if (monthEndMs > cutoffMs) continue; // 分区内仍可能有保留期内的行 → 保留
      const name = `${m[1]}_${m[2]}`; // 已经过正则校验
      // P1-12：archive-before-drop——先归档到 MinIO 再 DROP；归档失败不 DROP（宁可超保留期，不可损毁）
      if (!(await this.archivePartitionBeforeDrop(name, m[1], m[2]))) {
        this.logger.warn(`OperationLog 归档失败，跳过 DROP 分区 ${name}（下轮重试）`);
        continue;
      }
      await this.prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "OperationLog_${name}"`);
      this.logger.log(`OperationLog 清理：DROP 过期分区 OperationLog_${name}（已归档，保留 ${this.retentionDays} 天）`);
    }
  }

  /** P1-12：把待删月分区全量导出为 gzip JSON-lines 存 MinIO，写 OperationLogArchive 清单。
   * 幂等：该月已有清单（含空分区占位）→ 直接 true（不重复导出）。失败 → false（不 DROP）。 */
  private async archivePartitionBeforeDrop(name: string, yyyy: string, mm: string): Promise<boolean> {
    if (!this.archiveEnabled) return true; // 开关关闭：跳过归档（启动时已 warn 法定留存不满足）
    const month = `${yyyy}_${mm}`;
    try {
      const existing = await this.prisma.operationLogArchive.findUnique({ where: { month } });
      if (existing) return true; // 幂等：已归档（含空分区占位）

      const rows = await this.prisma.$queryRawUnsafe<
        { id: string; userId: string | null; username: string | null; role: string | null; portal: string | null; method: string | null; path: string | null; query: unknown; body: unknown; statusCode: number | null; durationMs: number | null; ipAddress: string | null; userAgent: string | null; referer: string | null; error: unknown; createdAt: Date }[]
      >(`SELECT * FROM "OperationLog_${name}"`);

      let objectKey = '';
      let sha256 = '';
      let sizeBytes = 0;
      if (rows.length > 0) {
        const lines = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
        const gz = zlib.gzipSync(Buffer.from(lines, 'utf8'));
        objectKey = `operation-log-archive/${yyyy}_${mm}.jsonl.gz`;
        await minioClient.putObject(MINIO_BUCKET, objectKey, gz, gz.length, { 'Content-Type': 'application/gzip' });
        sha256 = crypto.createHash('sha256').update(gz).digest('hex');
        sizeBytes = gz.length;
      }

      await this.prisma.operationLogArchive.create({
        data: { month, rowCount: rows.length, objectKey, sha256, sizeBytes },
      });
      this.logger.log(`OperationLog 归档：${month} → ${objectKey || '(空分区占位)'}（${rows.length} 行，sha256=${sha256 || '-'}）`);
      return true;
    } catch (err) {
      this.logger.error(`OperationLog 归档失败：${month} — ${(err as Error).message}`);
      return false;
    }
  }

  /** P1-12：归档清单（admin 查询） */
  async listArchives() {
    return this.prisma.operationLogArchive.findMany({ orderBy: { month: 'desc' } });
  }

  /** P1-12：归档完整性验证——重算 MinIO 对象 sha256 与清单比对（空分区占位跳过） */
  async verifyArchive(month: string) {
    const rec = await this.prisma.operationLogArchive.findUnique({ where: { month } });
    if (!rec) throw new Error('ARCHIVE_NOT_FOUND');
    if (!rec.objectKey) return { month, valid: true, note: '空分区占位', rowCount: 0 };
    const stream = await minioClient.getObject(MINIO_BUCKET, rec.objectKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const buf = Buffer.concat(chunks);
    const actual = crypto.createHash('sha256').update(buf).digest('hex');
    return { month, valid: actual === rec.sha256, storedSha256: rec.sha256, actualSha256: actual, sizeBytes: rec.sizeBytes, actualSizeBytes: buf.length };
  }

  /** 兜底：分批删除 DEFAULT 分区内的过期行（正常为 0 行；覆盖时钟漂移/漏建分区等异常） */
  async purgeDefaultStragglers(): Promise<void> {
    const cutoff = tsLiteral(Date.now() - this.retentionDays * 86_400_000);
    const BATCH = 5000;
    let total = 0;
    for (;;) {
      const deleted = await this.prisma.$executeRawUnsafe(
        `DELETE FROM "OperationLog_default" WHERE ctid IN (SELECT ctid FROM "OperationLog_default" WHERE "createdAt" < '${cutoff}' LIMIT ${BATCH})`,
      );
      total += deleted;
      if (deleted < BATCH) break;
    }
    if (total > 0) this.logger.log(`OperationLog 清理：DEFAULT 分区删除 ${total} 条超过 ${this.retentionDays} 天的记录`);
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
