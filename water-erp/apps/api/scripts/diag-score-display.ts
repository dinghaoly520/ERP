/**
 * 生产诊断（bug#121 关联问询，2026-11-17）：某项目「采购端做完数据后看不到评分点」根因排查。
 * 只读——逐项目输出评分数据链各环节计数与裁决线。
 *
 * 用法：
 *   npx tsx scripts/diag-score-display.ts                 # 最近 10 个项目
 *   npx tsx scripts/diag-score-display.ts --code=SWHI-TP-2026111601  # 指定项目编号
 *   npx tsx scripts/diag-score-display.ts --limit=20      # 最近 N 个
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const codeArg = process.argv.find((a) => a.startsWith('--code='))?.slice(7);
const limitArg = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice(8) ?? 10);

async function main() {
  const projects = codeArg
    ? await prisma.bidProject.findMany({ where: { OR: [{ projectCode: codeArg }, { name: { contains: codeArg } }] }, orderBy: { createdAt: 'desc' } })
    : await prisma.bidProject.findMany({ orderBy: { createdAt: 'desc' }, take: limitArg });

  if (projects.length === 0) { console.log(`未找到项目：${codeArg}`); return; }

  for (const p of projects) {
    const items = await prisma.bidScoreItem.findMany({
      where: { projectId: p.id },
      select: { id: true, category: true, name: true, maxScore: true, _count: { select: { points: true, scoreRecords: true } } },
      orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
    });
    const experts = await prisma.bidExpert.count({ where: { projectId: p.id } });
    const suppliers = await prisma.bidSupplier.count({ where: { projectId: p.id } });
    const results = await prisma.bidEvaluationResult.count({ where: { projectId: p.id } });
    const totalPoints = items.reduce((s, i) => s + i._count.points, 0);
    const totalRecords = items.reduce((s, i) => s + i._count.scoreRecords, 0);

    const verdict =
      items.length === 0 ? '【裁决】评分项 0 —— 评分标准从未编制（谈判/直接采购轨无编制步骤、或招标轨漏做编制）→ 卡片无数据属数据面空，非展示缺陷'
      : totalPoints === 0 ? `【裁决】评分项 ${items.length} 条但得分点 0 —— 编制只建了评分项没建得分点（通过/不通过型可无得分点，#121 表决口径仍应展示项行）`
      : totalRecords === 0 ? `【裁决】评分项 ${items.length} + 得分点 ${totalPoints} 在，但专家打分记录 0 —— 评分数据未产生（专家未打分/未提交）`
      : `【裁决】数据链完整（项 ${items.length}/点 ${totalPoints}/打分 ${totalRecords}）—— 若页面仍无展示，转查前端/接口返回（提供页面截图与接口响应）`;

    console.log('═'.repeat(100));
    console.log(`${p.projectCode} | ${p.name?.slice(0, 30)} | ${p.stage} | 方式=${p.procurementMethod ?? '-'} | round=${p.currentRoundNo ?? '-'} | 建于 ${p.createdAt?.toISOString().slice(0, 10)} | 标准发布=${p.scoreStandardPublishedAt ? 'Y' : 'N'}`);
    console.log(`  专家 ${experts} · 供应商 ${suppliers} · 评标结果 ${results} · 评分项 ${items.length} · 得分点 ${totalPoints} · 打分记录 ${totalRecords}`);
    for (const i of items.slice(0, 12)) {
      console.log(`    [${i.category}] ${i.name.slice(0, 24)} max=${i.maxScore} 点=${i._count.points} 打分=${i._count.scoreRecords}`);
    }
    if (items.length > 12) console.log(`    …另有 ${items.length - 12} 项`);
    console.log(`  ${verdict}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
