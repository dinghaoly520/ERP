// 将当前数据库的全部业务表导出为 seed JSON 快照。
// 用法：npx tsx prisma/scripts/dump-seed.ts
//
// 导出「全部」业务表（含空表，空表写入 []），避免漏表。
// 由 seed.ts 按依赖顺序重新写入。Date → ISO 字符串、Decimal → 字符串，
// Prisma 的 createMany 均可直读。不导出 _prisma_migrations。
//
// 注意：本脚本会覆盖 seed-data/*.json。若仅想更新个别表，请先备份。

import { Prisma, PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const prisma = new PrismaClient();
const outDir = join(__dirname, '..', 'seed-data');
mkdirSync(outDir, { recursive: true });

/** 递归把 Prisma 运行时类型转成 JSON 安全结构。 */
function serialize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Prisma.Decimal) return value.toString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as object)) out[k] = serialize(v);
    return out;
  }
  return value;
}

// 全部业务表：[文件名(=模型名), Prisma 委托]。按依赖顺序排列。
const TABLES: ReadonlyArray<[file: string, delegate: keyof PrismaClient]> = [
  ['Department', 'department'],
  ['User', 'user'],
  ['UserSettings', 'userSettings'],
  ['PasswordChangeRequest', 'passwordChangeRequest'],
  ['PasswordResetRequest', 'passwordResetRequest'],
  ['SupplierClassification', 'supplierClassification'],
  ['Supplier', 'supplier'],
  ['SupplierContact', 'supplierContact'],
  ['SupplierQualification', 'supplierQualification'],
  ['SupplierEvaluation', 'supplierEvaluation'],
  ['SupplierChangeRecord', 'supplierChangeRecord'],
  ['SupplierBidSubmission', 'supplierBidSubmission'],
  ['SupplierCatalogApplication', 'supplierCatalogApplication'],
  ['CatalogItem', 'catalogItem'],
  ['CatalogSupplier', 'catalogSupplier'],
  ['PriceHistory', 'priceHistory'],
  ['UserFavorite', 'userFavorite'],
  ['Announcement', 'announcement'],
  ['AnnouncementAttachment', 'announcementAttachment'],
  ['ProcurementProject', 'procurementProject'],
  ['ProcurementRound', 'procurementRound'],
  ['RoundParticipant', 'roundParticipant'],
  ['Project', 'project'],
  ['ProjectManagementItem', 'projectManagementItem'],
  ['ProjectManagementStage', 'projectManagementStage'],
  ['BidProject', 'bidProject'],
  ['BidSupplier', 'bidSupplier'],
  ['BidExpert', 'bidExpert'],
  ['BidScoreItem', 'bidScoreItem'],
  ['BidScoreRecord', 'bidScoreRecord'],
  ['BidScoreDelta', 'bidScoreDelta'],
  ['BidOpeningSession', 'bidOpeningSession'],
  ['BidOpeningRecord', 'bidOpeningRecord'],
  ['BidClarification', 'bidClarification'],
  ['BidSupervisionLog', 'bidSupervisionLog'],
  ['BidSupervisionAnnotation', 'bidSupervisionAnnotation'],
  ['BidArchiveItem', 'bidArchiveItem'],
  ['BidEvaluationResult', 'bidEvaluationResult'],
  ['BidDocument', 'bidDocument'],
  ['BidDocumentAccess', 'bidDocumentAccess'],
  ['BidRequirementReview', 'bidRequirementReview'],
  ['BudgetList', 'budgetList'],
  ['BudgetItem', 'budgetItem'],
  ['AuditLog', 'auditLog'],
  ['ExpertProfile', 'expertProfile'],
  ['ExpertEvaluation', 'expertEvaluation'],
  ['Notification', 'notification'],
  ['NotificationDeliveryLog', 'notificationDeliveryLog'],
  ['AssistantConversation', 'assistantConversation'],
  ['AssistantMessage', 'assistantMessage'],
  ['AssistantActionLog', 'assistantActionLog'],
  ['AssistantAlert', 'assistantAlert'],
  ['FileAsset', 'fileAsset'],
  ['WorkArrangement', 'workArrangement'],
  ['WorkArrangementDailyPlanCache', 'workArrangementDailyPlanCache'],
  ['WorkArrangementDependency', 'workArrangementDependency'],
  ['WorkArrangementNote', 'workArrangementNote'],
  ['WorkArrangementTemplate', 'workArrangementTemplate'],
  ['ImportBatch', 'importBatch'],
  ['Attachment', 'attachment'],
  ['Contact', 'contact'],
  ['KnowledgeBase', 'knowledgeBase'],
  ['KnowledgeFile', 'knowledgeFile'],
  ['ComplianceRule', 'complianceRule'],
  ['ReviewTask', 'reviewTask'],
  ['TenderFieldSample', 'tenderFieldSample'],
  ['TenderDocumentHistory', 'tenderDocumentHistory'],
  ['ExtractionTask', 'extractionTask'],
  ['DocumentChunk', 'documentChunk'],
  ['AiBidAnalysisTask', 'aiBidAnalysisTask'],
  ['AiBidderResult', 'aiBidderResult'],
  ['AiBidReport', 'aiBidReport'],
  ['AiConcordanceResult', 'aiConcordanceResult'],
];

async function main() {
  console.log(`导出到 ${outDir}`);
  let total = 0;
  for (const [file, delegate] of TABLES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = serialize(await (prisma[delegate] as any).findMany()) as unknown[];
    writeFileSync(join(outDir, `${file}.json`), JSON.stringify(rows, null, 2));
    total += rows.length;
    console.log(`  ${file}.json  ←  ${rows.length} 行`);
  }
  console.log(`\n完成：${TABLES.length} 张表，共 ${total} 行。`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
