/* =====================================================================
   业务标签池初始化回填（2026-10-14）
   --------------------------------------------------------------------
   背景：BusinessTag 池 APPROVED 为 0，注册/变更页「已有标签可选」落空，
   用户只能全部自创。存量 507 家供应商的 tags 字段由规则引擎/导入回填，
   词表高度收敛——直接以此为准入池。

   语义：仅补缺失词（APPROVED, source='migration'）；池内已存在的记录
   （PENDING 待审 / REJECTED 被拒）一律不动——尊重既有审核态。
   默认仅入「≥3 家在用」的公共词（全量 342 词中约 1/3 是单家长尾/整句式
   标签，全入会让选择列表不可用；长尾词走注册自创通道）。
   幂等可重放（seed 重建后可再跑）。

   运行：cd apps/api && npx tsx scripts/backfill-business-tag-pool.ts [--dry] [--min-usage N]
   ===================================================================== */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const dry = process.argv.includes('--dry');
const minUsageIdx = process.argv.indexOf('--min-usage');
const minUsage = minUsageIdx >= 0 ? Number(process.argv[minUsageIdx + 1]) || 3 : 3;

async function main() {
  const suppliers = await prisma.supplier.findMany({ select: { tags: true } });
  const counts = new Map<string, number>();
  for (const s of suppliers) {
    for (const t of s.tags ?? []) {
      const name = t.trim();
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  const existing = new Set((await prisma.businessTag.findMany({ select: { name: true } })).map((t) => t.name));
  const missing = [...counts.entries()]
    .filter(([name, n]) => !existing.has(name) && n >= minUsage)
    .sort((a, b) => b[1] - a[1]);

  console.log(`存量标签词 ${counts.size} 个；池内已有 ${existing.size} 个；≥${minUsage} 家在用且未入池 ${missing.length} 个`);
  if (dry) {
    console.log(missing.map(([name, n]) => `${name}（${n} 家）`).join('、'));
    return;
  }
  for (const [name] of missing) {
    await prisma.businessTag.create({
      data: { name, status: 'APPROVED', source: 'migration' },
    });
  }
  console.log(`已补入 ${missing.length} 个标签入池（APPROVED / migration）`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
