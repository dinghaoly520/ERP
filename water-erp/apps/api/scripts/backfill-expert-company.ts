/**
 * 一次性回填（2026-09-24 专家库公司隔离落地）：存量 bid_expert 全部归属采购中心运营主体
 * （co-swhi-sjy 设计院）——与公司隔离落地时「无归属存量已清」的既有口径一致。
 * 后续新专家由录入/导入链路自操作人写时快照，不再需要本脚本。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const sjy = await prisma.company.findUnique({ where: { id: 'co-swhi-sjy' } });
  if (!sjy) throw new Error('co-swhi-sjy 公司主数据不存在，请先核对 companies 表');
  const unattributed = await prisma.user.findMany({
    where: { role: 'bid_expert', OR: [{ companyId: null }, { company: null }] },
    select: { id: true },
  });
  const r = await prisma.user.updateMany({
    where: { id: { in: unattributed.map(u => u.id) } },
    data: { companyId: sjy.id, company: sjy.name },
  });
  console.log(`专家归属回填：${r.count} 名 → ${sjy.name}（${sjy.id}）`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
