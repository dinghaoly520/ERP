/**
 * 一次性清理（2026-11-20 用户裁定「不再生成预成交公示」）：删除归档自动生成的
 * 存量「预成交公示」草稿（Announcement.type=PRE_WIN_NOTICE 且 status=DRAFT）。
 *
 * 背景：G1（archiveAll → ensureWinnerNotice）曾在完整归档后自动派生 PRE_WIN 草稿，
 * 堆积在公告发布中心「待处理草稿」列表。生成器已删（bid.service.ts），本脚本清存量。
 *
 * 边界：
 *   - 只删 DRAFT——已发布/已回收站的 PRE_WIN 是历史公示事实（中标通知书公示闸的
 *     兼容查询、时间轴、异议窗口仍读它们），不碰；
 *   - 草稿无附件/阅读数等关联副作用，直接物理删除；
 *   - --execute 前先 dry-run 核对清单（标题即辨识面，如「预成交公示：谈判文件公告 — 谈判采购006」）。
 *
 * 用法：
 *   npx tsx scripts/cleanup-pre-win-drafts.ts            # dry-run（默认，只列清单）
 *   npx tsx scripts/cleanup-pre-win-drafts.ts --execute  # 执行删除
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const execute = process.argv.includes('--execute');

async function main() {
  const drafts = await prisma.announcement.findMany({
    where: { type: 'PRE_WIN_NOTICE', status: 'DRAFT' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, title: true, relatedProjectCode: true, companyId: true, createdAt: true },
  });
  if (drafts.length === 0) {
    console.log('无 PRE_WIN_NOTICE 草稿，无需清理。');
    return;
  }
  console.log(`PRE_WIN_NOTICE 草稿共 ${drafts.length} 条：`);
  for (const d of drafts) {
    console.log(`  [${d.id}] ${d.title}（关联编号 ${d.relatedProjectCode ?? '—'}，创建于 ${d.createdAt.toISOString().slice(0, 10)}）`);
  }
  if (!execute) {
    console.log('\ndry-run：未删除。确认无误后加 --execute 执行。');
    return;
  }
  const { count } = await prisma.announcement.deleteMany({
    where: { type: 'PRE_WIN_NOTICE', status: 'DRAFT' },
  });
  console.log(`\n已删除 ${count} 条预成交公示草稿。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
