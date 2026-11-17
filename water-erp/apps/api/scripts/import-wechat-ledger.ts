/**
 * 微信台账 Excel 导入（2026-11-17 用户裁定）：
 * 源表名称列合并单元格跨行——续行（名称空但有供应商/金额）= 同项目追加轮次；
 * 每项目 projectCode 留空；有供应商 → AWARDED（供应商文本快照+成交价）；
 * 无供应商 = 未开标 → PENDING 且不写成交价；部门按名匹配缺失则建；
 * 经办人按 displayName 匹配 User；sourceType=EXCEL_IMPORT + ImportBatch 批次留档。
 * 默认 dry-run；--execute 写库；--rollback=<batchId> 按批次整批回滚（连带删本项目组独占的 Project）。
 */
import { PrismaClient, ResultStatus, SourceType } from '@prisma/client';

const COMPANY = { id: 'co-swhi-sjy', name: '四川水发勘测设计研究有限公司' };
/** 方式名归一（2026-11-17 用户裁定）：旧名/变体 → 平台 canon——
 *  竞争性谈判|谈判→谈判采购；询比|询价|询价采购→询比采购；单一来源采购|单源直接采购→直接采购；
 *  内部竞标|竞价→竞价采购（直接委托/邀请招标/续约照录）。 */
const normalizeMethod = (m: string) => ({
  '竞争性谈判': '谈判采购', '谈判': '谈判采购',
  '询比': '询比采购', '询价': '询比采购', '询价采购': '询比采购',
  '单一来源采购': '直接采购', '单源直接采购': '直接采购',
  '内部竞标': '竞价采购', '竞价': '竞价采购',
}[m.trim()] ?? m.trim());
const UPLOADED_BY = 'cmrai35fx0001koddsw3fw8d1'; // Swhi-CGZX-admin

type Round = {
  date: string | null; method: string; department: string;
  budget: number | null; control: number | null; supplier: string | null;
  award: number | null; operator: string | null;
};
type Group = { name: string; rounds: Round[] };

async function main() {
  const prisma = new PrismaClient();
  const rollbackArg = process.argv.find(a => a.startsWith('--rollback='));
  if (rollbackArg) {
    const batchId = rollbackArg.split('=')[1];
    const rounds = await prisma.procurementRound.findMany({ where: { importBatchId: batchId }, select: { projectId: true } });
    const projectIds = [...new Set(rounds.map(r => r.projectId))];
    const del = await prisma.procurementRound.deleteMany({ where: { importBatchId: batchId } });
    const orphan = await prisma.project.deleteMany({ where: { id: { in: projectIds }, procurementRounds: { none: {} } } });
    await prisma.importBatch.delete({ where: { id: batchId } }).catch(() => undefined);
    console.log(`↩️ 回滚批次 ${batchId}：轮次 ${del.count}、独占项目 ${orphan.count}`);
    await prisma.$disconnect();
    return;
  }

  const execute = process.argv.includes('--execute');
  const groups: Group[] = require('/tmp/xlswork/groups.json');
  const deptNames = [...new Set(groups.flatMap(g => g.rounds.map(r => r.department)).filter(Boolean))];
  const existingDepts = await prisma.department.count({ where: { name: { in: deptNames } } });
  const deptMap = new Map<string, string>();
  for (const n of deptNames) {
    const found = await prisma.department.findFirst({ where: { name: n }, select: { id: true } });
    deptMap.set(n, found?.id ?? (await prisma.department.create({ data: { name: n } })).id);
  }
  const opNames = [...new Set(groups.flatMap(g => g.rounds.map(r => r.operator)).filter(Boolean))];
  const opUsers = await prisma.user.findMany({ where: { displayName: { in: opNames } }, select: { id: true, displayName: true } });
  const opMap = new Map(opUsers.map(u => [u.displayName!, u.id]));

  const roundCount = groups.reduce((s, g) => s + g.rounds.length, 0);
  const pending = groups.reduce((s, g) => s + g.rounds.filter(r => !r.supplier).length, 0);
  console.log(`项目 ${groups.length} 个 / 轮次 ${roundCount} 条（AWARDED ${roundCount - pending} + PENDING ${pending}）| 部门 ${deptMap.size}（新建 ${deptMap.size - existingDepts}）| 经办人匹配 ${opMap.size}/${opNames.length}`);
  if (!execute) {
    console.log('[dry-run] 多轮项目:', groups.filter(g => g.rounds.length > 1).map(g => `${g.name.slice(0, 12)}×${g.rounds.length}`).join('、'));
    console.log('[dry-run] 加 --execute 执行写库');
    await prisma.$disconnect();
    return;
  }

  let ok = 0;
  let batchId: string | undefined;
  await prisma.$transaction(async tx => {
    const batch = await tx.importBatch.create({
      data: { fileName: '新建 XLS 工作表(1).xls（微信收取·历史台账）', sourceMonth: '2026-11', rowCount: roundCount, uploadedById: UPLOADED_BY },
    });
    batchId = batch.id;
    for (const g of groups) {
      const project = await tx.project.create({
        data: {
          name: g.name,
          businessCategory: normalizeMethod(g.rounds[0].method),
          description: `历史台账导入（微信 Excel，${g.rounds.length} 轮）`,
          ...(g.rounds[0].department ? { requestingDepartmentId: deptMap.get(g.rounds[0].department) } : {}),
        },
      });
      for (const [i, r] of g.rounds.entries()) {
        await tx.procurementRound.create({
          data: {
            projectId: project.id,
            roundNo: i + 1,
            ...(r.date ? { procurementDate: new Date(r.date) } : {}),
            procurementMethod: normalizeMethod(r.method) || '未填',
            ...(r.department ? { departmentId: deptMap.get(r.department) } : {}),
            ...(r.budget != null ? { budgetAmount: String(r.budget) } : {}),
            ...(r.control != null ? { controlAmount: String(r.control) } : {}),
            ...(r.supplier
              ? { awardedSupplierName: r.supplier, ...(r.award != null ? { awardAmount: String(r.award) } : {}), resultStatus: ResultStatus.AWARDED, resultText: '已成交' }
              : { resultStatus: ResultStatus.PENDING, resultText: '未开标（历史台账导入，无供应商记录）' }),
            sourceType: SourceType.EXCEL_IMPORT,
            importBatchId: batch.id,
            ...(r.operator && opMap.has(r.operator) ? { createdById: opMap.get(r.operator) } : {}),
            companyId: COMPANY.id,
            companyName: COMPANY.name,
          },
        });
        ok++;
      }
    }
    await tx.importBatch.update({ where: { id: batch.id }, data: { successCount: ok } });
  }, { timeout: 120000 });
  console.log(`✅ 已导入 ${ok} 轮次（批次 ${batchId}）`);
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
