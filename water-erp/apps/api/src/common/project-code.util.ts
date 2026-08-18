import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * 业务项目编号生成（取代旧的 `BID-${Date.now()}` / `PROC-${Date.now()}` 时间戳编号）。
 *
 * 格式与 ProjectManagementItem 一致：`前缀-YYYYMMDD##`，例如 `ZJ-2026081705`。
 *  - 前缀：采购方式前两字的拼音首字母（谈判→TP、竞价→JJ、直接→ZJ、邀请→YQ…）。
 *  - 序号：当日两位顺序号，基于当日同表创建数 +1。
 *  - 防重：生成后对目标表做 findUnique 探测，冲突则顺延（并发下兜底），最多探测 200 个序号。
 *    projectCode 唯一约束在各自表内，故仅查本表。
 */

/** 采购方式前两字拼音首字母 → 项目编号前缀；未知字回退 ASCII 大写或 X，空则 XM */
const PROCUREMENT_METHOD_PINYIN: Record<string, string> = {
  谈: 'T', 判: 'P', 竞: 'J', 价: 'J', 直: 'Z', 接: 'J',
  邀: 'Y', 请: 'Q', 询: 'X', 比: 'B', 小: 'X', 额: 'E', 公: 'G', 开: 'K',
};

export function procurementMethodPrefix(method?: string | null): string {
  const chars = Array.from(method ?? '').slice(0, 2);
  return (
    chars
      .map((c) => PROCUREMENT_METHOD_PINYIN[c] ?? (/[a-zA-Z]/.test(c) ? c.toUpperCase() : 'X'))
      .join('') || 'XM'
  );
}

export async function generateProjectCode(
  prisma: PrismaService,
  procurementMethod?: string | null,
  model: 'bidProject' | 'procurementProject' = 'bidProject',
): Promise<string> {
  const prefix = procurementMethodPrefix(procurementMethod);
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

  const table = prisma[model] as unknown as {
    count(args: { where: any }): Promise<number>;
    findUnique(args: { where: any; select?: any }): Promise<{ id: string } | null>;
  };
  const todayCount = await table.count({
    where: { createdAt: { gte: startOfDay, lte: endOfDay } },
  });

  for (let seq = todayCount + 1; seq <= todayCount + 200; seq++) {
    const code = `${prefix}-${ymd}${String(seq).padStart(2, '0')}`;
    const dup = await table.findUnique({ where: { projectCode: code }, select: { id: true } });
    if (!dup) return code;
  }

  throw new ConflictException({ error: '项目编号生成失败：当日可用序号已用尽', code: 'PROJECT_CODE_EXHAUSTED' });
}
