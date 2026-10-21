/**
 * 存量越权项目关联扫描（2026-10-21 工作台审计落地）：
 * work-arrangements 的项目关联合法性闸（validateProjectLink 与 PmiOwnershipGuard
 * 读口径同源）只挡增量——修复前建立的任务↔项目关联可能越出当前账号可见范围
 * （借 list include 与 AI 简报载荷外带项目标题/阶段/状态）。
 *
 * 口径：创建人 / admin / 本公司 leader 之外即越权。
 * 用法：
 *   npx tsx scripts/scan-work-arrangement-project-links.ts           # dry-run，仅报告
 *   npx tsx scripts/scan-work-arrangement-project-links.ts --fix     # 解除越权关联（置 null）
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const FIX = process.argv.includes('--fix');

async function main() {
  const rows = await prisma.workArrangement.findMany({
    where: { projectManagementItemId: { not: null } },
    select: {
      id: true,
      title: true,
      userId: true,
      projectManagementItemId: true,
      user: { select: { id: true, username: true, role: true, companyId: true } },
      projectManagementItem: { select: { id: true, title: true, projectCode: true, createdById: true, companyId: true } },
    },
  });

  const violations = rows.filter((row) => {
    const project = row.projectManagementItem;
    const user = row.user;
    if (!project || !user) return false; // 项目或用户已删——孤儿关联由外键/清理流程处理
    if (project.createdById === user.id) return false; // 创建人
    if (user.role === 'admin') return false; // admin 全量
    if (user.role === 'leader' && user.companyId && project.companyId === user.companyId) return false; // 本公司 leader
    return true;
  });

  if (violations.length === 0) {
    console.log(`扫描 ${rows.length} 条带项目关联的工作安排：无越权关联。`);
    return;
  }

  console.log(`扫描 ${rows.length} 条带项目关联的工作安排，越权 ${violations.length} 条：`);
  for (const v of violations) {
    console.log(
      `  [${v.id}] "${v.title}" — 用户 ${v.user?.username}(${v.user?.role})` +
      ` → 项目 ${v.projectManagementItem?.projectCode ?? v.projectManagementItem?.id}` +
      ` "${v.projectManagementItem?.title}"（归属 ${v.projectManagementItem?.createdById === v.userId ? '本人' : '他人'}）`,
    );
  }

  if (!FIX) {
    console.log('\ndry-run：未改动数据。加 --fix 解除上述越权关联（projectManagementItemId 置 null）。');
    return;
  }

  const result = await prisma.workArrangement.updateMany({
    where: { id: { in: violations.map((v) => v.id) } },
    data: { projectManagementItemId: null },
  });
  console.log(`\n已解除 ${result.count} 条越权关联（projectManagementItemId → null）。`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
