/**
 * 一次性回填（2026-11-12 bug#142 修复配套）：存量评分偏差告警工单标题里的 cuid 尾 8 位
 * （形如「评分偏差告警（评分项 cm65xcdo）」）反查项目内 BidScoreItem 名称后改写为
 * 「评分偏差告警（评分项 <名称>）」。写入侧已随修复改用名称，本脚本只清存量。
 *
 * 用法：npx tsx scripts/backfill-dispute-scoreitem-name.ts [--dry-run]
 * 幂等：标题已含名称（无 8 位尾缀 token）的行不命中，重复执行零副作用。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry-run');

// 与写入侧 fallback 同款：小写字母/数字 8 连位，前后非字母数字（括号内）
const TAIL_RE = /（评分项 ([a-z0-9]{8})）$/;

async function main() {
  const disputes = await prisma.expertDispute.findMany({
    where: { type: 'scoring', title: { contains: '评分偏差告警' } },
    select: { id: true, projectId: true, title: true },
  });
  let hit = 0, miss = 0;
  for (const d of disputes) {
    const m = TAIL_RE.exec(d.title ?? '');
    if (!m) continue; // 已是名称格式或异构标题
    const tail = m[1];
    // 尾 8 位在项目内反查评分项（cuid 全局唯一，尾缀项目内足够定位）
    const item = await prisma.bidScoreItem.findFirst({
      where: { projectId: d.projectId, id: { endsWith: tail } },
      select: { name: true },
    });
    if (!item) {
      miss++;
      console.log(`跳过 ${d.id}：项目内无尾缀 ${tail} 对应评分项（标题保持原样）`);
      continue;
    }
    const next = `评分偏差告警（评分项 ${item.name}）`;
    hit++;
    if (DRY) {
      console.log(`[dry] ${d.id}: "${d.title}" → "${next}"`);
    } else {
      await prisma.expertDispute.update({ where: { id: d.id }, data: { title: next } });
      console.log(`${d.id}: "${d.title}" → "${next}"`);
    }
  }
  console.log(`完成：改写 ${hit} 条，未命中评分项 ${miss} 条，扫描总数 ${disputes.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
