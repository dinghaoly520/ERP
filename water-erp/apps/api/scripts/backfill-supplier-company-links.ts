/**
 * 存量回填：Supplier.companyId 非空（任意 status）→ 建 APPROVED link（幂等可重跑）。
 * 全状态回填使 link 忠实镜像既有 companyId——读端切换后审批列表（PENDING 件）不受影响。
 * 运行：cd apps/api && npx tsx scripts/backfill-supplier-company-links.ts [--dry-run]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const suppliers = await prisma.supplier.findMany({
    where: { companyId: { not: null } },
    select: { id: true, companyId: true, createdAt: true, status: true },
  });
  console.log(`候选供应商 ${suppliers.length} 家（companyId 非空）`);
  if (dryRun) {
    for (const s of suppliers) console.log(`  [dry] ${s.id} → ${s.companyId} (${s.status})`);
    return;
  }
  let processed = 0;
  for (const s of suppliers) {
    await prisma.supplierCompanyLink.upsert({
      where: { supplierId_companyId: { supplierId: s.id, companyId: s.companyId! } },
      create: {
        supplierId: s.id, companyId: s.companyId!,
        status: 'APPROVED', appliedAt: s.createdAt,
      },
      update: {}, // 已有 link（含审批中/停用）不动——幂等
    });
    processed++;
  }
  const total = await prisma.supplierCompanyLink.count({ where: { status: 'APPROVED' } });
  console.log(`处理 ${processed} 行；APPROVED link 总数 ${total}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
