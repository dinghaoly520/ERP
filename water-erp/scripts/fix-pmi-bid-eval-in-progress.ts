/**
 * P1-B 存量修复（2026-09-08 二轮 UI 审查）：currentStage=BID_EVALUATION 的 ACTIVE PMI，
 * 其 BID_EVALUATION 阶段 status 置 IN_PROGRESS——否则 :3005 开标确认入口按钮不渲染。
 * 幂等：IN_PROGRESS/COMPLETED 不动；带 --dry-run 只打印清单。
 *
 * 背景：公告直建项目联动补建最小 PMI 时（N16 A 方案），currentStage 指向 BID_EVALUATION
 * 但对应阶段行 status 停在 NOT_STARTED。后端写径已修（7d89b349），本脚本只清存量；
 * 通用条件（不限 GK 编号，防同类遗漏）。存量 5 条：GK-2026082001~005。
 *
 * Prisma 客户端获取：脚本位于 water-erp/scripts/，pnpm 严格根布局下根 node_modules
 * 无 @prisma/client——沿用 scripts/demo-snapshot.js 先例（env 加载 + createRequire 指向
 * apps/api/package.json）。从 water-erp/ 根或 scripts/ 目录运行均可。
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';

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
const loadedEnv = loadEnvFile([
  join(scriptDir, '..', 'apps', 'api', '.env'), // 脚本自身位置
  join(process.cwd(), 'apps', 'api', '.env'), // 从 water-erp/ 根运行
]);

const apiRequire = createRequire(join(scriptDir, '..', 'apps', 'api', 'package.json'));
const { PrismaClient } = apiRequire('@prisma/client');
const prisma = new PrismaClient();
const dry = process.argv.includes('--dry-run');

async function main() {
  if (loadedEnv) console.log(`env: ${loadedEnv}`);
  console.log(dry ? 'DRY-RUN（只读，不更新任何数据）' : 'EXECUTE（将命中行的 BID_EVALUATION 阶段置 IN_PROGRESS）');
  const items = await prisma.projectManagementItem.findMany({
    where: { currentStage: 'BID_EVALUATION', status: 'ACTIVE' },
    select: { id: true, projectCode: true, stages: { where: { stageKey: 'BID_EVALUATION', status: 'NOT_STARTED' } } },
  });
  const targets = items.filter((i) => i.stages.length > 0);
  console.log(`命中 ${targets.length} 条：`, targets.map((t) => t.projectCode).join(', ') || '（无）');
  if (dry || targets.length === 0) return;
  const res = await prisma.projectManagementStage.updateMany({
    where: { projectManagementItemId: { in: targets.map((t) => t.id) }, stageKey: 'BID_EVALUATION', status: 'NOT_STARTED' },
    data: { status: 'IN_PROGRESS' },
  });
  console.log(`已更新 ${res.count} 条 stage → IN_PROGRESS`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
