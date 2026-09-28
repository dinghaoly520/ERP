/**
 * 一次性回填（2026-09-28 直接采购 09 备案表阶段）：为存量直接采购项目补建
 * DIRECT_PURCHASE_FILING 阶段行（新项目由 METHOD_STAGE_TEMPLATES 自动带上，不再需要本脚本）。
 * 状态规则：
 *  - 项目 ARCHIVED → COMPLETED 补录（completedAt 取 archivedAt）
 *  - 合同已完成（未归档）→ IN_PROGRESS，currentStage 自 CONTRACT 推进到备案表
 *  - 其余 → NOT_STARTED
 * 幂等：已有该阶段行的项目跳过。
 */
import { PrismaClient } from '@prisma/client';
import { stageCodeFor } from '../src/common/project-code.util';

const prisma = new PrismaClient();

async function main() {
  const items = await prisma.projectManagementItem.findMany({
    where: { procurementMethod: '直接采购' },
    select: {
      id: true, status: true, currentStage: true, projectCode: true, archivedAt: true,
      stages: { select: { id: true, stageKey: true, stageOrder: true, status: true, round: true } },
    },
  });

  for (const item of items) {
    if (item.stages.some((s) => s.stageKey === 'DIRECT_PURCHASE_FILING')) continue;
    const contract = item.stages.find((s) => s.stageKey === 'CONTRACT');
    const round = contract?.round ?? 1;
    const order = item.stages.reduce((m, s) => Math.max(m, s.stageOrder), 0) + 1;

    let status: 'COMPLETED' | 'IN_PROGRESS' | 'NOT_STARTED' = 'NOT_STARTED';
    let completedAt: Date | null = null;
    if (item.status === 'ARCHIVED') {
      status = 'COMPLETED';
      completedAt = item.archivedAt ?? new Date();
    } else if (contract?.status === 'COMPLETED') {
      status = 'IN_PROGRESS';
    }

    await prisma.projectManagementStage.create({
      data: {
        projectManagementItemId: item.id,
        stageKey: 'DIRECT_PURCHASE_FILING',
        stageName: '直接采购备案表',
        stageOrder: order,
        round,
        stageCode: item.projectCode ? stageCodeFor(item.projectCode, 'DIRECT_PURCHASE_FILING', round) : null,
        status,
        completedAt,
      },
    });
    // 合同已完成未归档：项目指针推进到备案表（否则 09 卡永远「待解锁」）
    if (status === 'IN_PROGRESS' && item.currentStage === 'CONTRACT') {
      await prisma.projectManagementItem.update({
        where: { id: item.id },
        data: { currentStage: 'DIRECT_PURCHASE_FILING' },
      });
    }
    console.log(`${item.projectCode ?? item.id} → 直接采购备案表(${status}, order=${order}, round=${round})`);
  }
  console.log('回填完成');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
