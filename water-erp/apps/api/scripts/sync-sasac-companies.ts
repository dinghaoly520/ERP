/**
 * 幂等同步（2026-11-10 生产实录：专家导入归属指定面板只见 3 家公司）：
 * 把集团全级次企业名单（SASAC_UNITS 62 家，与 :3005 注册页公司名单同源）物化进
 * Company 主数据表——专家导入归属面板/admin 公司选择器/注册查重都读 DB 主数据，
 * 名单缺档的公司无从选择、无从归属。
 *
 * - 按名称精确匹配：既有公司（seed curated/历次注册建档）一律不动——shortName/code
 *   是人工维护的项目编号前缀（SWHI 等），SASAC 名单的 18 位是社会信用代码，语义不同不写入
 * - 别名归并（NAME_ALIASES）：种子/历史简写拼写与名单官方拼写并存时，保留既有行
 *   （id/编号前缀/人员归属不动）改名为官方拼写，两行并存则先并再改——防主数据分叉
 * - 幂等：重复执行只补缺，安全；生产跑一次即可
 */
import { PrismaClient } from '@prisma/client';
import { SASAC_UNITS } from '@water-erp/shared';

const prisma = new PrismaClient();

/** 种子/历史简写 → 名单官方拼写（同步时改名并轨；新增别名在此登记） */
const NAME_ALIASES: Record<string, string> = {
  '引大济岷水资源开发有限公司': '四川省引大济岷水资源开发有限公司',
};

/** 持 companyId 的模型（12 个 FK 关系 + SupplierObjection/Contract 裸列）——两行并轨时迁移归属 */
const COMPANY_ID_MODELS = [
  'companyPlace', 'companySupervision', 'companyPurchaser', 'department', 'user',
  'bidProject', 'supplierObjection', 'supplier', 'supplierCompanyLink', 'announcement',
  'procurementProject', 'procurementRound', 'projectManagementItem', 'contract',
] as const;

async function mergeAliases() {
  let renamed = 0;
  for (const [oldName, newName] of Object.entries(NAME_ALIASES)) {
    const oldRow = await prisma.company.findUnique({ where: { name: oldName } });
    if (!oldRow) continue;
    const newRow = await prisma.company.findUnique({ where: { name: newName } });
    if (newRow) {
      // 两行并存（注册/导入按官方拼写已建过档）：把新行归属全部迁到旧行（保 id/前缀）后删新行
      for (const m of COMPANY_ID_MODELS) {
        await (prisma as any)[m].updateMany({ where: { companyId: newRow.id }, data: { companyId: oldRow.id } });
      }
      await prisma.company.delete({ where: { id: newRow.id } });
      console.log(`别名并轨：删重复行「${newName}」（${newRow.id}），归属迁入既有行 ${oldRow.id}`);
    }
    await prisma.company.update({ where: { id: oldRow.id }, data: { name: newName } });
    // User.company 是展示快照；拼写归一属订正而非公司改名，快照同步订正避免新旧拼写混排
    await prisma.user.updateMany({ where: { company: oldName }, data: { company: newName } });
    console.log(`别名改名：「${oldName}」→「${newName}」（保留 id=${oldRow.id}）`);
    renamed++;
  }
  return renamed;
}

async function main() {
  // 名单自检：重名会在按名补缺语义下静默并轨，先炸出来
  const names = SASAC_UNITS.map((u) => u.name);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  if (dup.length > 0) throw new Error(`SASAC_UNITS 存在重名：${dup.join('、')}`);

  const aliasesFixed = await mergeAliases();

  const existing = new Set(
    (await prisma.company.findMany({ select: { name: true } })).map((c) => c.name),
  );
  let created = 0;
  for (const u of SASAC_UNITS) {
    if (existing.has(u.name)) continue;
    await prisma.company.create({ data: { name: u.name } });
    created++;
  }
  console.log(
    `公司主数据同步：名单 ${SASAC_UNITS.length} 家，新建 ${created} 家，既有 ${SASAC_UNITS.length - created} 家（未改动），别名归并 ${aliasesFixed} 处`,
  );
  console.log(`Company 主数据现存共 ${await prisma.company.count()} 家`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
