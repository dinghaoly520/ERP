/**
 * 一次性修复（2026-11-13 首版，2026-11-16 bug#150 扩面）：multipart 文件名 latin1 误读乱码存量回填。
 *
 * 病理：multer 2.2/busboy ^1.6.0 栈对普通 `filename=` 参数恒以 latin1 形态交付
 * `file.originalname`（浏览器/undici 原始 UTF-8 字节被单次误读——ASCII 无恙、中文
 * 变 `æŠ€æœ¯`）。2026-07-16 曾修 /upload 等三处（97dea7740），dual-v3 密文暂存端点
 * （ca/encrypted-asset.controller）漏接，2026-11-12 #150 让专家端反显真实文件名后暴露。
 * 运行时已换条件式归一（common/filename-encoding.util.ts）——本脚本用**同一把尺子**
 * （needsMultipartFilenameFix）扫存量并回填，判定口径与线上新写入完全一致。
 *
 * 范围（2026-11-16 bug#150 扩面：可见面不只 FileAsset——澄清与修改文件卡行名=
 * TenderClarificationDoc.title 直发；谈判/PMI 轨读端=Attachment.fileName）：
 *   1. FileAsset.originalName 全表（--category 收窄）——C_outer 暂存投递原始名 +
 *      bid_decrypted（#150 继承行）解密明文名；
 *   2. TenderClarificationDoc.title——专家门户「澄清与修改文件」卡行名（写入端点
 *      已于 ff49ee399 删除，行=历史数据；bug#150_281 三行 mojibake 即此面）；
 *   3. Attachment.fileName——PMI 阶段附件/谈判配置轨读端名。
 * 不触碰：开标文件包等证据 JSON（SHA-256 指纹锚定，历史事实不可改写）。
 *
 * 判定（needsMultipartFilenameFix，条件式三闸）：
 *   含 >U+00FF 字符 → 干净名不动；纯 ASCII → 不动；高位字节 → latin1→utf8 回转，
 *   解码出 U+FFFD/控制符 → 非本病理不动。修复值与原值相同则跳过。
 *
 * 用法：
 *   npx tsx scripts/fix-filename-mojibake.ts                          # dry-run（默认，只报告）
 *   npx tsx scripts/fix-filename-mojibake.ts --execute                # 执行回填
 *   npx tsx scripts/fix-filename-mojibake.ts --table=fileAsset        # 限定表（fileAsset|clarification|attachment，默认三表全扫）
 *   npx tsx scripts/fix-filename-mojibake.ts --category=bid_document  # 限定分类（逗号分隔，仅 FileAsset）
 *   npx tsx scripts/fix-filename-mojibake.ts --id=cmw...              # 外科模式：单行（仅 FileAsset）
 * 写入为条件 updateMany（where 含原值）——并发改名不被覆盖，安全重跑幂等。
 */
import { PrismaClient } from '@prisma/client';
import { needsMultipartFilenameFix, normalizeMultipartFilename } from '../src/common/filename-encoding.util';

const prisma = new PrismaClient();
const execute = process.argv.includes('--execute');
const idArg = process.argv.find((a) => a.startsWith('--id='))?.slice(5);
const categoryArg = process.argv.find((a) => a.startsWith('--category='))?.slice(11);
const categories = categoryArg ? categoryArg.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
const tableArg = process.argv.find((a) => a.startsWith('--table='))?.slice(8);
const wantFileAsset = !tableArg || tableArg === 'fileAsset';
const wantClarification = !tableArg || tableArg === 'clarification';
const wantAttachment = !tableArg || tableArg === 'attachment';

const CHUNK = 500;

type Plan = { table: 'FileAsset' | 'TenderClarificationDoc' | 'Attachment'; id: string; label: string; from: string; to: string };

async function scanFileAsset(plans: Plan[]): Promise<void> {
  if (!wantFileAsset) return;
  if (idArg) {
    const row = await prisma.fileAsset.findUnique({
      where: { id: idArg },
      select: { id: true, category: true, originalName: true },
    });
    if (!row) throw new Error(`FileAsset 不存在: ${idArg}`);
    if (row.originalName && needsMultipartFilenameFix(row.originalName)) {
      plans.push({ table: 'FileAsset', id: row.id, label: row.category, from: row.originalName, to: normalizeMultipartFilename(row.originalName) });
    } else {
      console.log(`[skip] FileAsset ${row.id} 无需修复（originalName=${JSON.stringify(row.originalName)}）`);
    }
    return;
  }
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
      plans.push({ table: 'FileAsset', id: r.id, label: r.category, from: r.originalName, to: normalizeMultipartFilename(r.originalName) });
    }
    if (rows.length < CHUNK) break;
  }
}

/** bug#150：专家门户「澄清与修改文件」卡行名=TenderClarificationDoc.title 直发（历史写入端点已删，行=存量）。 */
async function scanClarificationTitle(plans: Plan[]): Promise<void> {
  if (!wantClarification) return;
  let cursor: string | undefined;
  for (;;) {
    const rows: Array<{ id: string; version: number; title: string }> = await prisma.tenderClarificationDoc.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      select: { id: true, version: true, title: true },
      orderBy: { id: 'asc' },
      take: CHUNK,
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    for (const r of rows) {
      if (!needsMultipartFilenameFix(r.title)) continue;
      plans.push({ table: 'TenderClarificationDoc', id: r.id, label: `v${r.version}`, from: r.title, to: normalizeMultipartFilename(r.title) });
    }
    if (rows.length < CHUNK) break;
  }
}

/** PMI 阶段附件/谈判配置轨读端名（Attachment.fileName）。 */
async function scanAttachmentFileName(plans: Plan[]): Promise<void> {
  if (!wantAttachment) return;
  let cursor: string | undefined;
  for (;;) {
    const rows: Array<{ id: string; objectKey: string; fileName: string }> = await prisma.attachment.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      select: { id: true, objectKey: true, fileName: true },
      orderBy: { id: 'asc' },
      take: CHUNK,
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    for (const r of rows) {
      if (!needsMultipartFilenameFix(r.fileName)) continue;
      plans.push({ table: 'Attachment', id: r.id, label: r.objectKey.split('/').pop() ?? r.objectKey, from: r.fileName, to: normalizeMultipartFilename(r.fileName) });
    }
    if (rows.length < CHUNK) break;
  }
}

async function main() {
  const plans: Plan[] = [];
  await scanFileAsset(plans);
  await scanClarificationTitle(plans);
  await scanAttachmentFileName(plans);

  const byTable = new Map<string, number>();
  for (const p of plans) byTable.set(`${p.table}`, (byTable.get(p.table) ?? 0) + 1);

  console.log(`=== 文件名 latin1 误读存量修复（${execute ? 'EXECUTE' : 'DRY-RUN'}）===`);
  console.log(`范围：${idArg ? `FileAsset 单行 ${idArg}` : categories ? `FileAsset category ∈ {${categories.join(', ')}}` : tableArg ? `table=${tableArg}` : '三表全扫（FileAsset / TenderClarificationDoc.title / Attachment.fileName）'}`);
  console.log(`命中待修：${plans.length} 行`);
  for (const [t, n] of [...byTable.entries()].sort()) console.log(`  - ${t}: ${n}`);
  for (const p of plans.slice(0, 50)) console.log(`  ${p.table} ${p.id} [${p.label}] ${JSON.stringify(p.from)} → ${JSON.stringify(p.to)}`);
  if (plans.length > 50) console.log(`  …另有 ${plans.length - 50} 行同口径`);
  if (!execute || plans.length === 0) return;

  let updated = 0;
  for (const p of plans) {
    // 条件写：原值仍是扫描时的值才更新（防并发人工改名被覆盖）；安全重跑
    const r = p.table === 'FileAsset'
      ? await prisma.fileAsset.updateMany({ where: { id: p.id, originalName: p.from }, data: { originalName: p.to } })
      : p.table === 'TenderClarificationDoc'
        ? await prisma.tenderClarificationDoc.updateMany({ where: { id: p.id, title: p.from }, data: { title: p.to } })
        : await prisma.attachment.updateMany({ where: { id: p.id, fileName: p.from }, data: { fileName: p.to } });
    updated += r.count;
  }
  console.log(`已回填 ${updated}/${plans.length} 行（差异行=期间被并发修改，重跑即收）`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
