/**
 * 一次性：把现库 BidScorePoint 固化进 seed 快照（2026-10-21，d7e1413c 大岷固化的后续）。
 * - 旧快照仅 8 月手写 3 条 bp_seed_*（智慧水务），每次 seed 会把现库 69 条 TRUNCATE 冲掉
 *   （含 2026-10-19 恢复的大岷 XB 24 条、10-20 补配的技术 50 分要点）——本脚本追平。
 * - 口径：FK 闭合——只并入 scoreItemId 已在 BidScoreItem.json 快照内的行（现库 42 条挂
 *   在 28 个快照后新建的运行态 item 上，父链不在 seed，单独固化必 FK 违反；连项目重快照另议）。
 * - 字段保真：取模型全字段（保留 evidenceHint/objective 等），非旧快照键并集裁剪。
 * 幂等：快照中已有同 id 的条目跳过。
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'prisma', 'seed-data');
const prisma = new PrismaClient();

async function main() {
  const snapItemIds = new Set(
    JSON.parse(fs.readFileSync(path.join(DIR, 'BidScoreItem.json'), 'utf8')).map((i: { id: string }) => i.id),
  );
  const file = path.join(DIR, 'BidScorePoint.json');
  const existing: Array<{ id: string }> = JSON.parse(fs.readFileSync(file, 'utf8'));
  const fields = Object.keys((prisma as any).bidScorePoint.fields); // 关系字段在 findMany 结果中为 undefined，自然被裁
  const rows = await (prisma as any).bidScorePoint.findMany({
    orderBy: [{ scoreItemId: 'asc' }, { seq: 'asc' }],
  });

  let added = 0, skipped = 0, excluded = 0;
  const excludedItems = new Set<string>();
  for (const row of rows) {
    if (!snapItemIds.has(row.scoreItemId)) { excluded++; excludedItems.add(row.scoreItemId); continue; }
    if (existing.some((e) => e.id === row.id)) { skipped++; continue; }
    const clean: Record<string, unknown> = {};
    for (const k of fields) if (row[k] !== undefined && row[k] !== null) clean[k] = row[k];
    existing.push(clean);
    added++;
  }
  fs.writeFileSync(file, JSON.stringify(existing, null, 2) + '\n');
  console.log(
    `BidScorePoint.json：+${added} 条（同 id 跳过 ${skipped}；父 item 不在快照排除 ${excluded} 条 / ${excludedItems.size} 个运行态 item），终态 ${existing.length} 条`,
  );
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
