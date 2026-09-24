/**
 * 演示前复用清扫：BidExpert.isLead 残留体检与修复。
 *
 * 背景（2026-09-24 专家替换复审裁定）：
 *   - swapExpertRole 在 a896ae12 前不转移 isLead——换出组长会把组长标记留在被降为
 *     候补的行上（组长席空缺 → 末签/异议/表决链死锁）；
 *   - autoPromoteCandidate 在 73456f4d 前不转移 isLead——组长婉拒/过期递补后残留 declined 行。
 *   新代码已不再产生残留；历史数据与恢复的演示快照可能携带。
 *
 * 用法：
 *   npx tsx apps/api/scripts/sweep-stale-lead.ts            # dry-run（默认，零副作用，仅清单）
 *   npx tsx apps/api/scripts/sweep-stale-lead.ts --execute  # 执行修复
 *   dry-run 与 --execute 按相同逻辑判定（仅读库），dry-run 清单即 execute 的修复集。
 *
 * 修复规则（每项目独立）：
 *   1. 残留清除：isLead=true 且（expertRole='候补' 或 invitationStatus='declined'）→ isLead=false
 *   2. 清除后若组长空缺（无活跃正选组长）且项目非终态（ARCHIVED/ABORTED 除外）且有活跃正选：
 *      任命最早创建的非采购人代表活跃正选为组长（P1-7 采购人代表不得任组长）；
 *      活跃正选全为代表 → 只报告不任命（留 PATCH /expert-admin/extract/leader 人工处置）
 *   3. 活跃组长 >1：保留最早创建者，其余清为 false
 *
 * 范围裁定：终态项目（ARCHIVED/ABORTED）只进报告不动数据——归档即证据，
 * 运行时闸门（末签/表决）不再消费其 isLead。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface Fix {
  projectId: string;
  projectName: string;
  stage: string;
  clearStale: { id: string; expertName: string; role: string; inv: string }[];
  clearDuplicate: { id: string; expertName: string }[];
  appoint: { id: string; expertName: string } | null;
  leadVacantAllRep: boolean; // 活跃正选全为采购人代表 → 组长留空待人工
}

const ACTIVE_ROLES = (e: { expertRole: string; invitationStatus: string }) =>
  e.expertRole === '正选' && e.invitationStatus !== 'declined';

async function main() {
  const execute = process.argv.includes('--execute');

  const projects = await prisma.bidProject.findMany({
    select: {
      id: true, name: true, stage: true,
      experts: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, expertName: true, expertRole: true, invitationStatus: true, isLead: true, isPurchaserRepresentative: true, createdAt: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const fixes: Fix[] = [];
  for (const p of projects) {
    const clearStale = p.experts
      .filter(e => e.isLead && (e.expertRole === '候补' || e.invitationStatus === 'declined'))
      .map(e => ({ id: e.id, expertName: e.expertName, role: e.expertRole, inv: e.invitationStatus }));
    // 清残留后的活跃组长（正选 + 非 declined + isLead）
    const staleIds = new Set(clearStale.map(s => s.id));
    const activeLeads = p.experts.filter(e => e.isLead && !staleIds.has(e.id) && ACTIVE_ROLES(e));
    const clearDuplicate = activeLeads.slice(1).map(e => ({ id: e.id, expertName: e.expertName }));

    const isTerminal = p.stage === 'ARCHIVED' || p.stage === 'ABORTED';
    const activeRegulars = p.experts.filter(e => ACTIVE_ROLES(e));
    const nonRepRegulars = activeRegulars.filter(e => !e.isPurchaserRepresentative);
    let appoint: Fix['appoint'] = null;
    let leadVacantAllRep = false;
    if (!isTerminal && activeLeads.length === 0 && activeRegulars.length > 0) {
      const candidate = nonRepRegulars[0];
      if (candidate) appoint = { id: candidate.id, expertName: candidate.expertName };
      else leadVacantAllRep = true;
    }
    if (clearStale.length || clearDuplicate.length || appoint || leadVacantAllRep) {
      fixes.push({ projectId: p.id, projectName: p.name, stage: p.stage, clearStale, clearDuplicate, appoint, leadVacantAllRep });
    }
  }

  if (fixes.length === 0) {
    console.log(`体检 ${projects.length} 个项目：isLead 标记全部健康，无需修复。`);
    return;
  }

  for (const f of fixes) {
    console.log(`\n项目【${f.projectName}】(${f.stage}) ${f.projectId}`);
    for (const s of f.clearStale) console.log(`  清残留: ${s.expertName}（role=${s.role}, inv=${s.inv}）→ isLead=false`);
    for (const d of f.clearDuplicate) console.log(`  清重复: ${d.expertName} → isLead=false`);
    if (f.appoint) console.log(`  补任命: ${f.appoint.expertName} → isLead=true（最早非采购人代表活跃正选）`);
    if (f.leadVacantAllRep) console.log(`  ⚠ 组长空缺且活跃正选全为采购人代表——不自动任命，请走 PATCH /expert-admin/extract/leader`);
  }

  if (!execute) {
    console.log(`\ndry-run：共 ${fixes.length} 个项目待修复。加 --execute 执行（dry-run 清单即修复集）。`);
    return;
  }

  for (const f of fixes) {
    await prisma.$transaction(async (tx) => {
      if (f.clearStale.length) {
        await tx.bidExpert.updateMany({ where: { id: { in: f.clearStale.map(s => s.id) } }, data: { isLead: false } });
      }
      if (f.clearDuplicate.length) {
        await tx.bidExpert.updateMany({ where: { id: { in: f.clearDuplicate.map(d => d.id) } }, data: { isLead: false } });
      }
      if (f.appoint) {
        await tx.bidExpert.update({ where: { id: f.appoint.id }, data: { isLead: true } });
        await tx.bidSupervisionLog.create({
          data: {
            projectId: f.projectId, time: new Date(), role: '系统清扫', target: '评标委员会组成',
            action: 'isLead 残留清扫', result: `任命【${f.appoint.expertName}】为组长（演示前清扫脚本）`, riskFlag: '低',
          },
        }).catch(() => {/* 日志失败不阻塞 */});
      }
    });
  }
  console.log(`\n已执行：修复 ${fixes.length} 个项目。`);
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
