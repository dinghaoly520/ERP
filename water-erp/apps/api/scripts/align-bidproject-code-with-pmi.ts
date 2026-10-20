/**
 * 存量 BidProject.projectCode 与宿主 PMI 业务编号对齐脚本（2026-10-19 编号统一）
 *
 * 背景：generateProjectCode 历史产出两段式 `JJ-YYYYMMDD##`，与 PMI 三段式
 * `SWHI-JJ-YYYYMMDD##` 漂移（公告/立项/项目三处编号互不一致，甚至序号日期也漂：
 * ZJ-2026101602 vs SWHI-ZJ-2026101601）。用户裁定统一为 PMI 业务编号口径。
 *
 * 候选集：有 projectManagementItemId 且 projectCode ≠ PMI.projectCode 的 BidProject。
 * 目标码：PMI 业务编号；若已被同 PMI 其他轮次项目占用 → 顺延 `-R2`/`-R3`…。
 * 联动修正：引用旧 BidProject 编号的 Announcement.relatedProjectCode 同步改为新码。
 *
 * 用法：
 *   npx tsx apps/api/scripts/align-bidproject-code-with-pmi.ts           # dry-run（默认，零副作用）
 *   npx tsx apps/api/scripts/align-bidproject-code-with-pmi.ts --execute # 真实对齐
 *
 * --execute 语义：逐条 try/catch，单行失败不中断；执行前请审阅 dry-run 清单。
 * 影子项目（isExtractionOnly，无 PMI 宿主）与无 PMI 关联的行天然不在候选集，不动。
 */
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ── .env 加载（先于 PrismaClient 实例化）──
function loadEnvFile(candidates: string[]): string | null {
  for (const p of candidates) {
    if (existsSync(p)) {
      for (const line of readFileSync(p, 'utf-8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
      return p;
    }
  }
  return null;
}
loadEnvFile([join(__dirname, '..', '.env'), join(process.cwd(), '.env'), join(process.cwd(), 'apps/api/.env')]);

const prisma = new PrismaClient();
const EXECUTE = process.argv.includes('--execute');

async function main() {
  const rows = await prisma.bidProject.findMany({
    where: { projectManagementItemId: { not: null } },
    select: { id: true, name: true, projectCode: true, projectManagementItemId: true, round: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const pmis = await prisma.projectManagementItem.findMany({
    select: { id: true, projectCode: true },
  });
  const pmiCodeById = new Map(pmis.map(p => [p.id, p.projectCode]));

  // 全表已占编号集合（唯一约束探测用）
  const taken = new Set((await prisma.bidProject.findMany({ select: { projectCode: true } })).map(r => r.projectCode));

  const plans: Array<{ id: string; name: string; from: string; to: string; pmi: string }> = [];
  const skipped: Array<{ id: string; name: string; from: string; pmi: string; reason: string }> = [];

  for (const row of rows) {
    const pmiCode = row.projectManagementItemId ? pmiCodeById.get(row.projectManagementItemId) : null;
    if (!pmiCode) { skipped.push({ ...row, pmi: '—', reason: 'PMI 无业务编号' }); continue; }
    if (row.projectCode === pmiCode) continue; // 已对齐
    // 目标码：基础码空闲则用基础码；被占（同 PMI 首轮已在）顺延 -Rn
    let target = pmiCode;
    if (taken.has(target)) {
      target = '';
      for (let n = 2; n <= 201; n++) {
        const cand = `${pmiCode}-R${n}`;
        if (!taken.has(cand)) { target = cand; break; }
      }
      if (!target) { skipped.push({ ...row, pmi: pmiCode, reason: '轮次后缀耗尽' }); continue; }
    }
    taken.add(target); // 同批内互斥
    plans.push({ id: row.id, name: row.name, from: row.projectCode, to: target, pmi: pmiCode });
  }

  console.log(`候选 BidProject（有 PMI 宿主）: ${rows.length}，待对齐: ${plans.length}，跳过: ${skipped.length}`);
  for (const p of plans) {
    console.log(`  [对齐] ${p.from} → ${p.to}  (${p.name} / PMI ${p.pmi})`);
  }
  for (const s of skipped) {
    console.log(`  [跳过] ${s.from} (PMI ${s.pmi}) — ${s.reason}`);
  }
  if (!EXECUTE) {
    console.log('\ndry-run 结束（零副作用）。审阅后加 --execute 执行。');
    return;
  }

  let ok = 0, fail = 0;
  for (const p of plans) {
    try {
      await prisma.$transaction([
        prisma.bidProject.update({ where: { id: p.id }, data: { projectCode: p.to } }),
        // 引用旧 BidProject 内部编号的公告同步指向新码（PMI 码引用行不受影响）
        prisma.announcement.updateMany({ where: { relatedProjectCode: p.from }, data: { relatedProjectCode: p.to } }),
      ]);
      ok++;
    } catch (e) {
      fail++;
      console.error(`  [失败] ${p.from} → ${p.to}: ${(e as Error).message}`);
    }
  }
  console.log(`\n执行完成：成功 ${ok}，失败 ${fail}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
