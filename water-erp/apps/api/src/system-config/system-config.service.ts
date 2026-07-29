import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { sanitizeHtmlContent } from '../common/html-sanitize.util';

/**
 * 全局键值配置读写。富文本值写入时统一消毒（防存储型 XSS，与公告一致）。
 */
@Injectable()
export class SystemConfigService {
  constructor(private prisma: PrismaService) {}

  async get(key: string) {
    return this.prisma.systemConfig.findUnique({ where: { key } });
  }

  async set(key: string, value: string, updatedBy?: string) {
    const sanitized = sanitizeHtmlContent(value);
    return this.prisma.systemConfig.upsert({
      where: { key },
      update: { value: sanitized, updatedBy: updatedBy ?? null },
      create: { key, value: sanitized, updatedBy: updatedBy ?? null },
    });
  }
}
