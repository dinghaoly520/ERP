/**
 * 一次性回填（2026-11-12 bug#150）：存量 bid_decrypted 资产的 originalName 恒为合成名
 * （technical.plain/business.plain/coverLetter.plain）——解密终局 upsert 已改为继承投递原始名
 * （外层资产名剥 .outer），本脚本把存量行按同口径补齐，专家端反显/证据链不再显示合成名。
 *
 * 口径（与 supplier-portal.service.ts plainNameByRole 一致）：
 *   submission 三角色列 → 外层 FileAsset.originalName → 剥尾 `.outer`；
 *   查无外层资产/名字缺失 → 跳过该行（保持合成名，不猜）；
 *   现值非该 role 合成名（已被人改过）→ 跳过不动。
 *
 * 用法：npx tsx scripts/backfill-decrypted-plain-names.ts           # dry-run（默认）
 *       npx tsx scripts/backfill-decrypted-plain-names.ts --execute
 */
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const execute = process.argv.includes('--execute');

const ROLE_COLUMNS: Record<string, 'technicalFileAssetId' | 'businessFileAssetId' | 'coverLetterAssetId'> = {
  technical: 'technicalFileAssetId',
  business: 'businessFileAssetId',
  coverLetter: 'coverLetterAssetId',
};

async function main() {
  // 不加 decryptedAssets 的 JSON where 过滤（金仓/PG JSON null 语义在 Prisma 过滤里不可靠）——
  // 表小全量拉取，JS 侧判空兜底
  const submissions = await prisma.supplierBidSubmission.findMany({
    select: {
      id: true,
      technicalFileAssetId: true,
      businessFileAssetId: true,
      coverLetterAssetId: true,
      decryptedAssets: true,
      envelope: true,
    },
  });

  const plans: Array<{ assetId: string; from: string; to: string }> = [];
  for (const sub of submissions) {
    const decrypted = (sub.decryptedAssets as Record<string, string> | null) ?? {};
    for (const [role, col] of Object.entries(ROLE_COLUMNS)) {
      const decId = decrypted[role];
      if (!decId) continue;
      // 名字源双轨（与 service plainNameByRole 同口径）：外层列优先，dual-v3 三列为空回退信封 files[role].assetId
      const envAssetId = ((sub as { envelope?: { files?: Record<string, { assetId?: string }> } | null }).envelope?.files?.[role]?.assetId) ?? null;
      const outerId = sub[col] ?? envAssetId;
      if (!outerId) continue;
      const [dec, outer] = await Promise.all([
        prisma.fileAsset.findUnique({ where: { id: decId }, select: { originalName: true, category: true } }),
        prisma.fileAsset.findUnique({ where: { id: outerId }, select: { originalName: true } }),
      ]);
      if (!dec || dec.category !== 'bid_decrypted') continue;
      if (dec.originalName !== `${role}.plain`) continue; // 已被人改过/已是正确名 → 不动
      const outerName = outer?.originalName;
      if (!outerName) continue;
      const to = outerName.endsWith('.outer') ? outerName.slice(0, -'.outer'.length) : outerName;
      if (!to || to === dec.originalName) continue;
      plans.push({ assetId: decId, from: dec.originalName, to });
    }
  }

  if (!plans.length) {
    console.log('未发现需要回填的 bid_decrypted 合成名。');
    return;
  }
  console.log(`${execute ? '【执行】' : '【dry-run】'}${plans.length} 条待回填：\n`);
  for (const p of plans) console.log(`  ${p.assetId}\n    ${p.from}\n  → ${p.to}`);
  if (!execute) {
    console.log('\ndry-run 结束（未改动任何数据）。加 --execute 执行回填。');
    return;
  }
  for (const p of plans) {
    await prisma.fileAsset.update({ where: { id: p.assetId }, data: { originalName: p.to } });
  }
  console.log(`\n已回填 ${plans.length} 条 bid_decrypted.originalName。`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
