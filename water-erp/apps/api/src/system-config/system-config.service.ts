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

  /**
   * 原样写入（不消毒）——仅限机器消费的 JSON 配置键（如 supervision_push_config 的
   * endpoint/authToken）：sanitizeHtmlContent 会把 `&`→`&amp;`、剥除 `<...>` 序列，
   * 静默破坏 JSON（读取侧又掩码展示，省联网时才发现、不可诊断）。
   * 面向用户展示的富文本键（供应商澄清文案等）仍走 set() 消毒防存储型 XSS。
   */
  async setRaw(key: string, value: string, updatedBy?: string) {
    return this.prisma.systemConfig.upsert({
      where: { key },
      update: { value, updatedBy: updatedBy ?? null },
      create: { key, value, updatedBy: updatedBy ?? null },
    });
  }
}
