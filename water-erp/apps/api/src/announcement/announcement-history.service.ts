import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createHash } from 'node:crypto';

/** 公告历史动作（与前端展示对应） */
export type AnnouncementHistoryAction =
  | 'CREATE'
  | 'PUBLISH'
  | 'UPDATE'
  | 'UNPUBLISH'
  | 'ARCHIVE'
  | 'DELETE';

export type WriteHistoryInput = {
  announcementId: string;
  action: AnnouncementHistoryAction;
  title: string;
  type?: string | null;
  status?: string | null;
  content?: string | null;
  changedFields?: string[];
  operatorId?: string;
  operatorName?: string;
  ipAddress?: string;
  userAgent?: string;
};

/**
 * 公告操作历史（append-only）。
 * 只提供 create 与查询——无 update/delete，记录一经写入不可修改删减。
 *
 * 操作人姓名口径（2026-11-09 用户裁定：操作人一律显示账号姓名而非账号名）：
 * JWT 不携带 displayName，controller 传入的 operatorName 是账号名——写端在此解析
 * 姓名落快照；读端（timeline/listAll）再按 operatorId 联查覆盖，治愈存量账号名行
 * （口径同 audit.service：displayName 优先、username 回退、用户已删回退快照）。
 */
@Injectable()
export class AnnouncementHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  private contentFingerprint(content?: string | null): { hash?: string; length?: number } {
    if (content == null) return {};
    return { hash: createHash('sha256').update(content).digest('hex'), length: content.length };
  }

  /** 批量解析 operatorId → 姓名（displayName 优先、username 回退） */
  private async displayNameMap(operatorIds: (string | null | undefined)[]): Promise<Map<string, string>> {
    const ids = [...new Set(operatorIds.filter((x): x is string => !!x))];
    if (ids.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, displayName: true, username: true },
    });
    return new Map(users.map((u) => [u.id, u.displayName || u.username]));
  }

  /** 单个操作人姓名解析（写端落快照用；公告域内回收站 by / 派生留痕共用） */
  async resolvedName(operatorId?: string, fallback?: string | null): Promise<string | null> {
    if (!operatorId) return fallback ?? null;
    const map = await this.displayNameMap([operatorId]);
    return map.get(operatorId) ?? fallback ?? null;
  }

  async write(input: WriteHistoryInput) {
    const { hash, length } = this.contentFingerprint(input.content);
    return this.prisma.announcementHistory.create({
      data: {
        announcementId: input.announcementId,
        action: input.action,
        title: input.title,
        type: input.type ?? null,
        status: input.status ?? null,
        contentHash: hash ?? null,
        contentLength: length ?? null,
        changedFields: input.changedFields ?? [],
        operatorId: input.operatorId ?? null,
        operatorName: await this.resolvedName(input.operatorId, input.operatorName),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  }

  /** 某条公告的完整操作时间线（旧→新） */
  async timeline(announcementId: string) {
    const rows = await this.prisma.announcementHistory.findMany({
      where: { announcementId },
      orderBy: { createdAt: 'asc' },
    });
    return this.healOperatorNames(rows);
  }

  /** 全局公告操作历史（新→旧，公告管理页总览）；支持按日期/操作类型/标题关键词过滤。 */
  async listAll(params?: { page?: number; pageSize?: number; dateFrom?: string; dateTo?: string; action?: string; search?: string }) {
    const page = params?.page ?? 1;
    const pageSize = Math.min(params?.pageSize ?? 50, 200);
    const where: any = {};
    if (params?.action) where.action = params.action;
    if (params?.search) where.title = { contains: params.search };
    // 日期范围（YYYY-MM-DD，按本地时区边界）
    if (params?.dateFrom || params?.dateTo) {
      where.createdAt = {};
      if (params?.dateFrom) where.createdAt.gte = new Date(`${params.dateFrom}T00:00:00`);
      if (params?.dateTo) where.createdAt.lte = new Date(`${params.dateTo}T23:59:59.999`);
    }
    const [rows, total] = await Promise.all([
      this.prisma.announcementHistory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.announcementHistory.count({ where }),
    ]);
    return { items: await this.healOperatorNames(rows), total, page, pageSize };
  }

  /** 读端治愈：operatorId 可解析出用户时以姓名覆盖存量账号名快照 */
  private async healOperatorNames<T extends { operatorId: string | null; operatorName: string | null }>(rows: T[]): Promise<(T & { operatorName: string | null })[]> {
    const names = await this.displayNameMap(rows.map((r) => r.operatorId));
    return rows.map((r) => ({
      ...r,
      operatorName: (r.operatorId && names.get(r.operatorId)) || r.operatorName,
    }));
  }
}
