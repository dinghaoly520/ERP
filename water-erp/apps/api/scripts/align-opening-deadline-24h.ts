/**
 * 存量截标↔开标差值 24h 对齐脚本（截标↔开标 24h 关系规范化 · Task 3）
 *
 * 背景：业务规则「投标截止 = 开标前 24 小时」（BID_DEADLINE_BEFORE_OPENING_MS，口径见
 * packages/shared/src/constants.ts 与 src/bid/opening-deadline.util.ts）。存量项目（含
 * 旧演示脚本时代创建的）deadline 与 openTime 相差 1h 或任意值，不满足 24h 关系。
 * 本脚本扫描存量 BidProject，把 deadline 对齐到 openTime − 24h（openTime 为基准不动）。
 *
 * 候选集  bidProject 全量，四分区：
 *   1. 待修正    deadline > now 且 |deadline − (openTime − 24h)| > 60s
 *   2. 已截标不动 deadline <= now（历史已截标项目，改动无意义，不动）
 *   3. 已合规    |deadline − (openTime − 24h)| <= 60s（含开标已过但关系本已合规的行）
 *   4. 信息区    openTime 或 deadline 为空（无基准/无目标，仅列出，不修正）
 *
 * 用法：
 *   npx tsx apps/api/scripts/align-opening-deadline-24h.ts           # dry-run（默认，零副作用）
 *   npx tsx apps/api/scripts/align-opening-deadline-24h.ts --execute # 真实对齐「待修正」行
 *
 * --execute 语义：
 *   - 仅处理「待修正」行：update({ deadline: deriveDeadlineFromOpenTime(openTime) })，
 *     openTime 为基准不动；
 *   - 逐条 try/catch：单行失败不中断，失败行保持原样并计数；
 *   - 无交互确认——命令行 --execute 参数即确认（执行前请审阅 dry-run 清单）。
 *
 * 口径来源：BID_DEADLINE_BEFORE_OPENING_MS（24h）/ BID_OPENING_GAP_TOLERANCE_MS（60s）
 * 直接 import 自 @water-erp/shared dist（tsx 经 apps/api/tsconfig.json paths 解析，
 * 前置：shared 已 build）；deriveDeadlineFromOpenTime 复用 Task 1 的
 * src/bid/opening-deadline.util.ts（单一事实来源）。
 *
 * 环境：脚本自行加载 apps/api/.env（DATABASE_URL），
 * 从 water-erp/ 根或 apps/api/ 目录运行均可。
 */
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BID_DEADLINE_BEFORE_OPENING_MS, BID_OPENING_GAP_TOLERANCE_MS } from '@water-erp/shared';
import { deriveDeadlineFromOpenTime } from '../src/bid/opening-deadline.util';

// ── .env 加载（先于 PrismaClient 实例化）──
function loadEnvFile(candidates: string[]): string | null {
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
      if (process.env[m[1]] === undefined) process.env[m[1]] = value; // dotenv 语义：不覆盖已有
    }
    return p;
  }
  return null;
}

const scriptDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
const loadedEnv = loadEnvFile([
  join(process.cwd(), 'apps', 'api', '.env'), // 从 water-erp/ 根运行
  join(process.cwd(), '.env'), // 从 apps/api 运行
  join(scriptDir, '..', '.env'), // 脚本自身位置兜底
]);

const prisma = new PrismaClient();

const bar = '─'.repeat(96);

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}

const iso = (d: Date | null | undefined): string => (d ? d.toISOString() : '—');

type Proj = {
  id: string;
  projectCode: string;
  name: string;
  openTime: Date | null;
  deadline: Date | null;
  stage: string;
};

/** 24h 关系偏差：|deadline − (openTime − 24h)|，单位 ms；openTime/deadline 缺失返回 Infinity */
function gapMs(p: Proj): number {
  if (!p.openTime || !p.deadline) return Infinity;
  return Math.abs(
    p.deadline.getTime() - (p.openTime.getTime() - BID_DEADLINE_BEFORE_OPENING_MS),
  );
}

async function main() {
  const execute = process.argv.includes('--execute');
  const now = Date.now();

  console.log(bar);
  console.log(
    execute
      ? '  存量截标↔开标差值 24h 对齐 · EXECUTE（将更新「待修正」行的 deadline = openTime − 24h）'
      : '  存量截标↔开标差值 24h 对齐 · DRY-RUN（只读：不更新任何数据）',
  );
  console.log('  口径: 投标截止 = 开标前 24 小时（BID_DEADLINE_BEFORE_OPENING_MS）');
  console.log('        容差: |deadline − (openTime − 24h)| <= BID_OPENING_GAP_TOLERANCE_MS(60s)');
  if (loadedEnv) console.log(`  env: ${loadedEnv}`);
  console.log(bar);

  // ── 候选集 ──
  const projects = (await prisma.bidProject.findMany({
    select: { id: true, projectCode: true, name: true, openTime: true, deadline: true, stage: true },
    orderBy: { projectCode: 'asc' },
  })) as Proj[];
  console.log(`\n存量 BidProject 总数: ${projects.length}`);

  // ── 分区 ──
  const needFix: Proj[] = []; // deadline > now 且偏差超容差
  const expired: Proj[] = []; // deadline <= now（已截标不动）
  const compliant: Proj[] = []; // 偏差 <= 容差
  const missingTs: Proj[] = []; // openTime 或 deadline 为空（信息区，不修正）
  for (const p of projects) {
    if (!p.openTime || !p.deadline) {
      missingTs.push(p);
    } else if (p.deadline.getTime() <= now) {
      expired.push(p);
    } else if (gapMs(p) <= BID_OPENING_GAP_TOLERANCE_MS) {
      compliant.push(p);
    } else {
      needFix.push(p);
    }
  }

  console.log(`  待修正（deadline>now 且偏差>60s）  : ${needFix.length} 个`);
  console.log(`  已截标不动（deadline<=now）        : ${expired.length} 个`);
  console.log(`  已合规（偏差<=60s）                : ${compliant.length} 个`);
  console.log(`  信息区（openTime/deadline 缺失）   : ${missingTs.length} 个（不修正，见清单）`);

  // ── 待修正清单 ──
  if (needFix.length > 0) {
    console.log(`\n${bar}`);
    console.log('待修正清单（{ projectCode, name, stage, 现 openTime, 现 deadline, 目标 deadline }）:');
    console.log(bar);
    const head = [
      pad('#', 3),
      pad('projectCode', 24),
      pad('stage', 13),
      pad('现 openTime', 26),
      pad('现 deadline', 26),
      pad('目标 deadline', 26),
      'name',
    ].join(' ');
    console.log(head);
    console.log(bar);
    let i = 0;
    for (const p of needFix) {
      i += 1;
      console.log(
        [
          pad(String(i), 3),
          pad(p.projectCode, 24),
          pad(p.stage, 13),
          pad(iso(p.openTime), 26),
          pad(iso(p.deadline), 26),
          pad(iso(deriveDeadlineFromOpenTime(p.openTime as Date)), 26),
          p.name,
        ].join(' '),
      );
    }
  }

  // ── 信息区清单（无 openTime 或无 deadline；仅列出，不修正）──
  if (missingTs.length > 0) {
    console.log(`\n${bar}`);
    console.log(`信息区 · openTime 或 deadline 缺失: ${missingTs.length} 个（无基准/无目标，不修正）`);
    console.log(bar);
    for (const p of missingTs) {
      console.log(
        `  ${pad(p.projectCode, 24)} ${pad(p.stage, 13)} openTime=${iso(p.openTime)} deadline=${iso(p.deadline)}  ${p.name}`,
      );
    }
  }

  // ── 已截标 / 已合规（计数外，压缩列出 code 便于核对）──
  const briefList = (rows: Proj[]): string =>
    rows.length === 0 ? '（无）' : rows.map((r) => r.projectCode).join(' | ');
  console.log(`\n已截标不动（不改）: ${briefList(expired)}`);
  console.log(`已合规（不改）    : ${briefList(compliant)}`);

  // ── dry-run 到此为止 ──
  if (!execute) {
    console.log(`\n${bar}`);
    console.log('DRY-RUN 结束：未更新任何数据。');
    console.log('核对清单后，加 --execute 执行真实对齐（仅「待修正」行，openTime 为基准不动）。');
    console.log(bar);
    await prisma.$disconnect();
    return;
  }

  // ── EXECUTE ──
  console.log(`\n${bar}`);
  console.log('[WARN] EXECUTE 模式：即将把「待修正」行的 deadline 更新为 openTime − 24h。');
  console.log('[WARN] 已截标/已合规/信息区行一律不动；openTime 为基准不动。');
  console.log('[WARN] 逐条失败不中断；失败行保持原样。');
  console.log(bar);

  if (needFix.length === 0) {
    console.log(`\n无待修正行（对齐集为空），执行结束。`);
    await prisma.$disconnect();
    return;
  }

  let ok = 0;
  let failed = 0;
  const failedCodes: string[] = [];
  for (const p of needFix) {
    const target = deriveDeadlineFromOpenTime(p.openTime as Date);
    try {
      await prisma.bidProject.update({
        where: { id: p.id },
        data: { deadline: target },
      });
      ok += 1;
      console.log(`  [OK]   ${p.projectCode}  deadline ${iso(p.deadline)} → ${iso(target)}（openTime 不动）`);
    } catch (e) {
      failed += 1;
      failedCodes.push(p.projectCode);
      console.log(`  [FAIL] ${p.projectCode} 更新失败，保持原样: ${(e as Error).message}`);
    }
  }

  console.log(`\n${bar}`);
  console.log('EXECUTE 汇总:');
  console.log(`  成功（deadline 已对齐 24h）: ${ok}`);
  console.log(`  失败（保持原样，需人工跟进）: ${failed}`);
  console.log(`  未动（已截标/已合规/信息区）: ${expired.length + compliant.length + missingTs.length}`);
  if (failedCodes.length > 0) console.log(`  失败项目: ${failedCodes.join(' | ')}`);
  console.log(bar);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
