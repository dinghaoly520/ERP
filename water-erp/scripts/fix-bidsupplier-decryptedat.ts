// P2-2（二轮审查收尾）：BidSupplier 演示数据 decryptedAt 回填。
// 症状：开标大厅「解密时间」列全「—」（decryptStatus=SUCCESS 但 decryptedAt 空——种子快照早于 A-111 列填充）。
// 幂等：仅回填 SUCCESS 且 decryptedAt IS NULL 的行；时间戳 = 项目 openTime + 行内序号分钟。
import { config } from 'dotenv';
config({ path: require('path').resolve(__dirname, '../../apps/api/.env') });
const { createRequire } = require('module');
const req = createRequire(require('path').resolve(__dirname, '../../apps/api/package.json'));
const { PrismaClient } = req('@prisma/client');

const prisma = new PrismaClient();
const dry = process.argv.includes('--dry-run');

async function main() {
  const projects = await prisma.bidProject.findMany({
    where: { id: { in: ['cmqhero-bid-proj01', 'cmswmioxz0052uunxu1879izv'] } },
    select: { id: true, openTime: true },
  });
  for (const p of projects) {
    const rows = await prisma.bidSupplier.findMany({
      where: { projectId: p.id, decryptStatus: 'SUCCESS', decryptedAt: null },
      select: { id: true, supplierName: true },
      orderBy: { createdAt: 'asc' },
    });
    if (rows.length === 0) { console.log(`${p.id}: 无待回填`); continue; }
    console.log(`${p.id}（openTime ${p.openTime?.toISOString() ?? '空'}）待回填 ${rows.length} 行：${rows.map((r) => r.supplierName).join('、')}`);
    if (dry) continue;
    for (let i = 0; i < rows.length; i++) {
      const base = p.openTime ?? new Date('2026-07-01T10:00:00+08:00');
      const t = new Date(base.getTime() + (i + 1) * 60_000);
      await prisma.bidSupplier.update({ where: { id: rows[i].id }, data: { decryptedAt: t } });
      console.log(`  → ${rows[i].supplierName} decryptedAt=${t.toISOString()}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
