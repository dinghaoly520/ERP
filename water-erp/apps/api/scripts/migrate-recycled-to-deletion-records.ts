/**
 * 一次性迁移（spec 2026-11-12 §9 裁定 #5）：回收站暂存态废除，存量 RECYCLED 项目
 * 经与 deletePermanently 同口径的删除管线转为移除记录（墓碑）。
 * 幂等：无 RECYCLED 行时直接退出。跑法：cd apps/api && pnpm exec tsx scripts/migrate-recycled-to-deletion-records.ts
 */
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateOne(pm: { id: string }) {
  const project = await prisma.projectManagementItem.findUnique({
    where: { id: pm.id },
    select: {
      id: true, title: true, projectCode: true, requesterName: true, requesterDepartment: true,
      procurementMethod: true, budgetAmount: true, companyId: true, companyName: true,
      createdById: true, terminatedAt: true, terminationReason: true, terminatedStage: true,
      terminatedProcurementRoundId: true, terminatedById: true, recycledAt: true,
    },
  });
  if (!project) return;

  const users = await prisma.user.findMany({
    where: { id: { in: [project.terminatedById].filter((x): x is string => Boolean(x)) } },
    select: { id: true, displayName: true, username: true },
  });
  const nameOf = (uid?: string | null) => {
    const u = users.find((x) => x.id === uid);
    return u?.displayName || u?.username || null;
  };

  const round = project.terminatedProcurementRoundId
    ? await prisma.procurementRound.findUnique({
        where: { id: project.terminatedProcurementRoundId },
        select: { id: true, roundNo: true, projectId: true },
      })
    : null;

  const stageIds = await prisma.projectManagementStage.findMany({
    where: { projectManagementItemId: project.id },
    select: { id: true },
  });
  const attachmentWhere = {
    OR: [
      { projectManagementItemId: project.id },
      ...(stageIds.length > 0 ? [{ projectManagementStageId: { in: stageIds.map((s) => s.id) } }] : []),
      ...(round ? [{ procurementRoundId: round.id }] : []),
    ],
  };
  const attachments = await prisma.attachment.findMany({ where: attachmentWhere, select: { objectKey: true } });

  await prisma.$transaction(async (tx) => {
    await tx.projectDeletionRecord.create({
      data: {
        projectId: project.id,
        title: project.title,
        projectCode: project.projectCode,
        requesterName: project.requesterName,
        requesterDepartment: project.requesterDepartment,
        procurementMethod: project.procurementMethod,
        budgetAmount: project.budgetAmount,
        companyId: project.companyId,
        companyName: project.companyName,
        createdById: project.createdById,
        terminatedAt: project.terminatedAt,
        terminationReason: project.terminationReason,
        terminatedStage: project.terminatedStage,
        terminatedByName: nameOf(project.terminatedById),
        terminatedRoundNo: round?.roundNo ?? null,
        recycledAt: project.recycledAt,
        deletedByName: '系统迁移',
      },
    });
    await tx.attachment.deleteMany({ where: attachmentWhere });
    if (round) {
      await tx.procurementRound.delete({ where: { id: round.id } });
      const remaining = await tx.procurementRound.count({ where: { projectId: round.projectId } });
      if (remaining === 0) {
        await tx.project.delete({ where: { id: round.projectId } });
      }
    }
    await tx.projectManagementItem.delete({ where: { id: project.id } });
  });

  for (const att of attachments) {
    try {
      await unlink(resolve(process.cwd(), 'uploads', att.objectKey));
    } catch {
      // 文件可能已不存在，继续
    }
  }
}

async function main() {
  const recycled = await prisma.projectManagementItem.findMany({
    where: { status: 'RECYCLED' },
    select: { id: true, title: true },
  });
  if (recycled.length === 0) {
    console.log('[migrate] 无 RECYCLED 存量，跳过。');
    return;
  }
  console.log(`[migrate] 待清转 ${recycled.length} 行：${recycled.map((r) => r.title).join('、')}`);
  for (const r of recycled) {
    await migrateOne(r);
    console.log(`  ✓ ${r.title}（${r.id}）`);
  }
  const left = await prisma.projectManagementItem.count({ where: { status: 'RECYCLED' } });
  const tombs = await prisma.projectDeletionRecord.count();
  console.log(`[migrate] 完成：剩余 RECYCLED=${left}，移除记录总数=${tombs}`);
}

main().catch((e) => { console.error('[migrate ERROR]', e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
