// apps/api/scripts/migrate-ai-report-category.ts
/**
 * 存量 AI 分析报告 FileAsset 类目迁移（回流包遗留项修复 · Task 2）
 *
 * 背景：ai-bid worker 此前以 category='general' 落 AI 报告 docx（bidder.processor.ts），
 * general 不在 EVIDENCE_PROTECTED_CATEGORIES——回流包 aiAnalysis.report.docx 引用该资产，
 * 被删即引用悬空。Task 1 起新报告落 'ai_bid_report'；本脚本把存量对齐。
 *
 * 用法：
 *   # apps/api/ 目录下（pnpm bin 隔离，从根跑 npx tsx 会 not found）：
 *   npx tsx scripts/migrate-ai-report-category.ts            # dry-run（默认，零副作用）
 *   npx tsx scripts/migrate-ai-report-category.ts --execute  # 真实更新 category
 *   # 或从 water-erp/ 根：
 *   pnpm --filter api exec tsx scripts/migrate-ai-report-category.ts [--execute]
 *
 * 环境：脚本自行加载 apps/api/.env（DATABASE_URL），从 water-erp/ 根或 apps/api/ 目录运行均可。
 *
 * 候选集：AiBidReport.docxFileId/pdfFileId 指向、且 category ≠ ai_bid_report 的 FileAsset。
 * 幂等：已合规行不产生迁移；--execute 重跑为 no-op。孤儿（引用 id 无 FileAsset 行）仅列出。
 */
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ── .env 加载（先于 PrismaClient 实例化；dotenv 语义：不覆盖已有）──
function loadEnvFile(candidates: string[]): string | null {
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
    return p;
  }
  return null;
}

const scriptDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
loadEnvFile([
  join(process.cwd(), 'apps', 'api', '.env'), // 从 water-erp/ 根运行
  join(process.cwd(), '.env'), // 从 apps/api 运行
  join(scriptDir, '..', '.env'), // 脚本自身位置兜底
]);

export const TARGET_CATEGORY = 'ai_bid_report';
export interface AiReportRow { id: string; taskId: string; docxFileId: string | null; pdfFileId: string | null }
export interface AssetRow { id: string; key: string; category: string }

export function planAiReportCategoryMigrations(reports: AiReportRow[], assetsById: Map<string, AssetRow>): {
  migrations: Array<{ fileAssetId: string; key: string; from: string }>;
  missing: string[];
} {
  const migrations: Array<{ fileAssetId: string; key: string; from: string }> = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const r of reports) {
    for (const fid of [r.docxFileId, r.pdfFileId]) {
      if (!fid || seen.has(fid)) continue;
      seen.add(fid);
      const a = assetsById.get(fid);
      if (!a) { missing.push(fid); continue; }
      if (a.category !== TARGET_CATEGORY) migrations.push({ fileAssetId: a.id, key: a.key, from: a.category });
    }
  }
  return { migrations, missing };
}

async function main() {
  const execute = process.argv.includes('--execute');
  const prisma = new PrismaClient();
  try {
    const reports = await prisma.aiBidReport.findMany({
      select: { id: true, taskId: true, docxFileId: true, pdfFileId: true },
    });
    const ids = [...new Set(reports.flatMap(r => [r.docxFileId, r.pdfFileId]).filter((x): x is string => !!x))];
    const assets = ids.length > 0
      ? await prisma.fileAsset.findMany({ where: { id: { in: ids } }, select: { id: true, key: true, category: true } })
      : [];
    const { migrations, missing } = planAiReportCategoryMigrations(reports, new Map(assets.map(a => [a.id, a])));

    console.log(`AiBidReport 共 ${reports.length} 条；待迁移 ${migrations.length} 件；孤儿引用 ${missing.length} 件`);
    for (const m of migrations) console.log(`  [迁移] ${m.key}  ${m.from} -> ${TARGET_CATEGORY}`);
    for (const x of missing) console.log(`  [孤儿] FileAsset 缺行：${x}（AiBidReport 引用悬空，需人工核查）`);

    if (!execute) { console.log('\ndry-run 结束（未写库）。加 --execute 执行迁移。'); return; }
    if (migrations.length === 0) { console.log('无可迁移行。'); return; }
    const res = await prisma.fileAsset.updateMany({
      where: { id: { in: migrations.map(m => m.fileAssetId) } },
      data: { category: TARGET_CATEGORY },
    });
    console.log(`\n已更新 ${res.count} 件 FileAsset.category -> ${TARGET_CATEGORY}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) main().catch(err => { console.error(err); process.exit(1); });
