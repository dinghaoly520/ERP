// apps/api/scripts/assign-unattributed-company.ts
/**
 * 存量未归属公司批量归属（2026-10-15）：
 *   ① 供应商：Supplier.companyId=null → 设计院（co-swhi-sjy）+ companyName 快照。
 *      供应商库公司分组/隔离（2026-09-14）口径；2026-09-14 曾回填过一次，09-22 清库
 *      重种子后回退未归属——本次重建，且 seed.ts 重建段已补同口径兜底（见 1.6 段）。
 *   ② 专家：User.companyId=null 的 bid_expert 按 ExpertProfile.employer（工作单位）
 *      精确匹配 companies.name——匹配即归属（companyId + company 快照）；
 *      未匹配保持未归属并输出清单（2026-10-15 用户裁定：不兜底强归，避免张冠李戴）。
 *
 * 幂等：只动 companyId=null 的行，--execute 重跑为 no-op。
 * 用法：
 *   cd apps/api && npx tsx scripts/assign-unattributed-company.ts            # dry-run（默认，零副作用）
 *   cd apps/api && npx tsx scripts/assign-unattributed-company.ts --execute  # 真实执行
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
loadEnvFile([join(scriptDir, '..', '.env'), join(process.cwd(), '.env')]);

const prisma = new PrismaClient();

/** 归属目标：设计院（公司主数据唯一设计类主体，CGZX 工作人员全部挂此公司） */
const DESIGN_COMPANY_ID = 'co-swhi-sjy';

// ── 纯函数：专家按工作单位归属计划（spec 消费）──
export interface ExpertRow {
  id: string;
  displayName: string;
  employer: string | null;
}
export interface CompanyRow {
  id: string;
  name: string;
}
export interface ExpertAssignmentPlan {
  /** 按目标公司聚合的 userId 分组 */
  matched: { companyId: string; companyName: string; userIds: string[] }[];
  /** 工作单位匹配不上的（含未填），保持未归属 */
  unmatched: ExpertRow[];
}
export function planExpertCompanyAssignment(experts: ExpertRow[], companies: CompanyRow[]): ExpertAssignmentPlan {
  const byName = new Map(companies.map(c => [c.name.trim(), c] as const));
  const groups = new Map<string, { companyId: string; companyName: string; userIds: string[] }>();
  const unmatched: ExpertRow[] = [];
  for (const e of experts) {
    const c = e.employer?.trim() ? byName.get(e.employer.trim()) : undefined;
    if (!c) {
      unmatched.push(e);
      continue;
    }
    const g = groups.get(c.id) ?? { companyId: c.id, companyName: c.name, userIds: [] };
    g.userIds.push(e.id);
    groups.set(c.id, g);
  }
  return { matched: [...groups.values()], unmatched };
}

async function main() {
  const execute = process.argv.includes('--execute');
  const sjy = await prisma.company.findUnique({ where: { id: DESIGN_COMPANY_ID } });
  if (!sjy) throw new Error(`${DESIGN_COMPANY_ID} 公司主数据不存在，请先核对 companies 表`);

  // ① 供应商：未归属 → 设计院
  const suppliers = await prisma.supplier.findMany({ where: { companyId: null }, select: { id: true } });
  console.log(`[供应商] 未归属 ${suppliers.length} 家 → ${sjy.name}（${sjy.id}）`);
  if (execute && suppliers.length > 0) {
    const r = await prisma.supplier.updateMany({
      where: { id: { in: suppliers.map(s => s.id) } },
      data: { companyId: sjy.id, companyName: sjy.name },
    });
    console.log(`[供应商] 已归属 ${r.count} 家`);
  }

  // ② 专家：未归属按工作单位匹配公司主数据
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  const experts = await prisma.user.findMany({
    where: { role: 'bid_expert', companyId: null },
    select: { id: true, displayName: true, expertProfile: { select: { employer: true } } },
    orderBy: { displayName: 'asc' },
  });
  const plan = planExpertCompanyAssignment(
    experts.map(e => ({ id: e.id, displayName: e.displayName, employer: e.expertProfile?.employer ?? null })),
    companies,
  );
  console.log(`[专家] 未归属 ${experts.length} 名，按工作单位匹配：`);
  for (const g of plan.matched) console.log(`  - ${g.companyName}（${g.companyId}）× ${g.userIds.length}`);
  if (plan.unmatched.length > 0) {
    console.log(`[专家] 未匹配 ${plan.unmatched.length} 名（保持未归属）：`);
    for (const u of plan.unmatched) console.log(`  - ${u.displayName}｜工作单位「${u.employer ?? '未填'}」`);
  }
  if (execute) {
    for (const g of plan.matched) {
      const r = await prisma.user.updateMany({
        where: { id: { in: g.userIds } },
        data: { companyId: g.companyId, company: g.companyName },
      });
      console.log(`[专家] 已归属 ${r.count} 名 → ${g.companyName}`);
    }
  }
  console.log(execute ? '完成' : 'DRY-RUN 结束（--execute 生效）');
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}
