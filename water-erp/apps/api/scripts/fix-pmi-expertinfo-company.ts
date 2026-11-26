/**
 * 存量 PMI 评审专家名单重建（2026-11-26 三项用户裁定合一）：
 * ① 第二段=所属公司（User.company 展示快照，无公司归属回退部门名）——此前恒部门名；
 * ② 顺序=组长第一、正选在前、候补在后——此前靠 DB 中文 collation 随机；
 * ③ 写入闸=专家组确认完毕（无待回复正选）才允许名单存在——此前抽取确认/补选追加即全量
 *    落库，待回复/已婉拒专家带「正选」提前进基本信息（SWHI-TP-2026112601 实录：
 *    0/5 确认即 6 人全显示正选）。
 * 重建=BidExpert 名册按「成员=已确认参加 ∪ 需求方代表（婉拒不入·除名口径）」重算：
 * 组建未完毕 → 清空 expertInfo（重抽场景旧名单同样不该留）；无 BidExpert 行 → 不动。
 * 与抽取确认/归档兜底/面板同步三写端同口径。dry-run 只打印差异，--execute 实际回写。
 *
 *   npx tsx scripts/fix-pmi-expertinfo-company.ts            # dry-run（含 expertInfo 为空的组建中项目）
 *   npx tsx scripts/fix-pmi-expertinfo-company.ts --execute  # 回写
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const flat = (v: string | null | undefined) => (v ?? '').replace(/[\r\n]+/g, ' ').trim();

/** null=无 BidExpert 名册（不动）；''=组建未完毕或确认成员为空（应清空）；其余=重建串 */
async function rebuildExpertInfo(pmiId: string): Promise<string | null> {
  const bpIds = await prisma.bidProject.findMany({
    where: { projectManagementItemId: pmiId },
    select: { id: true },
  });
  const bpIdSet = bpIds.map((b) => b.id);
  const bidExperts = bpIdSet.length > 0
    ? await prisma.bidExpert.findMany({
        where: { projectId: { in: bpIdSet } },
        orderBy: [{ createdAt: 'asc' }],
        select: {
          expertName: true, major: true, expertRole: true, isLead: true, isPurchaserRepresentative: true, invitationStatus: true,
          user: { select: { company: true, department: { select: { name: true } }, expertProfile: { select: { title: true } } } },
        },
      })
    : [];
  if (bidExperts.length === 0) return null;
  const hasPendingRegular = bidExperts.some(e => e.expertRole === '正选' && !e.isPurchaserRepresentative && e.invitationStatus === 'pending');
  const members = bidExperts.filter(e => e.isPurchaserRepresentative || e.invitationStatus === 'confirmed');
  if (hasPendingRegular || members.length === 0) return '';
  // 名单顺序（2026-11-26 用户裁定：组长第一、正选在前、候补在后）——与抽取确认回写同口径
  const rank = (e: (typeof members)[number]) => (e.isLead ? 0 : e.expertRole === '候补' ? 2 : 1);
  const ordered = [...members].sort((a, b) => rank(a) - rank(b));
  return ordered
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
  const scanPending = process.argv.includes('--include-empty');
  const items = await prisma.projectManagementItem.findMany({
    where: scanPending ? {} : { expertInfo: { not: null } },
    select: { id: true, title: true, expertInfo: true },
    orderBy: { updatedAt: 'desc' },
  });

  let fixed = 0;
  for (const item of items) {
    const rebuilt = await rebuildExpertInfo(item.id);
    if (rebuilt === null) continue; // 无名册：非专家项目，不动
    if (rebuilt === (item.expertInfo ?? '')) continue; // 幂等（'' 与 null 等价）
    if (!execute) {
      if (rebuilt === '') {
        console.log(`[dry-run] ${item.id} 「${item.title}」 组建未完毕/无确认成员 → 清空现有名单（${String(item.expertInfo ?? '').split('\n').length} 行）`);
      } else {
        console.log(`[dry-run] ${item.id} 「${item.title}」`);
        const oldLines = String(item.expertInfo ?? '').split('\n').filter(Boolean);
        const newLines = rebuilt.split('\n');
        for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
          const o = String(oldLines[i] ?? '');
          const n = String(newLines[i] ?? '');
          if (o === n) continue;
          const sameName = o.split('|')[0] === n.split('|')[0];
          console.log(sameName
            ? `    ${o.split('|')[0]}: ${o.split('|')[1] ?? '(无)'} → ${n.split('|')[1] ?? '(无)'}`
            : `    第${i + 1}行 [旧] ${o}\n         [新] ${n}`);
        }
      }
    } else {
      await prisma.projectManagementItem.update({ where: { id: item.id }, data: { expertInfo: rebuilt === '' ? null : rebuilt } });
      console.log(rebuilt === ''
        ? `[cleared] ${item.id} 「${item.title}」（组建未完毕/无确认成员，已清空）`
        : `[fixed] ${item.id} 「${item.title}」`);
    }
    fixed++;
  }
  console.log(execute ? `回写完成：${fixed}/${items.length} 条。` : `dry-run：待回写 ${fixed}/${items.length} 条（加 --execute 执行）。`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
