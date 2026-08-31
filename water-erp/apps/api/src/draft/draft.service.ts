import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** 允许的草稿键前缀（白名单防滥用为任意 KV 存储） */
const ALLOWED_PREFIXES = ['supplier-selection', 'expert-extract'];

@Injectable()
export class DraftService {
  constructor(private readonly prisma: PrismaService) {}

  private assertKey(key: string) {
    if (!key || key.length > 200 || !ALLOWED_PREFIXES.some((p) => key === p || key.startsWith(`${p}:`))) {
      throw new BadRequestException({ error: '不支持的草稿键', code: 'BAD_DRAFT_KEY' });
    }
  }

  async get(userId: string, key: string) {
    this.assertKey(key);
    const row = await this.prisma.userDraft.findUnique({ where: { userId_key: { userId, key } } });
    if (!row) return null;
    return { key: row.key, payload: row.payload, updatedAt: row.updatedAt.toISOString() };
  }

  /** 覆盖式保存（草稿语义：最新即全量），payload ≤ 256KB 防滥用 */
  async put(userId: string, key: string, payload: unknown) {
    this.assertKey(key);
    const size = Buffer.byteLength(JSON.stringify(payload ?? null));
    if (size > 256 * 1024) {
      throw new BadRequestException({ error: '草稿内容过大（超过 256KB）', code: 'DRAFT_TOO_LARGE' });
    }
    const row = await this.prisma.userDraft.upsert({
      where: { userId_key: { userId, key } },
      create: { userId, key, payload: payload as object },
      update: { payload: payload as object },
      select: { updatedAt: true },
    });
    return { savedAt: row.updatedAt.toISOString() };
  }

  async remove(userId: string, key: string) {
    this.assertKey(key);
    await this.prisma.userDraft.deleteMany({ where: { userId, key } });
    return { deleted: true };
  }
}
