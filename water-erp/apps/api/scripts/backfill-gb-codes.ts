/**
 * 对接专项 Phase 1（T2）：存量国标编码回填。
 * 真因：27 PMI/18 BidProject 全为种子 JSON 直载，绕过 API 创建路径的 GbCodeService 分配。
 * 幂等：已有码跳过。产出人工复核清单 CSV（项目名/业务码/国标码）。
 * 运行：cd apps/api && npx tsx scripts/backfill-gb-codes.ts [--execute]
 *   （默认 dry-run；--execute 才写库。写库走直连 DIRECT_URL。）
 */
import { PrismaService } from '../src/prisma/prisma.service';
import { GbCodeService } from '../src/common/gb-code.service';

async function main() {
  const execute = process.argv.includes('--execute');
  const prisma = new PrismaService();
  const gb = new GbCodeService(prisma as any);
  const rows: Array<{ scope: string; name: string; bizCode: string; gbCode: string; note: string }> = [];

  // 1) PMI 18 位项目编码
  const pmis = await prisma.projectManagementItem.findMany({
    where: { gbProjectCode: null },
    select: { id: true, title: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const pmi of pmis) {
    const code = await gb.allocateProjectCode();
    rows.push({ scope: 'PMI', name: pmi.title, bizCode: pmi.id, gbCode: code, note: '18 位项目编码（自分配基码）' });
    if (execute) await prisma.projectManagementItem.update({ where: { id: pmi.id }, data: { gbProjectCode: code } });
  }

  // 2) BidProject 21 位采购编码（有 PMI 宿主复用其 18 位；无宿主自立）
  const bids = await prisma.bidProject.findMany({
    where: { gbProcureCode: null },
    select: { id: true, name: true, projectCode: true, projectManagementItemId: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const bp of bids) {
    const host = bp.projectManagementItemId
      ? await prisma.projectManagementItem.findUnique({ where: { id: bp.projectManagementItemId }, select: { gbProjectCode: true } })
      : null;
    const { gbProcureCode, gbSectionCode } = await gb.allocateProcureCode(host?.gbProjectCode ?? null);
    rows.push({ scope: 'BidProject', name: bp.name, bizCode: bp.projectCode, gbCode: gbProcureCode, note: `21 位采购编码（${host?.gbProjectCode ? 'PMI 宿主基码' : '自立基码'}）/ 标段码 ${gbSectionCode}` });
    if (execute) await prisma.bidProject.update({ where: { id: bp.id }, data: { gbProcureCode, gbSectionCode } });
  }

  // 3) 复核清单 CSV
  const ts = new Date().toISOString().replace(/[:.]/g, '');
  const csv = ['scope,name,bizCode,gbCode,note', ...rows.map(r => [r.scope, `"${r.name.replace(/"/g, '""')}"`, r.bizCode, r.gbCode, `"${r.note}"`].join(','))].join('\n');
  const out = `docs/认证送测材料/gb-code-backfill-${ts}.csv`;
  require('fs').mkdirSync('docs/认证送测材料', { recursive: true });
  require('fs').writeFileSync(out, csv);
  console.log(`[backfill-gb-codes] mode=${execute ? 'EXECUTE' : 'DRY-RUN'} PMI=${pmis.length} BidProject=${bids.length} 清单=${out}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
