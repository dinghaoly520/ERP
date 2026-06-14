import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async list(userId: string) {
    const rows = await this.prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(r => ({
      id: r.id,
      action: r.action,
      target: r.target,
      detail: r.detail,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
