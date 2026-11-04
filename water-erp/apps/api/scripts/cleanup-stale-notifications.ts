/**
 * 一次性清理（2026-11-04 通知堆积治理）：历史堆积的站内信——
 *  ① 公告广播死链：ANNOUNCEMENT_PUBLISHED 且链接指向的公告已不存在
 *     （8 月开发期公告已删、通知滞留——本地库 7385 条、种子快照 6888 条的成因）
 *  ② 存活公告重复通知：同用户同链接只保留最新一条（下线重发/测试反复发布导致的重复扇出）
 *  ③ 旧文案资质预警：治理前标题（资质即将到期提醒/供应商资质即将到期）——
 *     预警看板由到期日实时驱动，旧通知无消费价值；新文案（资质到期提醒）保留
 *  ④ 投递日志孤儿：notificationId 指向已删除通知的 NotificationDeliveryLog
 *
 * 默认干跑（只统计待删清单）；--execute 才实际删除。
 * 种子快照（seed-data/Notification*.json）已按同口径同步清洗，db:seed 不会复活堆积。
 * 再生源已断：公告删除联动清通知（announcement.service remove）、
 * 资质到期扫描 7 天幂等（scheduler scanExpiringQualifications）。
 *
 * 用法：cd apps/api && npx tsx scripts/cleanup-stale-notifications.ts [--execute]
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

// ── .env 加载（先于 PrismaClient 实例化；dotenv 语义：不覆盖已有）──
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const prisma = new PrismaClient();
const EXECUTE = process.argv.includes('--execute');

/** 治理前旧文案标题（2026-10-29 文案治理统一为「资质到期提醒」） */
const OLD_QUALIFICATION_TITLES = ['资质即将到期提醒', '供应商资质即将到期'];

async function main() {
  const before = await prisma.notification.count();
  const beforeUnread = await prisma.notification.count({ where: { isRead: false } });
  console.log(`清理前：通知总数 ${before}，未读 ${beforeUnread}`);

  // ── ① 公告广播死链 ──
  const announcements = await prisma.announcement.findMany({ select: { id: true } });
  const liveLinks = new Set(announcements.map(a => `/announcements/${a.id}`));
  const annNotices = await prisma.notification.findMany({
    where: { type: 'ANNOUNCEMENT_PUBLISHED' },
    select: { id: true, userId: true, link: true, createdAt: true },
  });
  const deadIds = annNotices.filter(n => !n.link || !liveLinks.has(n.link)).map(n => n.id);

  // ── ② 存活公告重复通知（同用户同链接保留最新）──
  const survivors = annNotices.filter(n => !deadIds.includes(n.id));
  const groups = new Map<string, typeof survivors>();
  for (const n of survivors) {
    const key = `${n.userId}|${n.link}`;
    const g = groups.get(key) ?? [];
    g.push(n);
    groups.set(key, g);
  }
  const dupIds: string[] = [];
  for (const g of groups.values()) {
    if (g.length > 1) {
      g.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (b.id > a.id ? 1 : -1));
      dupIds.push(...g.slice(1).map(n => n.id));
    }
  }

  // ── ③ 旧文案资质预警 ──
  const oldQual = await prisma.notification.findMany({
    where: { type: 'QUALIFICATION_EXPIRING', title: { in: OLD_QUALIFICATION_TITLES } },
    select: { id: true },
  });

  const deleteIds = [...new Set([...deadIds, ...dupIds, ...oldQual.map(n => n.id)])];
  console.log(`① 公告死链待删：${deadIds.length}`);
  console.log(`② 存活公告重复待删：${dupIds.length}（${groups.size} 组去重后保留各组最新）`);
  console.log(`③ 旧文案资质预警待删：${oldQual.length}`);
  console.log(`合计待删：${deleteIds.length}`);

  if (!EXECUTE) {
    console.log('\n干跑模式（未删除）。确认清单后加 --execute 执行。');
    return;
  }

  await prisma.notification.deleteMany({ where: { id: { in: deleteIds } } });

  // ── ④ 投递日志孤儿 ──
  const orphanLogs = await prisma.$executeRaw`
    DELETE FROM "NotificationDeliveryLog"
    WHERE "notificationId" IS NOT NULL
      AND "notificationId" NOT IN (SELECT id FROM "Notification")`;

  const after = await prisma.notification.count();
  const afterUnread = await prisma.notification.count({ where: { isRead: false } });
  console.log(`\n已删除通知 ${deleteIds.length} 条、孤儿投递日志 ${orphanLogs} 条`);
  console.log(`清理后：通知总数 ${after}（-${before - after}），未读 ${afterUnread}（-${beforeUnread - afterUnread}）`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
