/**
 * Seed —— 从 prisma/seed-data/*.json 重建数据库到一个固定快照状态。
 *
 * 工作方式
 *   1. 先 `TRUNCATE ... RESTART IDENTITY CASCADE` 清空全部业务表（与 _prisma_migrations 无关）；
 *   2. 再按外键依赖顺序 `createMany` 把 JSON 快照写回（空快照 `[]` 即空操作）。
 * 由此 seed 是幂等的：多次运行结果一致，始终复现同一份数据快照。
 *
 * 数据来源
 *   `npx tsx prisma/scripts/dump-seed.ts`  从真实库导出全部 28 张业务表为 seed-data/*.json。
 *   需要更新快照时：先改库，再重跑 dump-seed.ts，最后提交新的 JSON 文件即可。
 *
 * 账号说明
 *   seed 直接写回库中真实的 bcrypt 口令哈希，因此登录口令与导出时一致；
 *   常用演示账号沿用 `<用户名>@2026` 约定（见下方输出）。
 *
 * 注意
 *   `ProcurementProject.json` 为空——导出快照前该表数据已被一次失败的 seed 清空且未能恢复，
 *   故 BudgetList 的 procurementProjectId 一并被置空。如需采购立项演示数据，请重新创建后重跑 dump。
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const prisma = new PrismaClient();
const dataDir = join(__dirname, 'seed-data');

/** 读取一张表的 JSON 快照。 */
function load<T = Record<string, unknown>[]>(name: string): T {
  return JSON.parse(readFileSync(join(dataDir, `${name}.json`), 'utf-8')) as T;
}

// 所有业务表名（共 32 张，不含 Prisma 内部的 _prisma_migrations）。
const ALL_TABLES = [
  'BudgetItem', 'BudgetList',
  'BidDocumentAccess', 'BidDocument', 'AnnouncementAttachment',
  'BidClarification', 'BidOpeningRecord', 'BidScoreRecord', 'BidSupervisionLog',
  'SupplierBidSubmission', 'SupplierChangeRecord', 'SupplierContact',
  'SupplierEvaluation', 'SupplierQualification',
  'ExpertEvaluation', 'ExpertProfile', 'BidExpert', 'BidScoreItem',
  'BidArchiveItem', 'BidOpeningSession', 'BidSupplier',
  'FileAsset', 'ProcurementProject', 'Notification', 'NotificationDeliveryLog', 'Announcement',
  'CatalogItem', 'SupplierClassification', 'Supplier', 'BidProject',
  'User', 'Department', 'PriceHistory',
  'UserFavorite', 'AuditLog',
  'SupplierCatalogApplication', 'CatalogSupplier',
  'AssistantConversation', 'AssistantMessage', 'AssistantActionLog',
  'BidEvaluationResult',
] as const;

// 按外键依赖分三层写入（父表在前）。空快照 createMany 等价于空操作。
const SEED_ORDER: ReadonlyArray<[tableName: string, delegate: keyof PrismaClient]> = [
  // Level 0 —— 无外键
  ['Department', 'department'],
  ['BidProject', 'bidProject'],
  ['Announcement', 'announcement'],
  ['CatalogItem', 'catalogItem'],
  ['PriceHistory', 'priceHistory'],
  // Level 1 —— 依赖 Level 0
  ['User', 'user'],
  ['SupplierClassification', 'supplierClassification'],
  ['ProcurementProject', 'procurementProject'],
  ['FileAsset', 'fileAsset'],
  ['ExpertProfile', 'expertProfile'],
  ['Notification', 'notification'],
  ['ExpertEvaluation', 'expertEvaluation'],
  ['Supplier', 'supplier'],
  ['BidSupplier', 'bidSupplier'],
  ['BidExpert', 'bidExpert'],
  ['BidScoreItem', 'bidScoreItem'],
  ['BidOpeningSession', 'bidOpeningSession'],
  ['BidArchiveItem', 'bidArchiveItem'],
  ['BudgetList', 'budgetList'],
  ['AssistantConversation', 'assistantConversation'],
  // Level 2 —— 依赖 Level 1
  ['SupplierContact', 'supplierContact'],
  ['SupplierQualification', 'supplierQualification'],
  ['SupplierEvaluation', 'supplierEvaluation'],
  ['SupplierChangeRecord', 'supplierChangeRecord'],
  ['SupplierBidSubmission', 'supplierBidSubmission'],
  ['BidScoreRecord', 'bidScoreRecord'],
  ['BidOpeningRecord', 'bidOpeningRecord'],
  ['BidClarification', 'bidClarification'],
  ['BidSupervisionLog', 'bidSupervisionLog'],
  ['BudgetItem', 'budgetItem'],
  ['AnnouncementAttachment', 'announcementAttachment'],
  ['BidDocument', 'bidDocument'],
  ['BidDocumentAccess', 'bidDocumentAccess'],
  ['UserFavorite', 'userFavorite'], // Level 2：依赖 User + CatalogItem
  ['AuditLog', 'auditLog'], // Level 2：依赖 User
  ['SupplierCatalogApplication', 'supplierCatalogApplication'], // Level 2：依赖 Supplier + CatalogItem
  ['CatalogSupplier', 'catalogSupplier'], // Level 2：依赖 CatalogItem + Supplier
  ['AssistantMessage', 'assistantMessage'], // Level 2：依赖 AssistantConversation
  ['AssistantActionLog', 'assistantActionLog'], // Level 2：依赖 AssistantConversation（可选）
  ['BidEvaluationResult', 'bidEvaluationResult'], // Level 2：依赖 BidProject
];

async function main() {
  console.log('▶ 清空业务表（TRUNCATE … RESTART IDENTITY CASCADE）');
  const tableList = ALL_TABLES.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE;`);

  console.log('▶ 按外键依赖顺序写入快照');
  for (const [tableName, delegate] of SEED_ORDER) {
    const rows = load(tableName) as Record<string, unknown>[];
    if (rows.length === 0) continue; // 空快照跳过
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma[delegate] as any).createMany({ data: rows });
    console.log(`    ${tableName}: ${rows.length}`);
  }

  const counts = {
    用户: await prisma.user.count(),
    供应商: await prisma.supplier.count(),
    供应商联系人: await prisma.supplierContact.count(),
    供应商资质: await prisma.supplierQualification.count(),
    供应商分类: await prisma.supplierClassification.count(),
    采购目录: await prisma.catalogItem.count(),
    公告: await prisma.announcement.count(),
    招标项目: await prisma.bidProject.count(),
    通知: await prisma.notification.count(),
    专家档案: await prisma.expertProfile.count(),
    预算清单: await prisma.budgetList.count(),
  };
  console.log('\n✔ Seed 完成，关键表行数：');
  for (const [k, v] of Object.entries(counts)) console.log(`    ${k}: ${v}`);

  console.log('\n  各门户独立账号（每端口需单独登录，口令沿用 <用户名>@2026）：');
  console.log('    [信息门户   :3002]  公开访问，无需登录');
  console.log('    [电子商城   :3003]  mall / mall@2026');
  console.log('    [供应商端   :3004]  supplier1 / supplier1@2026');
  console.log('    [采购管理端 :3005]  caigou / caigou@2026');
  console.log('    [专家评标   :3006]  wangjg / wangjg@2026 · liuxm / liuxm@2026 · chenzq / chenzq@2026');
  console.log('    [开评标管理端 :3007]  lizhuren / lizhuren@2026');
}

main()
  .catch((e) => {
    console.error('Seed 失败：', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
