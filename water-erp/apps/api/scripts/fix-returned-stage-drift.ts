/**
 * 一次性修正（2026-11-23，spec §3.3）：RETURNED 状态被 approve 推进级产生的悬挂态
 * （status=RETURNED + reviewStage 已越过最后一次退回记录的级；生产实录 SUP-000016）。
 * 修正 = reviewStage 拨回最后一次 RETURNED 记录的 stage（供应商补正链不断，重提后从该级续审）；
 * 同时恢复 returnReason——缺陷 approve 推进路径曾清空该列（supplier.service 推进写 returnReason:null），
 * 原始退回原因仍留在 RETURNED 留痕记录的 reason 中，仅在现值为空且留痕有值时回填。
 * 通过留痕保留，另写 AuditLog 修正留痕。幂等：级已拨回且原因无需恢复则跳过。--dry-run 只列清单不写库。
 * 运行：cd apps/api && npx tsx scripts/fix-returned-stage-drift.ts [--dry-run]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const returned = await prisma.supplier.findMany({
    where: { status: 'RETURNED' },
    select: { id: true, name: true, supplierNo: true, reviewStage: true, returnReason: true, userId: true },
  });
  let fixed = 0;
  for (const s of returned) {
    const records = await prisma.supplierApprovalRecord.findMany({
      where: { supplierId: s.id, action: { in: ['RETURNED', 'APPROVED'] } },
      orderBy: { createdAt: 'asc' },
      select: { action: true, stage: true, reason: true, createdAt: true },
    });
    const lastReturned = [...records].reverse().find((r) => r.action === 'RETURNED');
    if (!lastReturned) continue;
    const approvedAfter = records.some((r) => r.action === 'APPROVED' && r.createdAt > lastReturned.createdAt);
    if (!approvedAfter) continue;
    const target = lastReturned.stage ?? 'STAFF';
    const targetReason = lastReturned.reason ?? null;
    const stageDirty = (s.reviewStage ?? 'STAFF') !== target;
    const reasonDirty = !s.returnReason && !!targetReason;
    if (!stageDirty && !reasonDirty) continue; // 幂等：级已拨回且原因无需恢复则跳过
    const label = [
      stageDirty ? `reviewStage ${s.reviewStage ?? 'STAFF'} → ${target}` : null,
      reasonDirty ? '恢复退回原因' : null,
    ].filter(Boolean).join('；');
    console.log(`${dryRun ? '[dry-run] ' : ''}${s.supplierNo} ${s.name}: ${label}`);
    if (dryRun) { fixed++; continue; }
    const data: { reviewStage?: string; returnReason?: string | null } = {};
    if (stageDirty) data.reviewStage = target;
    if (reasonDirty) data.returnReason = targetReason;
    await prisma.$transaction([
      prisma.supplier.update({ where: { id: s.id }, data }),
      prisma.auditLog.create({
        data: {
          userId: s.userId,
          action: 'SUPPLIER_STAGE_ROLLBACK_FIX',
          resourceType: '供应商注册审批',
          resourceId: s.supplierNo ?? s.id,
          details: {
            reason: '悬挂态修正（RETURNED 被 approve 推进级，2026-11-23 修复前存量）',
            from: s.reviewStage,
            to: stageDirty ? target : s.reviewStage,
            returnReasonRestored: reasonDirty ? targetReason : undefined,
          },
        },
      }),
    ]);
    fixed++;
  }
  console.log(`${dryRun ? '[dry-run] ' : ''}完成：检出并${dryRun ? '列出' : '修正'} ${fixed} 条悬挂态`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
