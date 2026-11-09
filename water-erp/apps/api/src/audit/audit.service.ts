import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { auditDetailSearchClauses } from '../common/audit-search.util';

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

/** 操作历史筛选子句（2026-11-09 用户需求：操作历史统一配类型/时间筛选+搜索）——
 *  单类型等值、日期按本地时区天边界（与公告/供应商历史同口径）、搜索命中
 *  资源类型/明细 JSON 串（resourceName 是读端计算字段无列，其数据源
 *  `名:id` 复合 resourceType 头段与 details.projectName/supplierName 均可被命中）。
 *  经 AND 组合注入，不与调用方既有 action in/notIn 键互覆。 */
function activityFilterClause(o?: { action?: string; dateFrom?: string; dateTo?: string; search?: string }): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [];
  if (o?.action) and.push({ action: o.action });
  if (o?.dateFrom || o?.dateTo) {
    const createdAt: { gte?: Date; lte?: Date } = {};
    if (o?.dateFrom) createdAt.gte = new Date(`${o.dateFrom}T00:00:00`);
    if (o?.dateTo) createdAt.lte = new Date(`${o.dateTo}T23:59:59.999`);
    and.push({ createdAt });
  }
  if (o?.search?.trim()) {
    and.push({ OR: auditDetailSearchClauses(o.search.trim()) as Prisma.AuditLogWhereInput[] });
  }
  return and.length ? { AND: and } : {};
}

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

  /** Daily cleanup at 3:00 AM — removes audit logs older than retention (P1-12 默认 15 年/5475 天) */
  @Cron('0 3 * * *')
  async scheduledCleanup() {
    try {
      const count = await this.cleanupOldLogs(this.auditRetentionDays());
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
      excludeActions?: string[];
      action?: string;
      dateFrom?: string;
      dateTo?: string;
      search?: string;
    },
  ) {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const where: Prisma.AuditLogWhereInput = {
      userId,
      ...(options?.actions && options.actions.length > 0
        ? { action: { in: options.actions } }
        : {}),
      ...(options?.excludeActions && options.excludeActions.length > 0
        ? { action: { notIn: options.excludeActions } }
        : {}),
      ...activityFilterClause(options),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items: await this.withResourceNames(rows), total };
  }

  /**
   * 全中心操作留痕（2026-11-06 用户裁定）：leader/admin 查所有人 AuditLog——join 操作人
   * 姓名/角色（displayName 优先），响应剥离 user 关系只留 operator 投影；资源名解析复用
   * my-activities 同一管线。LOGIN/LOGOUT 噪音由前端 exclude 传入（与本人视图同口径）。
   * （与既有 getAllActivities——admin 审计列表同函数名撞车，此方法名取 org 视野语义）
   */
  async getOrgActivities(options?: {
    limit?: number;
    offset?: number;
    excludeActions?: string[];
    action?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
  }) {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;
    const where: Prisma.AuditLogWhereInput = {
      ...(options?.excludeActions && options.excludeActions.length > 0
        ? { action: { notIn: options.excludeActions } }
        : {}),
      ...activityFilterClause(options),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { user: { select: { displayName: true, username: true, role: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const named = await this.withResourceNames(rows);
    const items = named.map(r => {
      const { user, ...rest } = r as typeof r & {
        user?: { displayName: string; username: string; role: string } | null;
      };
      return {
        ...rest,
        operator: user ? { name: user.displayName || user.username, role: user.role } : null,
      };
    });
    return { items, total };
  }

  /**
   * 操作历史资源可读化（2026-11-04 用户口径）：resourceType 里塞的 `BidProject:<cuid>`
   * / `BID-xxx` 编号 / details.projectId 对用户全是黑话——批量解析成投标项目名挂在
   * resourceName 上，前端不再裸出主键。解析不到的保持 null（前端按原样兜底）。
   * 全量形态（2026-11-04 稳健复查按 AuditLog 实测）：
   * - `BidProject:<id>`（阶段流转/澄清/移交/AI 重跑等，主流形态）
   * - resourceType 裸 `BidProject` + resourceId 装项目 id（EXPERT_EXTRACTION_CONFIRMED）
   * - `BID-xxx` projectCode（邀请供应商）/ details.projectId（解密/异议裁决）
   * - `supplier_company_link` + details.supplierId（归属审批族，无名字）→ 解析供应商名挂 supplierName
   */
  private async withResourceNames<T extends { resourceType: string | null; resourceId: string | null; details: unknown }>(
    rows: T[],
  ): Promise<(T & { resourceName: string | null; supplierName?: string | null })[]> {
    const idSet = new Set<string>();
    const codeSet = new Set<string>();
    const supplierIdSet = new Set<string>();
    const collect = (raw: unknown) => {
      if (typeof raw !== 'string' || !raw) return;
      const m = /^BidProject:(.+)$/.exec(raw);
      if (m) { idSet.add(m[1]); return; }
      if (/^BID-\d+$/.test(raw)) codeSet.add(raw);
    };
    for (const r of rows) {
      collect(r.resourceType);
      if (r.resourceType === 'BidProject' && r.resourceId) idSet.add(r.resourceId);
      const d = r.details as Record<string, unknown> | null;
      if (d && typeof d.projectId === 'string') idSet.add(d.projectId);
      if (d && typeof d.supplierId === 'string') supplierIdSet.add(d.supplierId);
    }

    const byId = new Map<string, string>();
    const byCode = new Map<string, string>();
    if (idSet.size > 0 || codeSet.size > 0) {
      const projects = await this.prisma.bidProject.findMany({
        where: {
          OR: [
            ...(idSet.size ? [{ id: { in: [...idSet] } }] : []),
            ...(codeSet.size ? [{ projectCode: { in: [...codeSet] } }] : []),
          ],
        },
        select: { id: true, projectCode: true, name: true },
      });
      for (const p of projects) {
        byId.set(p.id, p.name);
        if (p.projectCode) byCode.set(p.projectCode, p.name);
      }
    }
    const supplierById = new Map<string, string>();
    if (supplierIdSet.size > 0) {
      const suppliers = await this.prisma.supplier.findMany({
        where: { id: { in: [...supplierIdSet] } },
        select: { id: true, name: true },
      });
      for (const s of suppliers) supplierById.set(s.id, s.name);
    }

    return rows.map(r => {
      const m = r.resourceType ? /^BidProject:(.+)$/.exec(r.resourceType) : null;
      const d = r.details as Record<string, unknown> | null;
      const name =
        (m && byId.get(m[1])) ||
        (r.resourceType === 'BidProject' && r.resourceId ? byId.get(r.resourceId) : undefined) ||
        (d && typeof d.projectId === 'string' ? byId.get(d.projectId) : undefined) ||
        (r.resourceType ? byCode.get(r.resourceType) : undefined) ||
        null;
      const supplierName =
        d && typeof d.supplierName === 'string' ? d.supplierName
          : d && typeof d.supplierId === 'string' ? supplierById.get(d.supplierId) ?? null
          : null;
      return { ...r, resourceName: name, supplierName };
    });
  }

  /** P1-12：保留期参数化——AUDIT_LOG_RETENTION_DAYS 默认 5475（15 年，办法第42条）。低频业务动作表体量小，直接留 PG。 */
  private auditRetentionDays(): number {
    const raw = Number(process.env.AUDIT_LOG_RETENTION_DAYS);
    return Number.isFinite(raw) && raw > 0 ? raw : 5475;
  }

  async cleanupOldLogs(daysToKeep: number = 5475) {
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
