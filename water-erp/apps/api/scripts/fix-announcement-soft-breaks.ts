/**
 * 存量公告软换行修复（2026-10-22 重立渲染层安全网后的存量对账）：
 * 2026-10-20 撤闸（8e39016a）前后发布的公告，content 里存有句中软换行（<br/> 断词
 * 或「每行一段」），门户正文词中断行。新发布走 extractAnnouncementContentHtml 的
 * normalizeAnnouncementHtml；本脚本对存量 content 原位重跑同一归一（守卫：句读/
 * 列表/标题/落款/收尾行，见 announcement-content-html.util.ts）。
 *
 *   npx tsx scripts/fix-announcement-soft-breaks.ts           # dry-run，打印变更样本
 *   npx tsx scripts/fix-announcement-soft-breaks.ts --fix     # 原位更新
 */
import { PrismaClient } from '@prisma/client';
import { normalizeAnnouncementHtml } from '../src/tender-write/announcement-content-html.util';

const prisma = new PrismaClient();
const FIX = process.argv.includes('--fix');

async function main() {
  const rows = await prisma.announcement.findMany({
    where: { content: { contains: '<p' } },
    select: { id: true, title: true, content: true },
  });

  const changed: Array<{ id: string; title: string; from: string; to: string }> = [];
  for (const row of rows) {
    const normalized = normalizeAnnouncementHtml(row.content);
    if (normalized !== row.content) changed.push({ id: row.id, title: row.title, from: row.content, to: normalized });
  }

  console.log(`扫描 ${rows.length} 条含 HTML 正文的公告，需归一 ${changed.length} 条。`);
  for (const c of changed.slice(0, 3)) {
    console.log(`\n--- [${c.id}] ${c.title}`);
    console.log(`  前: ${c.from.slice(0, 160).replace(/\n/g, '⏎')}`);
    console.log(`  后: ${c.to.slice(0, 160).replace(/\n/g, '⏎')}`);
  }
  if (changed.length > 3) console.log(`\n…等共 ${changed.length} 条`);

  if (!FIX) {
    console.log('\ndry-run：未改动数据。加 --fix 原位归一。');
    return;
  }

  for (const c of changed) {
    await prisma.announcement.update({ where: { id: c.id }, data: { content: c.to } });
  }
  console.log(`\n已归一 ${changed.length} 条公告正文。`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
