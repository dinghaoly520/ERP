/**
 * 一次性修正（2026-11-23，spec §3.3）：RETURNED 状态被 approve 推进级产生的悬挂态
 * （status=RETURNED + reviewStage 已越过最后一次退回记录的级；生产实录 SUP-000016）。
 * 修正 = reviewStage 拨回最后一次 RETURNED 记录的 stage（供应商补正链不断，重提后从该级续审）；
 * 通过留痕保留，另写 AuditLog 修正留痕。幂等：目标级已一致跳过。--dry-run 只列清单不写库。
 * 运行：cd apps/api && npx tsx scripts/fix-returned-stage-drift.ts [--dry-run]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const returned = await prisma.supplier.findMany({
    where: { status: 'RETURNED' },
    select: { id: true, name: true, supplierNo: true, reviewStage: true, userId: true },
  });
  let fixed = 0;
  for (const s of returned) {
    const records = await prisma.supplierApprovalRecord.findMany({
      where: { supplierId: s.id, action: { in: ['RETURNED', 'APPROVED'] } },
      orderBy: { createdAt: 'asc' },
      select: { action: true, stage: true, createdAt: true },
    });
    const lastReturned = [...records].reverse().find((r) => r.action === 'RETURNED');
    if (!lastReturned) continue;
    const approvedAfter = records.some((r) => r.action === 'APPROVED' && r.createdAt > lastReturned.createdAt);
    if (!approvedAfter) continue;
    const target = lastReturned.stage ?? 'STAFF';
    if ((s.reviewStage ?? 'STAFF') === target) continue; // 幂等：已拨回则跳过
    console.log(`${dryRun ? '[dry-run] ' : ''}${s.supplierNo} ${s.name}: reviewStage ${s.reviewStage ?? 'STAFF'} → ${target}`);
    if (dryRun) { fixed++; continue; }
    await prisma.$transaction([
      prisma.supplier.update({ where: { id: s.id }, data: { reviewStage: target } }),
      prisma.auditLog.create({
        data: {
          userId: s.userId,
          action: 'SUPPLIER_STAGE_ROLLBACK_FIX',
          resourceType: '供应商注册审批',
          resourceId: s.supplierNo ?? s.id,
          details: {
            reason: '悬挂态修正（RETURNED 被 approve 推进级，2026-11-23 修复前存量）',
            from: s.reviewStage,
            to: target,
          },
        },
      }),
    ]);
    fixed++;
  }
  console.log(`${dryRun ? '[dry-run] ' : ''}完成：检出并${dryRun ? '列出' : '修正'} ${fixed} 条悬挂态`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
