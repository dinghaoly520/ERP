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
 */
@Injectable()
export class AnnouncementHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  private contentFingerprint(content?: string | null): { hash?: string; length?: number } {
    if (content == null) return {};
    return { hash: createHash('sha256').update(content).digest('hex'), length: content.length };
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
        operatorName: input.operatorName ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  }

  /** 某条公告的完整操作时间线（旧→新） */
  async timeline(announcementId: string) {
    return this.prisma.announcementHistory.findMany({
      where: { announcementId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** 全局公告操作历史（新→旧，公告管理页总览） */
  async listAll(params?: { page?: number; pageSize?: number }) {
    const page = params?.page ?? 1;
    const pageSize = Math.min(params?.pageSize ?? 50, 200);
    const where = {};
    const [items, total] = await Promise.all([
      this.prisma.announcementHistory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.announcementHistory.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
}
