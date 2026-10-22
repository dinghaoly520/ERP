/**
 * 幽灵待办手动补扫（2026-10-22）：对账消解四类镜像型可操作通知（详见
 * src/notification/stale-sweep.ts 头注）。日常由 Scheduler 每日 04:45 自动执行，
 * 本脚本用于存量环境的一次性清理或排查（幂等，只动 resolvedAt IS NULL 的行）。
 *
 *   npx tsx scripts/sweep-stale-notifications.ts
 */
import { PrismaClient } from '@prisma/client';
import { sweepStaleActionableNotifications } from '../src/notification/stale-sweep';

const prisma = new PrismaClient();

async function main() {
  const results = await sweepStaleActionableNotifications(prisma);
  if (results.length === 0) {
    console.log('幽灵待办对账：无需消解。');
    return;
  }
  let total = 0;
  for (const r of results) {
    console.log(`消解 ${r.type}（${r.rule}）：${r.resolved} 条`);
    total += r.resolved;
  }
  console.log(`合计消解 ${total} 条幽灵待办。`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
