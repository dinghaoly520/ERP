/**
 * 存量采购公告公示止点修复（2026-11-24，SWHI-GK-2026112002 实录）：
 * 2026-11-24 前，BID_NOTICE（采购公告/公开招标）发布时后端兜底恒「publishDate + 3 天」，
 * 无视向导/编写填写的公示期限（止）（metadata.announcementEnd）——用户填 20 天公示期，
 * 库止点却是发布+3 天，期满后公开端/:3004 误显「公示期满」标题壳（公告渠道）。
 * 代码修复：announcement.service.ts publicityEndFallback（新发布不再覆盖）。
 * 本脚本修复存量：BID_NOTICE PUBLISHED 行 publicityEnd ← metadata.announcementEnd
 * （datetime-local 无时区串按东八区解析，与 scheduled-publish.util 同口径）；
 * 无止点/无效/不晚于发布时刻/止点未早于现值的行不动（幂等，可重复执行）。
 *
 *   npx tsx scripts/fix-bid-notice-publicity-end.ts            # dry-run，只打印
 *   npx tsx scripts/fix-bid-notice-publicity-end.ts --execute  # 实际回填
 */
import { PrismaClient } from '@prisma/client';
import { parseScheduledPublishDate } from '../src/announcement/scheduled-publish.util';

const prisma = new PrismaClient();

async function main() {
  const execute = process.argv.includes('--execute');
  const rows = await prisma.announcement.findMany({
    where: { type: 'BID_NOTICE', status: 'PUBLISHED' },
    select: { id: true, title: true, publishDate: true, publicityEnd: true, metadata: true },
    orderBy: { publishDate: 'desc' },
  });

  let fixed = 0;
  for (const a of rows) {
    const metaEnd = parseScheduledPublishDate((a.metadata as Record<string, unknown> | null)?.announcementEnd);
    // 无止点/无效：旧行为即 +3 天兜底，视为一致，不动
    if (!metaEnd || !a.publishDate || metaEnd.getTime() <= a.publishDate.getTime()) continue;
    if (a.publicityEnd && a.publicityEnd.getTime() >= metaEnd.getTime()) continue; // 现值已覆盖止点（含已修复）
    if (!execute) {
      console.log(`[dry-run] ${a.id} 「${a.title}」 publicityEnd ${a.publicityEnd?.toISOString() ?? 'null'} → ${metaEnd.toISOString()}`);
    } else {
      await prisma.announcement.update({ where: { id: a.id }, data: { publicityEnd: metaEnd } });
      console.log(`[fixed] ${a.id} 「${a.title}」 publicityEnd → ${metaEnd.toISOString()}`);
    }
    fixed++;
  }
  console.log(execute ? `回填完成：${fixed}/${rows.length} 条。` : `dry-run：待回填 ${fixed}/${rows.length} 条（加 --execute 执行）。`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
