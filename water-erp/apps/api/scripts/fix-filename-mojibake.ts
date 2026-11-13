/**
 * 一次性修复（2026-11-13）：FileAsset.originalName 的 multipart 文件名 latin1 误读乱码。
 *
 * 病理：multer 2.2/busboy ^1.6.0 栈对普通 `filename=` 参数恒以 latin1 形态交付
 * `file.originalname`（浏览器/undici 原始 UTF-8 字节被单次误读——ASCII 无恙、中文
 * 变 `æŠ€æœ¯`）。2026-07-16 曾修 /upload 等三处（97dea7740），dual-v3 密文暂存端点
 * （ca/encrypted-asset.controller）漏接，2026-11-12 #150 让专家端反显真实文件名后暴露。
 * 运行时已换条件式归一（common/filename-encoding.util.ts）——本脚本用**同一把尺子**
 * （needsMultipartFilenameFix）扫存量并回填，判定口径与线上新写入完全一致。
 *
 * 范围：FileAsset 全表（分类可 --category 收窄）。覆盖两类受损行：
 *   - C_outer 暂存（category=bid_document，key 前缀 v3-staging/）——投递原始名；
 *   - bid_decrypted（#150 继承行）——解密明文名。
 * 不触碰：开标文件包等证据 JSON（SHA-256 指纹锚定，历史事实不可改写）。
 *
 * 判定（needsMultipartFilenameFix，条件式三闸）：
 *   含 >U+00FF 字符 → 干净名不动；纯 ASCII → 不动；高位字节 → latin1→utf8 回转，
 *   解码出 U+FFFD/控制符 → 非本病理不动。修复值与原值相同则跳过。
 *
 * 用法：
 *   npx tsx scripts/fix-filename-mojibake.ts                        # dry-run（默认，只报告）
 *   npx tsx scripts/fix-filename-mojibake.ts --execute              # 执行回填
 *   npx tsx scripts/fix-filename-mojibake.ts --category=bid_document # 限定分类（逗号分隔）
 *   npx tsx scripts/fix-filename-mojibake.ts --id=cmw...            # 外科模式：单行
 * 写入为条件 updateMany（where 含原值）——并发改名不被覆盖，安全重跑幂等。
 */
import { PrismaClient } from '@prisma/client';
import { needsMultipartFilenameFix, normalizeMultipartFilename } from '../src/common/filename-encoding.util';

const prisma = new PrismaClient();
const execute = process.argv.includes('--execute');
const idArg = process.argv.find((a) => a.startsWith('--id='))?.slice(5);
const categoryArg = process.argv.find((a) => a.startsWith('--category='))?.slice(11);
const categories = categoryArg ? categoryArg.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

const CHUNK = 500;

async function main() {
  const byCategory = new Map<string, number>();
  const plans: Array<{ id: string; category: string; from: string; to: string }> = [];

  if (idArg) {
    const row = await prisma.fileAsset.findUnique({
      where: { id: idArg },
      select: { id: true, category: true, originalName: true },
    });
    if (!row) throw new Error(`FileAsset 不存在: ${idArg}`);
    if (row.originalName && needsMultipartFilenameFix(row.originalName)) {
      plans.push({ id: row.id, category: row.category, from: row.originalName, to: normalizeMultipartFilename(row.originalName) });
    } else {
      console.log(`[skip] ${row.id} 无需修复（originalName=${JSON.stringify(row.originalName)}）`);
    }
  } else {
    // 游标分页（表增长也无压力）；只取判定必需列
    let cursor: string | undefined;
    for (;;) {
      const rows: Array<{ id: string; category: string; originalName: string | null }> = await prisma.fileAsset.findMany({
        where: {
          ...(categories ? { category: { in: categories } } : {}),
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: { id: true, category: true, originalName: true },
        orderBy: { id: 'asc' },
        take: CHUNK,
      });
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1].id;
      for (const r of rows) {
        if (!r.originalName || !needsMultipartFilenameFix(r.originalName)) continue;
        plans.push({ id: r.id, category: r.category, from: r.originalName, to: normalizeMultipartFilename(r.originalName) });
      }
      if (rows.length < CHUNK) break;
    }
  }

  for (const p of plans) byCategory.set(p.category, (byCategory.get(p.category) ?? 0) + 1);

  console.log(`=== 文件名 latin1 误读存量修复（${execute ? 'EXECUTE' : 'DRY-RUN'}）===`);
  console.log(`范围：${idArg ? `单行 ${idArg}` : categories ? `category ∈ {${categories.join(', ')}}` : '全表'}`);
  console.log(`命中待修：${plans.length} 行`);
  for (const [cat, n] of [...byCategory.entries()].sort()) console.log(`  - ${cat}: ${n}`);
  for (const p of plans.slice(0, 50)) console.log(`  ${p.id} [${p.category}] ${JSON.stringify(p.from)} → ${JSON.stringify(p.to)}`);
  if (plans.length > 50) console.log(`  …另有 ${plans.length - 50} 行同口径`);
  if (!execute || plans.length === 0) return;

  let updated = 0;
  for (const p of plans) {
    // 条件写：原值仍是扫描时的值才更新（防并发人工改名被覆盖）；安全重跑
    const r = await prisma.fileAsset.updateMany({
      where: { id: p.id, originalName: p.from },
      data: { originalName: p.to },
    });
    updated += r.count;
  }
  console.log(`已回填 ${updated}/${plans.length} 行（差异行=期间被并发修改，重跑即收）`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
