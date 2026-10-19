/**
 * 对接专项 Phase 1（T2）：存量国标编码回填（2026-10-19 起为 src/common/gb-code.backfill.ts 薄壳）。
 * 真因：种子 JSON 直载绕过 API 创建路径的 GbCodeService 分配。
 * 幂等：已有码跳过。产出人工复核清单 CSV（项目名/业务码/国标码）。
 * 运行：cd apps/api && npx tsx scripts/backfill-gb-codes.ts [--execute]
 *   （默认 dry-run；--execute 才写库。写库走直连 DIRECT_URL。）
 * 注：常规重灌库无须手动跑本脚本——seed.ts 尾部已自动回填；本脚本供存量手工补码/复核。
 */
import { PrismaService } from '../src/prisma/prisma.service';
import { GbCodeService } from '../src/common/gb-code.service';
import { backfillGbCodes } from '../src/common/gb-code.backfill';

async function main() {
  const execute = process.argv.includes('--execute');
  const prisma = new PrismaService();
  const gb = new GbCodeService(prisma as any);
  const rows = await backfillGbCodes(prisma, gb, { execute });

  // 复核清单 CSV
  const ts = new Date().toISOString().replace(/[:.]/g, '');
  const csv = ['scope,name,bizCode,gbCode,note', ...rows.map(r => [r.scope, `"${r.name.replace(/"/g, '""')}"`, r.bizCode, r.gbCode, `"${r.note}"`].join(','))].join('\n');
  const out = `docs/认证送测材料/gb-code-backfill-${ts}.csv`;
  require('fs').mkdirSync('docs/认证送测材料', { recursive: true });
  require('fs').writeFileSync(out, csv);
  console.log(`[backfill-gb-codes] mode=${execute ? 'EXECUTE' : 'DRY-RUN'} 待赋码=${rows.length}（PMI ${rows.filter(r => r.scope === 'PMI').length} / BidProject ${rows.filter(r => r.scope === 'BidProject').length}）清单=${out}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
