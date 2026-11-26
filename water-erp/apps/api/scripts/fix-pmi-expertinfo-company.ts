/**
 * 存量 PMI 评审专家名单修复（2026-11-26 用户裁定「公司列显示所属公司」）：
 * expertInfo 快照第二段此前恒写部门名（User.department.name），与基本信息列头「公司」错位
 * （实录：田瑜豪显示「总工程师办公室」等）。写端已改 User.company 展示快照优先（无公司
 * 归属回退部门名）；本脚本对存量 PMI 按 BidExpert 全量名册重建 expertInfo（与抽取确认
 * 回写同口径，含角色推导），dry-run 只打印差异，--execute 实际回写。幂等可重复执行。
 *
 *   npx tsx scripts/fix-pmi-expertinfo-company.ts            # dry-run
 *   npx tsx scripts/fix-pmi-expertinfo-company.ts --execute  # 回写
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const flat = (v: string | null | undefined) => (v ?? '').replace(/[\r\n]+/g, ' ').trim();

async function rebuildExpertInfo(pmiId: string): Promise<string | null> {
  const bpIds = await prisma.bidProject.findMany({
    where: { projectManagementItemId: pmiId },
    select: { id: true },
  });
  const bpIdSet = bpIds.map((b) => b.id);
  const bidExperts = bpIdSet.length > 0
    ? await prisma.bidExpert.findMany({
        where: { projectId: { in: bpIdSet } },
        orderBy: [{ expertRole: 'asc' }, { createdAt: 'asc' }],
        select: {
          expertName: true, major: true, expertRole: true, isLead: true, isPurchaserRepresentative: true,
          user: { select: { company: true, department: { select: { name: true } }, expertProfile: { select: { title: true } } } },
        },
      })
    : [];
  if (bidExperts.length === 0) return null;
  return bidExperts
    .map((e) => [
      flat(e.expertName),
      flat(e.user?.company || e.user?.department?.name),
      flat(e.major),
      flat(e.user?.expertProfile?.title),
      e.isPurchaserRepresentative ? '需求方代表' : e.expertRole === '候补' ? '候补' : e.isLead ? '正选·组长' : '正选',
    ].join('|'))
    .join('\n');
}

async function main() {
  const execute = process.argv.includes('--execute');
  const items = await prisma.projectManagementItem.findMany({
    where: { expertInfo: { not: null } },
    select: { id: true, title: true, expertInfo: true },
    orderBy: { updatedAt: 'desc' },
  });

  let fixed = 0;
  for (const item of items) {
    const rebuilt = await rebuildExpertInfo(item.id);
    if (!rebuilt || rebuilt === item.expertInfo) continue;
    if (!execute) {
      console.log(`[dry-run] ${item.id} 「${item.title}」`);
      const oldLines = String(item.expertInfo).split('\n');
      const newLines = rebuilt.split('\n');
      for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
        if (oldLines[i] !== newLines[i]) {
          const o = String(oldLines[i] ?? '').split('|')[1] ?? '(无)';
          const n = String(newLines[i] ?? '').split('|')[1] ?? '(无)';
          console.log(`    ${String(oldLines[i] ?? '').split('|')[0]}: ${o} → ${n}`);
        }
      }
    } else {
      await prisma.projectManagementItem.update({ where: { id: item.id }, data: { expertInfo: rebuilt } });
      console.log(`[fixed] ${item.id} 「${item.title}」`);
    }
    fixed++;
  }
  console.log(execute ? `回写完成：${fixed}/${items.length} 条。` : `dry-run：待回写 ${fixed}/${items.length} 条（加 --execute 执行）。`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
