/**
 * 一次性回填（2026-11-12 bug#115 验收发现）：修复 FileAsset.originalName 的 UTF-8→Latin-1
 * 双重编码存量（亮机日 2026-10-29/30 上传的 17 条：bid_document .outer / expert_sign_scan /
 * sign_packet_signature_page）。现行上传链路（:3007 rewrite 链与 :4001 直连）已实测中文入库
 * 正确，本脚本只清历史残留——zip 证据包/文件名反显（#150）等读端由此一并治好。
 *
 * 判定（保守）：现值含典型 mojibake 特征字节 → 且能 latin1 编码回原始 UTF-8 字节再解码成功
 * → 且还原结果与现值不同 → 且还原结果含 CJK（防止把正常 ASCII/拉丁文件名误伤）。
 *
 * 用法：npx tsx scripts/backfill-mojibake-filenames.ts           # dry-run（默认，只列清单）
 *       npx tsx scripts/backfill-mojibake-filenames.ts --execute # 实际更新
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const execute = process.argv.includes('--execute');

/** 双重编码特征字符（UTF-8 多字节序列被按 Latin-1 解读后的典型残留） */
const MOJIBAKE_RE = /[ÃÂ¢â€æéèçåï¼ã]/;

function tryRepair(name: string): string | null {
  if (!MOJIBAKE_RE.test(name)) return null;
  let repaired: string;
  try {
    repaired = Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return null;
  }
  if (repaired === name) return null;
  // 还原结果须含 CJK 且不含替换符/控制符——确保真是中文文件名而非巧合
  if (!/[一-鿿]/.test(repaired)) return null;
  if (/[�\u0000-\u0008]/.test(repaired)) return null;
  return repaired;
}

async function main() {
  const assets = await prisma.fileAsset.findMany({
    select: { id: true, category: true, originalName: true },
  });
  const targets = assets
    .map(a => ({ ...a, repaired: tryRepair(a.originalName) }))
    .filter((a): a is typeof a & { repaired: string } => a.repaired !== null);

  if (!targets.length) {
    console.log('未发现可修复的双重编码文件名，无需回填。');
    return;
  }
  console.log(`${execute ? '【执行】' : '【dry-run】'}发现 ${targets.length} 条可修复：\n`);
  for (const t of targets) {
    console.log(`  [${t.category}] ${t.id}\n    ${t.originalName}\n  → ${t.repaired}`);
  }
  if (!execute) {
    console.log('\ndry-run 结束（未改动任何数据）。加 --execute 执行回填。');
    return;
  }
  for (const t of targets) {
    await prisma.fileAsset.update({ where: { id: t.id }, data: { originalName: t.repaired } });
  }
  console.log(`\n已回填 ${targets.length} 条 FileAsset.originalName。`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
