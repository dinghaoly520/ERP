import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { canViewAllUserActivity } from '../auth/auth-scope';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  CreateTenderHistoryDto,
  QueryTenderHistoryDto,
} from './dto/tender-history.dto';

@Injectable()
export class TenderHistoryService {
  /** 每 (userId, documentType) 保留的最新记录上限——与项目侧草稿版本 MAX_VERSIONS=20 同语义（2026-11-12）。 */
  private static readonly MAX_RECORDS_PER_TYPE = 20;

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTenderHistoryDto, user: AuthenticatedUser) {
    const draftDataString = JSON.stringify(dto.draftData);
    const contentHash = createHash('sha256')
      .update(draftDataString)
      .digest('hex');

    const saved = await this.prisma.tenderDocumentHistory.upsert({
      where: {
        userId_documentType_contentHash: {
          userId: user.sub,
          documentType: dto.documentType,
          contentHash,
        },
      },
      update: {
        title: dto.title,
        updatedAt: new Date(),
      },
      create: {
        documentType: dto.documentType,
        title: dto.title,
        draftData: dto.draftData as Prisma.InputJsonValue,
        contentHash,
        userId: user.sub,
      },
    });

    await this.trimToLimit(dto.documentType, user.sub);

    return saved;
  }

  /** 清空当前用户该类型的全部记录（「清空历史」按钮；恒按本人收口，admin 也不清他人）。 */
  async clearMine(documentType: string, user: AuthenticatedUser) {
    const deleted = await this.prisma.tenderDocumentHistory.deleteMany({
      where: { documentType, userId: user.sub },
    });
    return { cleared: true, count: deleted.count };
  }

  /** 每 (userId, documentType) 只留最新 MAX_RECORDS_PER_TYPE 条，溢出删除。 */
  private async trimToLimit(documentType: string, userId: string) {
    const overflow = await this.prisma.tenderDocumentHistory.findMany({
      where: { userId, documentType },
      orderBy: { createdAt: 'desc' },
      skip: TenderHistoryService.MAX_RECORDS_PER_TYPE,
      select: { id: true },
    });
    if (overflow.length > 0) {
      await this.prisma.tenderDocumentHistory.deleteMany({
        where: { id: { in: overflow.map((r) => r.id) } },
      });
    }
  }

  async findMany(query: QueryTenderHistoryDto, user: AuthenticatedUser) {
    const take = Number.isFinite(Number(query.limit))
      ? Math.min(Math.max(Number(query.limit), 1), 50)
      : 20;

    const where: Record<string, unknown> = { documentType: query.documentType };
    if (!canViewAllUserActivity(user.role)) {
      where.userId = user.sub;
    }

    return this.prisma.tenderDocumentHistory.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const record = await this.prisma.tenderDocumentHistory.findUnique({
      where: { id },
    });

    if (!record) {
      throw new NotFoundException(
        `TenderDocumentHistory with id ${id} not found`,
      );
    }

    if (!canViewAllUserActivity(user.role) && record.userId !== user.sub) {
      throw new ForbiddenException('无权查看此历史记录。');
    }

    return record;
  }

  async delete(id: string, user: AuthenticatedUser) {
    const record = await this.prisma.tenderDocumentHistory.findUnique({
      where: { id },
    });

    if (!record) {
      throw new NotFoundException(
        `TenderDocumentHistory with id ${id} not found`,
      );
    }

    if (!canViewAllUserActivity(user.role) && record.userId !== user.sub) {
      throw new ForbiddenException('无权删除此历史记录。');
    }

    await this.prisma.tenderDocumentHistory.delete({
      where: { id },
    });

    return { id };
  }
}
