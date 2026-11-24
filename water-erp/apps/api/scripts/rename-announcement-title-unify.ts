/**
 * 存量公告标题名称统一（2026-11-24 用户裁定「所有发公告的采购方式名称统一」配套）：
 *   1. 「谈判文件公告 — X」→「谈判采购公告 — X」
 *      （getAnnouncementLabel 曾落兜底 `${tenderLabel}公告`，tenderLabel 是采购文件名
 *       「谈判文件」——与「竞价采购公告」等不统一；生成端同日已修）
 *   2. 「招标公告 — X」→「公开招标公告 — X」
 *      （公开招标公告名称与「邀请招标公告」对仗，同日二次裁定；docx 文书内部标题
 *       仍「招标公告」法定口吻不受影响）
 *
 * 改名面：
 *   - Announcement.title：公告列表/详情标题（主要可见面）
 *   - BidProject.name：2026-11-19 前存量带前缀入库（供应商门户「采购项目」名），同步改名
 *   分隔符兼容：— / - / – / ·（与 announcement-title.util.ts 的剥离正则一致）
 *   读端剥离正则新旧词都认（含旧「招标公告」与新「公开招标公告」）——改名不破坏既有匹配。
 *
 * 用法：
 *   npx tsx apps/api/scripts/rename-announcement-title-unify.ts           # dry-run（默认，零副作用）
 *   npx tsx apps/api/scripts/rename-announcement-title-unify.ts --execute # 真实改名
 *
 * --execute 语义：逐行 try/catch，单行失败不中断并计数；无交互确认——
 * 命令行参数即确认（执行前请审阅 dry-run 清单）。
 */
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ── .env 加载（先于 PrismaClient 实例化，dotenv 语义不覆盖已有）──
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

const prisma = new PrismaClient();
const EXECUTE = process.argv.includes('--execute');

// 旧名 → 新名（与 announcement-title.util.ts 剥离正则同集的分隔符，保留原分隔符仅换类型词）
const RENAMES: Array<{ from: string; to: string }> = [
  { from: '谈判文件公告', to: '谈判采购公告' },
  { from: '招标公告', to: '公开招标公告' },
];
const SEP_RE = (word: string) => new RegExp(`^${word}(\\s*[—\\-–·]\\s*)`);

async function run(): Promise<void> {
  let total = 0;
  let done = 0;
  let failed = 0;

  for (const { from, to } of RENAMES) {
    const sep = SEP_RE(from);
    const [announcements, bidProjects] = await Promise.all([
      prisma.announcement.findMany({ where: { title: { startsWith: from } }, select: { id: true, title: true } }),
      prisma.bidProject.findMany({ where: { name: { startsWith: from } }, select: { id: true, name: true } }),
    ]);
    console.log(`\n== ${from} → ${to}：Announcement ${announcements.length} 行、BidProject ${bidProjects.length} 行`);
    total += announcements.length + bidProjects.length;

    for (const a of announcements) {
      const next = a.title.replace(sep, `${to}$1`);
      if (next === a.title) { console.log(`  [跳过] 无分隔符形态：${a.title}`); continue; }
      console.log(`  [Announcement ${a.id}] ${a.title} → ${next}`);
      if (EXECUTE) {
        try { await prisma.announcement.update({ where: { id: a.id }, data: { title: next } }); done++; }
        catch (e) { failed++; console.log(`    改名失败：${(e as Error).message}`); }
      }
    }

    for (const b of bidProjects) {
      const next = b.name!.replace(sep, `${to}$1`);
      if (next === b.name) { console.log(`  [跳过] 无分隔符形态：${b.name}`); continue; }
      console.log(`  [BidProject ${b.id}] ${b.name} → ${next}`);
      if (EXECUTE) {
        try { await prisma.bidProject.update({ where: { id: b.id }, data: { name: next } }); done++; }
        catch (e) { failed++; console.log(`    改名失败：${(e as Error).message}`); }
      }
    }
  }

  console.log(`\n${EXECUTE ? `完成：命中 ${total} 行、改名 ${done} 行、失败 ${failed} 行` : `dry-run 结束：命中 ${total} 行（加 --execute 执行改名）`}`);
}

run()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
